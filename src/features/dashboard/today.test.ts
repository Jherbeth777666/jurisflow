import { describe, expect, it } from 'vitest'
import type { Demand, Task } from '@/types/database'
import { buildTodayItems } from './today'

type TodayItem = {
  kind: 'task' | 'next_action'
  id: string
  title: string
  date: string
  overdue: boolean
  href: string
  assigneeId: string | null
}

const STAMP = '2026-11-01T00:00:00.000Z'

function makeTask(over: Partial<Task>): Task {
  return {
    id: 't',
    organization_id: 'org-1',
    title: 'Tarefa',
    description: null,
    client_id: null,
    demand_id: null,
    assignee_id: null,
    due_date: null,
    priority: 'media',
    status: 'pendente',
    completed_at: null,
    created_by: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  } as Task
}

function makeDemand(over: Partial<Demand>): Demand {
  return {
    id: 'd',
    organization_id: 'org-1',
    client_id: 'cli-1',
    category_id: 'cat-1',
    stage_id: null,
    title: 'Demanda',
    description: null,
    responsible_id: null,
    opened_at: '2026-11-01',
    priority: 'media',
    status: 'em_andamento',
    next_action: null,
    next_action_date: null,
    notes: null,
    stage_changed_at: STAMP,
    closed_at: null,
    created_by: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  } as Demand
}

describe('buildTodayItems', () => {
  // Ordem manual esperada para today = 2026-11-11:
  // atrasados (data mais antiga primeiro): 11-08, 11-09, 11-10 (Alfa antes de Zeta no empate)
  // depois de hoje: 11-11 por título: "Hoje beta" < "Próxima ação" < "Suspensa hoje".
  it('junta tarefas e próximas ações abertas e ordena atrasados antes de hoje', () => {
    const tasks = [
      makeTask({ id: 't-early', title: 'Conferir prazo', due_date: '2026-11-08', assignee_id: 'u1' }),
      makeTask({ id: 't-late-b', title: 'Zeta vencida', due_date: '2026-11-10', assignee_id: 'u2' }),
      makeTask({ id: 't-late-a', title: 'Alfa vencida', due_date: '2026-11-10', status: 'em_andamento', assignee_id: 'u2' }),
      makeTask({ id: 't-today', title: 'Hoje beta', due_date: '2026-11-11', assignee_id: 'u1' }),
    ]
    const demands = [
      makeDemand({ id: 'd-mid', next_action: 'Ação vencida', next_action_date: '2026-11-09', responsible_id: 'u3' }),
      makeDemand({ id: 'd-today', next_action: null, next_action_date: '2026-11-11', status: 'aguardando_cliente', responsible_id: 'u4' }),
      makeDemand({ id: 'd-susp', next_action: 'Suspensa hoje', next_action_date: '2026-11-11', status: 'suspensa', responsible_id: 'u5' }),
    ]

    const items: TodayItem[] = buildTodayItems({ tasks, demands, today: '2026-11-11' })

    expect(items.map((i) => [i.kind, i.id, i.title, i.date, i.overdue, i.assigneeId])).toEqual([
      ['task', 't-early', 'Conferir prazo', '2026-11-08', true, 'u1'],
      ['next_action', 'd-mid', 'Ação vencida', '2026-11-09', true, 'u3'],
      ['task', 't-late-a', 'Alfa vencida', '2026-11-10', true, 'u2'],
      ['task', 't-late-b', 'Zeta vencida', '2026-11-10', true, 'u2'],
      ['task', 't-today', 'Hoje beta', '2026-11-11', false, 'u1'],
      ['next_action', 'd-today', 'Próxima ação', '2026-11-11', false, 'u4'],
      ['next_action', 'd-susp', 'Suspensa hoje', '2026-11-11', false, 'u5'],
    ])
    expect(items.find((i) => i.id === 'd-mid')?.href).toBe('/demandas/d-mid')
    expect(items.find((i) => i.id === 'd-today')?.href).toBe('/demandas/d-today')
  })

  it('ignora itens sem data, futuros, concluídos e cancelados', () => {
    const tasks = [
      makeTask({ id: 't-closed', title: 'Concluída vencida', due_date: '2026-11-01', status: 'concluida' }),
      makeTask({ id: 't-cancel', title: 'Cancelada vencida', due_date: '2026-11-01', status: 'cancelada' }),
      makeTask({ id: 't-future', title: 'Futura', due_date: '2026-11-12' }),
      makeTask({ id: 't-nodate', title: 'Sem data', due_date: null }),
    ]
    const demands = [
      makeDemand({ id: 'd-done', next_action: 'Feita vencida', next_action_date: '2026-11-01', status: 'concluida' }),
      makeDemand({ id: 'd-cancel', next_action: 'Cancelada', next_action_date: '2026-11-01', status: 'cancelada' }),
      makeDemand({ id: 'd-future', next_action: 'Futura', next_action_date: '2026-11-12' }),
      makeDemand({ id: 'd-nodate', next_action: 'Sem data', next_action_date: null }),
    ]

    expect(buildTodayItems({ tasks, demands, today: '2026-11-11' })).toEqual([])
  })

  it('usa "Próxima ação" quando next_action está vazio', () => {
    const demands = [
      makeDemand({ id: 'd-null', next_action: null, next_action_date: '2026-11-11' }),
      makeDemand({ id: 'd-empty', next_action: '', next_action_date: '2026-11-11' }),
    ]

    const items: TodayItem[] = buildTodayItems({ tasks: [], demands, today: '2026-11-11' })

    expect(items.map((i) => [i.id, i.title])).toEqual([
      ['d-null', 'Próxima ação'],
      ['d-empty', 'Próxima ação'],
    ])
  })
})
