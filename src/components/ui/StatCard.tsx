import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'

export function StatCard({
  label,
  value,
  icon,
  hint,
  to,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  icon?: ReactNode
  hint?: ReactNode
  to?: string
  tone?: 'default' | 'warning' | 'danger' | 'success'
}) {
  const toneCls = {
    default: 'text-navy-600 bg-navy-50 ring-navy-100',
    warning: 'text-amber-700 bg-amber-50 ring-amber-100',
    danger: 'text-red-600 bg-red-50 ring-red-100',
    success: 'text-emerald-700 bg-emerald-50 ring-emerald-100',
  }[tone]

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-medium text-ink-muted">{label}</span>
        {icon && <span className={cn('flex size-8 items-center justify-center rounded-lg ring-1 ring-inset', toneCls)}>{icon}</span>}
      </div>
      <div className="tabular mt-2.5 truncate text-heading font-semibold leading-none sm:text-display tracking-[-0.03em] text-ink">{value}</div>
      {hint && <div className="mt-1.5 text-caption text-ink-subtle">{hint}</div>}
    </>
  )
  const cls = 'group relative block overflow-hidden rounded-[var(--radius-card)] bg-surface p-4 shadow-[var(--shadow-card)]'
  return to ? (
    <Link to={to} className={cn(cls, 'transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
