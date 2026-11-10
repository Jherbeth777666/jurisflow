// Gráficos do painel (recharts) — carregados sob demanda para que os indicadores
// apareçam antes. Importado só via lazy() em DashboardPage.
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
import { formatCurrency, formatMonthShort, formatNumber } from '@/lib/format'
import { DEMAND_STATUS } from '@/lib/constants'
import type { DashboardMetrics } from '@/types/database'
import { ChartTooltip, Legend } from './charts'
import { axisProps, CHART, compactCurrency, STATUS_COLORS } from './chartTheme'
import { firstName } from './logic'

function ChartEmpty({ text }: { text: string }) {
  return <div className="flex h-[240px] items-center justify-center text-center text-[13px] text-ink-subtle">{text}</div>
}

export function MonthlyChart({ data }: { data: DashboardMetrics['monthly'] }) {
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

export function StatusChart({ data }: { data: DashboardMetrics['by_status'] }) {
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

export function RevenueChart({ data }: { data: DashboardMetrics['revenue_monthly'] }) {
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

export function CategoryChart({ data }: { data: DashboardMetrics['by_category'] }) {
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

export function ProductivityChart({ data }: { data: DashboardMetrics['productivity'] }) {
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

