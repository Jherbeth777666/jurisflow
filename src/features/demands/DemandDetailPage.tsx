import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarClock, FileText, MessageSquareText, Pencil, Trash2 } from 'lucide-react'
import { ActivityFeed } from '@/components/ActivityFeed'
import {
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  CategoryTag,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Select,
  Skeleton,
  Spinner,
  StatusBadge,
  useToast,
} from '@/components/ui'
import { TaskList } from '@/features/tasks/TaskList'
import { DemandChecklist } from '@/features/checklist/DemandChecklist'
import { MessageComposerModal } from '@/features/messages/MessageComposerModal'
import { useOrg } from '@/contexts/AuthContext'
import { useCategories, useMemberNames } from '@/hooks/useOrgData'
import { CONTRACT_STATUS, CONTRACT_TYPE, DEMAND_STATUS, PRIORITY, toOptions } from '@/lib/constants'
import { daysSince, formatCurrency, formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { DemandStatus } from '@/types/database'
import { useDeleteDemand, useDemand, useDemandContracts, usePatchDemand } from './api'
import { DemandFormModal } from './DemandFormModal'
import { useStageEntryPrompt } from '@/features/workflows/stageRules'
import { StageStepper } from './StageStepper'
import { STALLED_DAYS, formatDaysStalled, isNextActionOverdue, isOpenStatus } from './logic'

export function DemandDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useOrg()
  const q = useDemand(id)
  const cats = useCategories()
  const members = useMemberNames()
  const patch = usePatchDemand()
  const del = useDeleteDemand()
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [composing, setComposing] = useState(false)
  const stagePrompt = useStageEntryPrompt()

  if (q.isLoading) return <DetailSkeleton />
  if (q.isError || !q.data)
    return (
      <div>
        <BackLink />
        <Card>
          <ErrorState message={q.error ? (q.error as Error).message : 'Demanda não encontrada.'} onRetry={() => q.refetch()} />
        </Card>
      </div>
    )

  const d = q.data
  const category = cats.data?.find((c) => c.id === d.category_id)
  const stages = category?.stages ?? []
  const stage = stages.find((s) => s.id === d.stage_id)
  const responsible = d.responsible_id ? members.map.get(d.responsible_id) : null
  const open = isOpenStatus(d.status)
  const days = daysSince(d.stage_changed_at)
  const overdue = isNextActionOverdue(d)

  const quick = async (p: { stage_id?: string; status?: DemandStatus }, msg: string) => {
    try {
      const saved = await patch.mutateAsync({ id: d.id, patch: p })
      toast.show(saved.status === 'concluida' && p.stage_id ? `${msg} A demanda foi concluída.` : msg)
      const entered = p.stage_id ? stages.find((s) => s.id === p.stage_id) : undefined
      if (entered) void stagePrompt.promptFor(d, entered)
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Não foi possível atualizar.', 'error')
    }
  }

  return (
    <div>
      <BackLink />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {category && <CategoryTag name={category.name} color={category.color} />}
            <StatusBadge value={d.status} map={DEMAND_STATUS} />
            <StatusBadge value={d.priority} map={PRIORITY} />
          </div>
          <h1 className="text-heading font-semibold tracking-[-0.01em] text-ink">{d.title}</h1>
          <p className="mt-0.5 text-body text-ink-muted">
            Cliente:{' '}
            {d.client ? (
              <Link to={`/clientes/${d.client.id}`} className="font-medium text-ink hover:underline">
                {d.client.full_name}
              </Link>
            ) : (
              '—'
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<MessageSquareText className="size-4" />} onClick={() => setComposing(true)}>
            Mensagem
          </Button>
          <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
            Editar
          </Button>
          {can('demands.delete') && (
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)} className="text-red-600 hover:bg-red-50 hover:text-red-700">
              Excluir
            </Button>
          )}
        </div>
      </div>

      <MessageComposerModal open={composing} onClose={() => setComposing(false)} clientId={d.client_id} demandId={d.id} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Etapas"
              description={
                open ? (
                  <>
                    Na etapa atual há{' '}
                    <span className={cn('tabular', days >= STALLED_DAYS && 'font-medium text-amber-700')}>{formatDaysStalled(days)}</span>
                  </>
                ) : (
                  `Encerrada em ${formatDateTime(d.closed_at)}`
                )
              }
            />
            <CardBody className="space-y-4">
              {cats.isLoading ? <Skeleton className="h-12 w-full" /> : <StageStepper stages={stages} currentId={d.stage_id} color={category?.color} />}
              <div className="grid gap-3 sm:grid-cols-2">
                <Select
                  label="Mover para etapa"
                  options={stages.map((s) => ({ value: s.id, label: s.is_final ? `${s.name} (conclui)` : s.name }))}
                  value={d.stage_id ?? ''}
                  placeholder={stages.length ? undefined : 'Sem etapas'}
                  disabled={patch.isPending || !stages.length}
                  onChange={(e) => {
                    const target = stages.find((s) => s.id === e.target.value)
                    if (target && target.id !== d.stage_id) quick({ stage_id: target.id }, `Movida para “${target.name}”.`)
                  }}
                />
                <Select
                  label="Status"
                  options={toOptions(DEMAND_STATUS)}
                  value={d.status}
                  disabled={patch.isPending}
                  onChange={(e) => {
                    const v = e.target.value as DemandStatus
                    if (v !== d.status) quick({ status: v }, `Status alterado para “${DEMAND_STATUS[v].label}”.`)
                  }}
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Detalhes" />
            <CardBody className="space-y-4">
              <TextBlock label="Descrição" value={d.description} empty="Sem descrição." />
              <div>
                <p className="mb-1 text-caption font-medium text-ink-subtle">Próxima atividade</p>
                {d.next_action || d.next_action_date ? (
                  <div className="flex items-start gap-2 text-body">
                    <CalendarClock className={cn('mt-0.5 size-4 shrink-0', overdue ? 'text-red-600' : 'text-ink-subtle')} />
                    <div>
                      <p className="text-ink">{d.next_action || 'Atividade sem descrição'}</p>
                      <p className={cn('tabular text-label', overdue ? 'font-medium text-red-600' : 'text-ink-muted')}>
                        {d.next_action_date ? formatDate(d.next_action_date) : 'Sem data definida'}
                        {overdue && ' · vencida'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-body text-ink-subtle">Nenhuma atividade agendada.</p>
                )}
              </div>
              <TextBlock label="Observações" value={d.notes} empty="Sem observações." />
            </CardBody>
          </Card>

          <DemandChecklist demandId={d.id} categoryId={d.category_id} clientId={d.client_id} />

          <Card>
            <CardHeader title="Tarefas" />
            <CardBody>
              <TaskList demandId={d.id} allowCreate />
            </CardBody>
          </Card>

          <ContractsCard demandId={d.id} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Resumo" />
            <CardBody>
              <dl className="space-y-3 text-body-sm">
                <Info label="Etapa atual">{stage?.name ?? '—'}</Info>
                <Info label="Responsável">
                  {responsible ? (
                    <span className="flex items-center gap-2">
                      <Avatar name={responsible} />
                      {responsible}
                    </span>
                  ) : (
                    <span className="text-ink-subtle">Sem responsável</span>
                  )}
                </Info>
                <Info label="Abertura">{formatDate(d.opened_at)}</Info>
                {d.closed_at && <Info label="Encerramento">{formatDate(d.closed_at)}</Info>}
                <Info label="Última mudança de etapa">{formatDateTime(d.stage_changed_at)}</Info>
                <Info label="Criada em">{formatDateTime(d.created_at)}</Info>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Histórico de alterações" />
            <CardBody>
              <ActivityFeed entityType="demands" entityId={d.id} />
            </CardBody>
          </Card>
        </div>
      </div>

      {stagePrompt.element}
      <DemandFormModal open={editing} onClose={() => setEditing(false)} demand={d} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Excluir demanda"
        description="A demanda e suas tarefas serão excluídas permanentemente. Contratos vinculados permanecem, mas perdem o vínculo com esta demanda. Esta ação não pode ser desfeita."
        confirmLabel="Excluir demanda"
        onConfirm={async () => {
          await del.mutateAsync({ id: d.id, client_id: d.client_id })
          toast.show('Demanda excluída.')
          navigate('/demandas', { replace: true })
        }}
      />
    </div>
  )
}

function ContractsCard({ demandId }: { demandId: string }) {
  const q = useDemandContracts(demandId)
  return (
    <Card>
      <CardHeader title="Contratos vinculados" />
      {q.isLoading ? (
        <Spinner />
      ) : q.isError ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="Nenhum contrato vinculado"
          description="Contratos de honorários ligados a esta demanda aparecem aqui."
          className="py-8"
        />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((c) => (
            <li key={c.id}>
              <Link to={`/contratos/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-navy-50/60">
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-ink">{c.description || CONTRACT_TYPE[c.contract_type]}</p>
                  <p className="text-caption text-ink-subtle">
                    {CONTRACT_TYPE[c.contract_type]} · assinado em {formatDate(c.signed_at)}
                    {Number(c.overdue_count) > 0 && <span className="text-red-600"> · {c.overdue_count} parcela(s) vencida(s)</span>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="tabular text-body-sm text-ink">{formatCurrency(c.total_amount)}</span>
                  <StatusBadge value={c.status} map={CONTRACT_STATUS} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function BackLink() {
  return (
    <Link to="/demandas" className="mb-3 inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
      <ArrowLeft className="size-4" />
      Demandas
    </Link>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-ink-subtle">{label}</dt>
      <dd className="tabular min-w-0 text-right text-ink">{children}</dd>
    </div>
  )
}

function TextBlock({ label, value, empty }: { label: string; value: string | null; empty: string }) {
  return (
    <div>
      <p className="mb-1 text-caption font-medium text-ink-subtle">{label}</p>
      {value ? (
        <p className="whitespace-pre-wrap text-body text-ink">{value}</p>
      ) : (
        <p className="text-body text-ink-subtle">{empty}</p>
      )}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <Skeleton className="mb-4 h-4 w-24" />
      <Skeleton className="mb-2 h-6 w-2/3" />
      <Skeleton className="mb-6 h-4 w-1/3" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
    </div>
  )
}
