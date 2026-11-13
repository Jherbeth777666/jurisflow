import { describe, expect, it } from 'vitest'
import type { ClientOverview } from '@/types/database'
import { stageAgeLabel, summaryStats } from './summary'

type OverviewDemand = ClientOverview['open_demands'][number]

function demand(over: Partial<OverviewDemand> = {}): OverviewDemand {
  return {
    id: 'd1',
    title: 'Demanda',
    status: 'em_andamento',
    stage_name: 'Acompanhamento',
    category_name: 'Outros',
    next_action: null,
    next_action_date: null,
    next_action_overdue: false,
    checklist_pending: 0,
    checklist_total: 0,
    days_in_stage: 0,
    ...over,
  }
}

function overview(over: Partial<ClientOverview> = {}): ClientOverview {
  return {
    open_demands: [],
    checklist_pending_items: [],
    tasks: { open: 0, overdue: 0, next_due_date: null },
    finance: { open_amount: 0, overdue_amount: 0, overdue_count: 0, next_due_date: null },
    last_activity_at: null,
    ...over,
  }
}

describe('summaryStats', () => {
  it('conta demandas abertas, ações atrasadas e documentos pendentes', () => {
    const stats = summaryStats(
      overview({
        open_demands: [
          // 3 + 0 + 2 = 5 documentos pendentes no total.
          demand({ id: 'a', next_action_overdue: true, checklist_pending: 3, checklist_total: 5 }),
          demand({ id: 'b', next_action_overdue: true, checklist_pending: 0, checklist_total: 2 }),
          demand({ id: 'c', next_action_overdue: false, checklist_pending: 2, checklist_total: 2 }),
        ],
        tasks: { open: 4, overdue: 1, next_due_date: '2026-11-12' },
        finance: { open_amount: 1234.56, overdue_amount: 300, overdue_count: 1, next_due_date: '2026-11-20' },
      }),
    )

    expect(stats).toEqual({
      openDemands: 3,
      overdueNextActions: 2,
      pendingDocuments: 5,
      openTasks: 4,
      overdueTasks: 1,
      openAmount: 1234.56,
      overdueAmount: 300,
    })
  })

  it('zera os indicadores quando não há pendências', () => {
    expect(summaryStats(overview())).toEqual({
      openDemands: 0,
      overdueNextActions: 0,
      pendingDocuments: 0,
      openTasks: 0,
      overdueTasks: 0,
      openAmount: 0,
      overdueAmount: 0,
    })
  })
})

describe('stageAgeLabel', () => {
  it('usa "hoje" para 0 dias', () => {
    expect(stageAgeLabel(0)).toBe('hoje')
  })

  it('usa singular para 1 dia', () => {
    expect(stageAgeLabel(1)).toBe('há 1 dia')
  })

  it('usa plural a partir de 2 dias', () => {
    expect(stageAgeLabel(2)).toBe('há 2 dias')
    expect(stageAgeLabel(5)).toBe('há 5 dias')
  })
})
