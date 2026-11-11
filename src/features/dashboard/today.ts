// "O que fazer hoje": junta tarefas e próximas ações abertas com prazo até hoje.
import type { Demand, Task } from '@/types/database'

export type TodayTask = Pick<Task, 'id' | 'title' | 'due_date' | 'status' | 'assignee_id'>
export type TodayDemand = Pick<Demand, 'id' | 'next_action' | 'next_action_date' | 'status' | 'responsible_id'>

export type TodayItemKind = 'task' | 'next_action'

export interface TodayItem {
  kind: TodayItemKind
  id: string
  title: string
  date: string
  overdue: boolean
  href: string
  assigneeId: string | null
}

const OPEN_TASK_STATUSES = new Set<Task['status']>(['pendente', 'em_andamento'])
const CLOSED_DEMAND_STATUSES = new Set<Demand['status']>(['concluida', 'cancelada'])

export function buildTodayItems({
  tasks,
  demands,
  today,
}: {
  tasks: TodayTask[]
  demands: TodayDemand[]
  today: string
}): TodayItem[] {
  const items: TodayItem[] = []

  for (const t of tasks) {
    if (!OPEN_TASK_STATUSES.has(t.status) || !t.due_date || t.due_date > today) continue
    items.push({
      kind: 'task',
      id: t.id,
      title: t.title,
      date: t.due_date,
      overdue: t.due_date < today,
      href: '/tarefas',
      assigneeId: t.assignee_id,
    })
  }

  for (const d of demands) {
    if (CLOSED_DEMAND_STATUSES.has(d.status) || !d.next_action_date || d.next_action_date > today) continue
    items.push({
      kind: 'next_action',
      id: d.id,
      title: d.next_action?.trim() || 'Próxima ação',
      date: d.next_action_date,
      overdue: d.next_action_date < today,
      href: `/demandas/${d.id}`,
      assigneeId: d.responsible_id,
    })
  }

  // Data mais antiga primeiro; no mesmo dia, por título. Sem desempate extra para manter estável.
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'pt-BR'))
}
