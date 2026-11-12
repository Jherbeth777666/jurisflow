import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, CalendarClock, Info, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Select, Skeleton, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { useCategories } from '@/hooks/useOrgData'
import { PRIORITY, toOptions } from '@/lib/constants'
import { moveItem } from '@/features/checklist/logic'
import type { PriorityLevel } from '@/types/database'
import {
  OFFSET_MAX,
  TASK_TITLE_MAX,
  TASK_TITLE_MIN,
  useTaskTemplateActions,
  useTaskTemplates,
  type TaskTemplateInput,
  type TaskTemplateRow,
} from './taskTemplatesApi'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Não foi possível concluir a ação.')

/** Sugestão inicial: tarefas administrativas genéricas, sem conteúdo jurídico. */
const INITIAL_SUGGESTION: TaskTemplateInput[] = [
  { title: 'Conferir documentos pessoais do cliente', offset_days: 0, priority: 'media' },
  { title: 'Solicitar documentos pendentes ao cliente', offset_days: 2, priority: 'alta' },
  { title: 'Retorno ao cliente sobre o andamento', offset_days: 7, priority: 'media' },
]

interface Draft {
  id: string | null
  title: string
  /** texto do campo; vazio = sem data */
  offset: string
  priority: PriorityLevel
  /** vazio = ao criar a demanda */
  stageId: string
}

const emptyDraft = (): Draft => ({ id: null, title: '', offset: '', priority: 'media', stageId: '' })

function parseDraft(d: Draft): { ok: true; input: TaskTemplateInput } | { ok: false; error: string } {
  const title = d.title.trim().replace(/\s+/g, ' ')
  if (title.length < TASK_TITLE_MIN) return { ok: false, error: `O título precisa de pelo menos ${TASK_TITLE_MIN} caracteres.` }
  if (title.length > TASK_TITLE_MAX) return { ok: false, error: `Máximo de ${TASK_TITLE_MAX} caracteres.` }
  let offset_days: number | null = null
  if (d.offset.trim() !== '') {
    const n = Number(d.offset)
    if (!Number.isInteger(n) || n < 0 || n > OFFSET_MAX) return { ok: false, error: `Os dias devem ser um número inteiro de 0 a ${OFFSET_MAX}.` }
    offset_days = n
  }
  return { ok: true, input: { title, offset_days, priority: d.priority, stage_id: d.stageId || null } }
}

const offsetLabel = (n: number | null) => (n == null ? 'sem data' : `D+${n} dias`)

/**
 * Edição das tarefas sugeridas por categoria (admin/advogado). As datas são lembretes
 * internos calculados a partir da criação da demanda, não prazos jurídicos.
 */
export function TaskTemplatesEditor({ initialCategoryId }: { initialCategoryId?: string }) {
  const { can } = useOrg()
  const canEdit = can('workflows.manage')
  const toast = useToast()
  const cats = useCategories()
  const templates = useTaskTemplates()
  const actions = useTaskTemplateActions()

  const [categoryId, setCategoryId] = useState(initialCategoryId ?? '')
  const activeCategory = categoryId || cats.data?.[0]?.id || ''
  const activeStages = (cats.data?.find((c) => c.id === activeCategory)?.stages ?? []).slice().sort((a, b) => a.position - b.position)
  // Agrupado pelo gatilho: primeiro "Ao criar a demanda", depois as etapas na ordem de position.
  const groups: TaskTemplateRow[][] = [
    ...[null, ...activeStages.map((s) => s.id)].map((sid) =>
      (templates.data ?? []).filter((t) => t.category_id === activeCategory && (t.stage_id ?? null) === sid).sort((a, b) => a.position - b.position),
    ),
  ]
  const list = groups.flat()
  const triggerLabel = (stageId: string | null) => {
    if (!stageId) return 'Ao criar a demanda'
    const st = activeStages.find((s) => s.id === stageId)
    return st ? `Ao entrar em ${st.name}` : 'Etapa removida'
  }

  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<TaskTemplateRow | null>(null)

  const counts = new Map<string, number>()
  templates.data?.forEach((t) => counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + 1))

  const groupOf = (t: TaskTemplateRow) => groups.find((g) => g.includes(t)) ?? [t]
  const editing = draft.id !== null
  const resetDraft = () => {
    setDraft(emptyDraft())
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const check = parseDraft(draft)
    if (!check.ok) return setError(check.error)
    setError(null)
    try {
      if (draft.id) await actions.update.mutateAsync({ id: draft.id, input: check.input })
      else await actions.add.mutateAsync({ categoryId: activeCategory, input: check.input })
      resetDraft()
    } catch (err) {
      setError(errMsg(err))
    }
  }

  const useInitial = async () => {
    try {
      await actions.addMany.mutateAsync({ categoryId: activeCategory, inputs: INITIAL_SUGGESTION })
      toast.show('Sugestão inicial adicionada. Ajuste como preferir.')
    } catch (err) {
      toast.show(errMsg(err), 'error')
    }
  }

  const move = (id: string, delta: -1 | 1) => {
    const gi = groups.findIndex((g) => g.some((t) => t.id === id))
    if (gi < 0) return
    const moved = moveItem(groups[gi], id, delta)
    if (!moved) return
    const ids = groups.flatMap((g, i) => (i === gi ? moved : g)).map((t) => t.id)
    actions.reorder.mutate(
      { categoryId: activeCategory, ids },
      { onError: (err) => toast.show(errMsg(err), 'error') },
    )
  }

  if (cats.isError || templates.isError)
    return (
      <Card>
        <ErrorState
          message={((cats.error ?? templates.error) as Error).message}
          onRetry={() => {
            cats.refetch()
            templates.refetch()
          }}
        />
      </Card>
    )

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <CalendarClock className="size-4 text-ink-subtle" /> Tarefas sugeridas por categoria
          </span>
        }
        description="Sugeridas ao criar uma demanda ou ao entrar numa etapa, com datas calculadas a partir da criação. São lembretes internos de organização, não prazos legais."
      />
      <div className="border-b border-line px-4 py-3">
        {cats.isLoading ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <Select
            label="Categoria"
            wrapperClassName="max-w-xs"
            value={activeCategory}
            onChange={(e) => {
              setCategoryId(e.target.value)
              resetDraft()
            }}
            options={(cats.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${counts.get(c.id) ?? 0})` }))}
          />
        )}
      </div>

      {templates.isLoading ? (
        <div className="space-y-2.5 p-4" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-2/3" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          className="py-8"
          title="Nenhuma tarefa sugerida para esta categoria"
          description={canEdit ? 'Adicione abaixo ou comece pela sugestão inicial.' : 'Peça a um advogado ou administrador para configurar.'}
          action={
            canEdit && activeCategory ? (
              <Button size="sm" onClick={useInitial} loading={actions.addMany.isPending}>
                Usar sugestão inicial
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ol className="divide-y divide-line px-1 py-1.5">
          {list.map((t, idx) => (
            <li key={t.id} className="group flex items-center gap-3 rounded-md px-3 py-1.5 hover:bg-canvas">
              <span className="w-5 shrink-0 text-right text-caption text-ink-subtle tabular">{idx + 1}</span>
              <span className="min-w-0 flex-1 truncate text-body text-ink">{t.title}</span>
              <span className="shrink-0 text-caption text-ink-muted">{offsetLabel(t.offset_days)}</span>
              <Badge tone="gray">{triggerLabel(t.stage_id)}</Badge>
              <Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge>
              {canEdit && (
                <div className="flex shrink-0 items-center sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <Icon label={`Subir ${t.title}`} disabled={groupOf(t).indexOf(t) === 0} onClick={() => move(t.id, -1)}>
                    <ArrowUp className="size-3.5" />
                  </Icon>
                  <Icon label={`Descer ${t.title}`} disabled={groupOf(t).indexOf(t) === groupOf(t).length - 1} onClick={() => move(t.id, 1)}>
                    <ArrowDown className="size-3.5" />
                  </Icon>
                  <Icon
                    label={`Editar ${t.title}`}
                    onClick={() => {
                      setError(null)
                      setDraft({ id: t.id, title: t.title, offset: t.offset_days == null ? '' : String(t.offset_days), priority: t.priority, stageId: t.stage_id ?? '' })
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Icon>
                  <Icon label={`Excluir ${t.title}`} onClick={() => setDeleting(t)}>
                    <Trash2 className="size-3.5" />
                  </Icon>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {canEdit && activeCategory ? (
        <form onSubmit={submit} className="border-t border-line px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_140px_auto] sm:items-center">
            <input
              value={draft.title}
              onChange={(e) => {
                setDraft({ ...draft, title: e.target.value })
                setError(null)
              }}
              maxLength={TASK_TITLE_MAX}
              placeholder={editing ? 'Título da tarefa' : 'Nova tarefa sugerida'}
              aria-label="Título da tarefa sugerida"
              className="h-8 min-w-0 rounded-md border border-line-strong bg-surface px-2.5 text-body-sm placeholder:text-ink-subtle focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100"
            />
            <input
              type="number"
              min={0}
              max={OFFSET_MAX}
              value={draft.offset}
              onChange={(e) => {
                setDraft({ ...draft, offset: e.target.value })
                setError(null)
              }}
              placeholder="Sem data"
              aria-label="Dias após a criação (vazio = sem data)"
              className="h-8 rounded-md border border-line-strong bg-surface px-2.5 text-body-sm placeholder:text-ink-subtle focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100"
            />
            <select
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value as PriorityLevel })}
              aria-label="Prioridade da tarefa sugerida"
              className="h-8 rounded-md border border-line-strong bg-surface px-2 text-body-sm focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100"
            >
              {toOptions(PRIORITY).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={draft.stageId}
              onChange={(e) => setDraft({ ...draft, stageId: e.target.value })}
              aria-label="Quando sugerir"
              className="h-8 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-body-sm focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100 sm:col-span-3"
            >
              <option value="">Ao criar a demanda</option>
              {activeStages.map((st) => (
                <option key={st.id} value={st.id}>
                  Ao entrar em {st.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button
                size="sm"
                type="submit"
                icon={editing ? undefined : <Plus className="size-3.5" />}
                loading={actions.add.isPending || actions.update.isPending}
                disabled={!draft.title.trim()}
              >
                {editing ? 'Salvar' : 'Adicionar'}
              </Button>
              {editing && (
                <Button size="sm" type="button" onClick={resetDraft}>
                  Cancelar
                </Button>
              )}
            </div>
          </div>
          {error && (
            <p className="mt-1 text-caption text-red-600" role="alert">
              {error}
            </p>
          )}
          <p className="mt-2 flex items-start gap-1.5 text-caption text-ink-subtle">
            <Info className="mt-px size-3 shrink-0" />
            Datas que caem no fim de semana passam para a segunda-feira. Alterações valem para as próximas demandas.
          </p>
        </form>
      ) : (
        !canEdit && <p className="border-t border-line px-4 py-3 text-caption text-ink-subtle">Somente leitura para o seu perfil.</p>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir tarefa sugerida"
        description={`Remover "${deleting?.title ?? ''}" do modelo desta categoria? Tarefas já criadas não são afetadas.`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (deleting) await actions.remove.mutateAsync(deleting.id)
        }}
      />
    </Card>
  )
}

function Icon({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded text-ink-subtle hover:bg-navy-50 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}
