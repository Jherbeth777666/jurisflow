// Ficha 360° do cliente: o que está pendente, sem trocar de aba.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlarmClock, Briefcase, CheckCircle2, FileText, Wallet } from 'lucide-react'
import { Badge, Card, CardBody, CardHeader, ErrorState, Spinner } from '@/components/ui'
import { cn } from '@/lib/cn'
import { formatCurrency, formatDate } from '@/lib/format'
import { useClientOverview } from './api'
import { stageAgeLabel, summaryStats } from './summary'

export function ClientSummary({ clientId }: { clientId: string }) {
  const q = useClientOverview(clientId)

  if (q.isLoading) {
    return (
      <Card className="mb-4">
        <Spinner />
      </Card>
    )
  }

  if (q.isError || !q.data) {
    return (
      <Card className="mb-4">
        <ErrorState
          message={q.error ? (q.error as Error).message : undefined}
          onRetry={() => void q.refetch()}
        />
      </Card>
    )
  }

  const overview = q.data
  const stats = summaryStats(overview)

  return (
    <Card className="mb-4">
      <CardHeader title="Resumo do cliente" description="O que está pendente agora." />
      <CardBody className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Indicator
            label="Demandas abertas"
            value={stats.openDemands}
            icon={<Briefcase className="size-3.5" aria-hidden />}
          />
          <Indicator
            label="Próximas ações atrasadas"
            value={stats.overdueNextActions}
            tone={stats.overdueNextActions > 0 ? 'danger' : 'default'}
            icon={<AlarmClock className="size-3.5" aria-hidden />}
          />
          <Indicator
            label="Documentos pendentes"
            value={stats.pendingDocuments}
            icon={<FileText className="size-3.5" aria-hidden />}
          />
          <Indicator
            label="Tarefas atrasadas"
            value={stats.overdueTasks}
            tone={stats.overdueTasks > 0 ? 'danger' : 'default'}
            hint={`de ${stats.openTasks} abertas`}
            icon={<CheckCircle2 className="size-3.5" aria-hidden />}
          />
          <Indicator
            label="Em aberto"
            value={formatCurrency(stats.openAmount)}
            hint={
              stats.overdueAmount > 0 ? (
                <span className="font-medium text-red-600">{formatCurrency(stats.overdueAmount)} vencido</span>
              ) : undefined
            }
            icon={<Wallet className="size-3.5" aria-hidden />}
          />
        </div>

        <section>
          <h4 className="mb-2 text-body-sm font-semibold text-ink">Demandas em andamento</h4>
          {overview.open_demands.length ? (
            <ul className="divide-y divide-line rounded-md border border-line">
              {overview.open_demands.map((d) => (
                <li key={d.id} className="px-3 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link to={`/demandas/${d.id}`} className="min-w-0 break-words text-body font-medium text-ink hover:underline">
                      {d.title}
                    </Link>
                    {d.next_action_overdue && <Badge tone="red">Atrasada</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-subtle">
                    <span>{d.stage_name || 'Sem etapa'}</span>
                    <span aria-hidden>·</span>
                    <span>{stageAgeLabel(d.days_in_stage)}</span>
                  </div>
                  {(d.next_action || d.next_action_date) && (
                    <div className="mt-1 break-words text-label text-ink-muted">
                      {d.next_action && <span>{d.next_action}</span>}
                      {d.next_action_date && <span> · {formatDate(d.next_action_date)}</span>}
                    </div>
                  )}
                  {d.checklist_total > 0 && (
                    <p className="mt-1 text-caption text-ink-subtle">
                      {d.checklist_pending} de {d.checklist_total} documentos
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-sm text-ink-subtle">Nenhuma demanda em andamento.</p>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-body-sm font-semibold text-ink">Documentos pendentes</h4>
          {overview.checklist_pending_items.length ? (
            <ul className="space-y-1.5">
              {overview.checklist_pending_items.map((item, index) => (
                <li key={`${item.demand_id}-${index}`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5 text-body-sm">
                  <span className="min-w-0 break-words text-ink">{item.label}</span>
                  <span className="shrink-0 text-caption text-ink-subtle">{item.demand_title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-sm text-ink-subtle">Nenhum documento pendente</p>
          )}
        </section>

        <p className="border-t border-line pt-3 text-caption text-ink-subtle">
          {overview.last_activity_at
            ? `Última movimentação: ${formatDate(overview.last_activity_at)}`
            : 'Sem movimentação registrada'}
        </p>
      </CardBody>
    </Card>
  )
}

function Indicator({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: 'default' | 'danger'
}) {
  return (
    <div role="group" aria-label={label} className="min-w-0 rounded-md border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5 text-caption font-medium text-ink-muted">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'tabular-nums mt-1 break-words text-heading font-semibold tracking-[-0.02em]',
          tone === 'danger' ? 'text-red-600' : 'text-ink',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-caption text-ink-subtle">{hint}</div>}
    </div>
  )
}
