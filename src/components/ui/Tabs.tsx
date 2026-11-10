import { useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { tabId, tabPanelId } from './tabIds'

/**
 * Abas acessíveis (padrão WAI-ARIA): setas ←/→, Home/End movem e ativam; só a aba
 * ativa entra na ordem do Tab. Com `idPrefix`, liga cada aba ao painel (aria-controls).
 */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
  idPrefix,
  label,
}: {
  value: T
  onChange: (v: T) => void
  items: { value: T; label: string; count?: number }[]
  className?: string
  idPrefix?: string
  /** Rótulo acessível do grupo de abas */
  label?: string
}) {
  const listRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = items.findIndex((it) => it.value === value)
    let next = -1
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next < 0) return
    e.preventDefault()
    onChange(items[next].value)
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}>
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            id={idPrefix ? tabId(idPrefix, it.value) : undefined}
            aria-controls={idPrefix ? tabPanelId(idPrefix, it.value) : undefined}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(it.value)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
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
