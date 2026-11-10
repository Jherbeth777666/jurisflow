import { MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Skeleton } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/format'
import type { ConversationSummary } from './api'

interface Props {
  conversations: ConversationSummary[] | undefined
  loading: boolean
  error: string | null
  onRetry: () => void
  selectedId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (c: ConversationSummary) => void
  onDelete: (c: ConversationSummary) => void
}

export function ConversationList({ conversations, loading, error, onRetry, selectedId, onSelect, onNew, onRename, onDelete }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-3">
        <h2 className="text-[13px] font-semibold text-ink">Conversas</h2>
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={onNew}>
          Nova
        </Button>
      </div>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2 p-1" aria-busy="true" aria-label="Carregando conversas">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="p-3 text-[12.5px] text-red-700" role="alert">
            {error}{' '}
            <button className="font-medium underline" onClick={onRetry}>
              Tentar novamente
            </button>
          </div>
        ) : !conversations?.length ? (
          <p className="px-2 py-6 text-center text-[12.5px] text-ink-muted">
            Nenhuma conversa ainda. Faça uma pergunta para começar.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => {
              const active = c.id === selectedId
              return (
                <li key={c.id} className="group relative">
                  <button
                    onClick={() => onSelect(c.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md py-2 pl-2.5 pr-16 text-left transition-colors',
                      active ? 'bg-navy-50 text-ink' : 'text-ink-muted hover:bg-canvas hover:text-ink',
                    )}
                  >
                    <MessageSquare className="mt-0.5 size-3.5 shrink-0 opacity-60" />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{c.title}</span>
                      <span className="block text-[11.5px] text-ink-subtle">{formatRelative(c.updated_at)}</span>
                    </span>
                  </button>
                  <div
                    className={cn(
                      'absolute right-1 top-1.5 flex gap-0.5 transition-opacity',
                      'opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100',
                    )}
                  >
                    <button
                      onClick={() => onRename(c)}
                      className="rounded p-1.5 text-ink-subtle hover:bg-surface hover:text-ink"
                      aria-label={`Renomear conversa ${c.title}`}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => onDelete(c)}
                      className="rounded p-1.5 text-ink-subtle hover:bg-surface hover:text-red-600"
                      aria-label={`Excluir conversa ${c.title}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
