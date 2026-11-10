// Classificação de tarefas por faixa de vencimento (função pura, testada em dueBuckets.test.ts).
import { addDaysISO, diffInDays, formatDate, todayISO } from '@/lib/format'
import type { ISODate, TaskStatus } from '@/types/database'

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none' | 'done'

export const DUE_BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none', 'done']

export const DUE_BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: 'Vencidas',
  today: 'Hoje',
  tomorrow: 'Amanhã',
  week: 'Esta semana',
  later: 'Depois',
  none: 'Sem data',
  done: 'Concluídas e canceladas',
}

/** Quantos dias à frente contam como "esta semana" (a partir de depois de amanhã). */
export const WEEK_DAYS = 7

export function isOpenStatus(status: TaskStatus): boolean {
  return status === 'pendente' || status === 'em_andamento'
}

/**
 * Faixa de vencimento de uma tarefa.
 * Tarefas concluídas/canceladas nunca geram alerta → 'done'.
 */
export function dueBucket(dueDate: ISODate | null, status: TaskStatus, today: ISODate = todayISO()): DueBucket {
  if (!isOpenStatus(status)) return 'done'
  if (!dueDate) return 'none'
  const diff = diffInDays(today, dueDate)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff <= WEEK_DAYS) return 'week'
  return 'later'
}

/** Agrupa preservando a ordem de entrada dentro de cada faixa; omite faixas vazias. */
export function groupByDueBucket<T extends { due_date: ISODate | null; status: TaskStatus }>(
  items: T[],
  today: ISODate = todayISO(),
): { bucket: DueBucket; items: T[] }[] {
  const map = new Map<DueBucket, T[]>()
  for (const it of items) {
    const b = dueBucket(it.due_date, it.status, today)
    const list = map.get(b)
    if (list) list.push(it)
    else map.set(b, [it])
  }
  return DUE_BUCKET_ORDER.filter((b) => map.has(b)).map((bucket) => ({ bucket, items: map.get(bucket)! }))
}

/** Texto curto do vencimento para listas. */
export function dueLabel(dueDate: ISODate | null, today: ISODate = todayISO()): string {
  if (!dueDate) return 'Sem data'
  const diff = diffInDays(today, dueDate)
  if (diff < 0) return `Venceu há ${-diff} ${diff === -1 ? 'dia' : 'dias'}`
  if (diff === 0) return 'Vence hoje'
  if (diff === 1) return 'Amanhã'
  return formatDate(dueDate)
}

/** Filtros de faixa aceitos na URL (?filter=…). O dashboard usa overdue/today/week. */
export type RangeFilter = 'overdue' | 'today' | 'week' | 'nodate'

export const RANGE_FILTERS: RangeFilter[] = ['overdue', 'today', 'week', 'nodate']

export function parseRangeFilter(value: string | null): RangeFilter | null {
  return RANGE_FILTERS.includes(value as RangeFilter) ? (value as RangeFilter) : null
}

/**
 * Intervalo de datas para um filtro de faixa (aplicado só a tarefas abertas).
 * 'week' = de hoje até hoje+7, igual ao indicador "prazos próximos" do dashboard.
 */
export function rangeBounds(
  filter: RangeFilter,
  today: ISODate = todayISO(),
): { lt?: ISODate; gte?: ISODate; lte?: ISODate; isNull?: true } {
  switch (filter) {
    case 'overdue':
      return { lt: today }
    case 'today':
      return { gte: today, lte: today }
    case 'week':
      return { gte: today, lte: addDaysISO(today, WEEK_DAYS) }
    case 'nodate':
      return { isNull: true }
  }
}

/**
 * Aba inicial da tela de tarefas a partir da URL. ?aba=todas|minhas tem precedência;
 * links com ?filter= (vindos do dashboard, que conta a equipe toda) abrem em "Todas"
 * para que os números batam.
 */
export function tabFromParams(params: URLSearchParams): 'mine' | 'all' {
  const aba = params.get('aba')
  if (aba === 'todas') return 'all'
  if (aba === 'minhas') return 'mine'
  return parseRangeFilter(params.get('filter')) ? 'all' : 'mine'
}
