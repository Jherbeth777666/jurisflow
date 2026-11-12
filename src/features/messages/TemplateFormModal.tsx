import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, InlineError, Input, Modal } from '@/components/ui'
import { useSaveMessageTemplate } from './api'
import { VARIABLE_GROUPS } from './segments'
import { VariableEditor, type VariableEditorHandle } from './VariableEditor'
import { VariableText } from './VariableText'
import { EXAMPLE_VALUES, fillTemplate, normalizeVariables, unknownVariables } from './variables'

export interface TemplateDraft {
  id?: string
  name: string
  subject: string
  body: string
}

const MAX_BODY = 2000

export function TemplateFormModal({
  open,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  initial: TemplateDraft | null
  onSaved?: (id: string) => void
}) {
  const save = useSaveMessageTemplate()
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<VariableEditorHandle>(null)
  const subjectRef = useRef<VariableEditorHandle>(null)
  const lastFocus = useRef<'body' | 'subject'>('body')

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setSubject(initial?.subject ?? '')
    setBody(initial?.body ?? '')
    setError(null)
  }, [open, initial])

  const unknown = [...unknownVariables(body), ...unknownVariables(subject)]

  // Insere no editor que teve foco por último (padrão: corpo)
  const insertVariable = (v: string) => {
    ;(lastFocus.current === 'subject' ? subjectRef : bodyRef).current?.insertVariable(v)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const n = name.trim()
    if (n.length < 2) return setError('Informe um nome com pelo menos 2 caracteres.')
    if (!body.trim()) return setError('Escreva o texto do modelo.')
    if (unknown.length) return setError(`Variáveis desconhecidas: ${unknown.join(', ')}`)
    try {
      const saved = await save.mutateAsync({
        id: initial?.id,
        name: n,
        subject: subject.trim() ? normalizeVariables(subject.trim()) : null,
        body: normalizeVariables(body.trim()),
      })
      onSaved?.(saved.id)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível salvar.'
      setError(msg === 'Registro duplicado.' ? 'Já existe um modelo com este nome.' : msg)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial?.id ? 'Editar modelo' : 'Novo modelo de mensagem'}
      description="Use variáveis para que os dados do cliente sejam preenchidos automaticamente."
      size="xl"
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="template-form" loading={save.isPending}>
            Salvar modelo
          </Button>
        </>
      }
    >
      <form id="template-form" onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Input label="Nome" required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-autofocus />
          <div onFocusCapture={() => (lastFocus.current = 'subject')}>
            <VariableEditor ref={subjectRef} label="Assunto (e-mail)" singleLine value={subject} onChange={setSubject} maxLength={160} />
          </div>
          <div onFocusCapture={() => (lastFocus.current = 'body')}>
            <VariableEditor
              ref={bodyRef}
              label="Texto"
              minRows={12}
              value={body}
              onChange={setBody}
              maxLength={MAX_BODY}
              error={unknown.length ? `Variáveis desconhecidas: ${unknown.join(', ')}` : null}
            />
            <p className="mt-1 text-right text-caption text-ink-subtle tabular">
              {body.length}/{MAX_BODY}
            </p>
          </div>
          <InlineError message={error} />
        </div>
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-label font-medium text-ink">Inserir variável</p>
            <div className="space-y-2.5">
              {VARIABLE_GROUPS.map((g) => (
                <div key={g.title}>
                  <p className="mb-1 text-caption font-medium uppercase tracking-wide text-ink-subtle">{g.title}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.variables.map((v) => (
                      <button
                        key={v.name}
                        type="button"
                        onClick={() => insertVariable(v.name)}
                        className="rounded-md bg-accent-50 px-1.5 py-0.5 text-caption text-accent-700 ring-1 ring-inset ring-accent-200 hover:bg-accent-100"
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-label font-medium text-ink">Prévia com dados de exemplo</p>
            <div
              className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas/60 p-3 text-label leading-relaxed text-ink scrollbar-thin"
              role="region"
              aria-label="Prévia da mensagem"
              tabIndex={0}
            >
              {body.trim() ? (
                <VariableText text={fillTemplate(body, EXAMPLE_VALUES).text} />
              ) : (
                <span className="text-ink-subtle">O texto aparecerá aqui.</span>
              )}
            </div>
          </div>
        </div>
      </form>
    </Modal>
  )
}
