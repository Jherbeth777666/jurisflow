import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, BellOff, CalendarClock, CheckCheck, ClipboardList, TrendingDown, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatRelative } from '@/lib/format'
import type { Notification, NotificationKind } from '@/types/database'
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from './api'

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  resumo_diario: ClipboardList,
  tarefas_atrasadas: AlertTriangle,
  prazos_hoje: CalendarClock,
  proximas_acoes_vencidas: TrendingDown,
  demandas_paradas: BellOff,
}

function NotificationItem({ item, onOpen }: { item: Notification; onOpen: (item: Notification) => void }) {
  const Icon = KIND_ICON[item.kind]
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn(
          'flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-canvas',
          item.read_at == null && 'bg-accent-50/40',
        )}
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-navy-500" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">{item.title}</span>
          {item.body && <span className="mt-0.5 block text-[12.5px] text-ink-muted">{item.body}</span>}
          <span className="mt-1 block text-[11.5px] text-ink-subtle">{formatRelative(item.created_at)}</span>
        </span>
        {item.read_at == null && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-600" aria-hidden />}
      </button>
    </li>
  )
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { data, isLoading } = useNotifications()
  const { data: count = 0 } = useUnreadCount()
  const markRead = useMarkRead()
  const markAll = useMarkAllRead()
  const notifications = data ?? []

  function handleOpen(item: Notification) {
    if (item.read_at == null) markRead.mutate(item.id)
    setOpen(false)
    navigate(item.link)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Avisos (${count} não lidos)`}
        aria-expanded={open}
        className="touch-target relative flex size-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-navy-50 hover:text-ink lg:size-9"
      >
        <Bell className="size-[18px]" strokeWidth={1.75} />
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-lg bg-surface shadow-[var(--shadow-pop)] ring-1 ring-line">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
            <p className="text-[13px] font-semibold text-ink">Avisos</p>
            {count > 0 && (
              <button
                type="button"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] font-medium text-accent-700 hover:bg-accent-50 disabled:opacity-50"
              >
                <CheckCheck className="size-3.5" aria-hidden />
                Marcar todas como lidas
              </button>
            )}
          </div>

          {isLoading ? (
            <p className="px-3.5 py-6 text-center text-[12.5px] text-ink-muted">Carregando avisos…</p>
          ) : notifications.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-[12.5px] text-ink-muted">Nenhum aviso por aqui.</p>
          ) : (
            <ul className="max-h-[min(420px,60vh)] divide-y divide-line overflow-y-auto">
              {notifications.map((item) => (
                <NotificationItem key={item.id} item={item} onOpen={handleOpen} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
