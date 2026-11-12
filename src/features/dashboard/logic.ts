// Funções puras do painel (saudação, ordenação de tarefas prioritárias).
import { PRIORITY_ORDER } from '@/lib/constants'
import type { PriorityLevel } from '@/types/database'

export function greeting(hour: number): string {
  if (hour < 5) return 'Boa noite'
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function firstName(full: string | null | undefined, email?: string | null): string {
  const n = (full ?? '').trim().split(/\s+/)[0]
  if (n) return n
  return email?.split('@')[0] ?? ''
}

/** Ordena por vencimento (sem data por último) e, no mesmo dia, por prioridade (urgente primeiro). */
export function sortPriorityTasks<T extends { due_date: string | null; priority: PriorityLevel }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const da = a.due_date ?? '9999-12-31'
    const db = b.due_date ?? '9999-12-31'
    if (da !== db) return da < db ? -1 : 1
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  })
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'none'

export function dueTone(due: string | null, today: string, soonDays = 3, diff: (a: string, b: string) => number): DueTone {
  if (!due) return 'none'
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return diff(today, due) <= soonDays ? 'soon' : 'later'
}

export interface MonthDelta {
  current: number
  previous: number
  diff: number
}

/** Compara o último mês da série com o anterior (série em ordem cronológica). Null se faltar mês. */
export function monthDelta<T extends { month: string }>(series: T[], pick: (row: T) => number): MonthDelta | null {
  if (series.length < 2) return null
  const sorted = [...series].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
  const current = pick(sorted[sorted.length - 1])
  const previous = pick(sorted[sorted.length - 2])
  return { current, previous, diff: current - previous }
}
