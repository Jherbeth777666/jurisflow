// Barra de ações em massa (L13): fixa no rodapé enquanto há itens selecionados.
// Genérica: quem usa passa as ações; a confirmação antes de aplicar é de quem usa.
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui'

export interface BulkAction {
  key: string
  label: string
  onClick: () => void
  disabled?: boolean
  /** Dica exibida (title) — útil para explicar por que a ação está desabilitada. */
  hint?: string
  tone?: 'default' | 'danger'
  icon?: ReactNode
}

export function BulkBar({
  count,
  actions,
  onClear,
}: {
  count: number
  actions: BulkAction[]
  onClear: () => void
}) {
  if (count <= 0) return null
  const hint = actions.find((a) => a.disabled && a.hint)?.hint
  const label = `${count} ${count === 1 ? 'selecionada' : 'selecionadas'}`
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:pb-5">
      <div
        role="region"
        aria-label="Ações em massa"
        className="pointer-events-auto flex w-full max-w-3xl animate-rise flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5 shadow-[var(--shadow-pop)]"
      >
        <span className="tabular mr-1 text-body-sm font-semibold text-ink">
          {label}
        </span>
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {actions.map((a) => (
            <Button
              key={a.key}
              size="sm"
              variant={a.tone === 'danger' ? 'danger' : 'secondary'}
              icon={a.icon}
              disabled={a.disabled}
              title={a.disabled ? a.hint : undefined}
              onClick={a.onClick}
            >
              {a.label}
            </Button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Limpar seleção
        </Button>
        {hint && <p className="w-full text-caption text-ink-muted">{hint}</p>}
      </div>
    </div>,
    document.body,
  )
}
