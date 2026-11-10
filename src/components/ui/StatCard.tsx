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
    default: 'text-navy-500 bg-navy-50',
    warning: 'text-amber-700 bg-amber-50',
    danger: 'text-red-600 bg-red-50',
    success: 'text-emerald-700 bg-emerald-50',
  }[tone]
  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-ink-muted">{label}</span>
        {icon && <span className={cn('flex size-7 items-center justify-center rounded-md', toneCls)}>{icon}</span>}
      </div>
      <div className="tabular mt-2 text-[22px] font-semibold tracking-[-0.02em] text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-ink-subtle">{hint}</div>}
    </>
  )
  const cls = 'block rounded-[var(--radius-card)] bg-surface p-4 shadow-[var(--shadow-card)]'
  return to ? (
    <Link to={to} className={cn(cls, 'transition-shadow hover:shadow-[var(--shadow-pop)]')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
