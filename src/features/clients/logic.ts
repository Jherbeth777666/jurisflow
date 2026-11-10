// Lógica pura do módulo de clientes (busca, validação e normalização do formulário).
import { escapeLike, isValidCPF, isValidEmail, isValidPhone, onlyDigits, todayISO } from '@/lib/format'
import type { Client, ClientStatus, Demand } from '@/types/database'

export type ClientSearch = { kind: 'cpf'; digits: string } | { kind: 'name'; pattern: string } | null

/**
 * Interpreta o termo de busca: se for composto só por dígitos e pontuação de CPF
 * (". - espaço") busca por dígitos no CPF; senão, ilike no nome (com curingas escapados).
 */
export function parseClientSearch(term: string): ClientSearch {
  const t = term.trim()
  if (!t) return null
  if (/^[\d.\-\s]+$/.test(t)) {
    const digits = onlyDigits(t)
    if (digits) return { kind: 'cpf', digits }
  }
  return { kind: 'name', pattern: `%${escapeLike(t)}%` }
}

export interface ClientFormValues {
  full_name: string
  cpf: string
  phone: string
  email: string
  birth_date: string
  address: string
  notes: string
  status: ClientStatus
}

export type ClientFormErrors = Partial<Record<keyof ClientFormValues, string>>

export const emptyClientForm: ClientFormValues = {
  full_name: '',
  cpf: '',
  phone: '',
  email: '',
  birth_date: '',
  address: '',
  notes: '',
  status: 'ativo',
}

export function clientToForm(c: Client): ClientFormValues {
  return {
    full_name: c.full_name,
    cpf: c.cpf ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    birth_date: c.birth_date ?? '',
    address: c.address ?? '',
    notes: c.notes ?? '',
    status: c.status,
  }
}

/** Valida um único campo; retorna a mensagem de erro ou undefined. */
export function validateClientField<K extends keyof ClientFormValues>(key: K, v: ClientFormValues, today = todayISO()): string | undefined {
  switch (key) {
    case 'full_name': {
      const n = v.full_name.trim()
      if (!n) return 'Informe o nome completo.'
      if (n.length < 2) return 'Nome muito curto.'
      if (n.length > 160) return 'Máximo de 160 caracteres.'
      return
    }
    case 'cpf':
      if (!onlyDigits(v.cpf)) return
      return isValidCPF(v.cpf) ? undefined : 'CPF inválido. Confira os dígitos.'
    case 'phone':
      if (!onlyDigits(v.phone)) return
      return isValidPhone(v.phone) ? undefined : 'Telefone deve ter DDD + número (10 a 13 dígitos).'
    case 'email':
      if (!v.email.trim()) return
      return isValidEmail(v.email) ? undefined : 'E-mail inválido.'
    case 'birth_date':
      if (!v.birth_date) return
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.birth_date)) return 'Data inválida.'
      if (v.birth_date <= '1900-01-01') return 'Data muito antiga.'
      if (v.birth_date > today) return 'A data não pode estar no futuro.'
      return
    case 'address':
      return v.address.length > 300 ? 'Máximo de 300 caracteres.' : undefined
    case 'notes':
      return v.notes.length > 4000 ? 'Máximo de 4.000 caracteres.' : undefined
    default:
      return
  }
}

export function validateClientForm(v: ClientFormValues, today = todayISO()): ClientFormErrors {
  const errors: ClientFormErrors = {}
  for (const key of Object.keys(v) as (keyof ClientFormValues)[]) {
    const msg = validateClientField(key, v, today)
    if (msg) errors[key] = msg
  }
  return errors
}

const nullIfEmpty = (s: string) => {
  const t = s.trim()
  return t ? t : null
}

/** Converte o formulário no payload do banco (CPF/telefone só com dígitos, vazios → null). */
export function clientFormToPayload(v: ClientFormValues) {
  return {
    full_name: v.full_name.trim().replace(/\s+/g, ' '),
    cpf: onlyDigits(v.cpf) || null,
    phone: onlyDigits(v.phone) || null,
    email: nullIfEmpty(v.email)?.toLowerCase() ?? null,
    birth_date: v.birth_date || null,
    address: nullIfEmpty(v.address),
    notes: nullIfEmpty(v.notes),
    status: v.status,
  }
}

// ---------------------------------------------------------------------------
// Histórico de atendimentos: aberturas e encerramentos de demandas em ordem cronológica
// ---------------------------------------------------------------------------

export interface ServiceEvent {
  key: string
  demandId: string
  title: string
  kind: 'opened' | 'concluded' | 'cancelled'
  /** 'YYYY-MM-DD' (abertura) ou timestamp ISO (encerramento) */
  at: string
}

type DemandForHistory = Pick<Demand, 'id' | 'title' | 'opened_at' | 'closed_at' | 'status' | 'created_at'>

/** Mais recentes primeiro. Datas de abertura (sem hora) são comparadas pelo dia. */
export function buildServiceHistory(demands: DemandForHistory[]): ServiceEvent[] {
  const events: (ServiceEvent & { sort: string })[] = []
  for (const d of demands) {
    events.push({ key: `${d.id}-o`, demandId: d.id, title: d.title, kind: 'opened', at: d.opened_at, sort: `${d.opened_at}T00:00:00` })
    if (d.closed_at && (d.status === 'concluida' || d.status === 'cancelada')) {
      events.push({
        key: `${d.id}-c`,
        demandId: d.id,
        title: d.title,
        kind: d.status === 'concluida' ? 'concluded' : 'cancelled',
        at: d.closed_at,
        sort: d.closed_at,
      })
    }
  }
  const rank = (e: ServiceEvent) => (e.kind === 'opened' ? 1 : 0) // no mesmo instante, encerramento aparece antes
  events.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : rank(a) - rank(b)))
  return events.map(({ sort: _sort, ...e }) => e)
}
