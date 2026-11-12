import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Briefcase, CheckCircle2, CircleDot, EyeOff, MessageSquareText, Pencil, Plus, ShieldAlert, Trash2, XCircle } from 'lucide-react'
import { ActivityFeed } from '@/components/ActivityFeed'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CategoryTag,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  Skeleton,
  Spinner,
  StatusBadge,
  Tabs,
  useToast,
} from '@/components/ui'
import { TaskList } from '@/features/tasks/TaskList'
import { MessageComposerModal } from '@/features/messages/MessageComposerModal'
import { DemandFormModal } from '@/features/demands/DemandFormModal'
import { useOrg } from '@/contexts/AuthContext'
import { useCategories } from '@/hooks/useOrgData'
import { CLIENT_STATUS, DEMAND_STATUS, PRIORITY } from '@/lib/constants'
import { formatCPF, formatDate, formatDateTime, formatPhone } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useAnonymizeClient, useClient, useClientContractsCount, useClientDemands, useDeleteClient } from './api'
import { ClientFormModal } from './ClientFormModal'
import { ClientSummary } from './ClientSummary'
import { buildServiceHistory } from './logic'

type Section = 'demandas' | 'tarefas' | 'atendimentos' | 'historico'

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const { can } = useOrg()
  const q = useClient(id)
  const demands = useClientDemands(id)
  const contracts = useClientContractsCount(id)
  const cats = useCategories()
  const del = useDeleteClient()
  const anon = useAnonymizeClient()

  const [editing, setEditing] = useState(false)
  const [newDemand, setNewDemand] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [blockedDelete, setBlockedDelete] = useState(false)
  const [confirmAnon, setConfirmAnon] = useState(false)
  const [composing, setComposing] = useState(false)
  const [section, setSection] = useState<Section>('demandas')

  const catById = useMemo(() => new Map((cats.data ?? []).map((c) => [c.id, c])), [cats.data])
  const stageName = useMemo(() => {
    const m = new Map<string, string>()
    cats.data?.forEach((c) => c.stages.forEach((s) => m.set(s.id, s.name)))
    return m
  }, [cats.data])
  const history = useMemo(() => buildServiceHistory(demands.data ?? []), [demands.data])

  if (q.isLoading) return <DetailSkeleton />
  if (q.isError || !q.data)
    return (
      <div>
        <BackLink />
        <Card>
          <ErrorState message={q.error ? (q.error as Error).message : 'Cliente não encontrado.'} onRetry={() => q.refetch()} />
        </Card>
      </div>
    )

  const c = q.data
  const anonymized = !!c.anonymized_at
  const demandCount = demands.data?.length ?? 0
  const openCount = demands.data?.filter((d) => d.status !== 'concluida' && d.status !== 'cancelada').length ?? 0
  const contractCount = contracts.data ?? 0
  const hasLinks = demandCount > 0 || contractCount > 0
  const linksKnown = demands.isSuccess && contracts.isSuccess

  const startDelete = () => (linksKnown && hasLinks ? setBlockedDelete(true) : setConfirmDelete(true))

  return (
    <div>
      <BackLink />

      {anonymized && (
        <div role="note" className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-body-sm text-amber-900">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Este cliente foi anonimizado em {formatDateTime(c.anonymized_at)}. Os dados pessoais foram removidos de forma irreversível e o
            cadastro não pode mais ser editado. Demandas, tarefas e o histórico financeiro foram mantidos.
          </span>
        </div>
      )}

      <Card className="mb-4">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-heading font-semibold tracking-[-0.01em] text-ink">{c.full_name}</h1>
              <StatusBadge value={c.status} map={CLIENT_STATUS} />
            </div>
            <p className="mt-0.5 text-label text-ink-subtle">Cliente desde {formatDate(c.created_at)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!anonymized && (
              <Button icon={<MessageSquareText className="size-4" />} onClick={() => setComposing(true)}>
                Mensagem
              </Button>
            )}
            {!anonymized && (
              <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Editar
              </Button>
            )}
            {!anonymized && can('clients.anonymize') && (
              <Button variant="ghost" icon={<EyeOff className="size-4" />} onClick={() => setConfirmAnon(true)}>
                Anonimizar
              </Button>
            )}
            {can('clients.delete') && (
              <Button
                variant="ghost"
                icon={<Trash2 className="size-4" />}
                onClick={startDelete}
                disabled={!linksKnown}
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                Excluir
              </Button>
            )}
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-3 border-t border-line p-4 text-body-sm sm:grid-cols-2 lg:grid-cols-4">
          <Info label="CPF">{c.cpf ? <span className="tabular">{formatCPF(c.cpf)}</span> : null}</Info>
          <Info label="Telefone">{c.phone ? <span className="tabular">{formatPhone(c.phone)}</span> : null}</Info>
          <Info label="E-mail">
            {c.email ? (
              <a href={`mailto:${c.email}`} className="hover:underline">
                {c.email}
              </a>
            ) : null}
          </Info>
          <Info label="Nascimento">{c.birth_date ? formatDate(c.birth_date) : null}</Info>
          <Info label="Endereço" className="sm:col-span-2">
            {c.address}
          </Info>
          <Info label="Observações administrativas" className="sm:col-span-2">
            {c.notes ? <span className="whitespace-pre-wrap">{c.notes}</span> : null}
          </Info>
        </dl>
      </Card>

      {!anonymized && <ClientSummary clientId={c.id} />}

      {!anonymized && <MessageComposerModal open={composing} onClose={() => setComposing(false)} clientId={c.id} />}

      <Tabs<Section>
        value={section}
        onChange={setSection}
        className="mb-4 overflow-x-auto"
        items={[
          { value: 'demandas', label: 'Demandas', count: demands.data ? demandCount : undefined },
          { value: 'tarefas', label: 'Tarefas' },
          { value: 'atendimentos', label: 'Atendimentos' },
          { value: 'historico', label: 'Alterações' },
        ]}
      />

      {section === 'demandas' && (
        <Card>
          <CardHeader
            title="Demandas"
            description={demands.data ? `${openCount} aberta(s) de ${demandCount}` : undefined}
            action={
              !anonymized && (
                <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewDemand(true)}>
                  Nova demanda
                </Button>
              )
            }
          />
          {demands.isLoading ? (
            <Spinner />
          ) : demands.isError ? (
            <ErrorState message={(demands.error as Error).message} onRetry={() => demands.refetch()} />
          ) : !demands.data?.length ? (
            <EmptyState
              icon={<Briefcase className="size-5" />}
              title="Nenhuma demanda para este cliente"
              description={anonymized ? undefined : 'Registre a primeira demanda para acompanhar o atendimento.'}
              action={
                !anonymized && (
                  <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setNewDemand(true)}>
                    Nova demanda
                  </Button>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {demands.data.map((d) => {
                const cat = catById.get(d.category_id)
                return (
                  <li key={d.id}>
                    <Link
                      to={`/demandas/${d.id}`}
                      className="flex flex-col gap-1.5 px-4 py-3 hover:bg-navy-50/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-body font-medium text-ink">{d.title}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-subtle">
                          {cat && <CategoryTag name={cat.name} color={cat.color} />}
                          <span>{d.stage_id ? stageName.get(d.stage_id) ?? '—' : '—'}</span>
                          <span>Aberta em {formatDate(d.opened_at)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge value={d.priority} map={PRIORITY} />
                        <StatusBadge value={d.status} map={DEMAND_STATUS} />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}

      {section === 'tarefas' && (
        <Card>
          <CardHeader title="Tarefas" />
          <CardBody>
            <TaskList clientId={c.id} allowCreate={!anonymized} />
          </CardBody>
        </Card>
      )}

      {section === 'atendimentos' && (
        <Card>
          <CardHeader title="Histórico de atendimentos" description="Demandas abertas e encerradas, da mais recente para a mais antiga." />
          <CardBody>
            {demands.isLoading ? (
              <Spinner />
            ) : demands.isError ? (
              <ErrorState message={(demands.error as Error).message} onRetry={() => demands.refetch()} />
            ) : !history.length ? (
              <EmptyState title="Nenhum atendimento registrado" description="Os atendimentos aparecem aqui conforme as demandas são abertas e encerradas." />
            ) : (
              <ol className="space-y-3">
                {history.map((e) => {
                  const Icon = e.kind === 'opened' ? CircleDot : e.kind === 'concluded' ? CheckCircle2 : XCircle
                  return (
                    <li key={e.key} className="flex items-start gap-3 text-body-sm">
                      <Icon
                        className={cn(
                          'mt-0.5 size-4 shrink-0',
                          e.kind === 'opened' ? 'text-accent-600' : e.kind === 'concluded' ? 'text-emerald-600' : 'text-ink-subtle',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-ink-muted">
                          {e.kind === 'opened' ? 'Demanda aberta' : e.kind === 'concluded' ? 'Demanda concluída' : 'Demanda cancelada'}:{' '}
                        </span>
                        <Link to={`/demandas/${e.demandId}`} className="font-medium text-ink hover:underline">
                          {e.title}
                        </Link>
                      </div>
                      <span className="tabular shrink-0 text-caption text-ink-subtle">{formatDate(e.at)}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </CardBody>
        </Card>
      )}

      {section === 'historico' && (
        <Card>
          <CardHeader title="Histórico de alterações" description="Por privacidade, registra apenas quais campos foram alterados, não os valores." />
          <CardBody>
            <ActivityFeed entityType="clients" entityId={c.id} />
          </CardBody>
        </Card>
      )}

      <ClientFormModal open={editing} onClose={() => setEditing(false)} client={c} />
      <DemandFormModal
        open={newDemand}
        onClose={() => setNewDemand(false)}
        defaults={{ client_id: c.id }}
        onSaved={(d) => navigate(`/demandas/${d.id}`)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Excluir cliente"
        description="O cadastro será excluído permanentemente. Se o cliente tiver demandas ou contratos, o sistema não permitirá a exclusão — nesse caso, use a anonimização."
        confirmLabel="Excluir cliente"
        onConfirm={async () => {
          await del.mutateAsync(c.id)
          toast.show('Cliente excluído.')
          navigate('/clientes', { replace: true })
        }}
      />

      <Modal
        open={blockedDelete}
        onClose={() => setBlockedDelete(false)}
        title="Não é possível excluir"
        size="sm"
        footer={
          <>
            <Button onClick={() => setBlockedDelete(false)}>Fechar</Button>
            {!anonymized && can('clients.anonymize') && (
              <Button
                variant="primary"
                onClick={() => {
                  setBlockedDelete(false)
                  setConfirmAnon(true)
                }}
              >
                Anonimizar cliente
              </Button>
            )}
          </>
        }
      >
        <p className="text-body text-ink-muted">
          Este cliente possui {plural(demandCount, 'demanda', 'demandas')}
          {contractCount > 0 && ` e ${plural(contractCount, 'contrato', 'contratos')}`} vinculados. Para preservar o histórico operacional e
          financeiro do escritório, o cadastro não pode ser excluído.
        </p>
        <p className="mt-2 text-body text-ink-muted">
          {anonymized
            ? 'Os dados pessoais deste cliente já foram removidos por anonimização.'
            : 'Se o objetivo é atender a um pedido de eliminação de dados (LGPD), anonimize o cliente: os dados pessoais são removidos e os vínculos são mantidos.'}
        </p>
      </Modal>

      <ConfirmDialog
        open={confirmAnon}
        onClose={() => setConfirmAnon(false)}
        title="Anonimizar cliente"
        tone="danger"
        confirmLabel="Anonimizar definitivamente"
        description="Nome, CPF, telefone, e-mail, nascimento, endereço e observações serão apagados de forma IRREVERSÍVEL e o cliente passará a constar como “Cliente anonimizado” (status arquivado). Demandas, tarefas, contratos e pagamentos continuam no histórico. Use para atender pedidos de eliminação de dados (LGPD)."
        onConfirm={async () => {
          await anon.mutateAsync(c.id)
          toast.show('Cliente anonimizado.')
        }}
      />
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function Info({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-caption text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{children ?? <span className="text-ink-subtle">—</span>}</dd>
    </div>
  )
}

function BackLink() {
  return (
    <Link to="/clientes" className="mb-3 inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink">
      <ArrowLeft className="size-4" />
      Clientes
    </Link>
  )
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <Skeleton className="mb-4 h-4 w-24" />
      <Skeleton className="mb-4 h-40 w-full" />
      <Skeleton className="mb-4 h-8 w-80" />
      <Skeleton className="h-56 w-full" />
    </div>
  )
}
