import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { Badge, Button, InlineError, Input, Select, Textarea, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { qk, memberName, useCategories, useClientLookup, useMembers } from '@/hooks/useOrgData'
import { supabase, unwrap } from '@/lib/supabase'
import { PRIORITY, toOptions } from '@/lib/constants'
import { usePatchDemand } from '@/features/demands/api'
import type { PriorityLevel } from '@/types/database'
import { matchByName, proposalSummary, type Proposal, type ProposalStatus } from './proposals'

type DemandLite = {
  id: string
  title: string
  client_id: string
  category_id: string
}

interface FormState {
  title: string
  dueDate: string
  clientId: string
  demandId: string
  assigneeId: string
  priority: PriorityLevel
  nextAction: string
  nextActionDate: string
  stageId: string
}

const STATUS_LABEL: Record<ProposalStatus, string> = {
  pendente: 'Pendente',
  confirmada: 'Feita',
  descartada: 'Descartada',
}

const STATUS_TONE: Record<ProposalStatus, 'amber' | 'green' | 'gray'> = {
  pendente: 'amber',
  confirmada: 'green',
  descartada: 'gray',
}

function initialForm(proposal: Proposal): FormState {
  const f = proposal.fields ?? {}
  const priority = f.priority && f.priority in PRIORITY ? (f.priority as PriorityLevel) : 'media'
  return {
    title: f.title ?? '',
    dueDate: f.due_date ?? '',
    clientId: '',
    demandId: '',
    assigneeId: '',
    priority,
    nextAction: f.next_action ?? '',
    nextActionDate: f.next_action_date ?? '',
    stageId: '',
  }
}

/** Cartão de confirmação de uma proposta da IA, abaixo da mensagem do assistente. */
export function ProposalCard({ proposal, messageId }: { proposal: Proposal; messageId: string }) {
  const { orgId, userId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const patchDemand = usePatchDemand()
  const members = useMembers()
  const categories = useCategories()
  const fields = proposal.fields ?? {}
  // A busca do servidor descarta símbolos como parênteses; busca pelo trecho antes do primeiro símbolo
  // e deixa a igualdade exata para o matchByName (nome completo).
  const [clientTerm, setClientTerm] = useState(() => (fields.client ?? '').split(/[^\p{L}\p{N}\s]/u)[0].trim())
  const clients = useClientLookup(clientTerm)
  const [status, setStatus] = useState<ProposalStatus>(proposal.status)
  const [form, setForm] = useState<FormState>(() => initialForm(proposal))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const demands = useQuery({
    queryKey: qk.demands(orgId, 'proposal-card', proposal.id),
    queryFn: async () =>
      (unwrap(
        await supabase
          .from('demands')
          .select('id, title, client_id, category_id, status')
          .eq('organization_id', orgId)
          .not('status', 'in', '(concluida,cancelada)')
          .order('updated_at', { ascending: false })
          .limit(200),
      ) as DemandLite[]) ?? [],
    staleTime: 30_000,
  })

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((s) => ({ ...s, [key]: value }))

  const clientResolved = useRef(false)
  useEffect(() => {
    if (clientResolved.current || !clients.data) return
    clientResolved.current = true
    if (!fields.client) return
    const result = matchByName(
      fields.client,
      clients.data.map((c) => ({ id: c.id, name: c.full_name })),
    )
    if ('id' in result) setForm((s) => (s.clientId ? s : { ...s, clientId: result.id }))
  }, [clients.data, fields.client])

  const demandResolved = useRef(false)
  useEffect(() => {
    if (demandResolved.current || !demands.data) return
    demandResolved.current = true
    if (!fields.demand_title) return
    const result = matchByName(
      fields.demand_title,
      demands.data.map((d) => ({ id: d.id, name: d.title })),
    )
    if ('id' in result) setForm((s) => (s.demandId ? s : { ...s, demandId: result.id }))
  }, [demands.data, fields.demand_title])

  const assigneeResolved = useRef(false)
  useEffect(() => {
    if (assigneeResolved.current || !members.data) return
    assigneeResolved.current = true
    if (!fields.assignee) return
    const result = matchByName(
      fields.assignee,
      members.data.filter((m) => m.active).map((m) => ({ id: m.user_id, name: memberName(m) })),
    )
    if ('id' in result) setForm((s) => (s.assigneeId ? s : { ...s, assigneeId: result.id }))
  }, [members.data, fields.assignee])

  const selectedDemand = demands.data?.find((d) => d.id === form.demandId)
  const selectedCategory = categories.data?.find((c) => c.id === selectedDemand?.category_id)
  const stageFor = useRef<string | null>(null)
  useEffect(() => {
    if (proposal.kind !== 'mover_etapa' || !form.demandId || !categories.data) return
    if (stageFor.current === form.demandId && form.stageId) return
    const demand = demands.data?.find((d) => d.id === form.demandId)
    const category = categories.data.find((c) => c.id === demand?.category_id)
    if (!category || !fields.stage_name) return
    const result = matchByName(
      fields.stage_name,
      category.stages.map((s) => ({ id: s.id, name: s.name })),
    )
    if ('id' in result) {
      setForm((s) => ({ ...s, stageId: result.id }))
      stageFor.current = form.demandId
    }
  }, [proposal.kind, form.demandId, form.stageId, categories.data, demands.data, fields.stage_name])

  const clientUnresolved = !!fields.client && !form.clientId
  const demandUnresolved = !!fields.demand_title && !form.demandId
  const demandRequired = (proposal.kind === 'definir_proxima_acao' || proposal.kind === 'mover_etapa') && !form.demandId
  const stageRequired = proposal.kind === 'mover_etapa' && !form.stageId
  const titleMissing = proposal.kind === 'criar_tarefa' && !form.title.trim()
  const actionMissing = proposal.kind === 'definir_proxima_acao' && !form.nextAction.trim()
  // Criar/editar tarefas e demandas é permitido a todos os membros (RLS 'all'); o banco decide.
  const permitted = !!userId
  const canConfirm =
    permitted &&
    !saving &&
    !clientUnresolved &&
    !demandUnresolved &&
    !demandRequired &&
    !stageRequired &&
    !titleMissing &&
    !actionMissing

  const registrar = async (nextStatus: 'confirmada' | 'descartada', entity?: string) => {
    const args = entity
      ? { p_message: messageId, p_proposal: proposal.id, p_status: nextStatus, p_entity: entity }
      : { p_message: messageId, p_proposal: proposal.id, p_status: nextStatus }
    unwrap(await supabase.rpc('ai_proposal_done', args))
  }

  const invalidateAfterWrite = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.tasks(orgId) }),
      qc.invalidateQueries({ queryKey: qk.demands(orgId) }),
      qc.invalidateQueries({ queryKey: qk.dashboard(orgId) }),
      qc.invalidateQueries({ queryKey: qk.activity(orgId) }),
      qc.invalidateQueries({ queryKey: ['agenda', orgId] }),
      qc.invalidateQueries({ queryKey: qk.ai(orgId) }),
    ])
  }

  const confirm = async () => {
    if (!canConfirm) return
    setSaving(true)
    setError(null)
    try {
      let entity: string
      if (proposal.kind === 'criar_tarefa') {
        const saved = unwrap(
          await supabase
            .from('tasks')
            .insert({
              title: form.title.trim(),
              description: null,
              client_id: form.clientId || null,
              demand_id: form.demandId || null,
              assignee_id: form.assigneeId || null,
              due_date: form.dueDate || null,
              priority: form.priority,
              status: 'pendente',
              organization_id: orgId,
              created_by: userId,
            })
            .select('*')
            .single(),
        ) as { id: string }
        entity = saved.id
      } else if (proposal.kind === 'definir_proxima_acao') {
        unwrap(
          await supabase
            .from('demands')
            .update({ next_action: form.nextAction.trim(), next_action_date: form.nextActionDate || null })
            .eq('organization_id', orgId)
            .eq('id', form.demandId)
            .select('*')
            .single(),
        )
        entity = form.demandId
      } else {
        const updated = (await patchDemand.mutateAsync({ id: form.demandId, patch: { stage_id: form.stageId } })) as
          | { id?: string }
          | undefined
        entity = updated?.id ?? form.demandId
      }
      await registrar('confirmada', entity)
      setStatus('confirmada')
      await invalidateAfterWrite()
      toast.show('Feito.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível confirmar a proposta.')
    } finally {
      setSaving(false)
    }
  }

  const discard = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await registrar('descartada')
      setStatus('descartada')
      await qc.invalidateQueries({ queryKey: qk.ai(orgId) })
      toast.show('Proposta descartada.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível descartar a proposta.')
    } finally {
      setSaving(false)
    }
  }

  const demandOptions = (demands.data ?? [])
    .filter((d) => !form.clientId || d.client_id === form.clientId)
    .map((d) => ({ value: d.id, label: d.title }))
  const stageOptions = (selectedCategory?.stages ?? []).map((s) => ({ value: s.id, label: s.name }))
  const memberOptions = members.data
    ?.filter((m) => m.active)
    .map((m) => ({ value: m.user_id, label: memberName(m) })) ?? []

  const warnings: string[] = []
  if (clientUnresolved && fields.client) warnings.push(fields.client)
  if ((demandUnresolved || demandRequired) && fields.demand_title) warnings.push(fields.demand_title)
  if (stageRequired && fields.stage_name) warnings.push(fields.stage_name)

  return (
    <section className="rounded-lg border border-line bg-canvas/60 p-3 shadow-[0_1px_1px_rgb(15_23_42/0.03)] sm:p-4" aria-label="Proposta da IA">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-accent-600" />
        <h3 className="text-[13px] font-semibold text-ink">Proposta da IA — confira antes de gravar</h3>
        <Badge tone={STATUS_TONE[status]} className="ml-auto">
          {STATUS_LABEL[status]}
        </Badge>
      </div>

      {status !== 'pendente' ? (
        <p className="mt-2 text-[13px] text-ink-muted">{proposalSummary(proposal)}</p>
      ) : (
        <>
          <p className="mt-1.5 text-[12.5px] text-ink-muted">{proposalSummary(proposal)}</p>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {proposal.kind === 'criar_tarefa' && (
              <>
                <Input label="Título" required maxLength={160} value={form.title} onChange={(e) => set('title', e.target.value)} />
                <Input label="Prazo" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
                <Input
                  wrapperClassName="sm:col-span-2"
                  aria-label="Buscar por nome ou CPF"
                  placeholder="Buscar cliente por nome ou CPF"
                  value={clientTerm}
                  onChange={(e) => setClientTerm(e.target.value)}
                />
                <Select
                  label="Cliente"
                  value={form.clientId}
                  onChange={(e) => setForm((s) => ({ ...s, clientId: e.target.value, demandId: '' }))}
                  options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.full_name }))}
                  placeholder={clients.isLoading ? 'Carregando…' : 'Sem cliente'}
                />
                <Select
                  label="Demanda"
                  value={form.demandId}
                  onChange={(e) => set('demandId', e.target.value)}
                  options={demandOptions}
                  placeholder={demands.isLoading ? 'Carregando…' : 'Sem demanda'}
                />
                <Select
                  label="Responsável"
                  value={form.assigneeId}
                  onChange={(e) => set('assigneeId', e.target.value)}
                  options={memberOptions}
                  placeholder="Sem responsável"
                />
                <Select
                  label="Prioridade"
                  value={form.priority}
                  onChange={(e) => set('priority', e.target.value as PriorityLevel)}
                  options={toOptions(PRIORITY)}
                />
              </>
            )}

            {proposal.kind === 'definir_proxima_acao' && (
              <>
                <Select
                  label="Demanda"
                  required
                  value={form.demandId}
                  onChange={(e) => set('demandId', e.target.value)}
                  options={demandOptions}
                  placeholder={demands.isLoading ? 'Carregando…' : 'Selecione a demanda'}
                />
                <Input
                  label="Data"
                  type="date"
                  value={form.nextActionDate}
                  onChange={(e) => set('nextActionDate', e.target.value)}
                />
                <Textarea
                  wrapperClassName="sm:col-span-2"
                  label="Próxima ação"
                  required
                  maxLength={300}
                  value={form.nextAction}
                  onChange={(e) => set('nextAction', e.target.value)}
                />
              </>
            )}

            {proposal.kind === 'mover_etapa' && (
              <>
                <Select
                  label="Demanda"
                  required
                  value={form.demandId}
                  onChange={(e) => set('demandId', e.target.value)}
                  options={demandOptions}
                  placeholder={demands.isLoading ? 'Carregando…' : 'Selecione a demanda'}
                />
                <Select
                  label="Etapa"
                  required
                  value={form.stageId}
                  onChange={(e) => set('stageId', e.target.value)}
                  options={stageOptions}
                  placeholder={selectedCategory ? 'Selecione a etapa' : 'Escolha a demanda primeiro'}
                  disabled={!selectedCategory}
                />
              </>
            )}
          </div>

          {warnings.map((name, index) => (
            <p
              key={`${index}-${name}`}
              className="mt-2 flex items-start gap-1.5 text-[12px] text-amber-800"
              role="status"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>Confira: a IA citou “{name}”. Escolha o item correto no campo.</span>
            </p>
          ))}

          {!permitted && (
            <p className="mt-2 flex items-start gap-1.5 text-[12px] text-amber-800" role="status">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>Seu perfil não tem permissão para confirmar esta proposta.</span>
            </p>
          )}

          {error && (
            <div className="mt-3">
              <InlineError message={error} />
            </div>
          )}

          <p className="mt-3 text-[11.5px] text-ink-subtle">Sugestão gerada por IA. Nada foi gravado ainda.</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={confirm}
              disabled={!canConfirm}
              loading={saving}
              className="h-11 min-w-28 sm:h-9"
            >
              Confirmar
            </Button>
            <Button onClick={discard} disabled={saving} className="h-11 min-w-28 sm:h-9">
              Descartar
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
