import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ClipboardList, Info, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Select, Skeleton, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { useCategories } from '@/hooks/useOrgData'
import { cn } from '@/lib/cn'
import { useChecklistTemplateActions, useChecklistTemplates } from './api'
import { moveItem, validateLabel } from './logic'
import { CHECKLIST_LABEL_MAX, type ChecklistTemplate } from './types'

const errMsg = (e: unknown) => {
  const m = e instanceof Error ? e.message : 'Não foi possível concluir a ação.'
  return m === 'Registro duplicado.' ? 'Este item já existe no modelo.' : m
}

/**
 * Edição dos itens sugeridos do checklist por categoria (admin/advogado).
 * Para a tela de Fluxos ou Configurações.
 */
export function ChecklistTemplatesEditor({ initialCategoryId }: { initialCategoryId?: string }) {
  const { can } = useOrg()
  const canEdit = can('workflows.manage')
  const toast = useToast()
  const cats = useCategories()
  const templates = useChecklistTemplates()
  const actions = useChecklistTemplateActions()

  const [categoryId, setCategoryId] = useState(initialCategoryId ?? '')
  const activeCategory = categoryId || cats.data?.[0]?.id || ''
  const list = (templates.data ?? []).filter((t) => t.category_id === activeCategory)

  const [newLabel, setNewLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; label: string; error?: string } | null>(null)
  const [deleting, setDeleting] = useState<ChecklistTemplate | null>(null)

  const counts = new Map<string, number>()
  templates.data?.forEach((t) => counts.set(t.category_id, (counts.get(t.category_id) ?? 0) + 1))

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const check = validateLabel(newLabel, list)
    if (!check.ok) return setError(check.error)
    setError(null)
    try {
      await actions.add.mutateAsync({ categoryId: activeCategory, label: check.label })
      setNewLabel('')
    } catch (err) {
      setError(errMsg(err))
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const check = validateLabel(editing.label, list, editing.id)
    if (!check.ok) return setEditing({ ...editing, error: check.error })
    const cur = list.find((t) => t.id === editing.id)
    setEditing(null)
    if (cur?.label === check.label) return
    try {
      await actions.rename.mutateAsync({ id: editing.id, label: check.label })
    } catch (err) {
      toast.show(errMsg(err), 'error')
    }
  }

  const move = (id: string, delta: -1 | 1) => {
    const next = moveItem(list, id, delta)
    if (!next) return
    actions.reorder.mutate(
      { categoryId: activeCategory, ids: next.map((t) => t.id) },
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
            <ClipboardList className="size-4 text-ink-subtle" /> Checklists por categoria
          </span>
        }
        description="Itens sugeridos ao aplicar o modelo em uma demanda. São controles administrativos editáveis, não exigências legais."
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
              setEditing(null)
              setError(null)
            }}
            options={(cats.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${counts.get(c.id) ?? 0})` }))}
          />
        )}
      </div>

      {templates.isLoading ? (
        <div className="space-y-2.5 p-4" aria-busy="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-2/3" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          className="py-8"
          title="Nenhum item sugerido para esta categoria"
          description={canEdit ? 'Adicione abaixo os itens que costumam ser solicitados.' : 'Peça a um advogado ou administrador para configurar.'}
        />
      ) : (
        <ol className="divide-y divide-line px-1 py-1.5">
          {list.map((t, idx) => (
            <li key={t.id} className="group flex items-center gap-3 rounded-md px-3 py-1.5 hover:bg-canvas">
              <span className="w-5 shrink-0 text-right text-[12px] text-ink-subtle tabular">{idx + 1}</span>
              {editing?.id === t.id ? (
                <div className="min-w-0 flex-1">
                  <input
                    autoFocus
                    value={editing.label}
                    maxLength={CHECKLIST_LABEL_MAX}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value, error: undefined })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveEdit()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setEditing(null)
                      }
                    }}
                    onBlur={saveEdit}
                    aria-label="Renomear item sugerido"
                    className="h-7 w-full rounded border border-accent-500 bg-surface px-2 text-[13px] outline-none ring-3 ring-accent-100"
                  />
                  {editing.error && <p className="mt-0.5 text-[11.5px] text-red-600">{editing.error}</p>}
                </div>
              ) : (
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{t.label}</span>
              )}
              {canEdit && (
                <div className={cn('flex shrink-0 items-center sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100')}>
                  <Icon label={`Subir ${t.label}`} disabled={idx === 0} onClick={() => move(t.id, -1)}>
                    <ArrowUp className="size-3.5" />
                  </Icon>
                  <Icon label={`Descer ${t.label}`} disabled={idx === list.length - 1} onClick={() => move(t.id, 1)}>
                    <ArrowDown className="size-3.5" />
                  </Icon>
                  <Icon label={`Renomear ${t.label}`} onClick={() => setEditing({ id: t.id, label: t.label })}>
                    <Pencil className="size-3.5" />
                  </Icon>
                  <Icon label={`Excluir ${t.label}`} onClick={() => setDeleting(t)}>
                    <Trash2 className="size-3.5" />
                  </Icon>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {canEdit && activeCategory ? (
        <form onSubmit={add} className="border-t border-line px-4 py-3">
          <div className="flex gap-2">
            <input
              value={newLabel}
              onChange={(e) => {
                setNewLabel(e.target.value)
                setError(null)
              }}
              maxLength={CHECKLIST_LABEL_MAX}
              placeholder="Novo item sugerido"
              aria-label="Novo item sugerido"
              className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] placeholder:text-ink-subtle focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100"
            />
            <Button size="sm" type="submit" icon={<Plus className="size-3.5" />} loading={actions.add.isPending} disabled={!newLabel.trim()}>
              Adicionar
            </Button>
          </div>
          {error && (
            <p className="mt-1 text-[12px] text-red-600" role="alert">
              {error}
            </p>
          )}
          <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-ink-subtle">
            <Info className="mt-px size-3 shrink-0" />
            Alterações valem para as próximas aplicações; checklists já criados nas demandas não mudam.
          </p>
        </form>
      ) : (
        !canEdit && <p className="border-t border-line px-4 py-3 text-[12px] text-ink-subtle">Somente leitura para o seu perfil.</p>
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir item sugerido"
        description={`Remover "${deleting?.label ?? ''}" do modelo desta categoria? Checklists já aplicados não são afetados.`}
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
