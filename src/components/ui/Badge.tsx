import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'navy' | 'violet'

const tones: Record<BadgeTone, string> = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-accent-50 text-accent-700 ring-accent-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  navy: 'bg-navy-900 text-white ring-navy-900',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
}

export function Badge({ tone = 'gray', children, className, dot }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  )
}

/** Badge a partir de um LabelMap de constants.ts */
export function StatusBadge<T extends string>({ value, map }: { value: T; map: Record<T, { label: string; tone: BadgeTone }> }) {
  const item = map[value]
  if (!item) return <Badge>{value}</Badge>
  return (
    <Badge tone={item.tone} dot>
      {item.label}
    </Badge>
  )
}

export function CategoryTag({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted whitespace-nowrap">
      <span className="size-2 rounded-sm" style={{ backgroundColor: color }} />
      {name}
    </span>
  )
}
