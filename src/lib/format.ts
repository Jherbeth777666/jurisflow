// Formatação e validação para padrões brasileiros.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const intFmt = new Intl.NumberFormat('pt-BR')

export function formatCurrency(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value
  return brl.format(Number.isFinite(n) ? (n as number) : 0)
}

export function formatNumber(value: number | null | undefined): string {
  return intFmt.format(value ?? 0)
}

/** Converte "1.234,56" / "1234.56" / "R$ 10" em número. Retorna NaN se inválido. */
export function parseCurrency(input: string): number {
  const cleaned = input.replace(/[^\d,.-]/g, '')
  if (!cleaned) return NaN
  let normalized: string
  if (cleaned.includes(',')) normalized = cleaned.replace(/\./g, '').replace(',', '.') // 1.234,56
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) normalized = cleaned.replace(/\./g, '') // 1.500 → 1500
  else normalized = cleaned // 1234.56
  return Number(normalized)
}

export const onlyDigits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function isValidCPF(value: string): boolean {
  const cpf = onlyDigits(value)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10])
}

export function formatCPF(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 11)
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

/** CPF mascarado para listagens: ***.456.789-** */
export function maskCPF(value: string | null | undefined): string {
  const d = onlyDigits(value)
  if (d.length !== 11) return '—'
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`
}

export function formatPhone(value: string | null | undefined): string {
  const d = onlyDigits(value).slice(0, 13)
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2')
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2')
}

export function isValidPhone(value: string): boolean {
  const d = onlyDigits(value)
  return d.length >= 10 && d.length <= 13
}

export function isValidEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())
}

// ---------------------------------------------------------------------------
// Datas — 'YYYY-MM-DD' é tratado como data local (sem fuso), evitando o bug
// clássico de exibir o dia anterior em UTC-3.
// ---------------------------------------------------------------------------

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toISODate(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayISO(): string {
  return toISODate(new Date())
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseISODate(iso)
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = value.length === 10 ? parseISODate(value) : new Date(value)
  return d.toLocaleDateString('pt-BR')
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Diferença em dias inteiros entre duas datas ISO (b - a). */
export function diffInDays(a: string, b: string): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime()
  return Math.round(ms / 86_400_000)
}

/**
 * Dias de CALENDÁRIO (datas locais) desde um timestamp até hoje: algo feito ontem às
 * 23h conta 1 dia hoje às 8h. Regra única para "parada há N dias" (dashboard, lista,
 * detalhe e kanban).
 */
export function daysSince(value: string, now: Date = new Date()): number {
  return Math.max(0, diffInDays(toISODate(new Date(value)), toISODate(now)))
}

/** Limite padrão para considerar uma demanda parada na etapa. */
export const STALLED_DAYS = 15

/**
 * Corte (timestamp ISO) para consultas "parada há N+ dias": `stage_changed_at < corte`
 * equivale a `daysSince(stage_changed_at) >= days`. É o início (meia-noite local) do dia
 * `hoje - days + 1`.
 */
export function stalledCutoff(days: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1)
  return d.toISOString()
}

/** Parada há `days` dias de calendário ou mais. */
export function isStalledSince(value: string, days: number = STALLED_DAYS, now: Date = new Date()): boolean {
  return daysSince(value, now) >= days
}

export function formatRelative(value: string): string {
  const diffSec = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
  const abs = Math.abs(diffSec)
  if (abs < 60) return rtf.format(diffSec, 'second')
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day')
  return formatDate(value)
}

/** 'YYYY-MM' → 'nov/26' */
export function formatMonthShort(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
    .replace('.', '')
    .replace(' de ', '/')
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Escapa curingas do PostgREST para uso em .ilike / .or */
export function escapeLike(term: string): string {
  return term.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()]/g, ' ')
}
