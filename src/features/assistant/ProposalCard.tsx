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

/** Maior trecho do nome sem símbolos (a busca do servidor troca símbolos por espaço). */
function lookupTerm(name: string): string {
  return name
    .split(/[^\p{L}\p{N}\s]/u)
    .map((part) => part.trim())
    .reduce((best, part) => (part.length > best.length ? part : best), '')
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
  // A busca do servidor descarta símbolos como parênteses; busca pelo maior trecho sem símbolos
  // e deixa a igualdade exata para o matchByName (nome completo).
  const [clientTerm, setClientTerm] = useState(() => lookupTerm(fields.client ?? ''))
  const clients = useClientLookup(clientTerm)
  const [status, setStatus] = useState<ProposalStatus>(proposal.status)
  const [form, setForm] = useState<FormState>(() => initialForm(proposal))
  const [clientDecided, setClientDecided] = useState(false)
  const [demandDecided, setDemandDecided] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Id já gravado na tabela normal; a partir daí só falta registrar a confirmação.
  const [writtenId, setWrittenId] = useState<string | null>(null)

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

  // A resolução por título pode ser refeita enquanto o usuário não tiver escolhido a demanda.
  // Em criar_tarefa (há seletor de cliente) o cliente filtra as opções; nos demais tipos o
  // cliente citado só desempata títulos iguais entre demandas de clientes diferentes.
  useEffect(() => {
    if (!demands.data || demandDecided) return
    if (!fields.demand_title) return
    // Se a IA citou um cliente, espera a busca para poder desempatar pelo cliente.
    if (fields.client && clients.data === undefined) return
    const filterByClient = proposal.kind === 'criar_tarefa'
    const pool = filterByClient && form.clientId ? demands.data.filter((d) => d.client_id === form.clientId) : demands.data
    let result = matchByName(
      fields.demand_title,
      pool.map((d) => ({ id: d.id, name: d.title })),
    )
    if (!filterByClient && 'candidates' in result && form.clientId) {
      // Desempata pelo cliente apenas entre títulos de igualdade exata (parciais nunca decidem sozinhas).
      const preferred = result.candidates.filter(
        (c) =>
          demands.data?.find((d) => d.id === c.id)?.client_id === form.clientId &&
          'id' in matchByName(fields.demand_title, [c]),
      )
      if (preferred.length === 1) result = { id: preferred[0].id }
    }
    setForm((s) => {
      if ('id' in result) return s.demandId === result.id ? s : { ...s, demandId: result.id }
      return s.demandId ? { ...s, demandId: '' } : s
    })
  }, [demands.data, fields.demand_title, fields.client, clients.data, form.clientId, demandDecided, proposal.kind])

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
    if (proposal.kind !== 'mover_etapa' || !form.demandId || !categories.data || !demands.data) return
    if (stageFor.current === form.demandId) return
    const demand = demands.data.find((d) => d.id === form.demandId)
    if (!demand) return
    stageFor.current = form.demandId
    const category = categories.data.find((c) => c.id === demand.category_id)
    if (!category || !fields.stage_name) {
      setForm((s) => (s.stageId ? { ...s, stageId: '' } : s))
      return
    }
    const result = matchByName(
      fields.stage_name,
      category.stages.map((s) => ({ id: s.id, name: s.name })),
    )
    setForm((s) => {
      if ('id' in result) return s.stageId === result.id ? s : { ...s, stageId: result.id }
      return s.stageId ? { ...s, stageId: '' } : s
    })
  }, [proposal.kind, form.demandId, categories.data, demands.data, fields.stage_name])

  // Cliente e demanda só são exigidos em criar_tarefa, e apenas até o usuário decidir o campo
  // citado (inclusive escolhendo "Sem cliente"/"Sem demanda"). Nos demais tipos não há seletor
  // de cliente; o cliente citado serve só para filtrar as demandas.
  const clientUnresolved = proposal.kind === 'criar_tarefa' && !!fields.client && !form.clientId
  const demandUnresolved = !!fields.demand_title && !form.demandId
  const demandPending =
    proposal.kind === 'criar_tarefa' && !!fields.demand_title && !form.demandId && !demandDecided
  const demandRequired = (proposal.kind === 'definir_proxima_acao' || proposal.kind === 'mover_etapa') && !form.demandId
  const stageRequired = proposal.kind === 'mover_etapa' && !form.stageId
  const titleMissing = proposal.kind === 'criar_tarefa' && !form.title.trim()
  const actionMissing = proposal.kind === 'definir_proxima_acao' && !form.nextAction.trim()
  // Enquanto só falta registrar a confirmação, os campos ficam travados com o que já foi gravado.
  const written = writtenId !== null
  const fieldsValid =
    !(clientUnresolved && !clientDecided) &&
    !demandPending &&
    !demandRequired &&
    !stageRequired &&
    !titleMissing &&
    !actionMissing
  // Criar/editar tarefas e demandas é permitido a todos os membros (RLS 'all'); o banco decide.
  const permitted = !!userId
  const canConfirm = permitted && !saving && (written || fieldsValid)

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

  const changeClient = (value: string) => {
    const current = demands.data?.find((d) => d.id === form.demandId)
    const keepDemand = !!current && (!value || current.client_id === value)
    setForm((s) => ({ ...s, clientId: value, demandId: keepDemand ? s.demandId : '' }))
    setClientDecided(true)
    if (!keepDemand) setDemandDecided(false)
  }

  const changeDemand = (value: string) => {
    setForm((s) => ({ ...s, demandId: value, ...(proposal.kind === 'mover_etapa' ? { stageId: '' } : {}) }))
    setDemandDecided(true)
    if (proposal.kind === 'mover_etapa') stageFor.current = null
  }

  const confirm = async () => {
    if (!canConfirm) return
    setSaving(true)
    setError(null)
    try {
      let entity = writtenId
      if (!entity) {
        if (proposal.kind === 'criar_tarefa') {
          const saved = unwrap(
            await supabase
              .from('tasks')
              .insert({
                title: form.title.trim(),
                description: null,
                client_id: form.clientId || selectedDemand?.client_id || null,
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
        setWrittenId(entity)
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

  // Só criar_tarefa filtra as opções pelo cliente (há seletor); nos demais tipos todas as
  // demandas abertas ficam disponíveis e o cliente citado serve apenas para desempatar.
  const demandOptions = (demands.data ?? [])
    .filter((d) => proposal.kind !== 'criar_tarefa' || !form.clientId || d.client_id === form.clientId)
    .map((d) => ({ value: d.id, label: d.title }))
  const stageOptions = (selectedCategory?.stages ?? []).map((s) => ({ value: s.id, label: s.name }))
  const memberOptions = members.data
    ?.filter((m) => m.active)
    .map((m) => ({ value: m.user_id, label: memberName(m) })) ?? []

  const warnings: string[] = []
  if (clientUnresolved && fields.client) warnings.push(fields.client)
  if ((demandUnresolved || demandRequired) && fields.demand_title) warnings.push(fields.demand_title)
  if (stageRequired && fields.stage_name) warnings.push(fields.stage_name)
  if (proposal.kind === 'criar_tarefa' && fields.assignee && !form.assigneeId) warnings.push(fields.assignee)

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

          <fieldset
            disabled={written}
            className="mt-3 grid min-w-0 grid-cols-1 gap-3 border-0 p-0 sm:grid-cols-2"
          >
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
                  onChange={(e) => changeClient(e.target.value)}
                  options={(clients.data ?? []).map((c) => ({ value: c.id, label: c.full_name }))}
                  placeholder={clients.isLoading ? 'Carregando…' : 'Sem cliente'}
                />
                <Select
                  label="Demanda"
                  value={form.demandId}
                  onChange={(e) => changeDemand(e.target.value)}
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
                  onChange={(e) => changeDemand(e.target.value)}
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
                  onChange={(e) => changeDemand(e.target.value)}
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
          </fieldset>

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

          <p className="mt-3 text-[11.5px] text-ink-subtle">
            {written
              ? 'Dados gravados. Só falta registrar a confirmação.'
              : 'Sugestão gerada por IA. Nada foi gravado ainda.'}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={confirm}
              disabled={!canConfirm}
              loading={saving}
              className="h-11 min-w-28 sm:h-9"
            >
              {written ? 'Tentar registrar de novo' : 'Confirmar'}
            </Button>
            {!written && (
              <Button onClick={discard} disabled={saving} className="h-11 min-w-28 sm:h-9">
                Descartar
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
