// Peças compartilhadas dos gráficos (Recharts) — paleta navy/azul discreta, tooltips em PT-BR.
import type { ReactNode } from 'react'
import type { TooltipContentProps } from 'recharts'
import { formatNumber } from '@/lib/format'

type TooltipProps = Partial<Pick<TooltipContentProps<number | string, string>, 'active' | 'payload' | 'label'>> & {
  formatValue?: (v: number) => string
  formatLabel?: (label: string) => ReactNode
}

export function ChartTooltip({ active, payload, label, formatValue = formatNumber, formatLabel }: TooltipProps) {
  if (!active || !payload?.length) return null
  const title = formatLabel ? formatLabel(String(label ?? '')) : label
  return (
    <div className="min-w-36 rounded-md bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow-pop)]">
      {title !== undefined && title !== '' && <div className="mb-1 font-medium text-ink">{title}</div>}
      <ul className="space-y-0.5">
        {payload.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-muted">
              <span className="size-2 rounded-sm" style={{ backgroundColor: (p.payload as { fill?: string } | undefined)?.fill ?? p.color }} />
              {p.name}
            </span>
            <span className="tabular font-medium text-ink">{formatValue(Number(p.value ?? 0))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-3 rounded-sm"
            style={i.dashed ? { borderTop: `2px dashed ${i.color}`, height: 0 } : { backgroundColor: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  )
}
