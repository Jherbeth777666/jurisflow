import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, HandCoins, Pencil, Trash2, Undo2, User, Briefcase } from 'lucide-react'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { CONTRACT_STATUS, CONTRACT_TYPE, INSTALLMENT_STATUS, PAYMENT_METHOD } from '@/lib/constants'
import { useOrg } from '@/contexts/AuthContext'
import { useMemberNames } from '@/hooks/useOrgData'
import { cn } from '@/lib/cn'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui'
import { ActivityFeed } from '@/components/ActivityFeed'
import type { Payment } from '@/types/database'
import { useContractDetail, useDeleteContract, useDeletePayment, useInstallments, usePayments, useUpdateContractStatus } from './api'
import { ContractFormModal } from './ContractFormModal'
import { PaymentModal } from './PaymentModal'
import { ProgressBar } from './ContractsPage'

export function ContractDetailPage() {
  const { id = '' } = useParams()
  const { can } = useOrg()
  const navigate = useNavigate()
  const toast = useToast()
  const names = useMemberNames()
  const detail = useContractDetail(id)
  const installments = useInstallments(id)
  const payments = usePayments(id)
  const updateStatus = useUpdateContractStatus()
  const deleteContract = useDeleteContract()
  const deletePayment = useDeletePayment()

  const [editOpen, setEditOpen] = useState(false)
  const [payOpen, setPayOpen] = useState<{ installmentId?: string } | null>(null)
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null)
  const [reversing, setReversing] = useState<Payment | null>(null)

  if (detail.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-60" />
        <Skeleton className="h-32 w-full rounded-[var(--radius-card)]" />
        <Skeleton className="h-64 w-full rounded-[var(--radius-card)]" />
      </div>
    )
  if (detail.isError)
    return (
      <Card>
        <ErrorState message={(detail.error as Error).message} onRetry={() => detail.refetch()} />
        <div className="pb-6 text-center">
          <Link to="/contratos" className="text-body-sm text-accent-700 hover:underline">
            Voltar para contratos
          </Link>
        </div>
      </Card>
    )

  const { contract: c, clientName, demand } = detail.data!
  const cancelled = c.status === 'cancelado'
  const instList = installments.data ?? []
  const instNumber = new Map(instList.map((i) => [i.id, i.number]))
  const hasOpen = instList.some((i) => i.remaining_amount > 0 && i.status !== 'cancelada' && i.status !== 'paga')
  const canPay = can('payments.create') && !cancelled && hasOpen

  return (
    <div className="space-y-4">
      <div>
        <Link to="/contratos" className="mb-2 inline-flex items-center gap-1 text-label text-ink-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> Contratos
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-heading font-semibold tracking-[-0.01em] text-ink">{CONTRACT_TYPE[c.contract_type]}</h1>
              <StatusBadge value={c.status} map={CONTRACT_STATUS} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm text-ink-muted">
              <Link to={`/clientes/${c.client_id}`} className="inline-flex items-center gap-1 hover:text-ink hover:underline">
                <User className="size-3.5" /> {clientName}
              </Link>
              {demand && (
                <Link to={`/demandas/${demand.id}`} className="inline-flex min-w-0 items-center gap-1 hover:text-ink hover:underline">
                  <Briefcase className="size-3.5" /> <span className="truncate">{demand.title}</span>
                </Link>
              )}
              <span>Contratado em {formatDate(c.signed_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canPay && (
              <Button variant="primary" icon={<HandCoins className="size-4" />} onClick={() => setPayOpen({})}>
                Registrar pagamento
              </Button>
            )}
            {can('contracts.manage') && (
              <Button icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
                Editar
              </Button>
            )}
            {can('contracts.manage') && !cancelled && c.status !== 'quitado' && (
              <Button icon={<Ban className="size-4" />} onClick={() => setConfirm('cancel')}>
                Cancelar contrato
              </Button>
            )}
            {can('contracts.delete') && (
              <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirm('delete')} className="text-red-600 hover:text-red-700">
                Excluir
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Resumo */}
      <Card>
        <CardBody className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Metric label="Valor contratado" value={formatCurrency(c.total_amount)} />
          <Metric label="Recebido" value={formatCurrency(c.received_amount)} className="text-emerald-700" />
          <Metric label="Saldo pendente" value={cancelled ? '—' : formatCurrency(c.balance_amount)} />
          <Metric
            label="Parcelas vencidas"
            value={String(c.overdue_count)}
            className={c.overdue_count > 0 ? 'text-red-600' : undefined}
          />
          <Metric label="Próximo vencimento" value={cancelled ? '—' : formatDate(c.next_due_date)} />
          <div className="col-span-full">
            <div className="mb-1 flex justify-between text-caption text-ink-subtle">
              <span>
                {c.installments_count}× · {PAYMENT_METHOD[c.payment_method]}
              </span>
              <span className="tabular">{c.total_amount > 0 ? Math.round((c.received_amount / c.total_amount) * 100) : 0}% recebido</span>
            </div>
            <ProgressBar value={c.received_amount} total={c.total_amount} className="h-1.5" />
          </div>
        </CardBody>
        {(c.description || c.notes) && (
          <div className="grid gap-4 border-t border-line px-4 py-3 text-body-sm sm:grid-cols-2">
            {c.description && (
              <div>
                <div className="text-caption font-medium text-ink-subtle">Descrição</div>
                <p className="mt-0.5 whitespace-pre-wrap text-ink">{c.description}</p>
              </div>
            )}
            {c.notes && (
              <div>
                <div className="text-caption font-medium text-ink-subtle">Observações</div>
                <p className="mt-0.5 whitespace-pre-wrap text-ink">{c.notes}</p>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {/* Cronograma */}
          <Card>
            <CardHeader title="Cronograma de parcelas" description={c.status === 'rascunho' ? 'Contrato em rascunho — parcelas ainda não são cobradas.' : undefined} />
            {installments.isLoading ? (
              <TableSkeleton rows={4} cols={5} />
            ) : installments.isError ? (
              <ErrorState message={(installments.error as Error).message} onRetry={() => installments.refetch()} />
            ) : !instList.length ? (
              <EmptyState title="Nenhuma parcela gerada" />
            ) : (
              <Table label="Cronograma de parcelas">
                <THead>
                  <tr>
                    <TH>Parcela</TH>
                    <TH>Vencimento</TH>
                    <TH className="text-right">Valor</TH>
                    <TH className="text-right">Pago</TH>
                    <TH className="text-right">Restante</TH>
                    <TH>Situação</TH>
                    {canPay && <TH className="text-right">Ação</TH>}
                  </tr>
                </THead>
                <TBody>
                  {instList.map((i) => {
                    const open = i.remaining_amount > 0 && i.status !== 'cancelada' && i.status !== 'paga'
                    return (
                      <TR key={i.id}>
                        <TD className="tabular text-ink-muted">
                          {i.number}/{instList.length}
                        </TD>
                        <TD className={cn('tabular whitespace-nowrap', i.status === 'vencida' && 'font-medium text-red-600')}>{formatDate(i.due_date)}</TD>
                        <TD className="tabular whitespace-nowrap text-right">{formatCurrency(i.amount)}</TD>
                        <TD className="tabular whitespace-nowrap text-right text-ink-muted">{i.paid_amount > 0 ? formatCurrency(i.paid_amount) : '—'}</TD>
                        <TD className="tabular whitespace-nowrap text-right font-medium">{i.remaining_amount > 0 ? formatCurrency(i.remaining_amount) : '—'}</TD>
                        <TD>
                          <StatusBadge value={i.status} map={INSTALLMENT_STATUS} />
                        </TD>
                        {canPay && (
                          <TD className="text-right">
                            {open && (
                              <Button size="sm" variant="ghost" onClick={() => setPayOpen({ installmentId: i.id })}>
                                Receber
                              </Button>
                            )}
                          </TD>
                        )}
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </Card>

          {/* Pagamentos */}
          <Card>
            <CardHeader
              title="Pagamentos registrados"
              description={payments.data?.length ? `${payments.data.length} pagamento${payments.data.length === 1 ? '' : 's'} · ${formatCurrency(c.received_amount)}` : undefined}
            />
            {payments.isLoading ? (
              <TableSkeleton rows={3} cols={4} />
            ) : payments.isError ? (
              <ErrorState message={(payments.error as Error).message} onRetry={() => payments.refetch()} />
            ) : !payments.data?.length ? (
              <EmptyState
                icon={<HandCoins className="size-5" />}
                title="Nenhum pagamento registrado"
                className="py-8"
                action={
                  canPay && (
                    <Button size="sm" variant="primary" onClick={() => setPayOpen({})}>
                      Registrar pagamento
                    </Button>
                  )
                }
              />
            ) : (
              <Table label="Pagamentos registrados">
                <THead>
                  <tr>
                    <TH>Data</TH>
                    <TH>Parcela</TH>
                    <TH className="text-right">Valor</TH>
                    <TH>Forma</TH>
                    <TH>Observação</TH>
                    {can('payments.delete') && <TH className="text-right">Ação</TH>}
                  </tr>
                </THead>
                <TBody>
                  {payments.data.map((p) => (
                    <TR key={p.id}>
                      <TD className="tabular whitespace-nowrap">
                        {formatDate(p.paid_at)}
                        <span className="block text-caption text-ink-subtle" title={formatDateTime(p.created_at)}>
                          por {p.created_by ? names.map.get(p.created_by) ?? 'usuário' : 'usuário removido'}
                        </span>
                      </TD>
                      <TD className="tabular text-ink-muted">{p.installment_id ? `${instNumber.get(p.installment_id) ?? '—'}/${instList.length || '—'}` : '—'}</TD>
                      <TD className="tabular whitespace-nowrap text-right font-medium">{formatCurrency(p.amount)}</TD>
                      <TD className="whitespace-nowrap text-ink-muted">{PAYMENT_METHOD[p.method]}</TD>
                      <TD className="max-w-[240px] truncate text-ink-muted" title={p.notes ?? undefined}>
                        {p.notes || '—'}
                      </TD>
                      {can('payments.delete') && (
                        <TD className="text-right">
                          <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => setReversing(p)}>
                            Estornar
                          </Button>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Histórico" />
          <CardBody>
            <ActivityFeed entityType="contracts" entityId={c.id} />
          </CardBody>
        </Card>
      </div>

      <ContractFormModal open={editOpen} onClose={() => setEditOpen(false)} contract={c} />
      <PaymentModal
        open={!!payOpen}
        onClose={() => setPayOpen(null)}
        contractId={c.id}
        installmentId={payOpen?.installmentId}
        defaultMethod={c.payment_method}
        subtitle={`${clientName} · ${CONTRACT_TYPE[c.contract_type]}`}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onClose={() => setConfirm(null)}
        title="Cancelar contrato"
        description="O contrato deixará de gerar cobranças e não aceitará novos pagamentos. Os pagamentos já registrados são mantidos. Você pode reativá-lo depois pela edição."
        confirmLabel="Cancelar contrato"
        onConfirm={async () => {
          await updateStatus.mutateAsync({ id: c.id, status: 'cancelado' })
          toast.show('Contrato cancelado.')
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title="Excluir contrato"
        description={`Esta ação é permanente e remove também as parcelas${payments.data?.length ? ` e os ${payments.data.length} pagamento(s) registrados` : ''}. Prefira cancelar se quiser manter o histórico financeiro.`}
        confirmLabel="Excluir definitivamente"
        onConfirm={async () => {
          await deleteContract.mutateAsync(c.id)
          toast.show('Contrato excluído.')
          navigate('/contratos', { replace: true })
        }}
      />
      <ConfirmDialog
        open={!!reversing}
        onClose={() => setReversing(null)}
        title="Estornar pagamento"
        description={
          reversing
            ? `O pagamento de ${formatCurrency(reversing.amount)} em ${formatDate(reversing.paid_at)} será removido e o saldo da parcela voltará a ficar em aberto.`
            : ''
        }
        confirmLabel="Estornar"
        onConfirm={async () => {
          if (!reversing) return
          await deletePayment.mutateAsync(reversing)
          toast.show('Pagamento estornado.')
        }}
      />
    </div>
  )
}

function Metric({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-caption font-medium text-ink-subtle">{label}</div>
      <div className={cn('tabular mt-0.5 truncate text-title font-semibold tracking-[-0.01em] text-ink', className)}>{value}</div>
    </div>
  )
}
