// CONTRATO DE INTERFACE (implementação pelo agente de fluxos/tarefas).
// Usado também na ficha da demanda e do cliente.
import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, InlineError, Input, Modal, Select, Textarea, useToast } from '@/components/ui'
import { ClientPicker } from '@/components/ClientPicker'
import { qk, useMemberNames } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { supabase, unwrap } from '@/lib/supabase'
import { PRIORITY, TASK_STATUS, toOptions } from '@/lib/constants'
import type { Demand, PriorityLevel, Task, TaskStatus } from '@/types/database'
import { invalidateTaskData } from './api'

export interface TaskFormModalProps {
  open: boolean
  onClose: () => void
  task?: Task | null
  defaults?: Partial<Pick<Task, 'client_id' | 'demand_id' | 'assignee_id'>>
  onSaved?: (task: Task) => void
}

interface FormState {
  title: string
  description: string
  client_id: string | null
  demand_id: string
  assignee_id: string
  due_date: string
  priority: PriorityLevel
  status: TaskStatus
}

type DemandOption = Pick<Demand, 'id' | 'title' | 'client_id' | 'status'> & { client: { full_name: string } | null }

export function TaskFormModal(props: TaskFormModalProps) {
  // O formulário só existe enquanto aberto; a chave recria o estado a cada abertura/tarefa
  // (sem efeito de "reiniciar" que sobrescreve o que o usuário fez).
  if (!props.open) return null
  return <TaskFormModalBody key={props.task?.id ?? 'nova'} {...props} />
}

function TaskFormModalBody({ open, onClose, task, defaults, onSaved }: TaskFormModalProps) {
  const { orgId, userId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const members = useMemberNames()
  const isEdit = !!task

  const initial = (): FormState => ({
    title: task?.title ?? '',
    description: task?.description ?? '',
    client_id: task ? task.client_id : (defaults?.client_id ?? null),
    demand_id: (task ? task.demand_id : defaults?.demand_id) ?? '',
    assignee_id: (task ? task.assignee_id : (defaults?.assignee_id ?? userId)) ?? '',
    due_date: task?.due_date ?? '',
    priority: task?.priority ?? 'media',
    status: task?.status ?? 'pendente',
  })

  const [start] = useState<FormState>(initial)
  const [form, setForm] = useState<FormState>(start)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Demanda cujo cliente pode ser preenchido automaticamente (a que veio pronta, sem
  // cliente). Quando o usuário mexe no cliente ("Limpar cliente"), isso é desligado.
  const [autoClientFor, setAutoClientFor] = useState<string | null>(start.client_id ? null : start.demand_id || null)
  const dirty = JSON.stringify(form) !== JSON.stringify(start)

  const close = () => {
    if (!saving) onClose()
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))

  // Demandas abertas do cliente escolhido; sem cliente, as mais recentes do escritório.
  const demands = useQuery({
    queryKey: qk.demands(orgId, 'task-picker', form.client_id ?? 'all'),
    enabled: open,
    queryFn: async () => {
      let q = supabase
        .from('demands')
        .select('id, title, client_id, status, client:clients(full_name)')
        .eq('organization_id', orgId)
        .not('status', 'in', '(concluida,cancelada)')
        .order('updated_at', { ascending: false })
        .limit(form.client_id ? 100 : 50)
      if (form.client_id) q = q.eq('client_id', form.client_id)
      return unwrap(await q) as unknown as DemandOption[]
    },
    staleTime: 30_000,
  })

  // Garante que a demanda já vinculada (mesmo encerrada) apareça no select.
  const linked = useQuery({
    queryKey: qk.demands(orgId, 'task-picker-linked', form.demand_id),
    enabled: open && !!form.demand_id && !!demands.data && !demands.data.some((d) => d.id === form.demand_id),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('demands')
          .select('id, title, client_id, status, client:clients(full_name)')
          .eq('organization_id', orgId)
          .eq('id', form.demand_id)
          .single(),
      ) as unknown as DemandOption,
  })

  const demandList: DemandOption[] = [...(demands.data ?? [])]
  if (linked.data && !demandList.some((d) => d.id === linked.data.id)) demandList.unshift(linked.data)
  // Demanda informada sem cliente (ex.: vinda da ficha da demanda) → usa o cliente dela,
  // derivado na renderização (sem efeito): "Limpar cliente" desliga e não é repreenchido.
  const inferredClient =
    !form.client_id && form.demand_id && form.demand_id === autoClientFor
      ? (demandList.find((d) => d.id === form.demand_id)?.client_id ?? null)
      : null
  const clientId = form.client_id ?? inferredClient

  const demandOptions = demandList.map((d) => ({
    value: d.id,
    label: form.client_id ? d.title : `${d.title} — ${d.client?.full_name ?? 'cliente'}`,
  }))

  const assigneeOptions = [...members.options]
  if (form.assignee_id && !assigneeOptions.some((o) => o.value === form.assignee_id)) {
    assigneeOptions.push({ value: form.assignee_id, label: `${members.map.get(form.assignee_id) ?? 'Membro'} (inativo)` })
  }

  const validate = () => {
    const e: Partial<Record<keyof FormState, string>> = {}
    const t = form.title.trim()
    if (t.length < 2) e.title = 'Informe um título com pelo menos 2 caracteres.'
    else if (t.length > 160) e.title = 'Use no máximo 160 caracteres.'
    if (form.description.length > 4000) e.description = 'Use no máximo 4.000 caracteres.'
    if (form.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.due_date)) e.due_date = 'Data inválida.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!validate()) return
    setSaving(true)
    setError(null)
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      client_id: clientId,
      demand_id: form.demand_id || null,
      assignee_id: form.assignee_id || null,
      due_date: form.due_date || null,
      priority: form.priority,
      status: form.status,
    }
    try {
      const saved = isEdit
        ? (unwrap(
            await supabase.from('tasks').update(payload).eq('id', task!.id).eq('organization_id', orgId).select('*').single(),
          ) as Task)
        : (unwrap(
            await supabase
              .from('tasks')
              .insert({ ...payload, organization_id: orgId, created_by: userId })
              .select('*')
              .single(),
          ) as Task)
      // Atualiza listas em segundo plano: o modal fecha sem esperar as consultas.
      void invalidateTaskData(qc, orgId)
      toast.show(isEdit ? 'Tarefa atualizada.' : 'Tarefa criada.')
      setSaving(false)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar a tarefa.')
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      dirty={dirty || saving}
      title={isEdit ? 'Editar tarefa' : 'Nova tarefa'}
      size="lg"
      footer={
        <>
          <Button onClick={close} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="task-form" loading={saving}>
            {isEdit ? 'Salvar alterações' : 'Criar tarefa'}
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          wrapperClassName="sm:col-span-2"
          label="Título"
          required
          maxLength={160}
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          error={errors.title}
          placeholder="Ex.: Solicitar CNIS atualizado"
        />
        <Textarea
          wrapperClassName="sm:col-span-2"
          label="Descrição"
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          error={errors.description}
        />
        <ClientPicker
          label="Cliente (opcional)"
          value={clientId}
          onChange={(id) => {
            setAutoClientFor(null)
            setForm((f) => ({ ...f, client_id: id, demand_id: id && id === clientId ? f.demand_id : '' }))
          }}
        />
        <div className="flex flex-col gap-1">
          <Select
            label="Demanda (opcional)"
            value={form.demand_id}
            onChange={(e) => {
              const id = e.target.value
              const d = demandList.find((x) => x.id === id)
              setForm((f) => ({ ...f, demand_id: id, client_id: d ? d.client_id : f.client_id }))
            }}
            options={demandOptions}
            placeholder={demands.isLoading ? 'Carregando…' : 'Nenhuma'}
            hint={
              demands.isError
                ? 'Não foi possível carregar as demandas.'
                : form.client_id
                  ? demandOptions.length === 0 && !demands.isLoading
                    ? 'Este cliente não tem demandas abertas.'
                    : 'Demandas abertas do cliente.'
                  : 'Escolher a demanda preenche o cliente.'
            }
          />
          {clientId && (
            <button
              type="button"
              className="self-start text-[12px] text-accent-700 hover:underline"
              onClick={() => {
                setAutoClientFor(null)
                set('client_id', null)
              }}
            >
              Limpar cliente
            </button>
          )}
        </div>
        <Select
          label="Responsável"
          value={form.assignee_id}
          onChange={(e) => set('assignee_id', e.target.value)}
          options={assigneeOptions}
          placeholder="Sem responsável"
        />
        <Input
          label="Vencimento"
          type="date"
          value={form.due_date}
          onChange={(e) => set('due_date', e.target.value)}
          error={errors.due_date}
        />
        <Select
          label="Prioridade"
          value={form.priority}
          onChange={(e) => set('priority', e.target.value as PriorityLevel)}
          options={toOptions(PRIORITY)}
        />
        <Select
          label="Status"
          value={form.status}
          onChange={(e) => set('status', e.target.value as TaskStatus)}
          options={toOptions(TASK_STATUS)}
        />
        {error && (
          <div className="sm:col-span-2">
            <InlineError message={error} />
          </div>
        )}
      </form>
    </Modal>
  )
}
