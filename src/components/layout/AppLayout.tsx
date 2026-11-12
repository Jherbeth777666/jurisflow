import { Suspense, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
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
  ChevronRight,
  FlaskConical,
  MessageSquareText,
  FileUp,
  HeartPulse,
  Plus,
} from 'lucide-react'
import { CommandPalette, CommandTrigger } from '@/features/command/CommandPalette'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { useAuth } from '@/contexts/AuthContext'
import { ROLE_LABELS } from '@/lib/constants'
import { Avatar, LogoMark, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }
type NavGroup = { label: string | null; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ to: '/', label: 'Visão geral', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Operação',
    items: [
      { to: '/demandas', label: 'Demandas', icon: Briefcase },
      { to: '/fluxos', label: 'Fluxos de trabalho', icon: KanbanSquare },
      { to: '/tarefas', label: 'Tarefas', icon: CheckSquare },
      { to: '/agenda', label: 'Agenda', icon: CalendarDays },
    ],
  },
  {
    label: 'Clientes e financeiro',
    items: [
      { to: '/clientes', label: 'Clientes', icon: Users },
      { to: '/contratos', label: 'Contratos e honorários', icon: Wallet },
      { to: '/mensagens', label: 'Mensagens', icon: MessageSquareText },
    ],
  },
  {
    label: 'Inteligência',
    items: [
      { to: '/assistente', label: 'Assistente IA', icon: Sparkles },
      { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
    ],
  },
  {
    label: 'Ferramentas',
    items: [
      { to: '/importar', label: 'Importar planilha', icon: FileUp },
      { to: '/qualidade', label: 'Saúde do cadastro', icon: HeartPulse },
      { to: '/configuracoes', label: 'Configurações', icon: Settings },
    ],
  },
]

const ALL_NAV = NAV_GROUPS.flatMap((g) => g.items)

function Sidebar({ onNavigate, showSearch }: { onNavigate?: () => void; showSearch?: boolean }) {
  const { organization, memberships, switchOrganization, profile, role, signOut } = useAuth()
  const [orgMenu, setOrgMenu] = useState(false)
  const multi = memberships.length > 1

  return (
    <div className="bg-sidebar flex h-full flex-col text-navy-100">
      <div className="flex h-16 items-center gap-2.5 px-5">
        <LogoMark className="size-8" />
        <span className="text-[15.5px] font-semibold tracking-tight text-white">
          JurisFlow <span className="font-medium text-accent-200">AI</span>
        </span>
      </div>

      <div className="relative px-3 pb-3">
        <button
          onClick={() => multi && setOrgMenu((o) => !o)}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg bg-white/[0.06] px-2.5 py-2 text-left ring-1 ring-inset ring-white/10 transition-colors',
            multi && 'hover:bg-white/10',
          )}
          aria-haspopup={multi ? 'menu' : undefined}
        >
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-navy-700 text-[12px] font-semibold text-white"
          >
            {(organization?.name ?? '?').trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-white">{organization?.name}</span>
            <span className="block text-[11.5px] text-navy-300">{role ? ROLE_LABELS[role] : ''}</span>
          </span>
          {multi && <ChevronsUpDown className="size-3.5 shrink-0 text-navy-300" />}
        </button>
        {orgMenu && (
          <div role="menu" className="absolute left-3 right-3 z-20 mt-1 rounded-lg bg-surface py-1 text-ink shadow-[var(--shadow-pop)]">
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
          <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-400/10 px-2.5 py-1.5 text-[11.5px] text-amber-200 ring-1 ring-inset ring-amber-300/20">
            <FlaskConical className="size-3.5" /> Ambiente de demonstração
          </div>
        )}
      </div>

      {showSearch && (
        <div className="px-3 pb-1">
          <CommandTrigger className="w-full" />
        </div>
      )}

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-3" aria-label="Menu principal">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? 'inicio'} className={group.label ? 'pt-4' : 'pt-1'}>
            {group.label && (
              <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-navy-300">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors',
                      isActive
                        ? 'bg-white/[0.09] font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]'
                        : 'text-navy-200 hover:bg-white/[0.05] hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        aria-hidden
                        className={cn(
                          'absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-accent-500 transition-opacity',
                          isActive ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <Icon
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-accent-200' : 'text-navy-300 group-hover:text-navy-100',
                        )}
                        strokeWidth={1.85}
                      />
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 px-1.5 py-1">
          <Avatar name={profile?.full_name || profile?.email} className="size-8 bg-navy-700 text-navy-100 ring-2 ring-white/10" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-white">{profile?.full_name || 'Usuário'}</p>
            <p className="truncate text-[11.5px] text-navy-300">{profile?.email}</p>
          </div>
          <button
            onClick={signOut}
            className="touch-target rounded-md p-1.5 text-navy-300 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Sair"
            title="Sair"
          >
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
  const { organization } = useAuth()
  const current = ALL_NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-navy-950 lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">
            <Sidebar onNavigate={() => setMobileOpen(false)} showSearch />
            <button
              onClick={() => setMobileOpen(false)}
              className="touch-target absolute right-2 top-3 rounded-md p-1.5 text-navy-200 hover:bg-white/10"
              aria-label="Fechar menu"
            >
              <X className="size-4" />
            </button>
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line/80 bg-surface/80 px-3 backdrop-blur-xl backdrop-saturate-150 lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="touch-target flex items-center justify-center rounded-lg p-1.5 text-ink-muted hover:bg-navy-50"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>
        <LogoMark className="size-6" />
        <span className="truncate text-[14.5px] font-semibold tracking-tight">{current?.label ?? 'JurisFlow AI'}</span>
        <div className="ml-auto flex items-center gap-1">
          <CommandTrigger tone="icon" />
          <NotificationBell />
        </div>
      </header>

      <header className="sticky top-0 z-20 hidden h-14 items-center gap-4 border-b border-line/80 bg-surface/75 px-6 backdrop-blur-xl backdrop-saturate-150 lg:flex lg:px-8">
        <nav aria-label="Você está em" className="flex min-w-0 items-center gap-2 text-[13px]">
          <span className="truncate text-ink-subtle">{organization?.name ?? 'JurisFlow'}</span>
          <ChevronRight className="size-3.5 shrink-0 text-ink-subtle/60" aria-hidden />
          <span className="truncate font-medium text-ink" aria-current="page">
            {current?.label ?? 'JurisFlow AI'}
          </span>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <CommandTrigger tone="light" className="h-9 w-64 rounded-lg xl:w-80" />
          <Link
            to="/demandas?nova=1"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-b from-accent-600 to-accent-700 px-3.5 text-[13.5px] font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(29_78_216/0.4)] transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
          >
            <Plus className="size-4" aria-hidden />
            Nova demanda
          </Link>
          <span className="mx-1 h-6 w-px bg-line" aria-hidden />
          <NotificationBell />
        </div>
      </header>

      <CommandPalette />

      <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <Suspense fallback={<Spinner />}>
          <div key={location.pathname} className="animate-rise">
            <Outlet />
          </div>
        </Suspense>
      </main>
    </div>
  )
}
