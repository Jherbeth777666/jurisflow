// Painel "Saúde do cadastro" (/qualidade).
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarClock, CheckCircle2, Copy, ListTodo, UserMinus, UserX, Users } from 'lucide-react'
import { Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, PageHeader, Skeleton, useToast } from '@/components/ui'
import { ExportButton } from '@/components/ExportButton'
import { formatDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/cn'
import { MATCH_REASON_LABEL } from '@/features/import/dedupe'
import { useInactivateClients, useQualityReport } from './api'
import { INDICATOR_LABEL, ISSUE_LABEL, scoreLabel, STALE_CLIENT_DAYS, WEIGHTS, type Indicator, type QualityReport } from './logic'

const PREVIEW = 8

export function QualityPage() {
  const q = useQualityReport()
  return (
    <div>
      <PageHeader
        title="Saúde do cadastro"
        description="Um raio-x da base do escritório: duplicados, cadastros incompletos e o que está parado — com o atalho para corrigir."
      />
      {q.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <Skeleton className="h-64" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        </div>
      ) : q.isError ? (
        <Card>
          <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <Dashboard r={q.data!} />
      )}
    </div>
  )
}

function Dashboard({ r }: { r: QualityReport }) {
  const s = scoreLabel(r.score)
  const allClear =
    !r.duplicates.length && !r.incomplete.length && !r.staleClients.length && !r.noResponsible.length && !r.noNextAction.length && !r.overdueTasks.length
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="lg:sticky lg:top-4">
        <div className="p-5">
          <p className="text-[12.5px] font-medium text-ink-muted">Pontuação da base</p>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="tabular text-[44px] font-semibold leading-none tracking-[-0.03em] text-ink">{r.score}</span>
            <span className="text-[14px] text-ink-subtle">/ 100</span>
          </div>
          <Badge className="mt-2" tone={s.tone === 'success' ? 'green' : s.tone === 'warning' ? 'amber' : 'red'} dot>
            {s.label}
          </Badge>
          <p className="mt-3 text-[12px] text-ink-subtle">
            {formatNumber(r.totals.clients)} clientes · {formatNumber(r.totals.openDemands)} demandas abertas · {formatNumber(r.totals.openTasks)} tarefas abertas
          </p>
        </div>
        <ul className="border-t border-line px-5 py-4">
          {(Object.keys(WEIGHTS) as Indicator[]).map((k) => {
            const ind = r.indicators[k]
            const pct = Math.round(ind.value * 100)
            return (
              <li key={k} className="py-1.5">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-ink">{INDICATOR_LABEL[k]}</span>
                  <span className="tabular text-ink-muted">
                    {ind.points.toFixed(0)}/{WEIGHTS[k]}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                  <div
                    className={cn('h-full rounded-full', pct >= 90 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
        <p className="border-t border-line px-5 py-3 text-[11.5px] leading-relaxed text-ink-subtle">
          Cada indicador vale a fração de registros sem o problema, multiplicada pelo peso. Calculado agora com os dados do escritório.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {allClear && (
          <Card className="flex items-center gap-3 p-5 xl:col-span-2">
            <CheckCircle2 className="size-5 text-emerald-600" />
            <p className="text-[13.5px] text-ink">Nenhum problema encontrado. Sua base está impecável.</p>
          </Card>
        )}
        <DuplicatesCard r={r} />
        <IncompleteCard r={r} />
        <StaleClientsCard r={r} />
        <DemandListCard
          title="Demandas sem responsável"
          icon={<UserX className="size-4" />}
          items={r.noResponsible}
          filename="demandas-sem-responsavel"
          empty="Todas as demandas abertas têm responsável."
        />
        <DemandListCard
          title="Demandas sem próxima atividade"
          description="Sem “próxima atividade” e sem tarefa aberta."
          icon={<ListTodo className="size-4" />}
          items={r.noNextAction}
          filename="demandas-sem-proxima-atividade"
          empty="Todas as demandas abertas têm um próximo passo."
        />
        <OverdueTasksCard r={r} />
      </div>
    </div>
  )
}

function Section({
  title,
  description,
  icon,
  count,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  icon: ReactNode
  count: number
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className={cn('flex size-6 items-center justify-center rounded-md', count ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700')}>
              {icon}
            </span>
            {title}
            <span className={cn('tabular rounded-full px-1.5 text-[11px]', count ? 'bg-navy-900 text-white' : 'bg-slate-100 text-ink-muted')}>{count}</span>
          </span>
        }
        description={description}
        action={action}
      />
      {children}
    </Card>
  )
}

function useExpand<T>(items: T[]) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, PREVIEW)
  const toggle =
    items.length > PREVIEW ? (
      <button onClick={() => setAll((a) => !a)} className="w-full border-t border-line py-2 text-[12.5px] font-medium text-accent-700 hover:bg-navy-50/60">
        {all ? 'Mostrar menos' : `Ver todos (${items.length})`}
      </button>
    ) : null
  return { shown, toggle }
}

const Empty = ({ text }: { text: string }) => (
  <p className="flex items-center gap-2 px-4 py-5 text-[13px] text-ink-muted">
    <CheckCircle2 className="size-4 text-emerald-600" /> {text}
  </p>
)

function DuplicatesCard({ r }: { r: QualityReport }) {
  const navigate = useNavigate()
  const { shown, toggle } = useExpand(r.duplicates)
  const openBoth = (a: string, b: string) => {
    window.open(`/clientes/${b}`, '_blank', 'noopener')
    navigate(`/clientes/${a}`)
  }
  return (
    <Section
      title="Possíveis duplicados"
      icon={<Copy className="size-3.5" />}
      count={r.duplicates.length}
      className="xl:col-span-2"
      action={
        <ExportButton
          resource="data_quality"
          filename="possiveis-duplicados"
          rows={r.duplicates}
          columns={[
            { key: 'aName', header: 'Cliente A' },
            { key: 'bName', header: 'Cliente B' },
            { key: 'reason', header: 'Motivo', value: (p) => MATCH_REASON_LABEL[p.reason] },
            { key: 'score', header: 'Similaridade', value: (p) => `${Math.round(p.score * 100)}%` },
          ]}
        />
      }
    >
      {!r.duplicates.length ? (
        <Empty text="Nenhum cadastro duplicado encontrado." />
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((p) => (
            <li key={`${p.a}-${p.b}`} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-[13px]">
                <span className="font-medium text-ink">{p.aName}</span>
                <span className="mx-1.5 text-ink-subtle">e</span>
                <span className="font-medium text-ink">{p.bName}</span>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <Badge tone={p.certain ? 'red' : 'amber'}>{MATCH_REASON_LABEL[p.reason]}</Badge>
                  {!p.certain && <span className="tabular text-[11.5px] text-ink-subtle">{Math.round(p.score * 100)}% parecido</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Link to={`/clientes/${p.a}`} className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium text-ink-muted hover:bg-navy-50 hover:text-ink">
                  Ver
                </Link>
                <Button size="sm" onClick={() => openBoth(p.a, p.b)}>
                  Abrir ambos
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {toggle}
    </Section>
  )
}

function IncompleteCard({ r }: { r: QualityReport }) {
  const { shown, toggle } = useExpand(r.incomplete)
  return (
    <Section
      title="Cadastros incompletos"
      description="Sem CPF, sem telefone ou com CPF inválido (arquivados não contam)."
      icon={<Users className="size-3.5" />}
      count={r.incomplete.length}
      action={
        <ExportButton
          resource="data_quality"
          filename="cadastros-incompletos"
          rows={r.incomplete}
          columns={[
            { key: 'name', header: 'Cliente', value: (x) => x.client.full_name },
            { key: 'issues', header: 'Pendências', value: (x) => x.issues.map((i) => ISSUE_LABEL[i]).join(', ') },
          ]}
        />
      }
    >
      {!r.incomplete.length ? (
        <Empty text="Todos os cadastros têm CPF válido e telefone." />
      ) : (
        <ul className="divide-y divide-line">
          {shown.map(({ client, issues }) => (
            <li key={client.id}>
              <Link to={`/clientes/${client.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-navy-50/60">
                <span className="truncate text-[13px] font-medium text-ink">{client.full_name}</span>
                <span className="flex shrink-0 gap-1">
                  {issues.map((i) => (
                    <Badge key={i} tone={i === 'cpf_invalido' ? 'red' : 'gray'}>
                      {ISSUE_LABEL[i]}
                    </Badge>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {toggle}
    </Section>
  )
}

function StaleClientsCard({ r }: { r: QualityReport }) {
  const toast = useToast()
  const inactivate = useInactivateClients()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const { shown, toggle } = useExpand(r.staleClients)
  const allIds = useMemo(() => r.staleClients.map((s) => s.client.id), [r.staleClients])
  const allSelected = selected.size === allIds.length && allIds.length > 0
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return (
    <Section
      title={`Clientes ativos parados há +${STALE_CLIENT_DAYS} dias`}
      description="Sem demanda aberta e sem movimentação. Sugestão: marcar como inativos."
      icon={<UserMinus className="size-3.5" />}
      count={r.staleClients.length}
      action={
        <ExportButton
          resource="data_quality"
          filename="clientes-ativos-parados"
          rows={r.staleClients}
          columns={[
            { key: 'name', header: 'Cliente', value: (x) => x.client.full_name },
            { key: 'last', header: 'Última movimentação', value: (x) => formatDate(x.lastActivity) },
            { key: 'days', header: 'Dias parado', value: (x) => x.days },
          ]}
        />
      }
    >
      {!r.staleClients.length ? (
        <Empty text="Nenhum cliente ativo parado." />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-line bg-canvas/60 px-4 py-2">
            <label className="inline-flex items-center gap-2 text-[12.5px] text-ink-muted">
              <input
                type="checkbox"
                className="size-4 accent-navy-900"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))}
              />
              Selecionar todos
            </label>
            <Button size="sm" variant="primary" disabled={!selected.size} onClick={() => setConfirm(true)}>
              Inativar {selected.size || ''}
            </Button>
          </div>
          <ul className="divide-y divide-line">
            {shown.map(({ client, lastActivity, days }) => (
              <li key={client.id} className="flex items-center gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-navy-900"
                  aria-label={`Selecionar ${client.full_name}`}
                  checked={selected.has(client.id)}
                  onChange={() => toggleOne(client.id)}
                />
                <Link to={`/clientes/${client.id}`} className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink hover:underline">
                  {client.full_name}
                </Link>
                <span className="tabular shrink-0 text-[12px] text-ink-subtle" title={`Última movimentação: ${formatDate(lastActivity)}`}>
                  {days} dias
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {toggle}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        tone="primary"
        title="Inativar clientes"
        confirmLabel={`Inativar ${selected.size}`}
        description={`${selected.size} cliente(s) passarão para a situação “Inativo”. Nenhum dado é apagado e você pode reativá-los a qualquer momento no cadastro.`}
        onConfirm={async () => {
          const n = await inactivate.mutateAsync([...selected])
          setSelected(new Set())
          toast.show(`${n} cliente(s) inativado(s).`)
        }}
      />
    </Section>
  )
}

function DemandListCard({
  title,
  description,
  icon,
  items,
  filename,
  empty,
}: {
  title: string
  description?: string
  icon: ReactNode
  items: QualityReport['noResponsible']
  filename: string
  empty: string
}) {
  const { shown, toggle } = useExpand(items)
  return (
    <Section
      title={title}
      description={description}
      icon={icon}
      count={items.length}
      action={<ExportButton resource="data_quality" filename={filename} rows={items} columns={[{ key: 'title', header: 'Demanda' }]} />}
    >
      {!items.length ? (
        <Empty text={empty} />
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((d) => (
            <li key={d.id}>
              <Link to={`/demandas/${d.id}`} className="block truncate px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-navy-50/60">
                {d.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {toggle}
    </Section>
  )
}

function OverdueTasksCard({ r }: { r: QualityReport }) {
  const { shown, toggle } = useExpand(r.overdueTasks)
  return (
    <Section
      title="Tarefas vencidas há +7 dias"
      icon={<CalendarClock className="size-3.5" />}
      count={r.overdueTasks.length}
      className="xl:col-span-2"
      action={
        <ExportButton
          resource="data_quality"
          filename="tarefas-vencidas"
          rows={r.overdueTasks}
          columns={[
            { key: 'title', header: 'Tarefa' },
            { key: 'due_date', header: 'Vencimento', value: (t) => formatDate(t.due_date) },
            { key: 'daysLate', header: 'Dias de atraso' },
          ]}
        />
      }
    >
      {!r.overdueTasks.length ? (
        <Empty text="Nenhuma tarefa esquecida." />
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((t) => (
            <li key={t.id}>
              <Link
                to={t.demand_id ? `/demandas/${t.demand_id}` : t.client_id ? `/clientes/${t.client_id}` : '/tarefas'}
                className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-navy-50/60"
              >
                <span className="truncate text-[13px] font-medium text-ink">{t.title}</span>
                <span className="tabular shrink-0 text-[12px] text-red-600">
                  venceu {formatDate(t.due_date)} · {t.daysLate} dias
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {toggle}
    </Section>
  )
}
