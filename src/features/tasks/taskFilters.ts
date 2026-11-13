// Filtros de Tarefas na URL (mesmo espírito de Demandas): funções puras, sem React.
// Valores padrão (aba Minhas, status abertas) são omitidos para manter URLs curtas e compartilháveis.
import { PRIORITY, TASK_STATUS } from '@/lib/constants'
import type { PriorityLevel, TaskStatus } from '@/types/database'
import { parseRangeFilter, type RangeFilter } from './dueBuckets'

export type TaskTab = 'mine' | 'all'
export type TaskStatusFilter = 'open' | 'all' | TaskStatus

export interface TaskFilters {
  tab: TaskTab
  assignee: string // '' | user_id | 'none'
  priority: '' | PriorityLevel
  status: TaskStatusFilter
  search: string
  range: RangeFilter | null
  byPerson: boolean
}

export function parseTaskFilters(p: URLSearchParams): TaskFilters {
  const priority = p.get('prio') ?? ''
  const status = p.get('status') ?? ''
  return {
    tab: p.get('aba') === 'todas' ? 'all' : 'mine',
    assignee: p.get('resp') ?? '',
    priority: Object.hasOwn(PRIORITY, priority) ? (priority as PriorityLevel) : '',
    status: status === 'todos' ? 'all' : Object.hasOwn(TASK_STATUS, status) ? (status as TaskStatus) : 'open',
    search: p.get('q') ?? '',
    range: parseRangeFilter(p.get('filter')),
    byPerson: p.get('agrupar') === 'pessoa',
  }
}

/** Serializa só o que difere do padrão. */
export function serializeTaskFilters(f: TaskFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.tab === 'all') p.set('aba', 'todas')
  if (f.assignee) p.set('resp', f.assignee)
  if (f.priority) p.set('prio', f.priority)
  if (f.status === 'all') p.set('status', 'todos')
  else if (f.status !== 'open') p.set('status', f.status)
  if (f.search.trim()) p.set('q', f.search.trim())
  if (f.range) p.set('filter', f.range)
  if (f.byPerson) p.set('agrupar', 'pessoa')
  return p
}
