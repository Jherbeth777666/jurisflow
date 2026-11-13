// Menu "Filtros salvos": aplica, salva e exclui combinações de filtros da tela atual (L13).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bookmark, ChevronDown, Trash2, Users } from 'lucide-react'
import { Button, Checkbox, ConfirmDialog, InlineError, Input, Modal, useToast } from '@/components/ui'
import { useMemberNames } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import { useDeleteView, useSaveView, useSavedViews, type SavedView, type ViewPage } from './api'

// Parâmetros que abrem modais ou paginam: nunca fazem parte de um filtro salvo.
const TRANSIENT_PARAMS = ['nova', 'novo', 'tarefa', 'page']

function filterQuery(params: URLSearchParams): string {
  const next = new URLSearchParams(params)
  TRANSIENT_PARAMS.forEach((k) => next.delete(k))
  return next.toString()
}

export function SavedViewsMenu({ page }: { page: ViewPage }) {
  const { userId } = useOrg()
  const toast = useToast()
  const members = useMemberNames()
  const views = useSavedViews(page)
  const save = useSaveView()
  const remove = useDeleteView()
  const [params, setParams] = useSearchParams()

  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<SavedView | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const query = useMemo(() => filterQuery(params), [params])
  const all = views.data ?? []
  const mine = all.filter((v) => v.user_id === userId)
  const team = all.filter((v) => v.user_id !== userId)

  const apply = (v: SavedView) => {
    setParams(new URLSearchParams(v.query), { replace: true })
    setOpen(false)
  }

  const openSave = () => {
    setOpen(false)
    setName('')
    setShared(false)
    setError(null)
    setSaving(true)
  }

  const submit = async () => {
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 60) {
      setError('Informe um nome com 2 a 60 caracteres.')
      return
    }
    setError(null)
    try {
      await save.mutateAsync({ page, name: trimmed, query, shared })
      setSaving(false)
      toast.show('Filtro salvo.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar o filtro.')
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="secondary"
        aria-haspopup="true"
        aria-expanded={open}
        icon={<Bookmark className="size-4" />}
        onClick={() => setOpen((o) => !o)}
        className="w-full sm:w-auto"
      >
        Filtros salvos
        {all.length > 0 && <span className="tabular rounded-full bg-ink/[0.07] px-1.5 text-caption text-ink-muted">{all.length}</span>}
        <ChevronDown className="size-3.5 text-ink-subtle" aria-hidden />
      </Button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] animate-rise rounded-[var(--radius-card)] border border-line bg-surface p-1.5 shadow-[var(--shadow-pop)] sm:left-auto sm:right-0">
          {views.isError && <p className="px-2 py-1.5 text-caption text-red-600">Não foi possível carregar os filtros salvos.</p>}
          {!views.isError && all.length === 0 && (
            <p className="px-2 py-1.5 text-caption text-ink-muted">Nenhum filtro salvo ainda.</p>
          )}
          {mine.length > 0 && (
            <section>
              <h3 className="px-2 pb-1 pt-1.5 text-caption font-semibold uppercase tracking-wide text-ink-subtle">Meus</h3>
              <ul>
                {mine.map((v) => (
                  <li key={v.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => apply(v)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1.5 text-left text-body-sm text-ink hover:bg-ink/[0.05]"
                    >
                      <span className="truncate">{v.name}</span>
                      {v.shared && <Users className="size-3.5 shrink-0 text-ink-subtle" aria-label="Compartilhado" />}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Excluir filtro ${v.name}`}
                      className="hover:text-red-600"
                      onClick={() => {
                        setOpen(false)
                        setDeleting(v)
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {team.length > 0 && (
            <section>
              <h3 className="px-2 pb-1 pt-1.5 text-caption font-semibold uppercase tracking-wide text-ink-subtle">Da equipe</h3>
              <ul>
                {team.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => apply(v)}
                      className="flex w-full flex-col rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-ink/[0.05]"
                    >
                      <span className="truncate text-body-sm text-ink">{v.name}</span>
                      <span className="truncate text-caption text-ink-subtle">{`por ${members.map.get(v.user_id) ?? 'colega'}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className={cn('mt-1 border-t border-line pt-1', all.length === 0 && 'mt-0 border-t-0 pt-0')}>
            <button
              type="button"
              disabled={!query}
              onClick={openSave}
              title={query ? undefined : 'Aplique algum filtro para poder salvá-lo'}
              className="w-full rounded-[var(--radius-control)] px-2 py-1.5 text-left text-body-sm font-medium text-accent-700 hover:bg-accent-50 disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-transparent"
            >
              Salvar filtros atuais…
            </button>
          </div>
        </div>
      )}

      <Modal
        open={saving}
        onClose={() => setSaving(false)}
        title="Salvar filtros"
        description="Guarde esta combinação de filtros para reaplicar com um clique."
        size="sm"
        footer={
          <>
            <Button onClick={() => setSaving(false)} disabled={save.isPending}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={submit} loading={save.isPending}>
              Salvar filtro
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label="Nome do filtro"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <Checkbox label="Compartilhar com a equipe" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          {error && <InlineError message={error} />}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? remove.mutateAsync(deleting.id) : undefined)}
        title="Excluir filtro"
        description={`O filtro "${deleting?.name ?? ''}" será excluído. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
      />
    </div>
  )
}
