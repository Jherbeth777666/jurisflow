import { Suspense, useEffect, useState } from 'react'
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
  PanelLeftClose,
  PanelLeftOpen,
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
const COLLAPSE_KEY = 'jurisflow:menu-recolhido'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

function Sidebar({
  onNavigate,
  showSearch,
  collapsed = false,
  onToggleCollapsed,
}: {
  onNavigate?: () => void
  showSearch?: boolean
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const { organization, memberships, switchOrganization, profile, role, signOut } = useAuth()
  const [orgMenu, setOrgMenu] = useState(false)
  const multi = memberships.length > 1

  return (
    <div className="flex h-full flex-col border-r border-line bg-sidebar">
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5', collapsed ? 'justify-center' : 'px-4')}>
        <LogoMark className="size-7" />
        {!collapsed && (
          <span className="text-body-lg font-semibold tracking-[-0.01em] text-ink">
            JurisFlow <span className="font-medium text-ink-subtle">AI</span>
          </span>
        )}
      </div>

      <div className={cn('relative pb-2', collapsed ? 'px-2' : 'px-3')}>
        <button
          onClick={() => multi && setOrgMenu((o) => !o)}
          title={collapsed ? organization?.name : undefined}
          aria-label={collapsed ? `Escritório: ${organization?.name ?? ''}` : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-[var(--radius-control)] bg-surface p-1.5 text-left shadow-[var(--shadow-card)] transition-shadow',
            multi && 'hover:shadow-[var(--shadow-lift)]',
            collapsed && 'justify-center',
          )}
          aria-haspopup={multi ? 'menu' : undefined}
        >
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-navy-50 text-caption font-semibold text-navy-700"
          >
            {(organization?.name ?? '?').trim().charAt(0).toUpperCase()}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-medium leading-tight text-ink">{organization?.name}</span>
                <span className="block text-2xs text-ink-subtle">{role ? ROLE_LABELS[role] : ''}</span>
              </span>
              {multi && <ChevronsUpDown className="mr-1 size-3.5 shrink-0 text-ink-subtle" />}
            </>
          )}
        </button>
        {orgMenu && (
          <div
            role="menu"
            className="absolute left-3 right-3 z-20 mt-1 min-w-48 animate-pop rounded-[var(--radius-control)] bg-surface py-1 text-ink shadow-[var(--shadow-pop)]"
          >
            {memberships.map((m) => (
              <button
                key={m.organization.id}
                role="menuitem"
                onClick={() => {
                  switchOrganization(m.organization.id)
                  setOrgMenu(false)
                }}
                className="block w-full truncate px-3 py-1.5 text-left text-body-sm hover:bg-surface-muted"
              >
                {m.organization.name}
              </button>
            ))}
          </div>
        )}
        {organization?.is_demo && !collapsed && (
          <div className="mt-2 flex items-center gap-1.5 rounded-[var(--radius-control)] bg-amber-50 px-2.5 py-1.5 text-2xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200/70">
            <FlaskConical className="size-3.5" aria-hidden /> Ambiente de demonstração
          </div>
        )}
      </div>

      {showSearch && (
        <div className="px-3 pb-1">
          <CommandTrigger tone="light" className="w-full" />
        </div>
      )}

      <nav className={cn('scrollbar-thin flex-1 overflow-y-auto pb-3', collapsed ? 'px-2' : 'px-3')} aria-label="Menu principal">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? 'inicio'} className={group.label ? 'pt-4' : 'pt-2'}>
            {group.label &&
              (collapsed ? (
                <div className="mx-auto mb-2 h-px w-6 bg-line-strong" aria-hidden />
              ) : (
                <p className="eyebrow px-2.5 pb-1.5">{group.label}</p>
              ))}
            <div className="space-y-px">
              {group.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  title={collapsed ? label : undefined}
                  aria-label={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'group flex min-h-8 items-center gap-2.5 rounded-[var(--radius-control)] text-body-sm transition-[background-color,color,box-shadow] duration-150',
                      collapsed ? 'justify-center py-2' : 'px-2.5 py-1.5',
                      isActive
                        ? 'bg-surface font-medium text-ink shadow-[var(--shadow-card)]'
                        : 'text-ink-muted hover:bg-ink/[0.045] hover:text-ink',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={cn(
                          'size-[17px] shrink-0 transition-colors',
                          isActive ? 'text-accent-600' : 'text-ink-subtle group-hover:text-ink-muted',
                        )}
                        strokeWidth={1.8}
                        aria-hidden
                      />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn('shrink-0 border-t border-line', collapsed ? 'px-2 py-2' : 'p-3')}>
        <div className={cn('flex items-center gap-2.5', collapsed ? 'flex-col' : 'px-1')}>
          <Avatar name={profile?.full_name || profile?.email} className="size-8 bg-navy-900 text-white" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-medium leading-tight text-ink">{profile?.full_name || 'Usuário'}</p>
              <p className="truncate text-2xs text-ink-subtle">{profile?.email}</p>
            </div>
          )}
          <button
            onClick={signOut}
            className="touch-target flex size-8 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-ink/[0.06] hover:text-ink"
            aria-label="Sair"
            title="Sair"
          >
            <LogOut className="size-4" />
          </button>
        </div>
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            className={cn(
              'mt-2 flex h-8 w-full items-center gap-2 rounded-md text-caption text-ink-subtle transition-colors hover:bg-ink/[0.045] hover:text-ink',
              collapsed ? 'justify-center' : 'px-2',
            )}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && 'Recolher menu'}
          </button>
        )}
      </div>
    </div>
  )
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const location = useLocation()
  const { organization } = useAuth()
  const current = ALL_NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* armazenamento indisponível: só não lembra a preferência */
    }
  }, [collapsed])

  return (
    <div className={cn('min-h-dvh transition-[padding] duration-200 ease-out', collapsed ? 'lg:pl-16' : 'lg:pl-60')}>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-200 ease-out lg:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade bg-navy-950/35 backdrop-blur-[3px]" onClick={() => setMobileOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-rise shadow-[var(--shadow-pop)]">
            <Sidebar onNavigate={() => setMobileOpen(false)} showSearch />
            <button
              onClick={() => setMobileOpen(false)}
              className="touch-target absolute right-2 top-3 flex size-8 items-center justify-center rounded-md text-ink-subtle hover:bg-ink/[0.06] hover:text-ink"
              aria-label="Fechar menu"
            >
              <X className="size-4" />
            </button>
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-canvas/85 px-3 backdrop-blur-xl lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="touch-target flex items-center justify-center rounded-md p-1.5 text-ink-muted hover:bg-ink/[0.05]"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>
        <LogoMark className="size-6" />
        <span className="truncate text-body-lg font-semibold tracking-[-0.01em]">{current?.label ?? 'JurisFlow AI'}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <CommandTrigger tone="icon" />
          <NotificationBell />
        </div>
      </header>

      <header className="sticky top-0 z-20 hidden h-14 items-center gap-4 border-b border-line bg-canvas/85 px-6 backdrop-blur-xl lg:flex lg:px-10">
        <nav aria-label="Você está em" className="flex min-w-0 items-center gap-1.5 text-body-sm">
          <span className="truncate text-ink-subtle">{organization?.name ?? 'JurisFlow'}</span>
          <ChevronRight className="size-3.5 shrink-0 text-ink-subtle/50" aria-hidden />
          <span className="truncate font-medium text-ink" aria-current="page">
            {current?.label ?? 'JurisFlow AI'}
          </span>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <CommandTrigger tone="light" className="h-8 w-60 xl:w-72" />
          <Link
            to="/demandas?nova=1"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] bg-navy-900 px-3 text-body-sm font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.1),var(--shadow-xs)] transition-[background-color,transform] duration-150 hover:bg-navy-800 active:scale-[0.97]"
          >
            <Plus className="size-4" aria-hidden />
            Nova demanda
          </Link>
          <span className="mx-1 h-5 w-px bg-line-strong" aria-hidden />
          <NotificationBell />
        </div>
      </header>

      <CommandPalette />

      <main className="mx-auto w-full max-w-[1360px] px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
        <Suspense fallback={<Spinner />}>
          <div key={location.pathname} className="animate-rise">
            <Outlet />
          </div>
        </Suspense>
      </main>
    </div>
  )
}
