// Tema dos gráficos (constantes) — paleta navy/azul discreta.
import type { DemandStatus } from '@/types/database'

export const CHART = {
  navy900: '#0b1b36',
  navy700: '#1f365d',
  navy500: '#3d5e91',
  navy300: '#8ea6c9',
  navy200: '#bccbe1',
  accent: '#3b82f6',
  grid: '#eef0f3',
  axis: '#8a93a3',
} as const

export const STATUS_COLORS: Record<DemandStatus, string> = {
  em_andamento: '#3b82f6',
  aguardando_cliente: '#d9a441',
  suspensa: '#94a3b8',
  concluida: '#1f365d',
  cancelada: '#d4d8df',
}

/** Props comuns de eixos — leves, sem linhas de eixo. */
export const axisProps = {
  tick: { fill: CHART.axis, fontSize: 11.5 },
  tickLine: false,
  axisLine: false,
} as const

/** "R$ 12,3 mil" para eixos monetários compactos */
export function compactCurrency(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(v)
}
