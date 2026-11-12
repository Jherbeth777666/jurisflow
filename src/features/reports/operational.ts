// Métricas operacionais (gargalos e carga) devolvidas pela RPC operational_metrics.

export interface OperationalStage {
  name: string
  category_name: string
  position: number
  open_now: number
  avg_age_open_days: number | null
  oldest_open_days: number | null
  avg_days_completed: number | null
  passes_completed: number
}

export interface OperationalWorkload {
  user_id: string
  name: string
  open_demands: number
  open_tasks: number
  overdue_tasks: number
  next_actions_overdue: number
}

export interface OperationalMetrics {
  stages: OperationalStage[]
  bottlenecks: OperationalStage[]
  workload: OperationalWorkload[]
}

export type BottleneckLevel = 'alto' | 'medio' | 'baixo'

/** Formata dias para a interface: "—", "menos de 1 dia", "1 dia" ou "N dias". */
export function formatDays(n: number | null): string {
  if (n === null || Number.isNaN(n)) return '—'
  if (n < 1) return 'menos de 1 dia'
  const value = n <= 10 ? Math.round(n * 10) / 10 : Math.round(n)
  if (value === 1) return '1 dia'
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
}

/** Classifica a etapa como gargalo a partir das demandas abertas e da idade média. */
export function bottleneckLevel(stage: Pick<OperationalStage, 'open_now' | 'avg_age_open_days'>): BottleneckLevel {
  const age = stage.avg_age_open_days
  if (stage.open_now >= 5 || (age !== null && age >= 30)) return 'alto'
  if (stage.open_now >= 3 || (age !== null && age >= 15)) return 'medio'
  return 'baixo'
}
