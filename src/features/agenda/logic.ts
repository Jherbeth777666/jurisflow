// Regras puras da agenda unificada: intervalos por aba e agrupamento por dia.
import { parseISODate, todayISO } from '@/lib/format'

export type AgendaView = 'hoje' | 'semana' | 'mes' | 'atrasados'
export type AgendaKind = 'task' | 'next_action' | 'installment'

export interface AgendaItem {
  kind: AgendaKind
  id: string
  title: string
  date: string
  overdue: boolean
  status: string
  client_id: string | null
  demand_id: string | null
  assignee_id: string | null
  amount: number | null
  contract_id?: string | null
}

export interface AgendaGroup<T extends AgendaItem = AgendaItem> {
  date: string
  label: string
  items: T[]
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isoFromUTC(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function addDaysUTC(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return isoFromUTC(new Date(Date.UTC(y, m - 1, d + days)))
}

export function rangeFor(view: AgendaView, today: string): { from: string; to: string } {
  switch (view) {
    case 'hoje':
      return { from: today, to: today }
    case 'semana': {
      const [y, m, d] = today.slice(0, 10).split('-').map(Number)
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
      const from = addDaysUTC(today, -((weekday + 6) % 7))
      return { from, to: addDaysUTC(from, 6) }
    }
    case 'mes': {
      const [y, m] = today.slice(0, 10).split('-').map(Number)
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` }
    }
    case 'atrasados':
      return { from: addDaysUTC(today, -60), to: addDaysUTC(today, -1) }
  }
}

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Hoje'
  if (date === addDaysUTC(today, 1)) return 'Amanhã'
  return parseISODate(date)
    .toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(' de ', ' ')
}

export function groupByDay<T extends AgendaItem>(items: T[], today: string = todayISO()): AgendaGroup<T>[] {
  const sorted = [...items].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.kind.localeCompare(b.kind) ||
      a.title.localeCompare(b.title, 'pt-BR'),
  )

  const groups: AgendaGroup<T>[] = []
  for (const item of sorted) {
    const last = groups[groups.length - 1]
    if (!last || last.date !== item.date) {
      groups.push({ date: item.date, label: dayLabel(item.date, today), items: [item] })
    } else {
      last.items.push(item)
    }
  }
  return groups
}
