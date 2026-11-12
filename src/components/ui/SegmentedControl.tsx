import { cn } from '@/lib/cn'

export interface SegmentedControlOption<T extends string> {
  value: T
  label: string
}

/** Alternador de escopo (ex.: Minhas/Todos) com estado pressionado acessível. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  items,
  'aria-label': ariaLabel,
  className,
}: {
  value: T
  onChange: (v: T) => void
  items: SegmentedControlOption<T>[]
  'aria-label': string
  className?: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('flex rounded-md border border-line-strong p-0.5', className)}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            aria-pressed={active}
            className={cn(
              'touch-target rounded px-2.5 py-1 text-[12.5px] font-medium transition-colors',
              active ? 'bg-navy-900 text-white' : 'text-ink-muted hover:text-ink',
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
