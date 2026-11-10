// Monta as linhas da prévia: normaliza, valida, deduplica e decide a ação padrão.
// Funções puras (sem React/Supabase).
import { todayISO } from '@/lib/format'
import type { Client, ClientStatus } from '@/types/database'
import { addToIndex, createIndex, findMatch, MATCH_REASON_LABEL, type Match } from './dedupe'
import { FIELD_LABELS, IMPORT_FIELDS, type ImportField, type Mapping } from './mapping'
import {
  cellToString,
  normalizeBirthDate,
  normalizeClientStatus,
  normalizeCPF,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeText,
  type RawCell,
} from './normalize'

export type RowStatus = 'novo' | 'atualizar' | 'possivel' | 'duplicado' | 'erro'
export type RowAction = 'criar' | 'atualizar' | 'ignorar'

export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  novo: 'Novo',
  atualizar: 'Atualizar existente',
  possivel: 'Possível duplicado',
  duplicado: 'Duplicado — ignorar',
  erro: 'Erro',
}

/** Campos editáveis na prévia (texto bruto vindo da planilha). */
export type RowRaw = Partial<Record<ImportField, string>>

export interface RowValues {
  full_name: string | null
  cpf: string | null
  phone: string | null
  email: string | null
  birth_date: string | null
  address: string | null
  notes: string | null
  status: ClientStatus | null
  category: string | null
}

/** Cliente existente com os campos usados na deduplicação/complemento. */
export type ExistingClient = Pick<Client, 'id' | 'full_name' | 'cpf' | 'phone' | 'birth_date' | 'email' | 'address'>

export interface ImportRow {
  /** id estável: "L<linha da planilha>" */
  id: string
  /** número da linha na planilha (1 = cabeçalho quando houver) */
  line: number
  raw: RowRaw
  values: RowValues
  errors: Partial<Record<ImportField, string>>
  status: RowStatus
  /** correspondência encontrada (no cadastro ou em linha anterior da planilha) */
  match: (Match & { target: 'existing' | 'sheet'; label: string }) | null
  /** ação padrão para o status (o usuário pode sobrescrever) */
  defaultAction: RowAction
}

/** Extrai o texto de cada campo mapeado de uma linha da planilha. */
export function rawFromSheetRow(cells: RawCell[], mapping: Mapping): Partial<Record<ImportField, RawCell>> {
  const out: Partial<Record<ImportField, RawCell>> = {}
  for (const f of IMPORT_FIELDS) {
    const idx = mapping[f]
    if (idx !== undefined) out[f] = cells[idx] ?? null
  }
  return out
}

/** Normaliza todos os campos de uma linha. */
export function normalizeRow(raw: Partial<Record<ImportField, RawCell>>, today: string = todayISO()) {
  const name = normalizeName(raw.full_name)
  const cpf = normalizeCPF(raw.cpf)
  const phone = normalizePhone(raw.phone)
  const email = normalizeEmail(raw.email)
  const birth = normalizeBirthDate(raw.birth_date, today)
  const address = normalizeText(raw.address, 300)
  const notes = normalizeText(raw.notes, 4000)
  const status = normalizeClientStatus(raw.status)
  const category = normalizeText(raw.category, 80)
  const values: RowValues = {
    full_name: name.value,
    cpf: cpf.value,
    phone: phone.value,
    email: email.value,
    birth_date: birth.value,
    address: address.value,
    notes: notes.value,
    status: status.value,
    category: category.value,
  }
  const errors: Partial<Record<ImportField, string>> = {}
  if (name.error) errors.full_name = name.error
  if (cpf.error) errors.cpf = cpf.error
  if (phone.error) errors.phone = phone.error
  if (email.error) errors.email = email.error
  if (birth.error) errors.birth_date = birth.error
  return { values, errors }
}

export const DEFAULT_ACTION: Record<RowStatus, RowAction> = {
  novo: 'criar',
  atualizar: 'atualizar',
  possivel: 'criar',
  duplicado: 'ignorar',
  erro: 'ignorar',
}

/** Ações permitidas por status (erro só pode ser ignorado até ser corrigido). */
export function allowedActions(status: RowStatus): RowAction[] {
  switch (status) {
    case 'erro':
      return ['ignorar']
    case 'atualizar':
      return ['atualizar', 'criar', 'ignorar']
    case 'possivel':
      return ['criar', 'atualizar', 'ignorar']
    case 'duplicado':
      return ['ignorar', 'criar']
    default:
      return ['criar', 'ignorar']
  }
}

export interface DraftRow {
  id: string
  line: number
  raw: RowRaw
}

/** Converte a tabela da planilha em rascunhos de linha (texto bruto por campo). */
export function draftsFromTable(rows: RawCell[][], mapping: Mapping, firstLine: number): DraftRow[] {
  return rows.map((cells, i) => {
    const r = rawFromSheetRow(cells, mapping)
    const raw: RowRaw = {}
    for (const f of IMPORT_FIELDS) if (r[f] !== undefined) raw[f] = cellToString(normalizeDateCell(r[f]))
    return { id: `L${firstLine + i}`, line: firstLine + i, raw }
  })
}

/** Datas do .xlsx chegam como Date → converte para dd/mm/aaaa (texto editável). */
function normalizeDateCell(v: RawCell): RawCell {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const d = String(v.getUTCDate()).padStart(2, '0')
    const m = String(v.getUTCMonth() + 1).padStart(2, '0')
    return `${d}/${m}/${v.getUTCFullYear()}`
  }
  return v
}

/**
 * Classifica todas as linhas. Ordem de verificação por linha:
 *  1. erros de validação → 'erro'
 *  2. duplicado certo de linha ANTERIOR da planilha → 'duplicado'
 *  3. correspondência certa no cadastro → 'atualizar'
 *  4. correspondência possível (planilha ou cadastro) → 'possivel'
 *  5. senão → 'novo'
 */
export function classifyRows(drafts: DraftRow[], existing: ExistingClient[], today: string = todayISO()): ImportRow[] {
  const existingIdx = createIndex(
    existing.map((c) => ({ id: c.id, name: c.full_name, cpf: c.cpf, phone: c.phone, birthDate: c.birth_date })),
  )
  const existingById = new Map(existing.map((c) => [c.id, c]))
  const sheetIdx = createIndex()
  const lineById = new Map<string, number>()

  return drafts.map((d) => {
    const { values, errors } = normalizeRow(d.raw, today)
    const base = { id: d.id, line: d.line, raw: d.raw, values, errors }
    if (Object.keys(errors).length) {
      return { ...base, status: 'erro' as const, match: null, defaultAction: 'ignorar' as const }
    }
    const person = { id: d.id, name: values.full_name ?? '', cpf: values.cpf, phone: values.phone, birthDate: values.birth_date }
    const inSheet = findMatch(sheetIdx, person)
    const inBase = findMatch(existingIdx, person)
    addToIndex(sheetIdx, person)
    lineById.set(d.id, d.line)

    let status: RowStatus = 'novo'
    let match: ImportRow['match'] = null
    if (inSheet?.certain) {
      status = 'duplicado'
      match = { ...inSheet, target: 'sheet', label: `Linha ${lineById.get(inSheet.id)} · ${MATCH_REASON_LABEL[inSheet.reason]}` }
    } else if (inBase?.certain) {
      status = 'atualizar'
      match = { ...inBase, target: 'existing', label: `${existingById.get(inBase.id)?.full_name ?? 'Cliente'} · ${MATCH_REASON_LABEL[inBase.reason]}` }
    } else if (inBase || inSheet) {
      status = 'possivel'
      const m = (inBase ?? inSheet)!
      const who = inBase ? existingById.get(m.id)?.full_name ?? 'Cliente' : `Linha ${lineById.get(m.id)}`
      match = { ...m, target: inBase ? 'existing' : 'sheet', label: `${who} · ${MATCH_REASON_LABEL[m.reason]}` }
    }
    return { ...base, status, match, defaultAction: DEFAULT_ACTION[status] }
  })
}

/** Ação efetiva = escolha do usuário (se permitida) ou padrão. */
export function effectiveAction(row: ImportRow, overrides: Record<string, RowAction | undefined>): RowAction {
  const o = overrides[row.id]
  if (o && allowedActions(row.status).includes(o)) {
    // "atualizar" só faz sentido com correspondência no cadastro
    if (o === 'atualizar' && row.match?.target !== 'existing') return row.defaultAction
    return o
  }
  return row.defaultAction
}

/**
 * Campos para complementar um cliente existente: só preenche o que está VAZIO no
 * cadastro (nunca sobrescreve dados que o escritório já tem).
 */
export function updatePatch(existing: ExistingClient, v: RowValues): Partial<Pick<Client, 'cpf' | 'phone' | 'email' | 'birth_date' | 'address'>> {
  const patch: Partial<Pick<Client, 'cpf' | 'phone' | 'email' | 'birth_date' | 'address'>> = {}
  if (!existing.cpf && v.cpf) patch.cpf = v.cpf
  if (!existing.phone && v.phone) patch.phone = v.phone
  if (!existing.email && v.email) patch.email = v.email
  if (!existing.birth_date && v.birth_date) patch.birth_date = v.birth_date
  if (!existing.address && v.address) patch.address = v.address
  return patch
}

export interface RowSummary {
  total: number
  byStatus: Record<RowStatus, number>
  criar: number
  atualizar: number
  ignorar: number
  demandas: number
}

export function summarize(
  rows: ImportRow[],
  overrides: Record<string, RowAction | undefined>,
  demandFor: (row: ImportRow) => boolean,
): RowSummary {
  const s: RowSummary = {
    total: rows.length,
    byStatus: { novo: 0, atualizar: 0, possivel: 0, duplicado: 0, erro: 0 },
    criar: 0,
    atualizar: 0,
    ignorar: 0,
    demandas: 0,
  }
  for (const r of rows) {
    s.byStatus[r.status]++
    const a = effectiveAction(r, overrides)
    s[a]++
    if (a !== 'ignorar' && demandFor(r)) s.demandas++
  }
  return s
}

/** Mensagem única com todos os erros da linha (para relatório/CSV). */
export function rowErrorText(row: ImportRow): string {
  return (Object.entries(row.errors) as [ImportField, string][]).map(([f, e]) => `${FIELD_LABELS[f]}: ${e}`).join(' · ')
}

/** Título padrão da demanda criada na importação. */
export function demandTitle(category: string, name: string): string {
  return `${category} — ${name}`.slice(0, 160)
}
