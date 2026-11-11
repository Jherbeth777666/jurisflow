import { Suspense, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Briefcase,
  KanbanSquare,
  CheckSquare,
  CalendarDays,
  Wallet,
  Sparkles,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronsUpDown,
  FlaskConical,
  MessageSquareText,
  FileUp,
  HeartPulse,
} from 'lucide-react'
import { CommandPalette, CommandTrigger } from '@/features/command/CommandPalette'
import { useAuth } from '@/contexts/AuthContext'
import { ROLE_LABELS } from '@/lib/constants'
import { Avatar, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }

const NAV: NavItem[] = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/demandas', label: 'Demandas', icon: Briefcase },
  { to: '/fluxos', label: 'Fluxos de trabalho', icon: KanbanSquare },
  { to: '/tarefas', label: 'Tarefas', icon: CheckSquare },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/contratos', label: 'Contratos e honorários', icon: Wallet },
  { to: '/assistente', label: 'Assistente IA', icon: Sparkles },
  { to: '/mensagens', label: 'Mensagens', icon: MessageSquareText },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
]

const NAV_TOOLS: NavItem[] = [
  { to: '/importar', label: 'Importar planilha', icon: FileUp },
  { to: '/qualidade', label: 'Saúde do cadastro', icon: HeartPulse },
]

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { organization, memberships, switchOrganization, profile, role, signOut } = useAuth()
  const [orgMenu, setOrgMenu] = useState(false)

  return (
    <div className="flex h-full flex-col bg-navy-900 text-navy-100">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <span className="flex size-7 items-center justify-center rounded-md bg-accent-600 text-white">
          <svg viewBox="0 0 32 32" className="size-4" aria-hidden>
            <path d="M8 7h16M16 7v18M10 25h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none" />
          </svg>
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-white">
          JurisFlow <span className="font-normal text-navy-300">AI</span>
        </span>
      </div>

      <div className="relative px-3 pb-2">
        <button
          onClick={() => memberships.length > 1 && setOrgMenu((o) => !o)}
          className={cn(
            'flex w-full items-center justify-between rounded-md bg-navy-800/70 px-2.5 py-2 text-left',
            memberships.length > 1 && 'hover:bg-navy-800',
          )}
          aria-haspopup={memberships.length > 1 ? 'menu' : undefined}
        >
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-white">{organization?.name}</span>
            <span className="block text-[11.5px] text-navy-300">{role ? ROLE_LABELS[role] : ''}</span>
          </span>
          {memberships.length > 1 && <ChevronsUpDown className="size-3.5 shrink-0 text-navy-300" />}
        </button>
        {orgMenu && (
          <div role="menu" className="absolute left-3 right-3 z-20 mt-1 rounded-md bg-surface py-1 text-ink shadow-[var(--shadow-pop)]">
            {memberships.map((m) => (
              <button
                key={m.organization.id}
                role="menuitem"
                onClick={() => {
                  switchOrganization(m.organization.id)
                  setOrgMenu(false)
                }}
                className="block w-full truncate px-3 py-1.5 text-left text-[13px] hover:bg-navy-50"
              >
                {m.organization.name}
              </button>
            ))}
          </div>
        )}
        {organization?.is_demo && (
          <div className="mt-2 flex items-center gap-1.5 rounded-md bg-amber-400/15 px-2.5 py-1.5 text-[11.5px] text-amber-200">
            <FlaskConical className="size-3.5" /> Ambiente de demonstração
          </div>
        )}
      </div>

      <div className="px-3 pb-1">
        <CommandTrigger className="w-full" />
      </div>

      <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="Menu principal">
        {[...NAV, null, ...NAV_TOOLS].map((item) => {
          if (!item) return <p key="tools" className="px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-navy-400">Ferramentas</p>
          const { to, label, icon: Icon, end } = item
          return (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] transition-colors',
                isActive ? 'bg-white/10 font-medium text-white' : 'text-navy-200 hover:bg-white/5 hover:text-white',
              )
            }
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            {label}
          </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 px-1">
          <Avatar name={profile?.full_name || profile?.email} className="size-7 bg-navy-700 text-navy-100" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-white">{profile?.full_name || 'Usuário'}</p>
            <p className="truncate text-[11.5px] text-navy-300">{profile?.email}</p>
          </div>
          <button onClick={signOut} className="rounded-md p-1.5 text-navy-300 hover:bg-white/10 hover:text-white" aria-label="Sair" title="Sair">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const current = [...NAV, ...NAV_TOOLS].find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-64">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-2 top-3 rounded-md p-1.5 text-navy-200 hover:bg-white/10"
              aria-label="Fechar menu"
            >
              <X className="size-4" />
            </button>
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-ink-muted hover:bg-navy-50" aria-label="Abrir menu">
          <Menu className="size-5" />
        </button>
        <span className="text-[14px] font-semibold">{current?.label ?? 'JurisFlow AI'}</span>
      </header>

      <CommandPalette />

      <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
