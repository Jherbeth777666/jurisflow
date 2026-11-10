import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CalendarDays, CalendarOff, CheckSquare, Plus, X } from 'lucide-react'
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  Select,
  Spinner,
  TableSkeleton,
  Tabs,
} from '@/components/ui'
import { qk, useMemberNames } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import { escapeLike, todayISO } from '@/lib/format'
import { PRIORITY, TASK_STATUS, toOptions } from '@/lib/constants'
import { cn } from '@/lib/cn'
import type { PriorityLevel, Task, TaskStatus } from '@/types/database'
import { OPEN_STATUSES, TASK_SELECT, useDeleteTask, useToggleTask, type TaskRow } from './api'
import { DUE_BUCKET_LABEL, groupByDueBucket, parseRangeFilter, rangeBounds, type DueBucket, type RangeFilter } from './dueBuckets'
import { TaskFormModal } from './TaskFormModal'
import { TaskRowItem } from './TaskRow'
import { useOpenFromParam } from '@/hooks/useOpenFromParam'

const PAGE = 30

type Tab = 'mine' | 'all'
type StatusFilter = 'open' | 'all' | TaskStatus

interface Filters {
  tab: Tab
  assignee: string // '' | user_id | 'none'
  priority: '' | PriorityLevel
  status: StatusFilter
  search: string
  range: RangeFilter | null
}

const RANGE_LABEL: Record<RangeFilter, string> = {
  overdue: 'Vencidas',
  today: 'Vencem hoje',
  week: 'Próximos 7 dias',
  nodate: 'Sem data',
}

const bucketTone: Partial<Record<DueBucket, string>> = {
  overdue: 'text-red-700',
  today: 'text-amber-800',
}

// Construtor de filtros compartilhado entre a lista e os contadores (sem tipos do PostgREST expostos).
interface FilterableQuery<Q> {
  eq(column: string, value: string): Q
  is(column: string, value: null): Q
  in(column: string, values: string[]): Q
  ilike(column: string, pattern: string): Q
  lt(column: string, value: string): Q
  gte(column: string, value: string): Q
  lte(column: string, value: string): Q
}

function applyBase<Q extends FilterableQuery<Q>>(q: Q, f: Filters, userId: string): Q {
  if (f.tab === 'mine') q = q.eq('assignee_id', userId)
  else if (f.assignee === 'none') q = q.is('assignee_id', null)
  else if (f.assignee) q = q.eq('assignee_id', f.assignee)
  if (f.priority) q = q.eq('priority', f.priority)
  if (f.search.trim()) q = q.ilike('title', `%${escapeLike(f.search.trim())}%`)
  return q
}

function applyRange<Q extends FilterableQuery<Q>>(q: Q, range: RangeFilter, today: string): Q {
  const b = rangeBounds(range, today)
  q = q.in('status', OPEN_STATUSES)
  if (b.isNull) q = q.is('due_date', null)
  if (b.lt) q = q.lt('due_date', b.lt)
  if (b.gte) q = q.gte('due_date', b.gte)
  if (b.lte) q = q.lte('due_date', b.lte)
  return q
}

export function TasksPage() {
  const { orgId, userId, can } = useOrg()
  const members = useMemberNames()
  const toggle = useToggleTask()
  const deleteTask = useDeleteTask()
  const [params, setParams] = useSearchParams()
  const range = parseRangeFilter(params.get('filter'))

  const [tab, setTab] = useState<Tab>('mine')
  const [assignee, setAssignee] = useState('')
  const [priority, setPriority] = useState<'' | PriorityLevel>('')
  const [status, setStatus] = useState<StatusFilter>('open')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  // ?tarefa=<id> (vindo da busca global) abre a tarefa para edição
  const taskParam = params.get('tarefa')
  useEffect(() => {
    if (!taskParam) return
    let active = true
    supabase
      .from('tasks')
      .select('*')
      .eq('organization_id', orgId)
      .eq('id', taskParam)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data) setEditing(data as Task)
        setParams((p) => { const n = new URLSearchParams(p); n.delete('tarefa'); return n }, { replace: true })
      })
    return () => { active = false }
  }, [taskParam, orgId, setParams])
  const [creating, setCreating] = useOpenFromParam('nova')
  const [deleting, setDeleting] = useState<TaskRow | null>(null)

  const today = todayISO()
  const filters: Filters = { tab, assignee, priority, status, search, range }

  const setRange = (r: RangeFilter | null) => {
    const next = new URLSearchParams(params)
    if (r) next.set('filter', r)
    else next.delete('filter')
    setParams(next, { replace: true })
  }

  // Contadores do resumo (respeitam aba, responsável, prioridade e busca).
  const summaryFilters = { tab, assignee, priority, search }
  const summary = useQuery({
    queryKey: qk.tasks(orgId, 'summary', summaryFilters, today),
    queryFn: async () => {
      const count = async (r: RangeFilter) => {
        const base = supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('organization_id', orgId)
        const res = await applyRange(applyBase(base, { ...filters, range: null }, userId), r, today)
        if (res.error) throw new Error(friendlyError(res.error))
        return res.count ?? 0
      }
      const [overdue, todayCount, week, nodate] = await Promise.all([count('overdue'), count('today'), count('week'), count('nodate')])
      return { overdue, today: todayCount, week, nodate }
    },
  })

  const list = useInfiniteQuery({
    queryKey: qk.tasks(orgId, 'page', filters, today),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let q = applyBase(supabase.from('tasks').select(TASK_SELECT).eq('organization_id', orgId), filters, userId)
      if (range) q = applyRange(q, range, today)
      else if (status === 'open') q = q.in('status', OPEN_STATUSES)
      else if (status !== 'all') q = q.eq('status', status)
      q = q
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .range(pageParam * PAGE, pageParam * PAGE + PAGE - 1)
      return unwrap(await q) as unknown as TaskRow[]
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length : undefined),
  })

  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data])
  const groups = useMemo(() => groupByDueBucket(rows, today), [rows, today])
  const hasFilters = !!(assignee || priority || status !== 'open' || search || range)

  const clearFilters = () => {
    setAssignee('')
    setPriority('')
    setStatus('open')
    setSearch('')
    setRange(null)
  }

  const assigneeOptions = [{ value: 'none', label: 'Sem responsável' }, ...members.options]
  const statusOptions = [
    { value: 'open', label: 'Pendentes e em andamento' },
    ...toOptions(TASK_STATUS),
    { value: 'all', label: 'Todos os status' },
  ]

  const counters: { key: RangeFilter; label: string; value: number | undefined; icon: ReactNode; tone: string; active: string }[] = [
    {
      key: 'overdue',
      label: 'Vencidas',
      value: summary.data?.overdue,
      icon: <AlertTriangle className="size-4" />,
      tone: 'text-red-600 bg-red-50',
      active: 'ring-red-300',
    },
    {
      key: 'today',
      label: 'Hoje',
      value: summary.data?.today,
      icon: <CalendarClock className="size-4" />,
      tone: 'text-amber-700 bg-amber-50',
      active: 'ring-amber-300',
    },
    {
      key: 'week',
      label: 'Próximos 7 dias',
      value: summary.data?.week,
      icon: <CalendarDays className="size-4" />,
      tone: 'text-navy-500 bg-navy-50',
      active: 'ring-navy-300',
    },
    {
      key: 'nodate',
      label: 'Sem data',
      value: summary.data?.nodate,
      icon: <CalendarOff className="size-4" />,
      tone: 'text-slate-600 bg-slate-100',
      active: 'ring-slate-300',
    },
  ]

  return (
    <div>
      <PageHeader
        title="Tarefas"
        description="Atividades do escritório organizadas por vencimento."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Nova tarefa
          </Button>
        }
      />

      {/* Resumo */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counters.map((c) => {
          const active = range === c.key
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => setRange(active ? null : c.key)}
              className={cn(
                'rounded-[var(--radius-card)] bg-surface p-3.5 text-left shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-pop)]',
                active && cn('ring-2', c.active),
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-ink-muted">{c.label}</span>
                <span className={cn('flex size-7 items-center justify-center rounded-md', c.tone)}>{c.icon}</span>
              </div>
              <div className="tabular mt-1.5 text-[22px] font-semibold tracking-[-0.02em] text-ink">
                {summary.isLoading ? <span className="text-ink-subtle">…</span> : summary.isError ? '—' : c.value}
              </div>
            </button>
          )
        })}
      </div>
      {summary.isError && <p className="-mt-2 mb-3 text-[12px] text-red-600">Não foi possível carregar os contadores.</p>}

      <Card>
        <div className="px-4 pt-2">
          <Tabs<Tab>
            value={tab}
            onChange={(v) => {
              setTab(v)
              setAssignee('')
            }}
            items={[
              { value: 'mine', label: 'Minhas' },
              { value: 'all', label: 'Todas' },
            ]}
          />
        </div>
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar por título…" className="sm:w-64" />
          {tab === 'all' && (
            <Select
              aria-label="Responsável"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              options={assigneeOptions}
              placeholder="Todos os responsáveis"
              wrapperClassName="sm:w-48"
            />
          )}
          <Select
            aria-label="Prioridade"
            value={priority}
            onChange={(e) => setPriority(e.target.value as '' | PriorityLevel)}
            options={toOptions(PRIORITY)}
            placeholder="Todas as prioridades"
            wrapperClassName="sm:w-44"
          />
          <Select
            aria-label="Status"
            value={range ? 'open' : status}
            disabled={!!range}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            options={statusOptions}
            wrapperClassName="sm:w-56"
          />
          {range && (
            <span className="inline-flex items-center gap-1 self-start rounded-full bg-navy-50 py-1 pl-2.5 pr-1 text-[12.5px] text-navy-700 sm:self-auto">
              {RANGE_LABEL[range]}
              <button type="button" onClick={() => setRange(null)} className="rounded-full p-0.5 hover:bg-navy-100" aria-label="Remover filtro de vencimento">
                <X className="size-3.5" />
              </button>
            </span>
          )}
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="self-start sm:ml-auto sm:self-auto">
              Limpar filtros
            </Button>
          )}
        </div>

        {list.isLoading ? (
          <TableSkeleton rows={6} cols={3} />
        ) : list.isError ? (
          <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<CheckSquare className="size-5" />}
            title={hasFilters ? 'Nenhuma tarefa encontrada' : tab === 'mine' ? 'Você não tem tarefas em aberto' : 'Nenhuma tarefa em aberto'}
            description={hasFilters ? 'Ajuste os filtros para ver outras tarefas.' : 'Crie tarefas para acompanhar as atividades do escritório.'}
            action={
              hasFilters ? (
                <Button size="sm" onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
                  Nova tarefa
                </Button>
              )
            }
          />
        ) : (
          <div>
            {groups.map((g) => (
              <section key={g.bucket} aria-labelledby={`bucket-${g.bucket}`}>
                <h2
                  id={`bucket-${g.bucket}`}
                  className={cn(
                    'flex items-center justify-between border-b border-line bg-canvas/70 px-4 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle',
                    bucketTone[g.bucket],
                  )}
                >
                  {DUE_BUCKET_LABEL[g.bucket]}
                  <span className="tabular font-medium">{g.items.length}</span>
                </h2>
                <ul className="divide-y divide-line border-b border-line last:border-b-0">
                  {g.items.map((t) => (
                    <TaskRowItem
                      key={t.id}
                      task={t}
                      today={today}
                      assigneeName={t.assignee_id ? (members.map.get(t.assignee_id) ?? null) : null}
                      onToggle={(done) => toggle.mutate({ id: t.id, done })}
                      onEdit={() => setEditing(t)}
                      onDelete={can('tasks.delete') ? () => setDeleting(t) : undefined}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {list.hasNextPage && (
              <div className="flex justify-center border-t border-line p-3">
                <Button size="sm" onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
                  Carregar mais
                </Button>
              </div>
            )}
            {list.isFetching && !list.isFetchingNextPage && <Spinner className="py-2" label="Atualizando…" />}
          </div>
        )}
      </Card>

      <p className="mt-4 text-center text-[12px] text-ink-subtle">
        Os alertas são auxiliares de organização e não substituem o controle oficial de prazos processuais.
      </p>

      <TaskFormModal open={creating} onClose={() => setCreating(false)} />
      <TaskFormModal open={!!editing} onClose={() => setEditing(null)} task={editing} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? deleteTask(deleting.id) : undefined)}
        title="Excluir tarefa"
        description={`A tarefa "${deleting?.title ?? ''}" será excluída permanentemente. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
      />
    </div>
  )
}

