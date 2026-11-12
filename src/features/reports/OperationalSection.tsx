import { useQuery } from '@tanstack/react-query'
import { Badge, Card, EmptyState, Table, TableSkeleton, TBody, TD, TH, THead, TR, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { downloadBlob } from '@/lib/download'
import { supabase, unwrap } from '@/lib/supabase'
import { cn } from '@/lib/cn'
import { slugify, toCSV, type CsvCell } from './aggregate'
import { bottleneckLevel, formatDays, type BottleneckLevel, type OperationalMetrics } from './operational'
import { ReportCard } from './ReportCard'

const LEVEL: Record<BottleneckLevel, { label: string; tone: 'red' | 'amber' | 'gray' }> = {
  alto: { label: 'Alto', tone: 'red' },
  medio: { label: 'Médio', tone: 'amber' },
  baixo: { label: 'Baixo', tone: 'gray' },
}

const EMPTY_TITLE = 'Ainda não há histórico suficiente.'
const EMPTY_DESCRIPTION = 'Os tempos aparecem conforme as demandas mudam de etapa.'

function levelBadge(stage: Parameters<typeof bottleneckLevel>[0]) {
  const level = bottleneckLevel(stage)
  const meta = LEVEL[level]
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

export function OperationalSection() {
  const { orgId } = useOrg()
  const toast = useToast()

  const metricsQ = useQuery({
    queryKey: ['reports', orgId, 'operational'],
    enabled: !!orgId,
    queryFn: async () =>
      unwrap(await supabase.rpc('operational_metrics', { p_org: orgId })) as OperationalMetrics,
  })

  if (metricsQ.isLoading) {
    return (
      <Card className="xl:col-span-2">
        <TableSkeleton rows={4} cols={5} />
      </Card>
    )
  }

  const metrics = metricsQ.data
  const hasHistory =
    !!metrics &&
    (metrics.stages.some((s) => s.open_now > 0 || s.passes_completed > 0) ||
      metrics.workload.some((w) => w.open_demands > 0 || w.open_tasks > 0 || w.next_actions_overdue > 0))

  const highlights = metrics?.bottlenecks.slice(0, 3) ?? []

  const exportStages = () => {
    if (!metrics) return
    const rows: CsvCell[][] = metrics.stages.map((s) => [
      s.name,
      s.category_name,
      s.open_now,
      s.avg_age_open_days,
      s.oldest_open_days,
      s.avg_days_completed,
      s.passes_completed,
      LEVEL[bottleneckLevel(s)].label,
    ])
    downloadBlob(
      `jurisflow-${slugify('gargalos-por-etapa')}.csv`,
      toCSV(
        ['Etapa', 'Categoria', 'Abertas agora', 'Idade média (dias)', 'Mais antiga (dias)', 'Tempo médio na etapa (dias)', 'Passagens concluídas', 'Nível'],
        rows,
      ),
      'text/csv;charset=utf-8',
    )
    toast.show('Arquivo CSV gerado.')
  }

  const exportWorkload = () => {
    if (!metrics) return
    const rows: CsvCell[][] = metrics.workload.map((w) => [
      w.name,
      w.open_demands,
      w.open_tasks,
      w.overdue_tasks,
      w.next_actions_overdue,
    ])
    downloadBlob(
      `jurisflow-${slugify('carga-por-responsavel')}.csv`,
      toCSV(['Responsável', 'Demandas abertas', 'Tarefas abertas', 'Tarefas atrasadas', 'Próximas ações vencidas'], rows),
      'text/csv;charset=utf-8',
    )
    toast.show('Arquivo CSV gerado.')
  }

  return (
    <>
      <ReportCard
        id="operacional-gargalos"
        title="Gargalos por etapa"
        description="Onde as demandas estão paradas e há quanto tempo"
        loading={metricsQ.isLoading}
        error={metricsQ.isError ? (metricsQ.error as Error).message : null}
        onRetry={() => metricsQ.refetch()}
        canExport={!!metrics?.stages.length}
        onExport={exportStages}
        onPrint={() => window.print()}
        hidden={false}
      >
        {metrics &&
          (hasHistory ? (
            <>
              {highlights.length > 0 && (
                <ul className="space-y-1.5 border-b border-line px-4 py-3 text-[13px] text-ink">
                  {highlights.map((stage) => {
                    const avg =
                      stage.avg_age_open_days === null
                        ? 'sem idade média'
                        : `${formatDays(stage.avg_age_open_days)} em média`
                    return (
                      <li key={`${stage.category_name}-${stage.name}`} className="flex items-start gap-2">
                        {levelBadge(stage)}
                        <span>
                          {`Etapa ${stage.name}: ${stage.open_now} demanda${stage.open_now === 1 ? '' : 's'}, ${avg} · ${stage.category_name}`}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              <Table label="Gargalos por etapa">
                <THead>
                  <tr>
                    <TH>Etapa</TH>
                    <TH className="text-right">Abertas agora</TH>
                    <TH className="text-right">Idade média</TH>
                    <TH className="text-right">Mais antiga</TH>
                    <TH className="text-right">Tempo médio na etapa (últimos 90 dias)</TH>
                    <TH>Nível</TH>
                  </tr>
                </THead>
                <TBody>
                  {metrics.stages.filter((s) => s.open_now > 0 || s.passes_completed > 0).map((stage) => (
                    <TR key={`${stage.category_name}-${stage.name}-${stage.position}`}>
                      <TD>
                        <span className="font-medium">{stage.name}</span>
                        <span className="mt-0.5 block text-[12px] text-ink-muted">{stage.category_name}</span>
                      </TD>
                      <TD className="tabular-nums text-right">{stage.open_now}</TD>
                      <TD className={cn('tabular-nums whitespace-nowrap text-right', stage.avg_age_open_days === null && 'text-ink-muted')}>
                        {formatDays(stage.avg_age_open_days)}
                      </TD>
                      <TD className={cn('tabular-nums whitespace-nowrap text-right', stage.oldest_open_days === null && 'text-ink-muted')}>
                        {formatDays(stage.oldest_open_days)}
                      </TD>
                      <TD className={cn('tabular-nums whitespace-nowrap text-right', stage.avg_days_completed === null && 'text-ink-muted')}>
                        {formatDays(stage.avg_days_completed)}
                      </TD>
                      <TD>{levelBadge(stage)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </>
          ) : (
            <EmptyState title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} />
          ))}
      </ReportCard>

      <ReportCard
        id="operacional-carga"
        title="Carga por responsável"
        description="Demandas e tarefas em aberto por membro ativo"
        loading={metricsQ.isLoading}
        error={metricsQ.isError ? (metricsQ.error as Error).message : null}
        onRetry={() => metricsQ.refetch()}
        canExport={!!metrics?.workload.length}
        onExport={exportWorkload}
        onPrint={() => window.print()}
        hidden={false}
      >
        {metrics &&
          (metrics.workload.length ? (
            <Table label="Carga por responsável">
              <THead>
                <tr>
                  <TH>Responsável</TH>
                  <TH className="text-right">Demandas abertas</TH>
                  <TH className="text-right">Tarefas abertas</TH>
                  <TH className="text-right">Tarefas atrasadas</TH>
                  <TH className="text-right">Próximas ações vencidas</TH>
                </tr>
              </THead>
              <TBody>
                {metrics.workload.map((member) => (
                  <TR key={member.user_id}>
                    <TD className="font-medium">{member.name}</TD>
                    <TD className="tabular-nums text-right">{member.open_demands}</TD>
                    <TD className="tabular-nums text-right">{member.open_tasks}</TD>
                    <TD className={cn('tabular-nums text-right', member.overdue_tasks > 0 ? 'font-medium text-red-600' : 'text-ink-muted')}>
                      {member.overdue_tasks}
                    </TD>
                    <TD className={cn('tabular-nums text-right', member.next_actions_overdue > 0 ? 'font-medium text-amber-700' : 'text-ink-muted')}>
                      {member.next_actions_overdue}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState title="Sem carga atribuída." description="Nenhuma demanda ou tarefa em aberto para os membros ativos." />
          ))}
      </ReportCard>
    </>
  )
}
