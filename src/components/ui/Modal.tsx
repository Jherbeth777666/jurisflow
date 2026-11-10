import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /**
   * Formulário com alterações não salvas: clique no fundo NÃO fecha e Esc pede
   * confirmação. Fechar pelo X ou por "Cancelar" continua explícito.
   */
  dirty?: boolean
}

const DISCARD_MSG = 'Descartar as alterações não salvas?'

// Pilha de modais abertos: só o do topo responde a Esc/Tab (diálogos empilhados).
const openStack: symbol[] = []

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }

export function Modal({ open, onClose, title, description, children, footer, size = 'md', dirty = false }: ModalProps) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // onClose em ref: o efeito (foco inicial, trava de scroll) roda só ao abrir/fechar,
  // não a cada render do pai com uma nova função.
  const onCloseRef = useRef(onClose)
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    onCloseRef.current = onClose
    dirtyRef.current = dirty
  }, [onClose, dirty])

  useEffect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null
    const me = Symbol('modal')
    openStack.push(me)
    const onKey = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== me) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!dirtyRef.current || window.confirm(DISCARD_MSG)) onCloseRef.current()
      }
      if (e.key === 'Tab' && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea')
      ;(target ?? panelRef.current)?.focus()
    })
    return () => {
      openStack.splice(openStack.indexOf(me), 1)
      document.removeEventListener('keydown', onKey)
      if (!openStack.length) document.body.style.overflow = ''
      prevFocus?.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-navy-950/40 backdrop-blur-[2px]"
        onClick={() => {
          if (!dirty) onClose()
        }}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-xl bg-surface shadow-[var(--shadow-pop)] sm:rounded-xl',
          sizes[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold text-ink">
              {title}
            </h2>
            {description && <p id={descId} className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X className="size-4" />
          </Button>
        </div>
        <div className="scrollbar-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-canvas/60 px-5 py-3 rounded-b-xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
