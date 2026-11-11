// Agenda unificada: tarefas, próximas ações e parcelas em um só lugar.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, CalendarClock, ListTodo, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useOrg } from '@/contexts/AuthContext'
import { useMemberNames } from '@/hooks/useOrgData'
import { formatCurrency, todayISO } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '@/components/ui'
import { fetchClientNames } from '@/features/contracts/api'
import { groupByDay, rangeFor, type AgendaItem, type AgendaView } from './logic'

type Scope = 'mine' | 'all'

interface AgendaRow extends AgendaItem {
  client_name: string | null
}

const VIEWS: { value: AgendaView; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mês' },
  { value: 'atrasados', label: 'Atrasados' },
]

function isView(value: string | null): value is AgendaView {
  return value === 'hoje' || value === 'semana' || value === 'mes' || value === 'atrasados'
}

const KIND_META: Record<AgendaItem['kind'], { icon: typeof ListTodo; tone: string; label: string }> = {
  task: { icon: ListTodo, tone: 'bg-navy-50 text-navy-600', label: 'Tarefa' },
  next_action: { icon: CalendarClock, tone: 'bg-amber-50 text-amber-700', label: 'Próxima ação' },
  installment: { icon: Wallet, tone: 'bg-emerald-50 text-emerald-700', label: 'Parcela' },
}

function hrefFor(item: AgendaItem): string {
  if (item.kind === 'task') return '/tarefas'
  if (item.kind === 'next_action') return item.demand_id ? `/demandas/${item.demand_id}` : '/demandas'
  return item.contract_id ? `/contratos/${item.contract_id}` : '/contratos'
}

export function AgendaPage() {
  const { orgId } = useOrg()
  const members = useMemberNames()
  const [params, setParams] = useSearchParams()
  const [scope, setScope] = useState<Scope>('all')
  const today = todayISO()

  const rawView = params.get('v')
  const view: AgendaView = isView(rawView) ? rawView : 'hoje'
  const range = rangeFor(view, today)

  const agendaQ = useQuery({
    queryKey: ['agenda', orgId, view, scope, today],
    enabled: !!orgId,
    queryFn: async (): Promise<AgendaRow[]> => {
      const res = await supabase.rpc('agenda_items', {
        p_org: orgId,
        p_from: range.from,
        p_to: range.to,
        p_only_mine: scope === 'mine',
      })
      if (res.error) throw new Error(res.error.message)

      const rows = ((res.data ?? []) as AgendaItem[]).map((row) => ({
        ...row,
        amount: row.amount == null ? null : Number(row.amount),
      }))
      const clientIds = rows.map((r) => r.client_id).filter((id): id is string => !!id)
      const clientNames = clientIds.length ? await fetchClientNames(orgId, clientIds) : new Map<string, string>()
      return rows.map((row) => ({
        ...row,
        client_name: row.client_id ? (clientNames.get(row.client_id) ?? null) : null,
      }))
    },
  })

  const items = useMemo(() => {
    const rows = agendaQ.data ?? []
    if (view === 'atrasados') return rows.filter((row) => row.overdue)
    // Semana e mês mostram só o período; atrasados antigos ficam em "Hoje" e "Atrasados".
    if (view === 'semana' || view === 'mes') return rows.filter((row) => row.date >= range.from)
    return rows
  }, [agendaQ.data, view, range.from])

  const groups = useMemo(() => groupByDay(items, today), [items, today])

  function changeView(next: AgendaView) {
    const search = new URLSearchParams(params)
    search.set('v', next)
    setParams(search, { replace: true })
  }

  return (
    <div>
      <PageHeader
        title="Agenda"
        description="Prazos de tarefas, próximas ações e parcelas a receber."
      />

      <Card>
        <div className="flex flex-col gap-2 border-b border-line px-4 pt-2 sm:flex-row sm:items-center sm:justify-between">
          <Tabs<AgendaView>
            value={view}
            onChange={changeView}
            items={VIEWS}
            className="overflow-x-auto"
          />
          <div
            className="flex self-start rounded-md border border-line-strong p-0.5 sm:self-auto"
            role="group"
            aria-label="Filtrar por responsável"
          >
            {(['mine', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
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
        </div>

        {agendaQ.isLoading ? (
          <div className="space-y-3 p-4" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : agendaQ.isError ? (
          <ErrorState message={(agendaQ.error as Error).message} onRetry={() => agendaQ.refetch()} />
        ) : !items.length ? (
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title="Nada por aqui"
            description={
              view === 'atrasados'
                ? 'Nenhum prazo atrasado no período.'
                : 'Nenhum prazo ou parcela neste período.'
            }
          />
        ) : (
          <div>
            {groups.map((group) => (
              <section key={group.date} aria-label={group.label}>
                <h2 className="flex items-center justify-between border-b border-line bg-canvas/70 px-4 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                  {group.date === today ? `${group.label} · ${group.items.length}` : group.label}
                  {group.date !== today && <span className="tabular font-medium">{group.items.length}</span>}
                </h2>
                <ul className="divide-y divide-line border-b border-line last:border-b-0">
                  {group.items.map((item) => {
                    const meta = KIND_META[item.kind]
                    const Icon = meta.icon
                    const assignee = item.assignee_id ? members.map.get(item.assignee_id) : null
                    const context = [item.client_name, assignee].filter(Boolean).join(' · ')
                    return (
                      <li key={`${item.kind}-${item.id}`}>
                        <Link
                          to={hrefFor(item)}
                          className="flex min-h-11 items-start gap-3 px-4 py-3 transition-colors hover:bg-navy-50/40"
                        >
                          <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md', meta.tone)}>
                            <Icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="min-w-0 truncate text-[13.5px] font-medium text-ink">{item.title}</span>
                              {item.overdue && <Badge tone="red">Atrasado</Badge>}
                            </span>
                            <span className="mt-0.5 block truncate text-[12px] text-ink-subtle">
                              {context || meta.label}
                            </span>
                          </span>
                          {item.amount != null && (
                            <span className="tabular-nums shrink-0 text-[13px] font-medium text-ink">
                              {formatCurrency(item.amount)}
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
