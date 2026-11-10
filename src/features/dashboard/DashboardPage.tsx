import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  AlarmClock,
  ArrowRight,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  FileWarning,
  ListTodo,
  Plus,
  Users,
  Wallet,
  Receipt,
  Hourglass,
} from 'lucide-react'
import { supabase, unwrap } from '@/lib/supabase'
import { STALLED_DAYS, daysSince, diffInDays, stalledCutoff, formatCurrency, formatDate, formatMonthShort, formatNumber, todayISO } from '@/lib/format'
import { DEMAND_STATUS, PRIORITY } from '@/lib/constants'
import { cn } from '@/lib/cn'
import { useOrg } from '@/contexts/AuthContext'
import { qk, useCategories, useMemberNames } from '@/hooks/useOrgData'
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton, StatCard, StatusBadge } from '@/components/ui'
import { ActivityFeed } from '@/components/ActivityFeed'
import { DemandFormModal } from '@/features/demands/DemandFormModal'
import type { DashboardMetrics, Demand, Task } from '@/types/database'
import { fetchClientNames } from '@/features/contracts/api'
import { ChartTooltip, Legend } from './charts'
import { axisProps, CHART, compactCurrency, STATUS_COLORS } from './chartTheme'
import { dueTone, firstName, greeting, sortPriorityTasks } from './logic'


function normalizeMetrics(m: DashboardMetrics): DashboardMetrics {
  const n = (v: unknown) => Number(v ?? 0)
  return {
    ...m,
    clients_total: n(m.clients_total),
    demands_in_progress: n(m.demands_in_progress),
    demands_done: n(m.demands_done),
    demands_waiting_docs: n(m.demands_waiting_docs),
    tasks_pending: n(m.tasks_pending),
    tasks_overdue: n(m.tasks_overdue),
    deadlines_upcoming: n(m.deadlines_upcoming),
    fees_expected: n(m.fees_expected),
    fees_received: n(m.fees_received),
    installments_overdue: n(m.installments_overdue),
    by_category: (m.by_category ?? []).map((c) => ({ ...c, count: n(c.count) })),
    by_status: (m.by_status ?? []).map((s) => ({ ...s, count: n(s.count) })),
    monthly: (m.monthly ?? []).map((x) => ({ month: x.month, opened: n(x.opened), closed: n(x.closed), new_clients: n(x.new_clients) })),
    revenue_monthly: (m.revenue_monthly ?? []).map((x) => ({ month: x.month, received: n(x.received), expected: n(x.expected) })),
    productivity: (m.productivity ?? []).map((p) => ({
      ...p,
      tasks_done_30d: n(p.tasks_done_30d),
      demands_closed_30d: n(p.demands_closed_30d),
      open_demands: n(p.open_demands),
    })),
  }
}

export function DashboardPage() {
  const { orgId, profile, organization } = useOrg()
  const metrics = useQuery({
    queryKey: qk.dashboard(orgId),
    queryFn: async () => normalizeMetrics(unwrap(await supabase.rpc('dashboard_metrics', { p_org: orgId })) as DashboardMetrics),
  })

  const [now] = useState(() => new Date())
  const dateLabel = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const name = firstName(profile?.full_name, profile?.email)

  const m = metrics.data
  const isNewOffice = !!m && m.clients_total === 0 && m.demands_in_progress === 0 && m.demands_done === 0

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
            {greeting(now.getHours())}
            {name ? `, ${name}` : ''}
          </h1>
          <p className="mt-0.5 text-[13.5px] text-ink-muted first-letter:uppercase">{dateLabel}</p>
        </div>
        <p className="text-[12.5px] text-ink-subtle">{organization.name}</p>
      </header>

      {metrics.isError ? (
        <Card>
          <ErrorState message={(metrics.error as Error).message} onRetry={() => metrics.refetch()} />
        </Card>
      ) : (
        <>
          <StatGrid m={m} />
          {isNewOffice ? (
            <WelcomePanel />
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Evolução mensal de atendimentos" description="Últimos 6 meses" className="lg:col-span-2" loading={!m}>
                  {m && <MonthlyChart data={m.monthly} />}
                </ChartCard>
                <ChartCard title="Demandas por situação" description="Todas as demandas" loading={!m}>
                  {m && <StatusChart data={m.by_status} />}
                </ChartCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Receitas e honorários" description="Recebido × previsto (vencimentos) por mês" className="lg:col-span-2" loading={!m}>
                  {m && <RevenueChart data={m.revenue_monthly} />}
                </ChartCard>
                <ChartCard title="Demandas por categoria" description="Em aberto" loading={!m}>
                  {m && <CategoryChart data={m.by_category} />}
                </ChartCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Produtividade da equipe" description="Últimos 30 dias e carteira atual" className="lg:col-span-2" loading={!m}>
                  {m && <ProductivityChart data={m.productivity} />}
                </ChartCard>
                <StalledDemands />
              </div>
            </>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            <PriorityTasks className="lg:col-span-2" />
            <Card className="h-fit">
              <CardHeader title="Atividades recentes" />
              <CardBody className="max-h-[420px] overflow-y-auto scrollbar-thin">
                <ActivityFeed limit={12} />
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------
function StatGrid({ m }: { m: DashboardMetrics | undefined }) {
  if (!m)
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-[var(--radius-card)]" />
        ))}
      </div>
    )
  const pct = m.fees_expected > 0 ? Math.round((m.fees_received / m.fees_expected) * 100) : 0
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="Clientes" value={formatNumber(m.clients_total)} icon={<Users className="size-4" />} to="/clientes" />
      <StatCard label="Demandas em andamento" value={formatNumber(m.demands_in_progress)} icon={<Briefcase className="size-4" />} to="/demandas" />
      <StatCard label="Demandas concluídas" value={formatNumber(m.demands_done)} icon={<CheckCircle2 className="size-4" />} to="/demandas?status=concluida" tone="success" />
      <StatCard
        label="Aguardando documentos"
        value={formatNumber(m.demands_waiting_docs)}
        icon={<FileWarning className="size-4" />}
        to="/demandas?waiting_docs=1"
        tone={m.demands_waiting_docs > 0 ? 'warning' : 'default'}
      />
      <StatCard
        label="Atividades pendentes"
        value={formatNumber(m.tasks_pending)}
        icon={<ListTodo className="size-4" />}
        to="/tarefas?aba=todas"
        hint={m.tasks_overdue > 0 ? <span className="text-red-600">{m.tasks_overdue} vencida{m.tasks_overdue === 1 ? '' : 's'}</span> : 'Nenhuma vencida'}
        tone={m.tasks_overdue > 0 ? 'danger' : 'default'}
      />
      <StatCard
        label="Prazos nos próximos 7 dias"
        value={formatNumber(m.deadlines_upcoming)}
        icon={<CalendarClock className="size-4" />}
        to="/tarefas?aba=todas&filter=week"
        tone={m.deadlines_upcoming > 0 ? 'warning' : 'default'}
      />
      <StatCard label="Honorários contratados" value={formatCurrency(m.fees_expected)} icon={<Receipt className="size-4" />} to="/contratos" hint="Contratos ativos e quitados" />
      <StatCard
        label="Honorários recebidos"
        value={formatCurrency(m.fees_received)}
        icon={<Wallet className="size-4" />}
        to="/contratos"
        tone="success"
        hint={
          m.installments_overdue > 0 ? (
            <span className="text-red-600">{formatCurrency(m.installments_overdue)} vencido</span>
          ) : m.fees_expected > 0 ? (
            `${pct}% do contratado`
          ) : undefined
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gráficos
// ---------------------------------------------------------------------------
function ChartCard({
  title,
  description,
  className,
  loading,
  children,
  action,
}: {
  title: string
  description?: string
  className?: string
  loading?: boolean
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} action={action} />
      <CardBody>{loading ? <Skeleton className="h-[240px] w-full" /> : children}</CardBody>
    </Card>
  )
}

function ChartEmpty({ text }: { text: string }) {
  return <div className="flex h-[240px] items-center justify-center text-center text-[13px] text-ink-subtle">{text}</div>
}

function MonthlyChart({ data }: { data: DashboardMetrics['monthly'] }) {
  if (!data.some((d) => d.opened || d.closed || d.new_clients)) return <ChartEmpty text="Sem movimentação nos últimos 6 meses." />
  return (
    <div>
      <Legend
        items={[
          { label: 'Demandas abertas', color: CHART.navy700 },
          { label: 'Concluídas', color: CHART.accent },
          { label: 'Novos clientes', color: CHART.navy300, dashed: true },
        ]}
      />
      <div className="mt-3 h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="month" tickFormatter={formatMonthShort} {...axisProps} />
            <YAxis allowDecimals={false} {...axisProps} />
            <Tooltip content={<ChartTooltip formatLabel={formatMonthShort} />} cursor={{ stroke: CHART.grid }} />
            <Line type="monotone" dataKey="opened" name="Demandas abertas" stroke={CHART.navy700} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="closed" name="Concluídas" stroke={CHART.accent} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="new_clients" name="Novos clientes" stroke={CHART.navy300} strokeWidth={2} strokeDasharray="4 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function StatusChart({ data }: { data: DashboardMetrics['by_status'] }) {
  const rows = (Object.keys(DEMAND_STATUS) as (keyof typeof DEMAND_STATUS)[])
    .map((s) => ({ status: s, name: DEMAND_STATUS[s].label, count: data.find((d) => d.status === s)?.count ?? 0, fill: STATUS_COLORS[s] }))
    .filter((r) => r.count > 0)
  const total = rows.reduce((s, r) => s + r.count, 0)
  if (!total) return <ChartEmpty text="Nenhuma demanda cadastrada." />
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-[170px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="count" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
              {rows.map((r) => (
                <Cell key={r.status} fill={r.fill} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-[20px] font-semibold text-ink">{formatNumber(total)}</span>
          <span className="text-[11.5px] text-ink-subtle">demandas</span>
        </div>
      </div>
      <ul className="w-full space-y-1 text-[12.5px]">
        {rows.map((r) => (
          <li key={r.status} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-ink-muted">
              <span className="size-2 rounded-sm" style={{ backgroundColor: r.fill }} />
              {r.name}
            </span>
            <span className="tabular text-ink">
              {r.count} <span className="text-ink-subtle">· {Math.round((r.count / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RevenueChart({ data }: { data: DashboardMetrics['revenue_monthly'] }) {
  if (!data.some((d) => d.received || d.expected)) return <ChartEmpty text="Nenhum honorário com vencimento ou recebimento nos últimos 6 meses." />
  return (
    <div>
      <Legend
        items={[
          { label: 'Previsto', color: CHART.navy200 },
          { label: 'Recebido', color: CHART.navy700 },
        ]}
      />
      <div className="mt-3 h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, left: 4, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="month" tickFormatter={formatMonthShort} {...axisProps} />
            <YAxis tickFormatter={compactCurrency} width={70} {...axisProps} />
            <Tooltip content={<ChartTooltip formatValue={formatCurrency} formatLabel={formatMonthShort} />} cursor={{ fill: CHART.grid, opacity: 0.6 }} />
            <Bar dataKey="expected" name="Previsto" fill={CHART.navy200} radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Bar dataKey="received" name="Recebido" fill={CHART.navy700} radius={[3, 3, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function CategoryChart({ data }: { data: DashboardMetrics['by_category'] }) {
  if (!data.length) return <ChartEmpty text="Nenhuma demanda em aberto." />
  const rows = data.map((d) => ({ ...d, fill: d.color }))
  const height = Math.max(160, rows.length * 34 + 20)
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={130} {...axisProps} tick={{ fill: '#5b6474', fontSize: 11.5 }} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: CHART.grid, opacity: 0.6 }} />
          <Bar dataKey="count" name="Demandas" radius={[0, 3, 3, 0]} barSize={14} label={{ position: 'right', fill: '#5b6474', fontSize: 11.5 }}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function ProductivityChart({ data }: { data: DashboardMetrics['productivity'] }) {
  const rows = data
    .map((p) => ({ ...p, short: firstName(p.name) || p.name }))
    .filter((p) => p.tasks_done_30d || p.demands_closed_30d || p.open_demands)
  if (!rows.length) return <ChartEmpty text="Sem tarefas ou demandas atribuídas à equipe no período." />
  return (
    <div>
      <Legend
        items={[
          { label: 'Tarefas concluídas (30d)', color: CHART.navy700 },
          { label: 'Demandas concluídas (30d)', color: CHART.accent },
          { label: 'Demandas abertas', color: CHART.navy200 },
        ]}
      />
      <div className="mt-3 h-[230px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="short" {...axisProps} interval={0} />
            <YAxis allowDecimals={false} {...axisProps} />
            <Tooltip
              content={<ChartTooltip formatLabel={(l) => rows.find((r) => r.short === l)?.name ?? l} />}
              cursor={{ fill: CHART.grid, opacity: 0.6 }}
            />
            <Bar dataKey="tasks_done_30d" name="Tarefas concluídas" fill={CHART.navy700} radius={[3, 3, 0, 0]} maxBarSize={22} />
            <Bar dataKey="demands_closed_30d" name="Demandas concluídas" fill={CHART.accent} radius={[3, 3, 0, 0]} maxBarSize={22} />
            <Bar dataKey="open_demands" name="Demandas abertas" fill={CHART.navy200} radius={[3, 3, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tarefas prioritárias
// ---------------------------------------------------------------------------
type PriorityTask = Pick<Task, 'id' | 'title' | 'due_date' | 'priority' | 'status' | 'assignee_id' | 'demand_id' | 'client_id'>

function PriorityTasks({ className }: { className?: string }) {
  const { orgId } = useOrg()
  const names = useMemberNames()
  const q = useQuery({
    queryKey: [...qk.dashboard(orgId), 'priority-tasks'],
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from('tasks')
          .select('id, title, due_date, priority, status, assignee_id, demand_id, client_id')
          .eq('organization_id', orgId)
          .in('status', ['pendente', 'em_andamento'])
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(40),
      ) as PriorityTask[]
      const top = sortPriorityTasks(rows).slice(0, 8)
      const demandIds = [...new Set(top.map((t) => t.demand_id).filter((x): x is string => !!x))]
      const demands = demandIds.length
        ? (unwrap(await supabase.from('demands').select('id, title').eq('organization_id', orgId).in('id', demandIds)) as Pick<Demand, 'id' | 'title'>[])
        : []
      const clients = await fetchClientNames(
        orgId,
        top.filter((t) => !t.demand_id && t.client_id).map((t) => t.client_id!),
      )
      const dMap = new Map(demands.map((d) => [d.id, d.title]))
      return top.map((t) => ({
        ...t,
        context: t.demand_id ? dMap.get(t.demand_id) ?? null : t.client_id ? clients.get(t.client_id) ?? null : null,
      }))
    },
  })
  const today = todayISO()

  return (
    <Card className={cn('h-fit', className)}>
      <CardHeader
        title="Tarefas prioritárias"
        description="Pendentes ordenadas por vencimento e prioridade"
        action={
          <Link to="/tarefas?aba=todas" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-700 hover:underline">
            Ver todas <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      {q.isLoading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={<CheckCircle2 className="size-5" />} title="Nenhuma tarefa pendente" description="A equipe está em dia." className="py-10" />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((t) => {
            const tone = dueTone(t.due_date, today, 3, diffInDays)
            return (
              <li key={t.id} className={cn('flex items-center gap-3 px-4 py-2.5', tone === 'overdue' && 'bg-red-50/50')}>
                <span
                  className={cn(
                    'h-8 w-1 shrink-0 rounded-full',
                    tone === 'overdue' ? 'bg-red-500' : tone === 'today' ? 'bg-amber-500' : tone === 'soon' ? 'bg-accent-500' : 'bg-line-strong',
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  {t.demand_id ? (
                    <Link to={`/demandas/${t.demand_id}`} className="block truncate text-[13.5px] font-medium text-ink hover:underline">
                      {t.title}
                    </Link>
                  ) : (
                    <span className="block truncate text-[13.5px] font-medium text-ink">{t.title}</span>
                  )}
                  <span className="block truncate text-[12px] text-ink-subtle">
                    {[t.context, t.assignee_id ? names.map.get(t.assignee_id) : 'Sem responsável'].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={cn(
                      'tabular text-[12px]',
                      tone === 'overdue' ? 'font-medium text-red-600' : tone === 'today' ? 'font-medium text-amber-700' : 'text-ink-muted',
                    )}
                  >
                    {tone === 'overdue'
                      ? `Venceu ${formatDate(t.due_date)}`
                      : tone === 'today'
                        ? 'Vence hoje'
                        : t.due_date
                          ? formatDate(t.due_date)
                          : 'Sem prazo'}
                  </span>
                  {(t.priority === 'alta' || t.priority === 'urgente') && <StatusBadge value={t.priority} map={PRIORITY} />}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Demandas paradas
// ---------------------------------------------------------------------------
function StalledDemands() {
  const { orgId } = useOrg()
  const cats = useCategories()
  const q = useQuery({
    queryKey: [...qk.dashboard(orgId), 'stalled', STALLED_DAYS],
    queryFn: async () => {
      const limit = stalledCutoff(STALLED_DAYS)
      const res = await supabase
        .from('demands')
        .select('id, title, client_id, category_id, stage_id, stage_changed_at', { count: 'exact' })
        .eq('organization_id', orgId)
        .not('status', 'in', '(concluida,cancelada)')
        .lt('stage_changed_at', limit)
        .order('stage_changed_at', { ascending: true })
        .limit(5)
      const rows = unwrap(res) as Pick<Demand, 'id' | 'title' | 'client_id' | 'category_id' | 'stage_id' | 'stage_changed_at'>[]
      const clients = await fetchClientNames(orgId, rows.map((r) => r.client_id))
      return { rows: rows.map((r) => ({ ...r, client: clients.get(r.client_id) ?? '—' })), total: res.count ?? rows.length }
    },
  })
  const stageName = new Map<string, string>()
  const catMap = new Map<string, { name: string; color: string }>()
  cats.data?.forEach((c) => {
    catMap.set(c.id, c)
    c.stages.forEach((s) => stageName.set(s.id, s.name))
  })

  return (
    <Card className="h-fit">
      <CardHeader
        title="Demandas paradas"
        description={`Sem mudança de etapa há ${STALLED_DAYS} dias ou mais`}
        action={
          q.data && q.data.total > 0 ? (
            <Link to={`/demandas?stalled=${STALLED_DAYS}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent-700 hover:underline">
              Ver {q.data.total} <ArrowRight className="size-3.5" />
            </Link>
          ) : undefined
        }
      />
      {q.isLoading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : !q.data?.rows.length ? (
        <EmptyState icon={<Hourglass className="size-5" />} title="Nenhuma demanda parada" description="Todas as demandas abertas avançaram recentemente." className="py-10" />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.rows.map((d) => {
            const cat = catMap.get(d.category_id)
            return (
              <li key={d.id} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/demandas/${d.id}`} className="min-w-0 truncate text-[13.5px] font-medium text-ink hover:underline">
                    {d.title}
                  </Link>
                  <Badge tone="amber" className="shrink-0">
                    <AlarmClock className="size-3" /> {daysSince(d.stage_changed_at)} dias
                  </Badge>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-subtle">
                  {cat && <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: cat.color }} />}
                  <span className="truncate">
                    {d.client} · {d.stage_id ? stageName.get(d.stage_id) ?? 'Etapa' : 'Sem etapa'}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Escritório novo
// ---------------------------------------------------------------------------
function WelcomePanel() {
  const [demandOpen, setDemandOpen] = useState(false)
  return (
    <Card>
      <div className="grid gap-6 p-6 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div>
          <h2 className="text-[16px] font-semibold text-ink">Comece pelo cadastro dos seus clientes</h2>
          <p className="mt-1 max-w-prose text-[13.5px] text-ink-muted">
            Os indicadores e gráficos deste painel são calculados a partir dos dados do escritório. Assim que você cadastrar clientes e
            abrir demandas, eles aparecem aqui.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link
            to="/clientes?novo=1"
            className="flex items-center gap-3 rounded-md border border-line-strong px-3 py-3 text-[13.5px] font-medium text-ink transition-colors hover:bg-navy-50"
          >
            <span className="flex size-8 items-center justify-center rounded-md bg-navy-50 text-navy-600">
              <Users className="size-4" />
            </span>
            Cadastrar cliente
          </Link>
          <button
            type="button"
            onClick={() => setDemandOpen(true)}
            className="flex items-center gap-3 rounded-md border border-line-strong px-3 py-3 text-left text-[13.5px] font-medium text-ink transition-colors hover:bg-navy-50"
          >
            <span className="flex size-8 items-center justify-center rounded-md bg-navy-50 text-navy-600">
              <Plus className="size-4" />
            </span>
            Abrir demanda
          </button>
        </div>
      </div>
      <DemandFormModal open={demandOpen} onClose={() => setDemandOpen(false)} />
    </Card>
  )
}
