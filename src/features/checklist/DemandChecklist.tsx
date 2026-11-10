import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CheckCircle2, ClipboardList, Info, ListPlus, MessageCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, ErrorState, Skeleton, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { qk, useCategories } from '@/hooks/useOrgData'
import { supabase, unwrap } from '@/lib/supabase'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { DemandStatus } from '@/types/database'
import { MessageComposerModal } from '@/features/messages/MessageComposerModal'
import { DEFAULT_TEMPLATE_IDS } from '@/features/messages/defaultTemplates'
import { useChecklistActions, useChecklistItems, useChecklistTemplates } from './api'
import { checklistProgress, moveItem, nextStageAfter, validateLabel } from './logic'
import { CHECKLIST_LABEL_MAX, type DemandChecklistItem } from './types'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Não foi possível concluir a ação.')

/**
 * Checklist de pendências da demanda (lista textual de itens solicitados/recebidos —
 * nenhum arquivo é armazenado).
 */
export function DemandChecklist({
  demandId,
  categoryId,
  clientId,
  stageId,
  status,
}: {
  demandId: string
  categoryId: string
  clientId: string
  /** Etapa atual real (vem de qk.demand no DemandDetailPage — sempre atualizada). */
  stageId: string | null
  status: DemandStatus
}) {
  const { orgId, can } = useOrg()
  const toast = useToast()
  const qc = useQueryClient()
  const items = useChecklistItems(demandId)
  const templates = useChecklistTemplates()
  const cats = useCategories()
  const actions = useChecklistActions(demandId)
  const canDelete = can('demands.delete')

  const [newLabel, setNewLabel] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; label: string; error?: string } | null>(null)
  const [deleting, setDeleting] = useState<DemandChecklistItem | null>(null)
  const [composing, setComposing] = useState(false)
  const [dismissSuggestion, setDismissSuggestion] = useState(false)

  const list = items.data ?? []
  const progress = checklistProgress(list)
  const categoryTemplates = (templates.data ?? []).filter((t) => t.category_id === categoryId)
  const category = cats.data?.find((c) => c.id === categoryId)
  const stages = category?.stages ?? []
  const nextStage = nextStageAfter(stages, stageId)
  const effectiveClientId = clientId

  const moveStage = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      // Só move se a demanda ainda estiver na etapa que o usuário viu (evita retroceder
      // uma demanda que outra pessoa/aba já avançou).
      const rows = unwrap(
        await supabase.from('demands').update({ stage_id: to }).eq('id', demandId).eq('organization_id', orgId).eq('stage_id', from).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('A demanda já mudou de etapa. A tela foi atualizada — confira a etapa atual.')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.demand(orgId, demandId) })
      qc.invalidateQueries({ queryKey: qk.demands(orgId) })
      qc.invalidateQueries({ queryKey: qk.dashboard(orgId) })
      qc.invalidateQueries({ queryKey: qk.activity(orgId) })
    },
  })

  const submitNew = async (e: FormEvent) => {
    e.preventDefault()
    const check = validateLabel(newLabel, list)
    if (!check.ok) return setAddError(check.error)
    setAddError(null)
    try {
      await actions.add.mutateAsync(check.label)
      setNewLabel('')
    } catch (err) {
      setAddError(errMsg(err) === 'Registro duplicado.' ? 'Este item já está na lista.' : errMsg(err))
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const check = validateLabel(editing.label, list, editing.id)
    if (!check.ok) return setEditing({ ...editing, error: check.error })
    const original = list.find((i) => i.id === editing.id)
    setEditing(null)
    if (original?.label === check.label) return
    try {
      await actions.rename.mutateAsync({ id: editing.id, label: check.label })
    } catch (err) {
      toast.show(errMsg(err), 'error')
    }
  }

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setEditing(null)
    }
  }

  const move = (id: string, delta: -1 | 1) => {
    const next = moveItem(list, id, delta)
    if (!next) return
    actions.reorder.mutate(
      next.map((i) => i.id),
      { onError: (err) => toast.show(errMsg(err), 'error') },
    )
  }

  const toggle = (item: DemandChecklistItem) =>
    actions.toggle.mutate({ id: item.id, done: !item.done }, { onError: (err) => toast.show(errMsg(err), 'error') })

  const applyTemplate = async () => {
    try {
      const n = await actions.apply.mutateAsync()
      toast.show(n ? `${n} ${n === 1 ? 'item adicionado' : 'itens adicionados'} do modelo da categoria.` : 'Todos os itens do modelo já estão na lista.')
    } catch (err) {
      toast.show(errMsg(err), 'error')
    }
  }

  const header = (
    <CardHeader
      title={
        <span className="inline-flex items-center gap-2">
          <ClipboardList className="size-4 text-ink-subtle" /> Checklist de pendências
          {progress.total > 0 && (
            <span className={cn('tabular text-[12px] font-medium', progress.complete ? 'text-emerald-700' : 'text-ink-muted')}>
              {progress.done} de {progress.total}
            </span>
          )}
        </span>
      }
      description="Controle do que foi solicitado e recebido. Apenas a lista — nenhum arquivo é armazenado."
      action={
        <div className="flex flex-wrap justify-end gap-1.5">
          {categoryTemplates.length > 0 && (
            <Button size="sm" variant="ghost" icon={<ListPlus className="size-3.5" />} onClick={applyTemplate} loading={actions.apply.isPending}>
              <span className="hidden sm:inline">Aplicar modelo da categoria</span>
              <span className="sm:hidden">Modelo</span>
            </Button>
          )}
          {progress.total - progress.done > 0 && effectiveClientId && (
            <Button size="sm" variant="subtle" icon={<MessageCircle className="size-3.5" />} onClick={() => setComposing(true)}>
              Cobrar pendências
            </Button>
          )}
        </div>
      }
    />
  )

  if (items.isError)
    return (
      <Card>
        {header}
        <ErrorState message={(items.error as Error).message} onRetry={() => items.refetch()} />
      </Card>
    )

  return (
    <Card>
      {header}

      {progress.total > 0 && (
        <div className="px-4 pt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-navy-50"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-label={`${progress.done} de ${progress.total} itens recebidos`}
          >
            <div
              className={cn('h-full rounded-full transition-[width] duration-300', progress.complete ? 'bg-emerald-500' : 'bg-accent-600')}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {progress.complete && nextStage && !dismissSuggestion && stageId && status !== 'concluida' && (
        <div className="mx-4 mt-3 flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] text-emerald-900 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0" />
            Todos os itens recebidos — mover para a próxima etapa ({nextStage.name})?
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setDismissSuggestion(true)}>
              Agora não
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={moveStage.isPending}
              onClick={() =>
                moveStage.mutate({ from: stageId!, to: nextStage.id }, {
                  onSuccess: () => toast.show(`Demanda movida para "${nextStage.name}".`),
                  onError: (err) => toast.show(errMsg(err), 'error'),
                })
              }
            >
              Mover etapa
            </Button>
          </div>
        </div>
      )}

      {items.isLoading ? (
        <div className="space-y-2.5 p-4" aria-busy="true" aria-label="Carregando checklist">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-3/4" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          className="py-8"
          icon={<ClipboardList className="size-5" />}
          title="Nenhum item no checklist"
          description={
            categoryTemplates.length
              ? `Aplique as ${categoryTemplates.length} sugestões da categoria ou adicione itens manualmente.`
              : 'Adicione os itens que precisam ser solicitados ao cliente.'
          }
          action={
            categoryTemplates.length > 0 && (
              <Button size="sm" icon={<ListPlus className="size-3.5" />} onClick={applyTemplate} loading={actions.apply.isPending}>
                Aplicar modelo da categoria
              </Button>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-line px-1 py-1.5" aria-label="Itens do checklist">
          {list.map((item, idx) => (
            <li key={item.id} className="group flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-canvas">
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => toggle(item)}
                className="size-4 shrink-0 cursor-pointer rounded border-line-strong accent-emerald-600"
                aria-label={`${item.done ? 'Desmarcar' : 'Marcar como recebido'}: ${item.label}`}
              />
              {editing?.id === item.id ? (
                <div className="min-w-0 flex-1">
                  <input
                    autoFocus
                    value={editing.label}
                    maxLength={CHECKLIST_LABEL_MAX}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value, error: undefined })}
                    onKeyDown={onEditKey}
                    onBlur={saveEdit}
                    aria-label="Renomear item"
                    aria-invalid={!!editing.error || undefined}
                    className="h-7 w-full rounded border border-accent-500 bg-surface px-2 text-[13px] outline-none ring-3 ring-accent-100"
                  />
                  {editing.error && <p className="mt-0.5 text-[11.5px] text-red-600">{editing.error}</p>}
                </div>
              ) : (
                <button
                  type="button"
                  className={cn('min-w-0 flex-1 truncate text-left text-[13.5px]', item.done ? 'text-ink-subtle line-through' : 'text-ink')}
                  onClick={() => toggle(item)}
                  title={item.done && item.done_at ? `Recebido em ${formatDateTime(item.done_at)}` : item.label}
                >
                  {item.label}
                </button>
              )}
              {item.done && item.done_at && editing?.id !== item.id && (
                <span className="hidden shrink-0 text-[11.5px] text-ink-subtle tabular sm:inline">{formatDateTime(item.done_at)}</span>
              )}
              <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                <IconBtn label={`Subir ${item.label}`} disabled={idx === 0} onClick={() => move(item.id, -1)}>
                  <ArrowUp className="size-3.5" />
                </IconBtn>
                <IconBtn label={`Descer ${item.label}`} disabled={idx === list.length - 1} onClick={() => move(item.id, 1)}>
                  <ArrowDown className="size-3.5" />
                </IconBtn>
                <IconBtn label={`Renomear ${item.label}`} onClick={() => setEditing({ id: item.id, label: item.label })}>
                  <Pencil className="size-3.5" />
                </IconBtn>
                {canDelete && (
                  <IconBtn label={`Excluir ${item.label}`} onClick={() => setDeleting(item)}>
                    <Trash2 className="size-3.5" />
                  </IconBtn>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submitNew} className="border-t border-line px-4 py-3">
        <div className="flex gap-2">
          <input
            value={newLabel}
            onChange={(e) => {
              setNewLabel(e.target.value)
              setAddError(null)
            }}
            maxLength={CHECKLIST_LABEL_MAX}
            placeholder="Adicionar item (ex.: Comprovante de residência)"
            aria-label="Novo item do checklist"
            aria-invalid={!!addError || undefined}
            className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] placeholder:text-ink-subtle focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100"
          />
          <Button size="sm" type="submit" icon={<Plus className="size-3.5" />} loading={actions.add.isPending} disabled={!newLabel.trim()}>
            Adicionar
          </Button>
        </div>
        {addError && (
          <p className="mt-1 text-[12px] text-red-600" role="alert">
            {addError}
          </p>
        )}
        <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-ink-subtle">
          <Info className="mt-px size-3 shrink-0" />
          Itens sugeridos são controles administrativos editáveis, não exigências legais.
        </p>
      </form>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Excluir item"
        description={`Remover "${deleting?.label ?? ''}" do checklist desta demanda?`}
        confirmLabel="Excluir"
        onConfirm={async () => {
          if (deleting) await actions.remove.mutateAsync(deleting.id)
        }}
      />

      {composing && effectiveClientId && (
        <MessageComposerModal
          open
          onClose={() => setComposing(false)}
          clientId={effectiveClientId}
          demandId={demandId}
          initialTemplateId={DEFAULT_TEMPLATE_IDS.lembreteDocumentos}
        />
      )}
    </Card>
  )
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label.split(' ')[0]}
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded text-ink-subtle hover:bg-navy-50 hover:text-ink disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

