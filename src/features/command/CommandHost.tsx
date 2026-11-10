// Parte leve da busca global, carregada com o layout: atalho Ctrl+K/⌘K, botão e
// evento de abertura. O conteúdo (consultas, lista) é carregado só ao abrir.
import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'

const Palette = lazy(() => import('./CommandPalette'))

// ---------------------------------------------------------------------------
// Abertura global (atalho + evento para o botão do menu)
// ---------------------------------------------------------------------------
const OPEN_EVENT = 'jurisflow:command-palette'

function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

/** Botão compacto "Buscar… ⌘K" para o topo do menu lateral (tema escuro) ou barras claras. */
export function CommandTrigger({ tone = 'dark', className }: { tone?: 'dark' | 'light'; className?: string }) {
  const [mac] = useState(isMac)
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
      aria-label="Buscar ou executar comando"
      className={cn(
        'group flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-[13px] transition-colors',
        tone === 'dark'
          ? 'bg-navy-800/70 text-navy-300 hover:bg-navy-800 hover:text-white'
          : 'border border-line-strong bg-surface text-ink-subtle hover:border-navy-200 hover:text-ink',
        className,
      )}
    >
      <Search className="size-3.5 shrink-0" />
      <span className="flex-1 truncate text-left">Buscar…</span>
      <kbd
        className={cn(
          'rounded px-1.5 py-px font-sans text-[10.5px] font-medium',
          tone === 'dark' ? 'bg-navy-900/80 text-navy-300' : 'bg-canvas text-ink-subtle ring-1 ring-line',
        )}
      >
        {mac ? '⌘K' : 'Ctrl K'}
      </kbd>
    </button>
  )
}

/** Monte uma vez no layout autenticado: registra Ctrl+K / ⌘K e renderiza o modal. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_EVENT, onOpen)
    }
  }, [])

  if (!open) return null
  return createPortal(
    <Suspense fallback={null}>
      <Palette onClose={() => setOpen(false)} />
    </Suspense>,
    document.body,
  )
}

