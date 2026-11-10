import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { WorkflowStage } from '@/types/database'

/** Barra de progresso das etapas — horizontal, compacta e rolável em telas pequenas. */
export function StageStepper({ stages, currentId, color }: { stages: WorkflowStage[]; currentId: string | null; color?: string }) {
  if (!stages.length) return <p className="text-[13px] text-ink-subtle">Esta categoria não possui etapas configuradas.</p>
  const currentIdx = stages.findIndex((s) => s.id === currentId)
  return (
    <ol className="scrollbar-thin -mx-1 flex items-start overflow-x-auto px-1 pb-1" aria-label="Progresso das etapas">
      {stages.map((s, i) => {
        const done = currentIdx >= 0 && i < currentIdx
        const current = i === currentIdx
        return (
          <li key={s.id} className="flex min-w-[92px] flex-1 flex-col items-center gap-1.5" aria-current={current ? 'step' : undefined}>
            <div className="flex w-full items-center">
              <span className={cn('h-px flex-1', i === 0 ? 'bg-transparent' : done || current ? 'bg-navy-400' : 'bg-line')} />
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-1 ring-inset',
                  done && 'bg-navy-900 text-white ring-navy-900',
                  current && 'bg-surface text-navy-900 ring-2 ring-navy-900',
                  !done && !current && 'bg-surface text-ink-subtle ring-line-strong',
                )}
                style={current && color ? { boxShadow: `0 0 0 4px ${color}22` } : undefined}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn('h-px flex-1', i === stages.length - 1 ? 'bg-transparent' : done ? 'bg-navy-400' : 'bg-line')} />
            </div>
            <span
              className={cn(
                'line-clamp-2 px-1 text-center text-[11.5px] leading-tight',
                current ? 'font-medium text-ink' : done ? 'text-ink-muted' : 'text-ink-subtle',
              )}
            >
              {s.name}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
