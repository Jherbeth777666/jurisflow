// Painel "O que fazer hoje": prazos e próximas ações, com conclusão rápida de tarefas.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlarmClock, CalendarClock, CheckCircle2, Hourglass } from 'lucide-react'
import { supabase, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/AuthContext'
import { qk } from '@/hooks/useOrgData'
import { diffInDays, todayISO } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Card, CardHeader, ErrorState, Skeleton } from '@/components/ui'
import { OPEN_STATUSES as DEMAND_OPEN_STATUSES, STALLED_DAYS } from '@/features/demands/logic'
import { OPEN_STATUSES as TASK_OPEN_STATUSES, useToggleTask } from '@/features/tasks/api'
import { fetchClientNames } from '@/features/contracts/api'
import { buildTodayItems, type TodayDemand, type TodayItem, type TodayTask } from './today'

type Scope = 'mine' | 'all'

const SCOPE_KEY = 'jurisflow.today.scope'

function readScope(): Scope {
  try {
    return localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'mine'
  } catch {
    return 'mine'
  }
}

function saveScope(scope: Scope) {
  try {
    localStorage.setItem(SCOPE_KEY, scope)
  } catch {
    // localStorage indisponível (modo privado); a escolha vale só nesta sessão.
  }
}

function dateLabel(item: TodayItem, today: string): string {
  if (!item.overdue) return 'Hoje'
  const days = diffInDays(item.date, today)
  return days === 1 ? 'Atrasada há 1 dia' : `Atrasada há ${days} dias`
}

export function TodayPanel() {
  const { orgId, userId } = useOrg()
  const toggle = useToggleTask()
  const [scope, setScope] = useState<Scope>(readScope)
  const today = todayISO()

  const tasksQ = useQuery({
    queryKey: [...qk.dashboard(orgId), 'today-tasks', today],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('tasks')
          .select('id, title, due_date, status, assignee_id, client_id, demand_id')
          .eq('organization_id', orgId)
          .in('status', TASK_OPEN_STATUSES)
          .lte('due_date', today)
          .order('due_date', { ascending: true })
          .limit(50),
      ) as TodayTask[],
  })

  const demandsQ = useQuery({
    queryKey: [...qk.dashboard(orgId), 'today-demands', today],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('demands')
          .select('id, title, next_action, next_action_date, status, responsible_id, client_id')
          .eq('organization_id', orgId)
          .in('status', DEMAND_OPEN_STATUSES)
          .lte('next_action_date', today)
          .order('next_action_date', { ascending: true })
          .limit(50),
      ) as TodayDemand[],
  })

  const stalledQ = useQuery({
    queryKey: [...qk.dashboard(orgId), 'stalled-count', STALLED_DAYS],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - STALLED_DAYS * 86_400_000).toISOString()
      const res = await supabase
        .from('demands')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .in('status', DEMAND_OPEN_STATUSES)
        .lt('stage_changed_at', cutoff)
      if (res.error) throw new Error(String(res.error))
      return res.count ?? (res.data as unknown[] | null)?.length ?? 0
    },
  })

  const items = useMemo(() => {
    const all = buildTodayItems({ tasks: tasksQ.data ?? [], demands: demandsQ.data ?? [], today })
    return scope === 'mine' ? all.filter((i) => i.assigneeId === userId) : all
  }, [tasksQ.data, demandsQ.data, scope, userId, today])

  const demandIds = useMemo(
    () => [...new Set(items.map((i) => i.demandId).filter((id): id is string => !!id))],
    [items],
  )
  const clientIds = useMemo(
    () => [...new Set(items.map((i) => i.clientId).filter((id): id is string => !!id))],
    [items],
  )

  // Nome do cliente e título da demanda: sem isso vários itens ficam idênticos.
  const contextQ = useQuery({
    queryKey: [...qk.dashboard(orgId), 'today-context', today, demandIds.join(','), clientIds.join(',')],
    enabled: items.length > 0,
    queryFn: async () => {
      const demands = demandIds.length
        ? (unwrap(
            await supabase
              .from('demands')
              .select('id, title, client_id')
              .eq('organization_id', orgId)
              .in('id', demandIds),
          ) as { id: string; title: string; client_id: string | null }[])
        : []
      const allClientIds = [...new Set([...clientIds, ...demands.map((d) => d.client_id).filter((id): id is string => !!id)])]
      const clients = allClientIds.length ? await fetchClientNames(orgId, allClientIds) : new Map<string, string>()
      return {
        demands: new Map(demands.map((d) => [d.id, d])),
        clients,
      }
    },
  })

  const overdueCount = items.filter((i) => i.overdue).length
  const todayCount = items.length - overdueCount
  const stalled = stalledQ.data ?? 0
  const visibleItems = items.slice(0, 8)
  const moreHref = `/agenda?v=${overdueCount > 0 ? 'atrasados' : 'hoje'}`

  function contextFor(item: TodayItem): string {
    const demand = item.demandId ? contextQ.data?.demands.get(item.demandId) : null
    const clientId = item.clientId ?? demand?.client_id ?? null
    const clientName = clientId ? contextQ.data?.clients.get(clientId) : null
    return [clientName, demand?.title].filter(Boolean).join(' · ')
  }

  const loading = tasksQ.isLoading || demandsQ.isLoading || (items.length > 0 && contextQ.isLoading)
  const error = (tasksQ.error ?? demandsQ.error) as Error | null

  function changeScope(next: Scope) {
    setScope(next)
    saveScope(next)
  }

  return (
    <Card>
      <CardHeader
        title="O que fazer hoje"
        description="Prazos e próximas ações até hoje"
        action={
          <div className="flex rounded-md border border-line-strong p-0.5" role="group" aria-label="Filtrar por responsável">
            {(['mine', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => changeScope(value)}
                aria-pressed={scope === value}
                className={cn(
                  'rounded px-2.5 py-1 text-[12.5px] font-medium transition-colors',
                  scope === value ? 'bg-navy-900 text-white' : 'text-ink-muted hover:text-ink',
                )}
              >
                {value === 'mine' ? 'Minhas' : 'Todos'}
              </button>
            ))}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-[12.5px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <AlarmClock className="size-3.5 text-red-600" aria-hidden />
          <strong className="tabular-nums text-red-600">{overdueCount}</strong> atrasados
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-3.5 text-amber-600" aria-hidden />
          <strong className="tabular-nums text-ink">{todayCount}</strong> hoje
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Hourglass className="size-3.5 text-amber-700" aria-hidden />
          <strong className="tabular-nums text-ink">{stalled}</strong> demandas paradas
        </span>
      </div>

      {loading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : error ? (
        <ErrorState message={error.message} onRetry={() => void Promise.all([tasksQ.refetch(), demandsQ.refetch()])} />
      ) : !items.length ? (
        <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
          <CheckCircle2 className="mb-3 size-6 text-accent-600" aria-hidden />
          <p className="text-[14px] font-medium text-ink">Nada para hoje. Tudo em dia.</p>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {visibleItems.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className={cn(
                'flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
                item.overdue && 'bg-red-50/40',
              )}
            >
              <div className="min-w-0 flex-1">
                {item.kind === 'next_action' ? (
                  <Link to={item.href} className="block truncate text-[13.5px] font-medium text-ink hover:underline">
                    {item.title}
                  </Link>
                ) : (
                  <span className="block truncate text-[13.5px] font-medium text-ink">{item.title}</span>
                )}
                <span className="mt-0.5 block truncate text-[12px] text-ink-subtle">{contextFor(item)}</span>
                <span
                  className={cn(
                    'mt-0.5 block text-[12px] tabular-nums',
                    item.overdue ? 'font-medium text-red-600' : 'font-medium text-amber-700',
                  )}
                >
                  {dateLabel(item, today)}
                </span>
              </div>
              {item.kind === 'task' && (
                <button
                  type="button"
                  onClick={() => toggle.mutate({ id: item.id, done: true })}
                  aria-label={`Concluir tarefa ${item.title}`}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center self-end rounded-md border border-line-strong text-ink-muted transition-colors hover:bg-navy-50 hover:text-ink sm:self-auto"
                >
                  <CheckCircle2 className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && items.length > 8 && (
        <div className="border-t border-line px-4 py-2 text-center">
          <Link to={moreHref} className="text-[12.5px] font-medium text-accent-700 hover:underline">
            Ver todos ({items.length})
          </Link>
        </div>
      )}
    </Card>
  )
}
