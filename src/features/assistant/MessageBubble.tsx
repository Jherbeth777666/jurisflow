import { Database, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Markdown } from './markdown'
import { toolLabel } from './constants'

export function MessageBubble({ role, content, toolsUsed }: { role: 'user' | 'assistant'; content: string; toolsUsed?: string[] }) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-navy-900 px-3.5 py-2.5 text-body leading-relaxed text-white">
          {content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-700">
        <Sparkles className="size-3.5" />
      </div>
      <div className="min-w-0 max-w-[92%] flex-1">
        <div className="break-words rounded-xl rounded-tl-sm border border-line bg-surface px-3.5 py-2.5">
          <Markdown text={content} />
        </div>
        {toolsUsed && toolsUsed.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5" aria-label="Dados consultados">
            {toolsUsed.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-2xs text-ink-muted ring-1 ring-inset ring-line"
              >
                <Database className="size-3" />
                {toolLabel(t)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function ThinkingIndicator() {
  return (
    <div className="flex gap-2.5" role="status" aria-live="polite">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-700">
        <Sparkles className="size-3.5" />
      </div>
      <div className={cn('inline-flex items-center gap-2 rounded-xl rounded-tl-sm border border-line bg-surface px-3.5 py-2.5')}>
        <Loader2 className="size-3.5 animate-spin text-accent-600" />
        <span className="text-body-sm text-ink-muted">Consultando dados…</span>
      </div>
    </div>
  )
}
