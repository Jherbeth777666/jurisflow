// Lógica pura da ficha 360° do cliente (indicadores e rótulos de tempo).
import type { ClientOverview } from '@/types/database'

export interface OverviewStats {
  openDemands: number
  overdueNextActions: number
  pendingDocuments: number
  openTasks: number
  overdueTasks: number
  openAmount: number
  overdueAmount: number
}

/** Números dos indicadores exibidos no resumo do cliente. */
export function summaryStats(overview: ClientOverview): OverviewStats {
  return {
    openDemands: overview.open_demands.length,
    overdueNextActions: overview.open_demands.filter((d) => d.next_action_overdue).length,
    pendingDocuments: overview.open_demands.reduce((sum, d) => sum + d.checklist_pending, 0),
    openTasks: overview.tasks.open,
    overdueTasks: overview.tasks.overdue,
    openAmount: overview.finance.open_amount,
    overdueAmount: overview.finance.overdue_amount,
  }
}

/** Idade na etapa atual: "hoje", "há 1 dia" ou "há N dias". */
export function stageAgeLabel(days: number): string {
  if (days <= 0) return 'hoje'
  if (days === 1) return 'há 1 dia'
  return `há ${days} dias`
}
