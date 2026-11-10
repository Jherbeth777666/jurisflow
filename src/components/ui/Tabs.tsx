import { cn } from '@/lib/cn'

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T
  onChange: (v: T) => void
  items: { value: T; label: string; count?: number }[]
  className?: string
}) {
  return (
    <div role="tablist" className={cn('flex gap-1 border-b border-line', className)}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              active ? 'border-navy-900 text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {it.label}
            {it.count !== undefined && (
              <span className={cn('tabular rounded-full px-1.5 text-[11px]', active ? 'bg-navy-900 text-white' : 'bg-slate-100 text-ink-muted')}>
                {it.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
