import { useEffect, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, Printer } from 'lucide-react'
import { formatCurrency, formatDate, formatNumber, todayISO } from '@/lib/format'
import { CONTRACT_TYPE, PAYMENT_METHOD } from '@/lib/constants'
import { cn } from '@/lib/cn'
import { downloadBlob } from '@/lib/download'
import { useOrg } from '@/contexts/AuthContext'
import { useCategories, useMemberNames } from '@/hooks/useOrgData'
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import {
  completionTimeByCategory,
  csvDate,
  demandsByGroup,
  overdueSummary,
  PERIOD_LABELS,
  receivedByMethod,
  resolvePeriod,
  slugify,
  tasksDoneByPerson,
  toCSV,
  type CsvCell,
  type PeriodPreset,
} from './aggregate'
import { useOverdueInstallments, useReportData } from './api'

const PRESETS: PeriodPreset[] = ['this_month', 'last_month', 'last_90', 'this_year', 'custom']

type ReportId = 'por-categoria' | 'por-responsavel' | 'tempo-conclusao' | 'tarefas' | 'recebimentos' | 'inadimplencia'

const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  html, body { background: #fff !important; }
  aside, .lg\\:pl-60 > header { display: none !important; }
  .lg\\:pl-60 { padding-left: 0 !important; }
  main { max-width: none !important; padding: 0 !important; }
  .report-no-print { display: none !important; }
  .report-card { box-shadow: none !important; border: 1px solid #d5d9e0; break-inside: avoid; margin-bottom: 12px; }
  .report-card [class*="overflow-x-auto"] { overflow: visible !important; }
  [data-print-hidden="true"] { display: none !important; }
  .report-print-only { display: block !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`

export function ReportsPage() {
  const { organization } = useOrg()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const preset = (PRESETS.includes(params.get('periodo') as PeriodPreset) ? params.get('periodo') : 'this_month') as PeriodPreset
  const today = todayISO()
  const period = resolvePeriod(preset, today, { from: params.get('de') ?? undefined, to: params.get('ate') ?? undefined })

  const setPreset = (p: PeriodPreset) => {
    const next = new URLSearchParams(params)
    next.set('periodo', p)
    if (p === 'custom') {
      next.set('de', period.from)
      next.set('ate', period.to)
    } else {
      next.delete('de')
      next.delete('ate')
    }
    setParams(next, { replace: true })
  }
  const setCustom = (key: 'de' | 'ate', value: string) => {
    if (!value) return
    const next = new URLSearchParams(params)
    next.set('periodo', 'custom')
    next.set(key, value)
    setParams(next, { replace: true })
  }

  const data = useReportData(period)
  const overdue = useOverdueInstallments()
  const names = useMemberNames()
  const cats = useCategories()

  // Impressão: imprime um relatório específico (ou todos) e restaura a tela.
  const [printTarget, setPrintTarget] = useState<ReportId | 'all' | null>(null)
  useEffect(() => {
    if (!printTarget) return
    const t = setTimeout(() => {
      window.print()
      setPrintTarget(null)
    }, 60)
    return () => clearTimeout(t)
  }, [printTarget])

  const catMap = new Map<string, { label: string; color?: string }>()
  cats.data?.forEach((c) => catMap.set(c.id, { label: c.name, color: c.color }))
  const catLabel = (id: string) => catMap.get(id) ?? { label: 'Categoria removida' }
  const personLabel = (id: string) => (id ? names.map.get(id) ?? 'Usuário removido' : 'Sem responsável')

  // Agregações em funções puras (./aggregate); volume pequeno, calculado a cada render.
  const agg = data.data
    ? {
        byCategory: demandsByGroup(data.data.demands, period, (d) => d.category_id, catLabel),
        byPerson: demandsByGroup(data.data.demands, period, (d) => d.responsible_id ?? '', (k) => ({ label: personLabel(k) })),
        completion: completionTimeByCategory(data.data.demands, period, catLabel),
        tasks: tasksDoneByPerson(data.data.tasks, period, (id) => names.map.get(id) ?? 'Usuário removido'),
        methods: receivedByMethod(data.data.payments, period),
      }
    : null
  const overdueAgg = overdue.data ? overdueSummary(overdue.data, today) : null

  const periodText = `${formatDate(period.from)} a ${formatDate(period.to)}`
  const fileSuffix = `${period.from}_a_${period.to}`
  const exportCSV = (title: string, headers: string[], rows: CsvCell[][], withPeriod = true) => {
    downloadBlob(`jurisflow-${slugify(title)}${withPeriod ? `-${fileSuffix}` : `-${today}`}.csv`, toCSV(headers, rows), 'text/csv;charset=utf-8')
    toast.show('Arquivo CSV gerado.')
  }

  const hidden = (id: ReportId) => printTarget !== null && printTarget !== 'all' && printTarget !== id
  const loading = data.isLoading || !agg
  const sectionProps = (id: ReportId) => ({ id, hidden: hidden(id), onPrint: () => setPrintTarget(id) })

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="report-print-only mb-4 hidden">
        <p className="text-[16px] font-semibold">{organization.name} — Relatórios gerenciais</p>
        <p className="text-[12.5px] text-ink-muted">
          Período: {periodText} · Emitido em {formatDate(today)}
        </p>
      </div>

      <div className="report-no-print">
        <PageHeader
          title="Relatórios"
          description="Relatórios gerenciais do escritório calculados a partir dos dados cadastrados."
          actions={
            <Button icon={<Printer className="size-4" />} onClick={() => setPrintTarget('all')} disabled={loading}>
              Imprimir todos
            </Button>
          }
        />

        <Card className="mb-5 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div role="radiogroup" aria-label="Período" className="flex flex-wrap gap-1 rounded-md bg-canvas p-1">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  role="radio"
                  aria-checked={preset === p}
                  onClick={() => setPreset(p)}
                  className={cn(
                    'rounded px-3 py-1.5 text-[13px] font-medium transition-colors',
                    preset === p ? 'bg-surface text-ink shadow-[var(--shadow-card)]' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              {preset === 'custom' ? (
                <>
                  <Input label="De" type="date" value={period.from} max={period.to} onChange={(e) => setCustom('de', e.target.value)} wrapperClassName="w-40" />
                  <Input label="Até" type="date" value={period.to} min={period.from} onChange={(e) => setCustom('ate', e.target.value)} wrapperClassName="w-40" />
                </>
              ) : (
                <span className="tabular text-[13px] text-ink-muted">{periodText}</span>
              )}
              {data.isFetching && !data.isLoading && <span className="text-[12px] text-ink-subtle">Atualizando…</span>}
            </div>
          </div>
        </Card>
      </div>

      {data.isError ? (
        <Card>
          <ErrorState message={(data.error as Error).message} onRetry={() => data.refetch()} />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {/* Demandas por categoria */}
          <ReportCard
            {...sectionProps('por-categoria')}
            title="Demandas por categoria"
            description={`Abertas e concluídas em ${periodText}`}
            loading={loading}
            canExport={!!agg?.byCategory.length}
            onExport={() =>
              exportCSV(
                'demandas-por-categoria',
                ['Categoria', 'Abertas', 'Concluídas'],
                agg!.byCategory.map((r) => [r.label, r.opened, r.closed]),
              )
            }
          >
            {agg && <GroupTable rows={agg.byCategory} firstCol="Categoria" empty="Nenhuma demanda aberta ou concluída no período." />}
          </ReportCard>

          {/* Demandas por responsável */}
          <ReportCard
            {...sectionProps('por-responsavel')}
            title="Demandas por responsável"
            description={`Abertas e concluídas em ${periodText}`}
            loading={loading}
            canExport={!!agg?.byPerson.length}
            onExport={() =>
              exportCSV(
                'demandas-por-responsavel',
                ['Responsável', 'Abertas', 'Concluídas'],
                agg!.byPerson.map((r) => [r.label, r.opened, r.closed]),
              )
            }
          >
            {agg && <GroupTable rows={agg.byPerson} firstCol="Responsável" empty="Nenhuma demanda aberta ou concluída no período." />}
          </ReportCard>

          {/* Tempo médio de conclusão */}
          <ReportCard
            {...sectionProps('tempo-conclusao')}
            title="Tempo médio de conclusão"
            description={
              agg?.completion.overall.count
                ? `${agg.completion.overall.count} demanda${agg.completion.overall.count === 1 ? '' : 's'} concluída${agg.completion.overall.count === 1 ? '' : 's'} · média geral de ${formatDays(agg.completion.overall.avgDays)}`
                : 'Da abertura à conclusão, para demandas concluídas no período'
            }
            loading={loading}
            canExport={!!agg?.completion.rows.length}
            onExport={() =>
              exportCSV(
                'tempo-medio-de-conclusao',
                ['Categoria', 'Concluídas', 'Média (dias)', 'Mínimo (dias)', 'Máximo (dias)'],
                [
                  ...agg!.completion.rows.map((r) => [r.label, r.count, r.avgDays, r.minDays, r.maxDays] as CsvCell[]),
                  ['Total', agg!.completion.overall.count, agg!.completion.overall.avgDays, null, null],
                ],
              )
            }
          >
            {agg &&
              (agg.completion.rows.length ? (
                <Table>
                  <THead>
                    <tr>
                      <TH>Categoria</TH>
                      <TH className="text-right">Concluídas</TH>
                      <TH className="text-right">Média</TH>
                      <TH className="text-right">Mín.</TH>
                      <TH className="text-right">Máx.</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {agg.completion.rows.map((r) => {
                      const max = Math.max(...agg.completion.rows.map((x) => x.avgDays), 1)
                      return (
                        <TR key={r.key}>
                          <TD>
                            <Swatch color={r.color} label={r.label} />
                            <MiniBar value={r.avgDays} max={max} color={r.color} />
                          </TD>
                          <TD className="tabular text-right">{r.count}</TD>
                          <TD className="tabular whitespace-nowrap text-right font-medium">{formatDays(r.avgDays)}</TD>
                          <TD className="tabular whitespace-nowrap text-right text-ink-muted">{formatDays(r.minDays)}</TD>
                          <TD className="tabular whitespace-nowrap text-right text-ink-muted">{formatDays(r.maxDays)}</TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              ) : (
                <ReportEmpty text="Nenhuma demanda concluída no período." />
              ))}
          </ReportCard>

          {/* Tarefas por pessoa */}
          <ReportCard
            {...sectionProps('tarefas')}
            title="Tarefas concluídas por pessoa"
            description={`Concluídas em ${periodText}, comparando com o prazo`}
            loading={loading}
            canExport={!!agg?.tasks.length}
            onExport={() =>
              exportCSV(
                'tarefas-concluidas-por-pessoa',
                ['Pessoa', 'Concluídas', 'No prazo', 'Com atraso', 'Sem prazo'],
                agg!.tasks.map((r) => [r.label, r.done, r.onTime, r.late, r.noDue]),
              )
            }
          >
            {agg &&
              (agg.tasks.length ? (
                <Table>
                  <THead>
                    <tr>
                      <TH>Pessoa</TH>
                      <TH className="text-right">Concluídas</TH>
                      <TH className="text-right">No prazo</TH>
                      <TH className="text-right">Com atraso</TH>
                      <TH className="text-right">Sem prazo</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {agg.tasks.map((r) => (
                      <TR key={r.key}>
                        <TD>
                          <span className="font-medium">{r.label}</span>
                          <MiniBar value={r.done} max={agg.tasks[0].done} />
                        </TD>
                        <TD className="tabular text-right font-medium">{r.done}</TD>
                        <TD className="tabular text-right text-emerald-700">{r.onTime}</TD>
                        <TD className={cn('tabular text-right', r.late > 0 ? 'text-red-600' : 'text-ink-muted')}>{r.late}</TD>
                        <TD className="tabular text-right text-ink-muted">{r.noDue}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <ReportEmpty text="Nenhuma tarefa concluída no período." />
              ))}
          </ReportCard>

          {/* Recebimentos por forma de pagamento */}
          <ReportCard
            {...sectionProps('recebimentos')}
            title="Recebido por forma de pagamento"
            description={
              agg?.methods.count
                ? `${formatCurrency(agg.methods.total)} em ${agg.methods.count} pagamento${agg.methods.count === 1 ? '' : 's'} · ${periodText}`
                : `Pagamentos registrados em ${periodText}`
            }
            loading={loading}
            canExport={!!agg?.methods.rows.length}
            onExport={() =>
              exportCSV(
                'recebido-por-forma-de-pagamento',
                ['Forma de pagamento', 'Pagamentos', 'Valor (R$)', 'Participação (%)'],
                [
                  ...agg!.methods.rows.map((r) => [PAYMENT_METHOD[r.method], r.count, r.total, Math.round(r.share * 1000) / 10] as CsvCell[]),
                  ['Total', agg!.methods.count, agg!.methods.total, 100],
                ],
              )
            }
          >
            {agg &&
              (agg.methods.rows.length ? (
                <Table>
                  <THead>
                    <tr>
                      <TH>Forma</TH>
                      <TH className="text-right">Pagamentos</TH>
                      <TH className="text-right">Valor</TH>
                      <TH className="text-right">%</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {agg.methods.rows.map((r) => (
                      <TR key={r.method}>
                        <TD>
                          <span className="font-medium">{PAYMENT_METHOD[r.method]}</span>
                          <MiniBar value={r.share} max={1} />
                        </TD>
                        <TD className="tabular text-right">{r.count}</TD>
                        <TD className="tabular whitespace-nowrap text-right font-medium">{formatCurrency(r.total)}</TD>
                        <TD className="tabular text-right text-ink-muted">{(r.share * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</TD>
                      </TR>
                    ))}
                    <TR className="bg-canvas/60">
                      <TD className="font-medium">Total</TD>
                      <TD className="tabular text-right font-medium">{agg.methods.count}</TD>
                      <TD className="tabular whitespace-nowrap text-right font-semibold">{formatCurrency(agg.methods.total)}</TD>
                      <TD />
                    </TR>
                  </TBody>
                </Table>
              ) : (
                <ReportEmpty text="Nenhum pagamento registrado no período." />
              ))}
          </ReportCard>

          {/* Inadimplência */}
          <ReportCard
            {...sectionProps('inadimplencia')}
            title="Inadimplência"
            description={`Parcelas vencidas e não pagas em ${formatDate(today)} (situação atual, independe do período)`}
            loading={overdue.isLoading}
            error={overdue.isError ? (overdue.error as Error).message : null}
            onRetry={() => overdue.refetch()}
            canExport={!!overdueAgg?.rows.length}
            onExport={() =>
              exportCSV(
                'inadimplencia',
                ['Cliente', 'Tipo de contrato', 'Parcela', 'Vencimento', 'Dias em atraso', 'Valor em aberto (R$)'],
                overdueAgg!.rows.map((r) => {
                  const row = overdue.data!.find((x) => x.id === r.id)
                  return [
                    row?.client_name ?? '',
                    row?.contract_type ? CONTRACT_TYPE[row.contract_type] : '',
                    `${r.number}/${row?.installments_count ?? ''}`,
                    csvDate(r.due_date),
                    r.days,
                    r.remaining,
                  ] as CsvCell[]
                }),
                false,
              )
            }
            className="xl:col-span-2"
          >
            {overdueAgg && overdue.data && <OverdueReport agg={overdueAgg} data={overdue.data} />}
          </ReportCard>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
function ReportCard({
  id,
  title,
  description,
  loading,
  error,
  onRetry,
  canExport,
  onExport,
  onPrint,
  hidden,
  className,
  children,
}: {
  id: ReportId
  title: string
  description?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  canExport: boolean
  onExport: () => void
  onPrint: () => void
  hidden: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={cn('report-card h-fit', className)} data-print-hidden={hidden ? 'true' : undefined} id={`relatorio-${id}`}>
      <CardHeader
        title={title}
        description={description}
        action={
          <div className="report-no-print flex gap-1">
            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={onExport} disabled={!canExport || loading} title="Exportar CSV">
              <span className="hidden sm:inline">Exportar CSV</span>
            </Button>
            <Button size="sm" variant="ghost" icon={<Printer className="size-3.5" />} onClick={onPrint} disabled={loading} title="Imprimir">
              <span className="hidden sm:inline">Imprimir</span>
            </Button>
          </div>
        }
      />
      {error ? <ErrorState message={error} onRetry={onRetry} /> : loading ? <TableSkeleton rows={4} cols={3} /> : children}
    </Card>
  )
}

function ReportEmpty({ text }: { text: string }) {
  return <EmptyState title={text} className="py-10" />
}

function Swatch({ color, label }: { color?: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      {color && <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: color }} />}
      {label}
    </span>
  )
}

function MiniBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="mt-1 h-1 w-full max-w-48 rounded-full bg-navy-50" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color ?? '#3d5e91', opacity: color ? 0.85 : 1 }} />
    </div>
  )
}

function GroupTable({ rows, firstCol, empty }: { rows: ReturnType<typeof demandsByGroup>; firstCol: string; empty: string }) {
  if (!rows.length) return <ReportEmpty text={empty} />
  const max = Math.max(...rows.map((r) => Math.max(r.opened, r.closed)), 1)
  const tot = rows.reduce((s, r) => ({ opened: s.opened + r.opened, closed: s.closed + r.closed }), { opened: 0, closed: 0 })
  return (
    <Table>
      <THead>
        <tr>
          <TH>{firstCol}</TH>
          <TH className="text-right">Abertas</TH>
          <TH className="text-right">Concluídas</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.key}>
            <TD>
              <Swatch color={r.color} label={r.label} />
              <div className="mt-1 flex max-w-48 flex-col gap-0.5">
                <MiniBar value={r.opened} max={max} color="#1f365d" />
                <MiniBar value={r.closed} max={max} color="#3b82f6" />
              </div>
            </TD>
            <TD className="tabular text-right">{formatNumber(r.opened)}</TD>
            <TD className="tabular text-right">{formatNumber(r.closed)}</TD>
          </TR>
        ))}
        <TR className="bg-canvas/60">
          <TD className="font-medium">Total</TD>
          <TD className="tabular text-right font-semibold">{formatNumber(tot.opened)}</TD>
          <TD className="tabular text-right font-semibold">{formatNumber(tot.closed)}</TD>
        </TR>
      </TBody>
    </Table>
  )
}

function OverdueReport({ agg, data }: { agg: ReturnType<typeof overdueSummary>; data: ReturnType<typeof useOverdueInstallments>['data'] }) {
  if (!agg.count) return <ReportEmpty text="Nenhuma parcela vencida. Todos os recebimentos estão em dia." />
  const byId = new Map((data ?? []).map((r) => [r.id, r]))
  const maxBucket = Math.max(...agg.buckets.map((b) => b.total), 1)
  return (
    <div>
      <div className="grid gap-4 border-b border-line p-4 md:grid-cols-[220px_1fr]">
        <div>
          <div className="text-[12px] font-medium text-ink-subtle">Total vencido</div>
          <div className="tabular mt-0.5 text-[22px] font-semibold tracking-[-0.02em] text-red-600">{formatCurrency(agg.total)}</div>
          <div className="mt-0.5 text-[12px] text-ink-muted">
            {agg.count} parcela{agg.count === 1 ? '' : 's'} · {agg.clients} cliente{agg.clients === 1 ? '' : 's'} · {agg.contracts} contrato
            {agg.contracts === 1 ? '' : 's'}
          </div>
        </div>
        <ul className="space-y-1.5 text-[12.5px]">
          {agg.buckets.map((b) => (
            <li key={b.label} className="grid grid-cols-[110px_1fr_auto] items-center gap-3">
              <span className="text-ink-muted">{b.label}</span>
              <div className="h-2 rounded-full bg-navy-50">
                <div className="h-full rounded-full bg-red-400" style={{ width: `${b.total ? Math.max(2, (b.total / maxBucket) * 100) : 0}%` }} />
              </div>
              <span className="tabular whitespace-nowrap text-ink">
                {formatCurrency(b.total)} <span className="text-ink-subtle">({b.count})</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>Cliente</TH>
            <TH>Contrato</TH>
            <TH>Parcela</TH>
            <TH>Vencimento</TH>
            <TH className="text-right">Atraso</TH>
            <TH className="text-right">Em aberto</TH>
          </tr>
        </THead>
        <TBody>
          {agg.rows.map((r) => {
            const row = byId.get(r.id)
            return (
              <TR key={r.id}>
                <TD className="max-w-[240px] truncate font-medium">
                  <Link to={`/contratos/${r.contract_id}`} className="hover:underline">
                    {row?.client_name ?? '—'}
                  </Link>
                </TD>
                <TD className="whitespace-nowrap text-ink-muted">{row?.contract_type ? CONTRACT_TYPE[row.contract_type] : '—'}</TD>
                <TD className="tabular text-ink-muted">
                  {r.number}/{row?.installments_count ?? '—'}
                </TD>
                <TD className="tabular whitespace-nowrap">{formatDate(r.due_date)}</TD>
                <TD className={cn('tabular whitespace-nowrap text-right', r.days > 60 ? 'font-medium text-red-600' : 'text-ink-muted')}>
                  {r.days} dia{r.days === 1 ? '' : 's'}
                </TD>
                <TD className="tabular whitespace-nowrap text-right font-medium">{formatCurrency(r.remaining)}</TD>
              </TR>
            )
          })}
        </TBody>
      </Table>
    </div>
  )
}

function formatDays(n: number): string {
  const v = n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  return `${v} dia${n === 1 ? '' : 's'}`
}

