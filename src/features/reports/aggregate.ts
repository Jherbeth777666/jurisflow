// Agregações puras dos relatórios gerenciais (calculadas no cliente a partir de consultas filtradas por data).
import { diffInDays, toISODate, parseISODate } from '@/lib/format'
import type { DemandStatus, InstallmentStatus, PaymentMethod } from '@/types/database'

// ---------------------------------------------------------------------------
// Período
// ---------------------------------------------------------------------------
export type PeriodPreset = 'this_month' | 'last_month' | 'last_90' | 'this_year' | 'custom'

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_month: 'Este mês',
  last_month: 'Mês passado',
  last_90: 'Últimos 90 dias',
  this_year: 'Ano atual',
  custom: 'Personalizado',
}

export interface Period {
  from: string // 'YYYY-MM-DD' inclusivo
  to: string // 'YYYY-MM-DD' inclusivo
}

/** Resolve um período predefinido em datas locais (inclusivas). */
export function resolvePeriod(preset: PeriodPreset, today: string, custom?: Partial<Period>): Period {
  const d = parseISODate(today)
  const y = d.getFullYear()
  const m = d.getMonth()
  switch (preset) {
    case 'this_month':
      return { from: toISODate(new Date(y, m, 1)), to: today }
    case 'last_month':
      return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) }
    case 'last_90': {
      const f = new Date(y, m, d.getDate() - 89)
      return { from: toISODate(f), to: today }
    }
    case 'this_year':
      return { from: `${y}-01-01`, to: today }
    case 'custom': {
      const from = custom?.from || toISODate(new Date(y, m, 1))
      const to = custom?.to || today
      return from <= to ? { from, to } : { from: to, to: from }
    }
  }
}

/** Limites em timestamp (ISO UTC) para colunas timestamptz: [início do dia `from`, início do dia seguinte a `to`). */
export function periodBounds(p: Period): { start: string; end: string } {
  const s = parseISODate(p.from)
  const e = parseISODate(p.to)
  e.setDate(e.getDate() + 1)
  return { start: s.toISOString(), end: e.toISOString() }
}

/** Data local 'YYYY-MM-DD' de um timestamptz. */
export function tsToLocalDate(ts: string): string {
  return toISODate(new Date(ts))
}

export function inPeriod(date: string | null | undefined, p: Period): boolean {
  if (!date) return false
  const d = date.length > 10 ? tsToLocalDate(date) : date
  return d >= p.from && d <= p.to
}

// ---------------------------------------------------------------------------
// Demandas
// ---------------------------------------------------------------------------
export interface DemandLite {
  id: string
  category_id: string
  responsible_id: string | null
  opened_at: string // date
  closed_at: string | null // timestamptz
  status: DemandStatus
}

export interface GroupCount {
  key: string
  label: string
  color?: string
  opened: number
  closed: number
}

function isClosedIn(d: DemandLite, p: Period) {
  return d.status === 'concluida' && inPeriod(d.closed_at, p)
}

/** Demandas abertas e concluídas no período, agrupadas por uma chave. */
export function demandsByGroup(
  demands: DemandLite[],
  p: Period,
  keyOf: (d: DemandLite) => string,
  labelOf: (key: string) => { label: string; color?: string },
): GroupCount[] {
  const map = new Map<string, GroupCount>()
  const get = (k: string) => {
    let g = map.get(k)
    if (!g) {
      g = { key: k, ...labelOf(k), opened: 0, closed: 0 }
      map.set(k, g)
    }
    return g
  }
  for (const d of demands) {
    const opened = inPeriod(d.opened_at, p)
    const closed = isClosedIn(d, p)
    if (!opened && !closed) continue
    const g = get(keyOf(d))
    if (opened) g.opened++
    if (closed) g.closed++
  }
  return [...map.values()].sort((a, b) => b.opened + b.closed - (a.opened + a.closed) || a.label.localeCompare(b.label, 'pt-BR'))
}

export interface CompletionStat {
  key: string
  label: string
  color?: string
  count: number
  avgDays: number
  minDays: number
  maxDays: number
}

/** Tempo de conclusão (opened_at → closed_at, em dias) das demandas concluídas no período, por categoria. */
export function completionTimeByCategory(
  demands: DemandLite[],
  p: Period,
  labelOf: (categoryId: string) => { label: string; color?: string },
): { rows: CompletionStat[]; overall: { count: number; avgDays: number } } {
  const map = new Map<string, number[]>()
  for (const d of demands) {
    if (!isClosedIn(d, p) || !d.closed_at) continue
    const days = Math.max(0, diffInDays(d.opened_at, tsToLocalDate(d.closed_at)))
    const list = map.get(d.category_id) ?? []
    list.push(days)
    map.set(d.category_id, list)
  }
  const all: number[] = []
  const rows = [...map.entries()].map(([key, list]) => {
    all.push(...list)
    return {
      key,
      ...labelOf(key),
      count: list.length,
      avgDays: round1(avg(list)),
      minDays: Math.min(...list),
      maxDays: Math.max(...list),
    }
  })
  rows.sort((a, b) => b.avgDays - a.avgDays)
  return { rows, overall: { count: all.length, avgDays: round1(avg(all)) } }
}

// ---------------------------------------------------------------------------
// Tarefas
// ---------------------------------------------------------------------------
export interface TaskLite {
  assignee_id: string | null
  due_date: string | null
  completed_at: string | null
}

export interface TaskPersonRow {
  key: string
  label: string
  done: number
  onTime: number
  late: number
  noDue: number
}

/** Tarefas concluídas no período por pessoa, separando no prazo / com atraso / sem prazo. */
export function tasksDoneByPerson(tasks: TaskLite[], p: Period, labelOf: (userId: string) => string): TaskPersonRow[] {
  const map = new Map<string, TaskPersonRow>()
  for (const t of tasks) {
    if (!t.completed_at || !inPeriod(t.completed_at, p)) continue
    const key = t.assignee_id ?? ''
    let r = map.get(key)
    if (!r) {
      r = { key, label: key ? labelOf(key) : 'Sem responsável', done: 0, onTime: 0, late: 0, noDue: 0 }
      map.set(key, r)
    }
    r.done++
    if (!t.due_date) r.noDue++
    else if (tsToLocalDate(t.completed_at) <= t.due_date) r.onTime++
    else r.late++
  }
  return [...map.values()].sort((a, b) => b.done - a.done || a.label.localeCompare(b.label, 'pt-BR'))
}

// ---------------------------------------------------------------------------
// Financeiro
// ---------------------------------------------------------------------------
export interface PaymentLite {
  amount: number | string
  method: PaymentMethod
  paid_at: string
}

export interface MethodRow {
  method: PaymentMethod
  count: number
  total: number
  share: number // 0..1
}

export function receivedByMethod(payments: PaymentLite[], p: Period): { rows: MethodRow[]; total: number; count: number } {
  const map = new Map<PaymentMethod, { count: number; cents: number }>()
  let totalCents = 0
  let count = 0
  for (const pay of payments) {
    if (!inPeriod(pay.paid_at, p)) continue
    const cents = Math.round(Number(pay.amount) * 100)
    const r = map.get(pay.method) ?? { count: 0, cents: 0 }
    r.count++
    r.cents += cents
    map.set(pay.method, r)
    totalCents += cents
    count++
  }
  const rows = [...map.entries()]
    .map(([method, r]) => ({ method, count: r.count, total: r.cents / 100, share: totalCents ? r.cents / totalCents : 0 }))
    .sort((a, b) => b.total - a.total)
  return { rows, total: totalCents / 100, count }
}

export interface OverdueLite {
  id: string
  contract_id: string
  client_id: string
  number: number
  due_date: string
  remaining_amount: number | string
  status: InstallmentStatus
}

export interface AgingBucket {
  label: string
  count: number
  total: number
}

export interface OverdueSummary {
  total: number
  count: number
  clients: number
  contracts: number
  buckets: AgingBucket[]
  rows: (OverdueLite & { days: number; remaining: number })[]
}

/** Inadimplência: parcelas vencidas (situação atual), com faixas de atraso. */
export function overdueSummary(list: OverdueLite[], today: string): OverdueSummary {
  const rows = list
    .filter((i) => i.status === 'vencida' && Number(i.remaining_amount) > 0)
    .map((i) => ({ ...i, remaining: Number(i.remaining_amount), days: diffInDays(i.due_date, today) }))
    .sort((a, b) => b.days - a.days)
  const defs: { label: string; min: number; max: number }[] = [
    { label: '1–30 dias', min: 1, max: 30 },
    { label: '31–60 dias', min: 31, max: 60 },
    { label: '61–90 dias', min: 61, max: 90 },
    { label: 'Mais de 90 dias', min: 91, max: Infinity },
  ]
  const buckets = defs.map((d) => {
    const inB = rows.filter((r) => r.days >= d.min && r.days <= d.max)
    return { label: d.label, count: inB.length, total: sumMoney(inB.map((r) => r.remaining)) }
  })
  return {
    total: sumMoney(rows.map((r) => r.remaining)),
    count: rows.length,
    clients: new Set(rows.map((r) => r.client_id)).size,
    contracts: new Set(rows.map((r) => r.contract_id)).size,
    buckets,
    rows,
  }
}

// ---------------------------------------------------------------------------
// CSV (Excel pt-BR: BOM UTF-8 + ponto e vírgula)
// ---------------------------------------------------------------------------
export type CsvCell = string | number | null | undefined

function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return ''
  let s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')) : String(v)
  // Evita injeção de fórmulas no Excel
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCSV(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(';'))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** Formata data ISO como dd/mm/aaaa para CSV. */
export function csvDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ---------------------------------------------------------------------------
function avg(list: number[]) {
  return list.length ? list.reduce((s, n) => s + n, 0) / list.length : 0
}
function round1(n: number) {
  return Math.round(n * 10) / 10
}
function sumMoney(list: number[]) {
  return list.reduce((s, n) => s + Math.round(n * 100), 0) / 100
}
