// Lógica pura do quadro Kanban (testada em board.test.ts).
import { PRIORITY_ORDER } from '@/lib/constants'
import type { Demand, PriorityLevel, WorkflowStage } from '@/types/database'

export type BoardDemand = Pick<
  Demand,
  | 'id'
  | 'title'
  | 'client_id'
  | 'category_id'
  | 'stage_id'
  | 'responsible_id'
  | 'priority'
  | 'status'
  | 'next_action'
  | 'next_action_date'
  | 'stage_changed_at'
  | 'closed_at'
> & { client: { full_name: string } | null }

export const BOARD_SELECT =
  'id, title, client_id, category_id, stage_id, responsible_id, priority, status, next_action, next_action_date, stage_changed_at, closed_at, client:clients(full_name)'

/** Dias parada a partir dos quais o card recebe destaque. */
export const STALE_DAYS = 15
/** Concluídas exibidas na coluna final. */
export const DONE_LIMIT = 20
export const DONE_WINDOW_DAYS = 30

export function isClosed(d: Pick<Demand, 'status'>) {
  return d.status === 'concluida' || d.status === 'cancelada'
}

/**
 * Espelha a regra do banco (demands_before_write) para a atualização otimista:
 * etapa final → concluída; saindo da final com status concluída → em andamento.
 */
export function applyStageMove(d: BoardDemand, to: Pick<WorkflowStage, 'id' | 'is_final'>, nowIso: string): BoardDemand {
  if (d.stage_id === to.id) return d
  const next: BoardDemand = { ...d, stage_id: to.id, stage_changed_at: nowIso }
  if (to.is_final) {
    next.status = 'concluida'
    next.closed_at = d.closed_at ?? nowIso
  } else if (d.status === 'concluida') {
    next.status = 'em_andamento'
    next.closed_at = null
  }
  return next
}

function compareCards(a: BoardDemand, b: BoardDemand) {
  const ca = isClosed(a)
  const cb = isClosed(b)
  if (ca !== cb) return ca ? 1 : -1
  if (ca) return (b.closed_at ?? '').localeCompare(a.closed_at ?? '')
  const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  if (p) return p
  return a.stage_changed_at.localeCompare(b.stage_changed_at) // parada há mais tempo primeiro
}

/** Agrupa por etapa; demandas sem etapa válida caem na primeira coluna. */
export function groupByStage(demands: BoardDemand[], stages: Pick<WorkflowStage, 'id'>[]): Map<string, BoardDemand[]> {
  const map = new Map<string, BoardDemand[]>(stages.map((s) => [s.id, []]))
  const first = stages[0]?.id
  for (const d of demands) {
    const key = d.stage_id && map.has(d.stage_id) ? d.stage_id : first
    if (key) map.get(key)!.push(d)
  }
  map.forEach((list) => list.sort(compareCards))
  return map
}

export interface BoardFilters {
  /** '' = todos; 'none' = sem responsável; senão user_id */
  responsible: string
  priority: '' | PriorityLevel
  search: string
}

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

export function filterBoard(demands: BoardDemand[], f: BoardFilters): BoardDemand[] {
  const term = normalize(f.search)
  return demands.filter((d) => {
    if (f.responsible === 'none' ? d.responsible_id !== null : f.responsible && d.responsible_id !== f.responsible) return false
    if (f.priority && d.priority !== f.priority) return false
    if (term && !normalize(`${d.title} ${d.client?.full_name ?? ''}`).includes(term)) return false
    return true
  })
}

export function moveInArray<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr
  const copy = arr.slice()
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}
