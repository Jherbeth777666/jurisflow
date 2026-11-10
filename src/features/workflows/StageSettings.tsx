// Aba "Configurar etapas": categorias (criar/renomear/cor/ativar) e etapas (criar/editar/reordenar/excluir).
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, ArrowDown, ArrowUp, Check, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  InlineError,
  Input,
  Modal,
  Select,
  Spinner,
  useToast,
} from '@/components/ui'
import { qk, type CategoryWithStages } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import type { WorkflowStage } from '@/types/database'
import {
  CATEGORY_COLORS,
  DEFAULT_STAGES,
  countDemandsInStage,
  createCategory,
  createStage,
  deleteStage,
  invalidateWorkflow,
  updateCategory,
  updateStage,
  useReorderStages,
} from './api'
import { useStableClose } from './useStableClose'

export function StageSettings({
  categories,
  categoryId,
  onCategoryChange,
}: {
  categories: CategoryWithStages[]
  categoryId: string | null
  onCategoryChange: (id: string) => void
}) {
  const { can } = useOrg()
  const canManage = can('workflows.manage')
  const [categoryModal, setCategoryModal] = useState<{ mode: 'create' } | { mode: 'edit'; category: CategoryWithStages } | null>(null)
  const category = categories.find((c) => c.id === categoryId) ?? categories[0] ?? null
  const closeCategoryModal = useCallback(() => setCategoryModal(null), [])

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader
          title="Categorias"
          action={
            canManage && (
              <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCategoryModal({ mode: 'create' })}>
                Nova
              </Button>
            )
          }
        />
        {categories.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-ink-muted">Nenhuma categoria cadastrada.</p>
        ) : (
          <ul className="p-1.5" role="list">
            {categories.map((c) => {
              const selected = c.id === category?.id
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={selected || undefined}
                    onClick={() => onCategoryChange(c.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors',
                      selected ? 'bg-navy-50 font-medium text-ink' : 'text-ink-muted hover:bg-navy-50/60 hover:text-ink',
                    )}
                  >
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: c.color }} aria-hidden />
                    <span className={cn('min-w-0 flex-1 truncate', !c.active && 'line-through decoration-ink-subtle')}>{c.name}</span>
                    {!c.active ? <Badge>Inativa</Badge> : <span className="tabular text-[11.5px] text-ink-subtle">{c.stages.length}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {category ? (
        <CategoryStages
          key={category.id}
          category={category}
          canManage={canManage}
          onEditCategory={() => setCategoryModal({ mode: 'edit', category })}
        />
      ) : (
        <Card>
          <EmptyState
            title="Nenhuma categoria"
            description={canManage ? 'Crie uma categoria para definir as etapas do fluxo.' : 'Peça a um administrador ou advogado para criar categorias.'}
            action={
              canManage && (
                <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setCategoryModal({ mode: 'create' })}>
                  Nova categoria
                </Button>
              )
            }
          />
        </Card>
      )}

      <CategoryFormModal
        state={categoryModal}
        nextSortOrder={categories.reduce((m, c) => Math.max(m, c.sort_order), 0) + 1}
        onClose={closeCategoryModal}
        onCreated={(id) => onCategoryChange(id)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function CategoryStages({
  category,
  canManage,
  onEditCategory,
}: {
  category: CategoryWithStages
  canManage: boolean
  onEditCategory: () => void
}) {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const reorder = useReorderStages()
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState<WorkflowStage | null>(null)
  const closeDelete = useCallback(() => setDeleting(null), [])
  const stages = category.stages
  const ids = stages.map((s) => s.id)
  const hasFinal = stages.some((s) => s.is_final)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const applyOrder = (next: string[]) => reorder.mutate({ categoryId: category.id, ids: next })
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    applyOrder(arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))))
  }
  const shift = (index: number, dir: -1 | 1) => {
    const to = index + dir
    if (to < 0 || to >= ids.length) return
    applyOrder(arrayMove(ids, index, to))
  }

  const toggleActive = async () => {
    setToggling(true)
    try {
      await updateCategory(orgId, category.id, { active: !category.active })
      await invalidateWorkflow(qc, orgId)
      toast.show(category.active ? 'Categoria desativada. Ela não aparecerá em novas demandas nem no quadro.' : 'Categoria reativada.')
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'Não foi possível alterar a categoria.', 'error')
    } finally {
      setToggling(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: category.color }} aria-hidden />
            {category.name}
            {!category.active && <Badge>Inativa</Badge>}
          </span>
        }
        description={canManage ? 'Arraste ou use as setas para reordenar. As alterações são salvas automaticamente.' : 'Somente leitura — apenas administradores e advogados alteram fluxos.'}
        action={
          canManage && (
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={onEditCategory}>
                Editar
              </Button>
              <Button size="sm" onClick={toggleActive} loading={toggling}>
                {category.active ? 'Desativar' : 'Ativar'}
              </Button>
            </div>
          )
        }
      />

      {!hasFinal && stages.length > 0 && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Nenhuma etapa marcada como conclusão: as demandas desta categoria não serão concluídas automaticamente ao chegar ao fim do fluxo.
        </div>
      )}

      {stages.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-ink-muted">Nenhuma etapa cadastrada.</p>
      ) : canManage ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ol className="divide-y divide-line px-1 py-1">
              {stages.map((s, i) => (
                <SortableStageRow
                  key={s.id}
                  stage={s}
                  index={i}
                  total={stages.length}
                  busy={reorder.isPending}
                  onUp={() => shift(i, -1)}
                  onDown={() => shift(i, 1)}
                  onDelete={() => setDeleting(s)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      ) : (
        <ol className="divide-y divide-line px-1 py-1">
          {stages.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="tabular w-5 text-right text-[12px] text-ink-subtle">{i + 1}.</span>
              <span className="flex-1 text-[13.5px] text-ink">{s.name}</span>
              <StageFlags stage={s} />
            </li>
          ))}
        </ol>
      )}

      {canManage && <NewStageForm category={category} />}

      <DeleteStageModal stage={deleting} stages={stages} onClose={closeDelete} />
    </Card>
  )
}

function StageFlags({ stage }: { stage: WorkflowStage }) {
  return (
    <span className="flex gap-1.5">
      {stage.is_final && <Badge tone="green">Conclusão</Badge>}
      {stage.is_waiting_docs && <Badge tone="amber">Aguardando documentos</Badge>}
    </span>
  )
}

function SortableStageRow({
  stage,
  index,
  total,
  busy,
  onUp,
  onDown,
  onDelete,
}: {
  stage: WorkflowStage
  index: number
  total: number
  busy: boolean
  onUp: () => void
  onDown: () => void
  onDelete: () => void
}) {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id })
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(stage.name)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setName(stage.name), [stage.name])

  const save = async (patch: Parameters<typeof updateStage>[2]) => {
    setSaving(true)
    setError(null)
    try {
      await updateStage(orgId, stage.id, patch)
      await invalidateWorkflow(qc, orgId)
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível salvar a etapa.'
      setError(msg)
      toast.show(msg, 'error')
      return false
    } finally {
      setSaving(false)
    }
  }

  const submitName = async (e?: FormEvent) => {
    e?.preventDefault()
    const n = name.trim()
    if (!n || n.length > 80) {
      setError('O nome deve ter entre 1 e 80 caracteres.')
      return
    }
    if (n === stage.name) {
      setEditing(false)
      return
    }
    if (await save({ name: n })) {
      setEditing(false)
      toast.show('Etapa renomeada.')
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative bg-surface px-2 py-2', isDragging && 'z-10 rounded-md shadow-[var(--shadow-pop)]')}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          aria-label={`Reordenar etapa ${stage.name}`}
          className="cursor-grab touch-none rounded p-1 text-ink-subtle hover:bg-navy-50 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-500 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </button>
        <span className="tabular w-5 text-right text-[12px] text-ink-subtle">{index + 1}.</span>

        <div className="min-w-0 flex-1 basis-40">
          {editing ? (
            <form onSubmit={submitName} className="flex items-center gap-1">
              <input
                autoFocus
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setName(stage.name)
                    setEditing(false)
                    setError(null)
                  }
                }}
                aria-label="Nome da etapa"
                aria-invalid={!!error || undefined}
                className="h-8 w-full rounded-md border border-line-strong px-2 text-[13.5px] focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100"
              />
              <Button type="submit" size="icon" variant="ghost" loading={saving} aria-label="Salvar nome">
                {!saving && <Check className="size-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Cancelar edição"
                onClick={() => {
                  setName(stage.name)
                  setEditing(false)
                  setError(null)
                }}
              >
                <X className="size-4" />
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="group inline-flex max-w-full items-center gap-1.5 text-left text-[13.5px] text-ink"
              aria-label={`Renomear etapa ${stage.name}`}
            >
              <span className="truncate">{stage.name}</span>
              <Pencil className="size-3 shrink-0 text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 pl-9 sm:pl-0">
          <Checkbox
            label="Conclusão"
            checked={stage.is_final}
            disabled={saving}
            onChange={(e) => save({ is_final: e.target.checked })}
            title="Mover uma demanda para esta etapa a marca como concluída"
          />
          <Checkbox
            label="Aguarda docs"
            checked={stage.is_waiting_docs}
            disabled={saving}
            onChange={(e) => save({ is_waiting_docs: e.target.checked })}
            title="Demandas nesta etapa contam como aguardando documentos"
          />
        </div>

        <div className="ml-auto flex items-center">
          <Button size="icon" variant="ghost" onClick={onUp} disabled={busy || index === 0} aria-label={`Subir etapa ${stage.name}`}>
            <ArrowUp className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={onDown} disabled={busy || index === total - 1} aria-label={`Descer etapa ${stage.name}`}>
            <ArrowDown className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            disabled={total <= 1}
            title={total <= 1 ? 'A categoria precisa de ao menos uma etapa' : undefined}
            aria-label={`Excluir etapa ${stage.name}`}
            className="hover:text-red-600"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {error && editing && <p className="mt-1 pl-14 text-[12px] text-red-600">{error}</p>}
    </li>
  )
}

function NewStageForm({ category }: { category: CategoryWithStages }) {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const [isFinal, setIsFinal] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (!n || n.length > 80) {
      setError('Informe um nome de 1 a 80 caracteres.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const position = category.stages.reduce((m, s) => Math.max(m, s.position), -1) + 1
      await createStage(orgId, category.id, { name: n, is_final: isFinal, is_waiting_docs: waiting }, position)
      await invalidateWorkflow(qc, orgId)
      setName('')
      setIsFinal(false)
      setWaiting(false)
      toast.show('Etapa adicionada ao final do fluxo.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a etapa.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-line bg-canvas/50 px-4 py-3" noValidate>
      <p className="mb-2 text-[12.5px] font-medium text-ink">Nova etapa</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label="Nome da nova etapa"
          placeholder="Ex.: Conferência documental"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          wrapperClassName="flex-1"
          error={error}
        />
        <div className="flex items-center gap-3">
          <Checkbox label="Conclusão" checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} />
          <Checkbox label="Aguarda docs" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} />
        </div>
        <Button type="submit" variant="primary" size="md" icon={<Plus className="size-4" />} loading={saving} className="self-start sm:self-auto">
          Adicionar
        </Button>
      </div>
    </form>
  )
}

function DeleteStageModal({ stage, stages, onClose }: { stage: WorkflowStage | null; stages: WorkflowStage[]; onClose: () => void }) {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const [moveTo, setMoveTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const others = stages.filter((s) => s.id !== stage?.id)

  const count = useQuery({
    queryKey: qk.demands(orgId, 'stage-count', stage?.id ?? 'none'),
    enabled: !!stage,
    queryFn: () => countDemandsInStage(orgId, stage!.id),
    staleTime: 0,
  })

  useEffect(() => {
    if (!stage) return
    setError(null)
    // Padrão: etapa anterior (ou a próxima, se for a primeira)
    const idx = stages.findIndex((s) => s.id === stage.id)
    const fallback = stages[idx - 1] ?? stages[idx + 1]
    setMoveTo(fallback?.id ?? '')
  }, [stage?.id])

  const close = useStableClose(onClose, saving)
  const needsTarget = (count.data ?? 0) > 0
  const target = others.find((s) => s.id === moveTo)

  const confirm = async () => {
    if (!stage) return
    if (needsTarget && !moveTo) {
      setError('Escolha a etapa de destino.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await deleteStage(stage.id, needsTarget ? moveTo : null)
      await Promise.all([invalidateWorkflow(qc, orgId), qc.invalidateQueries({ queryKey: qk.activity(orgId) })])
      toast.show('Etapa excluída.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível excluir a etapa.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!stage}
      onClose={close}
      title="Excluir etapa"
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirm} loading={saving} disabled={count.isLoading || count.isError}>
            Excluir etapa
          </Button>
        </>
      }
    >
      {count.isLoading ? (
        <Spinner className="py-4" label="Verificando demandas na etapa…" />
      ) : count.isError ? (
        <InlineError message={count.error.message} />
      ) : (
        <div className="flex flex-col gap-3 text-[13.5px] text-ink-muted">
          {needsTarget ? (
            <>
              <p>
                Há <strong className="text-ink">{count.data}</strong> {count.data === 1 ? 'demanda' : 'demandas'} na etapa “{stage?.name}”. Escolha para
                qual etapa {count.data === 1 ? 'ela será movida' : 'elas serão movidas'}:
              </p>
              <Select
                label="Etapa de destino"
                required
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
                options={others.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Selecione…"
              />
              {target?.is_final && (
                <p className="text-[12.5px] text-amber-800">Atenção: a etapa escolhida é de conclusão — as demandas movidas serão marcadas como concluídas.</p>
              )}
            </>
          ) : (
            <p>A etapa “{stage?.name}” não tem demandas e será excluída. Esta ação não pode ser desfeita.</p>
          )}
          {error && <InlineError message={error} />}
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------

function CategoryFormModal({
  state,
  nextSortOrder,
  onClose,
  onCreated,
}: {
  state: { mode: 'create' } | { mode: 'edit'; category: CategoryWithStages } | null
  nextSortOrder: number
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const editing = state?.mode === 'edit' ? state.category : null
  const [name, setName] = useState('')
  const [color, setColor] = useState(CATEGORY_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const close = useStableClose(onClose, saving)

  useEffect(() => {
    if (!state) return
    setName(editing?.name ?? '')
    setColor(editing?.color ?? CATEGORY_COLORS[0])
    setError(null)
    setNameError(null)
  }, [state])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    if (n.length < 2 || n.length > 80) {
      setNameError('O nome deve ter entre 2 e 80 caracteres.')
      return
    }
    setSaving(true)
    setError(null)
    setNameError(null)
    try {
      if (editing) {
        await updateCategory(orgId, editing.id, { name: n, color })
        toast.show('Categoria atualizada.')
      } else {
        const cat = await createCategory(orgId, { name: n, color }, nextSortOrder)
        onCreated(cat.id)
        toast.show('Categoria criada com etapas iniciais.')
      }
      await invalidateWorkflow(qc, orgId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar a categoria.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={!!state}
      onClose={close}
      title={editing ? 'Editar categoria' : 'Nova categoria'}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="category-form" variant="primary" loading={saving}>
            {editing ? 'Salvar' : 'Criar categoria'}
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input label="Nome" required value={name} maxLength={80} onChange={(e) => setName(e.target.value)} error={nameError} placeholder="Ex.: Pensão por morte" />
        <fieldset>
          <legend className="mb-1.5 text-[12.5px] font-medium text-ink">Cor</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor da categoria">
            {CATEGORY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Cor ${c}`}
                onClick={() => setColor(c)}
                className={cn(
                  'flex size-7 items-center justify-center rounded-md ring-offset-2 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500',
                  color === c && 'ring-2 ring-navy-900',
                )}
                style={{ backgroundColor: c }}
              >
                {color === c && <Check className="size-3.5 text-white" />}
              </button>
            ))}
          </div>
        </fieldset>
        {!editing && (
          <p className="text-[12.5px] text-ink-muted">
            Serão criadas as etapas iniciais {DEFAULT_STAGES.map((s) => `“${s.name}”`).join(', ')}. Você pode editá-las depois.
          </p>
        )}
        {error && <InlineError message={error} />}
      </form>
    </Modal>
  )
}
