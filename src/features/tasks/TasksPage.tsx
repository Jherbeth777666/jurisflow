import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CalendarDays, CalendarOff, CheckSquare, Plus, X } from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
  Spinner,
  TableSkeleton,
  Tabs,
} from '@/components/ui'
import { groupByPerson } from './groupByPerson'
import { qk, useMemberNames } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import { escapeLike, todayISO } from '@/lib/format'
import { PRIORITY, TASK_STATUS, toOptions } from '@/lib/constants'
import { cn } from '@/lib/cn'
import type { PriorityLevel, Task } from '@/types/database'
import { OPEN_STATUSES, TASK_SELECT, useDeleteTask, useToggleTask, type TaskRow } from './api'
import { DUE_BUCKET_LABEL, groupByDueBucket, rangeBounds, type DueBucket, type RangeFilter } from './dueBuckets'
import { TaskFormModal } from './TaskFormModal'
import { TaskRowItem } from './TaskRow'
import { TasksBulkActions } from './TasksBulkActions'
import { parseTaskFilters, serializeTaskFilters, type TaskFilters, type TaskStatusFilter } from './taskFilters'
import { SavedViewsMenu } from '@/features/views/SavedViewsMenu'
import { useOpenFromParam } from '@/hooks/useOpenFromParam'
import { useSelection } from '@/hooks/useSelection'

const PAGE = 30

type Tab = 'mine' | 'all'
type StatusFilter = TaskStatusFilter
// Filtros que alimentam as consultas (o agrupamento é só visual).
type Filters = Omit<TaskFilters, 'byPerson'>

const FILTER_PARAMS = ['aba', 'resp', 'prio', 'status', 'q', 'filter', 'agrupar']

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
  // Os filtros moram na URL (compartilhável e salvável): aba, resp, prio, status, q, filter, agrupar.
  const urlFilters = useMemo(() => parseTaskFilters(params), [params])
  const { tab, assignee, priority, status, search, range, byPerson: groupByPersonParam } = urlFilters
  const apply = useCallback(
    (patch: Partial<TaskFilters>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          FILTER_PARAMS.forEach((k) => next.delete(k))
          serializeTaskFilters({ ...parseTaskFilters(current), ...patch }).forEach((v, k) => next.set(k, v))
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  const setSearch = useCallback((v: string) => apply({ search: v }), [apply])
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

  const setRange = (r: RangeFilter | null) => apply({ range: r })

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
  // "Agrupar por pessoa" só faz sentido na aba Todas; fica na URL para poder compartilhar o link.
  const byPerson = tab === 'all' && groupByPersonParam
  const personGroups = useMemo(
    () => (byPerson ? groupByPerson(rows, members.map, today) : []),
    [byPerson, rows, members.map, today],
  )
  const setGrouping = (value: 'prazo' | 'pessoa') => apply({ byPerson: value === 'pessoa' })

  // Seleção em massa: some ao mudar qualquer filtro.
  const selection = useSelection(serializeTaskFilters(urlFilters).toString())
  const rowIds = rows.map((t) => t.id)
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selection.has(id))
  const renderTask = (t: TaskRow) => (
    <TaskRowItem
      key={t.id}
      task={t}
      today={today}
      assigneeName={t.assignee_id ? (members.map.get(t.assignee_id) ?? null) : null}
      onToggle={(done) => toggle.mutate({ id: t.id, done })}
      onEdit={() => setEditing(t)}
      onDelete={can('tasks.delete') ? () => setDeleting(t) : undefined}
      selected={selection.has(t.id)}
      onSelect={() => selection.toggle(t.id)}
    />
  )
  const hasFilters = !!(assignee || priority || status !== 'open' || search || range)

  const clearFilters = () => apply({ assignee: '', priority: '', status: 'open', search: '', range: null })

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
                <span className="text-label font-medium text-ink-muted">{c.label}</span>
                <span className={cn('flex size-7 items-center justify-center rounded-md', c.tone)}>{c.icon}</span>
              </div>
              <div className="tabular mt-1.5 text-heading font-semibold tracking-[-0.02em] text-ink">
                {summary.isLoading ? <span className="text-ink-subtle">…</span> : summary.isError ? '—' : c.value}
              </div>
            </button>
          )
        })}
      </div>
      {summary.isError && <p className="-mt-2 mb-3 text-caption text-red-600">Não foi possível carregar os contadores.</p>}

      <Card>
        <div className="px-4 pt-2">
          <Tabs<Tab>
            value={tab}
            onChange={(v) => apply({ tab: v, assignee: '' })}
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
              onChange={(e) => apply({ assignee: e.target.value })}
              options={assigneeOptions}
              placeholder="Todos os responsáveis"
              wrapperClassName="sm:w-48"
            />
          )}
          <Select
            aria-label="Prioridade"
            value={priority}
            onChange={(e) => apply({ priority: e.target.value as '' | PriorityLevel })}
            options={toOptions(PRIORITY)}
            placeholder="Todas as prioridades"
            wrapperClassName="sm:w-44"
          />
          <Select
            aria-label="Status"
            value={range ? 'open' : status}
            disabled={!!range}
            onChange={(e) => apply({ status: e.target.value as StatusFilter })}
            options={statusOptions}
            wrapperClassName="sm:w-56"
          />
          {range && (
            <span className="inline-flex items-center gap-1 self-start rounded-full bg-navy-50 py-1 pl-2.5 pr-1 text-label text-navy-700 sm:self-auto">
              {RANGE_LABEL[range]}
              <button type="button" onClick={() => setRange(null)} className="rounded-full p-0.5 hover:bg-navy-100" aria-label="Remover filtro de vencimento">
                <X className="size-3.5" />
              </button>
            </span>
          )}
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="self-start sm:self-auto">
              Limpar filtros
            </Button>
          )}
          <SavedViewsMenu page="tarefas" />
          {tab === 'all' && (
            <div className="flex items-center gap-2 self-start sm:ml-auto sm:self-auto">
              <span className="text-label text-ink-muted">Agrupar por</span>
              <SegmentedControl<'prazo' | 'pessoa'>
                aria-label="Agrupar tarefas por"
                value={byPerson ? 'pessoa' : 'prazo'}
                onChange={setGrouping}
                items={[
                  { value: 'prazo', label: 'Prazo' },
                  { value: 'pessoa', label: 'Pessoa' },
                ]}
              />
            </div>
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
            <label className="flex items-center gap-3 border-b border-line bg-surface-muted px-4 py-2 text-label text-ink-muted">
              <span className="touch-target flex size-6 shrink-0 items-center justify-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => selection.toggleAll(rowIds)}
                  aria-label="Selecionar todas as visíveis"
                  className="size-4 cursor-pointer rounded border-line-strong accent-navy-900"
                />
              </span>
              Selecionar todas as visíveis
            </label>
            {byPerson
              ? personGroups.map((g) => (
                  <section key={g.key} aria-labelledby={`pessoa-${g.key}`}>
                    <h2
                      id={`pessoa-${g.key}`}
                      className="flex items-center gap-2.5 border-b border-line bg-surface-muted px-4 py-2 text-body-sm font-semibold text-ink"
                    >
                      {g.key === 'none' ? (
                        <span className="flex size-6 items-center justify-center rounded-full bg-ink/[0.06] text-2xs text-ink-subtle" aria-hidden>
                          ?
                        </span>
                      ) : (
                        <Avatar name={g.name} />
                      )}
                      <span className="min-w-0 flex-1 truncate">{g.name}</span>
                      {g.overdue > 0 && <Badge tone="red">{g.overdue} vencida{g.overdue === 1 ? '' : 's'}</Badge>}
                      <span className="tabular text-caption font-medium text-ink-subtle">
                        {g.items.length} tarefa{g.items.length === 1 ? '' : 's'}
                      </span>
                    </h2>
                    <ul className="divide-y divide-line border-b border-line last:border-b-0">{g.items.map(renderTask)}</ul>
                  </section>
                ))
              : groups.map((g) => (
              <section key={g.bucket} aria-labelledby={`bucket-${g.bucket}`}>
                <h2
                  id={`bucket-${g.bucket}`}
                  className={cn(
                    'flex items-center justify-between border-b border-line bg-canvas/70 px-4 py-1.5 text-caption font-semibold uppercase tracking-wide text-ink-subtle',
                    bucketTone[g.bucket],
                  )}
                >
                  {DUE_BUCKET_LABEL[g.bucket]}
                  <span className="tabular font-medium">{g.items.length}</span>
                </h2>
                <ul className="divide-y divide-line border-b border-line last:border-b-0">{g.items.map(renderTask)}</ul>
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

      <p className="mt-4 text-center text-caption text-ink-subtle">
        Os alertas são auxiliares de organização e não substituem o controle oficial de prazos processuais.
      </p>

      <TasksBulkActions
        ids={selection.ids}
        memberOptions={members.options}
        canDelete={can('tasks.delete')}
        onClear={selection.clear}
      />
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

