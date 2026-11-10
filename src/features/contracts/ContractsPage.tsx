import { useCallback, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, CalendarClock, FileSignature, HandCoins, Plus, Wallet, Scale } from 'lucide-react'
import { formatCurrency, formatDate, diffInDays, todayISO } from '@/lib/format'
import { CONTRACT_STATUS, CONTRACT_TYPE, INSTALLMENT_STATUS, PAGE_SIZE, toOptions } from '@/lib/constants'
import { useOrg } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
  StatCard,
  StatusBadge,
  Table,
  TableSkeleton,
  Tabs,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui'
import type { ContractStatus } from '@/types/database'
import { useContractList, useFinanceSummary, useReceivables, type ReceivableRow } from './api'
import { ContractFormModal } from './ContractFormModal'
import { PaymentModal } from './PaymentModal'
import { usePageClamp } from '@/hooks/usePageClamp'

type Tab = 'contratos' | 'recebimentos'

export function ProgressBar({ value, total, className }: { value: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0
  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-navy-50', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={`${Math.round(pct)}% recebido`}
    >
      <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-navy-500')} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function ContractsPage() {
  const { can } = useOrg()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('aba') === 'recebimentos' ? 'recebimentos' : 'contratos'
  const [formOpen, setFormOpen] = useState(false)

  const summary = useFinanceSummary()
  const receivables = useReceivables(30)

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    if (t === 'contratos') next.delete('aba')
    else next.set('aba', t)
    setParams(next, { replace: true })
  }

  const overdueCount = receivables.data?.filter((r) => r.status === 'vencida').length

  return (
    <div>
      <PageHeader
        title="Contratos e honorários"
        description="Controle de honorários contratados, parcelas e recebimentos."
        actions={
          can('contracts.manage') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setFormOpen(true)}>
              Novo contrato
            </Button>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-[var(--radius-card)]" />)
        ) : summary.isError ? (
          <Card className="col-span-full">
            <ErrorState message={(summary.error as Error).message} onRetry={() => summary.refetch()} />
          </Card>
        ) : (
          <>
            <StatCard
              label="Honorários contratados"
              value={formatCurrency(summary.data!.contractedTotal)}
              hint={`Ativos e quitados · ${summary.data!.activeCount} ativo${summary.data!.activeCount === 1 ? '' : 's'} (${formatCurrency(summary.data!.activeTotal)})`}
              icon={<FileSignature className="size-4" />}
            />
            <StatCard label="Recebido" value={formatCurrency(summary.data!.received)} hint="Ativos e quitados" icon={<Wallet className="size-4" />} tone="success" />
            <StatCard label="Saldo pendente" value={formatCurrency(summary.data!.balance)} hint="A receber dos contratos ativos" icon={<Scale className="size-4" />} />
            <StatCard
              label="Valor vencido"
              value={formatCurrency(summary.data!.overdue)}
              hint={`${summary.data!.overdueCount} parcela${summary.data!.overdueCount === 1 ? '' : 's'} vencida${summary.data!.overdueCount === 1 ? '' : 's'}`}
              icon={<AlertTriangle className="size-4" />}
              tone={summary.data!.overdue > 0 ? 'danger' : 'default'}
            />
          </>
        )}
      </div>

      <Tabs
        className="mb-4"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'contratos', label: 'Contratos' },
          { value: 'recebimentos', label: 'Recebimentos', count: overdueCount || undefined },
        ]}
      />

      {tab === 'contratos' ? <ContractsTab onCreate={() => setFormOpen(true)} /> : <ReceivablesTab query={receivables} />}

      <ContractFormModal open={formOpen} onClose={() => setFormOpen(false)} onSaved={(c) => navigate(`/contratos/${c.id}`)} />
    </div>
  )
}

function ContractsTab({ onCreate }: { onCreate: () => void }) {
  const { can } = useOrg()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = (params.get('status') ?? '') as ContractStatus | ''
  const search = params.get('q') ?? ''
  const page = Math.max(0, Number(params.get('p') ?? 0) || 0)

  const update = useCallback(
    (patch: Record<string, string>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
          if (!('p' in patch)) next.delete('p')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const list = useContractList({ status, search, page })
  const goToPage = useCallback((p: number) => update({ p: p ? String(p) : '' }), [update])
  usePageClamp(page, PAGE_SIZE, list.data, list.isPlaceholderData, goToPage)
  const today = todayISO()
  const filtered = !!status || !!search

  return (
    <Card>
      <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => update({ q: v })} placeholder="Buscar por cliente" className="sm:w-72" />
        <Select
          aria-label="Filtrar por status"
          wrapperClassName="sm:w-48"
          value={status}
          onChange={(e) => update({ status: e.target.value })}
          options={toOptions(CONTRACT_STATUS)}
          placeholder="Todos os status"
        />
      </div>

      {list.isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : list.isError ? (
        <ErrorState message={(list.error as Error).message} onRetry={() => list.refetch()} />
      ) : !list.data?.rows.length ? (
        filtered ? (
          <EmptyState title="Nenhum contrato encontrado" description="Ajuste a busca ou o filtro de status." action={<Button size="sm" onClick={() => update({ q: '', status: '' })}>Limpar filtros</Button>} />
        ) : (
          <EmptyState
            icon={<FileSignature className="size-5" />}
            title="Nenhum contrato cadastrado"
            description="Cadastre os honorários contratados para acompanhar parcelas e recebimentos."
            action={
              can('contracts.manage') && (
                <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={onCreate}>
                  Novo contrato
                </Button>
              )
            }
          />
        )
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Cliente</TH>
                <TH>Tipo</TH>
                <TH className="text-right">Valor</TH>
                <TH className="text-right">Recebido</TH>
                <TH className="text-right">Saldo</TH>
                <TH className="w-28">Progresso</TH>
                <TH className="text-center">Vencidas</TH>
                <TH>Próx. vencimento</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {list.data.rows.map((c) => (
                <TR key={c.id} onClick={() => navigate(`/contratos/${c.id}`)}>
                  <TD className="max-w-[220px]">
                    <Link to={`/contratos/${c.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-ink hover:underline">
                      {c.client_name}
                    </Link>
                    <span className="block truncate text-[12px] text-ink-subtle">
                      {c.installments_count}× · desde {formatDate(c.signed_at)}
                    </span>
                  </TD>
                  <TD className="whitespace-nowrap text-ink-muted">{CONTRACT_TYPE[c.contract_type]}</TD>
                  <TD className="tabular whitespace-nowrap text-right">{formatCurrency(c.total_amount)}</TD>
                  <TD className="tabular whitespace-nowrap text-right text-ink-muted">{formatCurrency(c.received_amount)}</TD>
                  <TD className="tabular whitespace-nowrap text-right font-medium">{c.status === 'cancelado' ? '—' : formatCurrency(c.balance_amount)}</TD>
                  <TD>
                    <ProgressBar value={c.received_amount} total={c.total_amount} />
                  </TD>
                  <TD className="tabular text-center">
                    {c.overdue_count > 0 ? <span className="font-medium text-red-600">{c.overdue_count}</span> : <span className="text-ink-subtle">0</span>}
                  </TD>
                  <TD className={cn('tabular whitespace-nowrap', c.next_due_date && c.next_due_date < today && 'text-red-600')}>
                    {c.status === 'cancelado' ? '—' : formatDate(c.next_due_date)}
                  </TD>
                  <TD>
                    <StatusBadge value={c.status} map={CONTRACT_STATUS} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onChange={goToPage} />
        </>
      )}
    </Card>
  )
}

function ReceivablesTab({ query }: { query: ReturnType<typeof useReceivables> }) {
  const { can } = useOrg()
  const [paying, setPaying] = useState<ReceivableRow | null>(null)

  if (query.isLoading)
    return (
      <Card>
        <TableSkeleton rows={6} cols={5} />
      </Card>
    )
  if (query.isError)
    return (
      <Card>
        <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />
      </Card>
    )

  const rows = query.data ?? []
  const overdue = rows.filter((r) => r.status === 'vencida')
  const upcoming = rows.filter((r) => r.status !== 'vencida')
  const sum = (l: ReceivableRow[]) => l.reduce((s, r) => s + r.remaining_amount, 0)

  return (
    <div className="space-y-4">
      <ReceivableSection
        title="Parcelas vencidas"
        description={overdue.length ? `${overdue.length} parcela${overdue.length === 1 ? '' : 's'} · ${formatCurrency(sum(overdue))} em atraso` : undefined}
        rows={overdue}
        empty={<EmptyState icon={<HandCoins className="size-5" />} title="Nenhuma parcela vencida" description="Todos os recebimentos estão em dia." className="py-8" />}
        canPay={can('payments.create')}
        onPay={setPaying}
        overdue
      />
      <ReceivableSection
        title="Próximos 30 dias"
        description={upcoming.length ? `${upcoming.length} parcela${upcoming.length === 1 ? '' : 's'} · ${formatCurrency(sum(upcoming))} a receber` : undefined}
        rows={upcoming}
        empty={<EmptyState icon={<CalendarClock className="size-5" />} title="Nenhum vencimento nos próximos 30 dias" className="py-8" />}
        canPay={can('payments.create')}
        onPay={setPaying}
      />
      <PaymentModal
        open={!!paying}
        onClose={() => setPaying(null)}
        contractId={paying?.contract_id ?? null}
        installmentId={paying?.id}
        subtitle={paying ? `${paying.client_name} · parcela ${paying.number}/${paying.installments_count}` : undefined}
      />
    </div>
  )
}

function ReceivableSection({
  title,
  description,
  rows,
  empty,
  canPay,
  onPay,
  overdue,
}: {
  title: string
  description?: string
  rows: ReceivableRow[]
  empty: ReactNode
  canPay: boolean
  onPay: (r: ReceivableRow) => void
  overdue?: boolean
}) {
  const today = todayISO()
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {!rows.length ? (
        empty
      ) : (
        <Table>
          <THead>
            <tr>
              <TH>Vencimento</TH>
              <TH>Cliente</TH>
              <TH>Parcela</TH>
              <TH className="text-right">Valor</TH>
              <TH className="text-right">Restante</TH>
              <TH>Situação</TH>
              {canPay && <TH className="text-right">Ação</TH>}
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const days = diffInDays(today, r.due_date)
              return (
                <TR key={r.id}>
                  <TD className="tabular whitespace-nowrap">
                    <span className={cn(overdue && 'font-medium text-red-600')}>{formatDate(r.due_date)}</span>
                    <span className="block text-[11.5px] text-ink-subtle">
                      {days < 0 ? `há ${-days} dia${days === -1 ? '' : 's'}` : days === 0 ? 'hoje' : `em ${days} dia${days === 1 ? '' : 's'}`}
                    </span>
                  </TD>
                  <TD className="max-w-[220px]">
                    <Link to={`/contratos/${r.contract_id}`} className="block truncate font-medium hover:underline">
                      {r.client_name}
                    </Link>
                    <span className="block truncate text-[12px] text-ink-subtle">{CONTRACT_TYPE[r.contract_type]}</span>
                  </TD>
                  <TD className="tabular whitespace-nowrap text-ink-muted">
                    {r.number}/{r.installments_count || '—'}
                  </TD>
                  <TD className="tabular whitespace-nowrap text-right text-ink-muted">{formatCurrency(r.amount)}</TD>
                  <TD className="tabular whitespace-nowrap text-right font-medium">{formatCurrency(r.remaining_amount)}</TD>
                  <TD>
                    <StatusBadge value={r.status} map={INSTALLMENT_STATUS} />
                  </TD>
                  {canPay && (
                    <TD className="text-right">
                      <Button size="sm" variant="subtle" icon={<HandCoins className="size-3.5" />} onClick={() => onPay(r)}>
                        Registrar pagamento
                      </Button>
                    </TD>
                  )}
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}
    </Card>
  )
}
