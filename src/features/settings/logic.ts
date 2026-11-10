// Regras puras do módulo de configurações (testáveis sem Supabase).
import type {
  Client,
  Contract,
  Demand,
  Installment,
  MemberRole,
  MemberWithProfile,
  OrganizationInvitation,
  Payment,
  Task,
} from '@/types/database'
import { isValidEmail, todayISO } from '@/lib/format'

export type SettingsTab = 'perfil' | 'escritorio' | 'equipe' | 'privacidade'
export const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: 'perfil', label: 'Perfil' },
  { value: 'escritorio', label: 'Escritório' },
  { value: 'equipe', label: 'Equipe' },
  { value: 'privacidade', label: 'Privacidade e LGPD' },
]

export function parseTab(v: string | null): SettingsTab {
  return SETTINGS_TABS.some((t) => t.value === v) ? (v as SettingsTab) : 'perfil'
}

// ---------------------------------------------------------------------------
// Validações
// ---------------------------------------------------------------------------
export function validateFullName(name: string): string | null {
  const n = name.trim()
  if (n.length < 2) return 'Informe seu nome (mínimo 2 caracteres).'
  if (n.length > 120) return 'O nome pode ter no máximo 120 caracteres.'
  return null
}

export function validateOrgName(name: string): string | null {
  const n = name.trim()
  if (n.length < 2) return 'Informe o nome do escritório (mínimo 2 caracteres).'
  if (n.length > 120) return 'O nome pode ter no máximo 120 caracteres.'
  return null
}

export function validatePassword(password: string, confirm: string): string | null {
  if (password.length < 8) return 'A senha deve ter pelo menos 8 caracteres.'
  if (password.length > 72) return 'A senha pode ter no máximo 72 caracteres.'
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use letras e números na senha.'
  if (password !== confirm) return 'As senhas não conferem.'
  return null
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Valida um novo convite contra membros e convites pendentes já existentes. */
export function validateInvitation(
  email: string,
  members: Pick<MemberWithProfile, 'active' | 'profile'>[],
  pending: Pick<OrganizationInvitation, 'email'>[],
): string | null {
  const e = normalizeEmail(email)
  if (!e) return 'Informe o e-mail.'
  if (!isValidEmail(e)) return 'E-mail inválido.'
  const member = members.find((m) => normalizeEmail(m.profile?.email ?? '') === e)
  if (member?.active) return 'Esta pessoa já faz parte da equipe.'
  if (pending.some((p) => normalizeEmail(p.email) === e)) return 'Já existe um convite pendente para este e-mail.'
  return null
}

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------
export function activeAdminCount(members: Pick<MemberWithProfile, 'role' | 'active'>[]): number {
  return members.filter((m) => m.role === 'admin' && m.active).length
}

/** true quando a alteração deixaria o escritório sem administrador ativo (o banco também bloqueia). */
export function wouldRemoveLastAdmin(
  members: Pick<MemberWithProfile, 'id' | 'role' | 'active'>[],
  target: Pick<MemberWithProfile, 'id' | 'role' | 'active'>,
  change: { role?: MemberRole; active?: boolean },
): boolean {
  if (target.role !== 'admin' || !target.active) return false
  const losesAdmin = (change.role !== undefined && change.role !== 'admin') || change.active === false
  return losesAdmin && activeAdminCount(members) <= 1
}

/** Ordena: ativos primeiro, depois admin → advogado → assistente, depois nome. */
export function sortMembers<T extends Pick<MemberWithProfile, 'active' | 'role' | 'profile'>>(members: T[]): T[] {
  const order: Record<MemberRole, number> = { admin: 0, advogado: 1, assistente: 2 }
  return [...members].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      order[a.role] - order[b.role] ||
      (a.profile?.full_name || a.profile?.email || '').localeCompare(b.profile?.full_name || b.profile?.email || '', 'pt-BR'),
  )
}

/** O que cada papel pode fazer — espelha a matriz da migration 003 (RLS). */
export const ROLE_CAPABILITIES: { resource: string; admin: string; advogado: string; assistente: string }[] = [
  { resource: 'Clientes — consultar, cadastrar e editar', admin: 'Sim', advogado: 'Sim', assistente: 'Sim' },
  { resource: 'Clientes — excluir e anonimizar', admin: 'Sim', advogado: 'Não', assistente: 'Não' },
  { resource: 'Demandas e tarefas — criar, editar, mover', admin: 'Sim', advogado: 'Sim', assistente: 'Sim' },
  { resource: 'Demandas e tarefas — excluir', admin: 'Sim', advogado: 'Sim', assistente: 'Não' },
  { resource: 'Fluxos de trabalho (categorias e etapas)', admin: 'Editar', advogado: 'Editar', assistente: 'Só leitura' },
  { resource: 'Contratos — criar e editar', admin: 'Sim', advogado: 'Sim', assistente: 'Só leitura' },
  { resource: 'Contratos — excluir', admin: 'Sim', advogado: 'Não', assistente: 'Não' },
  { resource: 'Pagamentos — registrar', admin: 'Sim', advogado: 'Sim', assistente: 'Sim' },
  { resource: 'Pagamentos — estornar/editar', admin: 'Sim', advogado: 'Sim', assistente: 'Não' },
  { resource: 'Equipe, convites e dados do escritório', admin: 'Sim', advogado: 'Não', assistente: 'Não' },
  { resource: 'Exportar dados de cliente (LGPD)', admin: 'Sim', advogado: 'Não', assistente: 'Não' },
  { resource: 'Conversas com o assistente de IA', admin: 'Só as próprias', advogado: 'Só as próprias', assistente: 'Só as próprias' },
]

// ---------------------------------------------------------------------------
// Portabilidade (LGPD art. 18, V): exportação dos dados de um cliente
// ---------------------------------------------------------------------------
export interface ClientExportInput {
  organizationName: string
  client: Client
  demands: Demand[]
  tasks: Task[]
  contracts: Contract[]
  installments: Installment[]
  payments: Payment[]
  generatedAt?: string
}

/** Remove campos internos de controle (ids de escritório/autor) que não são dados do titular. */
function strip<T extends object>(row: T): Omit<T, 'organization_id' | 'created_by'> {
  const copy = { ...row } as T & { organization_id?: unknown; created_by?: unknown }
  delete copy.organization_id
  delete copy.created_by
  return copy
}

export function buildClientExport(input: ClientExportInput) {
  const taskById = new Map<string, Task>()
  input.tasks.forEach((t) => taskById.set(t.id, t))
  return {
    formato: 'JurisFlow AI — exportação de dados do titular (LGPD, art. 18, V)',
    versao: 1,
    gerado_em: input.generatedAt ?? new Date().toISOString(),
    controlador: input.organizationName,
    observacao:
      'Contém os dados cadastrais do titular e os registros de atendimento e financeiros vinculados a ele. ' +
      'O sistema não armazena documentos (arquivos).',
    titular: strip(input.client),
    demandas: input.demands.map(strip),
    tarefas: [...taskById.values()].map(strip),
    contratos: input.contracts.map((c) => ({
      ...strip(c),
      parcelas: input.installments.filter((i) => i.contract_id === c.id).sort((a, b) => a.number - b.number).map(strip),
      pagamentos: input.payments.filter((p) => p.contract_id === c.id).map(strip),
    })),
  }
}

export function exportFileName(clientName: string, today: string = todayISO()): string {
  const slug =
    clientName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'cliente'
  return `dados-${slug}-${today}.json`
}
