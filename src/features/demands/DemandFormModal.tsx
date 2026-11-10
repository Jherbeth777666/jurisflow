// CONTRATO DE INTERFACE (implementação pelo agente de clientes/demandas).
// Usado também pelo Kanban (fluxos) e pela ficha do cliente.
import { useMemo, useState, type FormEvent } from 'react'
import { Button, Input, InlineError, Modal, Select, Spinner, Textarea, useToast } from '@/components/ui'
import { ClientPicker } from '@/components/ClientPicker'
import { useCategories, useMemberNames } from '@/hooks/useOrgData'
import { DEMAND_STATUS, PRIORITY, toOptions } from '@/lib/constants'
import { todayISO } from '@/lib/format'
import type { Demand, DemandStatus, PriorityLevel } from '@/types/database'
import { useSaveDemand } from './api'
import { validateDemandForm, type DemandFormErrors, type DemandFormValues } from './logic'

export interface DemandFormModalProps {
  open: boolean
  onClose: () => void
  /** Demanda existente para edição; ausente = criação */
  demand?: Demand | null
  /** Valores iniciais na criação (ex.: cliente vindo da ficha, categoria/etapa vinda do Kanban) */
  defaults?: Partial<Pick<Demand, 'client_id' | 'category_id' | 'stage_id'>>
  onSaved?: (demand: Demand) => void
}

function initialValues(demand: Demand | null | undefined, defaults: DemandFormModalProps['defaults']): DemandFormValues {
  if (demand) {
    return {
      client_id: demand.client_id,
      category_id: demand.category_id,
      stage_id: demand.stage_id ?? '',
      title: demand.title,
      description: demand.description ?? '',
      responsible_id: demand.responsible_id ?? '',
      opened_at: demand.opened_at,
      priority: demand.priority,
      status: demand.status,
      next_action: demand.next_action ?? '',
      next_action_date: demand.next_action_date ?? '',
      notes: demand.notes ?? '',
    }
  }
  return {
    client_id: defaults?.client_id ?? '',
    category_id: defaults?.category_id ?? '',
    stage_id: defaults?.stage_id ?? '',
    title: '',
    description: '',
    responsible_id: '',
    opened_at: todayISO(),
    priority: 'media',
    status: 'em_andamento',
    next_action: '',
    next_action_date: '',
    notes: '',
  }
}

/** Monta o formulário só quando aberto: o estado inicial vem de demand/defaults a cada abertura. */
export function DemandFormModal(props: DemandFormModalProps) {
  return props.open ? <DemandFormModalInner key={props.demand?.id ?? 'new'} {...props} /> : null
}

function DemandFormModalInner({ open, onClose, demand, defaults, onSaved }: DemandFormModalProps) {
  const toast = useToast()
  const save = useSaveDemand()
  const cats = useCategories()
  const members = useMemberNames()
  const [values, setValues] = useState<DemandFormValues>(() => initialValues(demand, defaults))
  const [errors, setErrors] = useState<DemandFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  // Categorias ativas; na edição mantém a categoria atual mesmo se tiver sido desativada.
  const categoryOptions = useMemo(
    () =>
      (cats.data ?? [])
        .filter((c) => c.active || c.id === demand?.category_id)
        .map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (inativa)` })),
    [cats.data, demand?.category_id],
  )
  const category = cats.data?.find((c) => c.id === values.category_id)
  const stageOptions = (category?.stages ?? []).map((s) => ({ value: s.id, label: s.name }))

  // Etapa efetiva: a escolhida, se pertencer à categoria; senão a 1ª etapa da categoria.
  const stageId = category?.stages.some((st) => st.id === values.stage_id) ? values.stage_id : (category?.stages[0]?.id ?? '')

  // Responsáveis ativos + o atual (caso tenha sido desativado).
  const responsibleOptions = useMemo(() => {
    const opts = [...members.options]
    if (values.responsible_id && !opts.some((o) => o.value === values.responsible_id)) {
      opts.push({ value: values.responsible_id, label: `${members.map.get(values.responsible_id) ?? 'Usuário'} (inativo)` })
    }
    return opts
  }, [members.options, members.map, values.responsible_id])

  const set = <K extends keyof DemandFormValues>(key: K, value: DemandFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const changeCategory = (id: string) => {
    const cat = cats.data?.find((c) => c.id === id)
    setValues((v) => ({ ...v, category_id: id, stage_id: cat?.stages[0]?.id ?? '' }))
    if (errors.category_id) setErrors((e) => ({ ...e, category_id: undefined }))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const errs = validateDemandForm(values)
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    try {
      const saved = await save.mutateAsync({ id: demand?.id, values: { ...values, stage_id: stageId } })
      toast.show(demand ? 'Demanda atualizada.' : 'Demanda criada.')
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível salvar a demanda.')
    }
  }

  const selectedStage = category?.stages.find((s) => s.id === stageId)
  const loadingRefs = cats.isLoading || members.isLoading

  return (
    <Modal
      open={open}
      onClose={save.isPending ? () => {} : onClose}
      title={demand ? 'Editar demanda' : 'Nova demanda'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="demand-form" loading={save.isPending} disabled={loadingRefs}>
            {demand ? 'Salvar alterações' : 'Criar demanda'}
          </Button>
        </>
      }
    >
      {loadingRefs ? (
        <Spinner />
      ) : cats.isError ? (
        <InlineError message={`Não foi possível carregar as categorias: ${(cats.error as Error).message}`} />
      ) : (
        <form id="demand-form" onSubmit={submit} noValidate className="space-y-4">
          <ClientPicker
            required
            value={values.client_id || null}
            onChange={(id) => set('client_id', id ?? '')}
            error={errors.client_id}
            disabled={!!demand}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Categoria"
              required
              options={categoryOptions}
              placeholder="Selecione"
              value={values.category_id}
              onChange={(e) => changeCategory(e.target.value)}
              error={errors.category_id}
            />
            <Select
              label="Etapa"
              options={stageOptions}
              disabled={!category || !stageOptions.length}
              placeholder={category ? (stageOptions.length ? undefined : 'Categoria sem etapas') : 'Escolha a categoria'}
              value={stageId}
              onChange={(e) => set('stage_id', e.target.value)}
              hint={selectedStage?.is_final ? 'Etapa final: a demanda será marcada como concluída.' : undefined}
            />
          </div>

          <Input
            label="Título"
            required
            maxLength={160}
            placeholder="Ex.: Pedido de salário-maternidade"
            value={values.title}
            onChange={(e) => set('title', e.target.value)}
            error={errors.title}
          />

          <Textarea
            label="Descrição"
            rows={3}
            maxLength={4000}
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            error={errors.description}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Responsável"
              options={responsibleOptions}
              placeholder="Sem responsável"
              value={values.responsible_id}
              onChange={(e) => set('responsible_id', e.target.value)}
            />
            <Input
              label="Data de abertura"
              type="date"
              required
              max={todayISO()}
              value={values.opened_at}
              onChange={(e) => set('opened_at', e.target.value)}
              error={errors.opened_at}
            />
            <Select
              label="Prioridade"
              options={toOptions(PRIORITY)}
              value={values.priority}
              onChange={(e) => set('priority', e.target.value as PriorityLevel)}
            />
            <Select
              label="Status"
              options={toOptions(DEMAND_STATUS)}
              value={values.status}
              onChange={(e) => set('status', e.target.value as DemandStatus)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <Input
              label="Próxima atividade"
              maxLength={300}
              placeholder="Ex.: Ligar para cliente pedindo CNIS"
              value={values.next_action}
              onChange={(e) => set('next_action', e.target.value)}
              error={errors.next_action}
            />
            <Input
              label="Data da atividade"
              type="date"
              value={values.next_action_date}
              onChange={(e) => set('next_action_date', e.target.value)}
              error={errors.next_action_date}
            />
          </div>

          <Textarea
            label="Observações"
            rows={2}
            maxLength={4000}
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            error={errors.notes}
          />

          <InlineError message={formError} />
        </form>
      )}
    </Modal>
  )
}
