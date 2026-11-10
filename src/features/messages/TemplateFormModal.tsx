import { useRef, useState, type FormEvent } from 'react'
import { Button, InlineError, Input, Modal, Textarea } from '@/components/ui'
import { useSaveMessageTemplate } from './api'
import { VariableText } from './VariableText'
import { EXAMPLE_VALUES, MESSAGE_VARIABLES, fillTemplate, normalizeVariables, unknownVariables } from './variables'

export interface TemplateDraft {
  id?: string
  name: string
  subject: string
  body: string
}

const MAX_BODY = 2000

interface TemplateFormModalProps {
  open: boolean
  onClose: () => void
  initial: TemplateDraft | null
  onSaved?: (id: string) => void
}

/** Estado recriado a cada abertura (chave), sem efeito de reinício. */
export function TemplateFormModal(props: TemplateFormModalProps) {
  if (!props.open) return null
  return <TemplateForm key={props.initial?.id ?? 'novo'} {...props} />
}

function TemplateForm({ open, onClose, initial, onSaved }: TemplateFormModalProps) {
  const save = useSaveMessageTemplate()
  const [name, setName] = useState(initial?.name ?? '')
  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const unknown = [...unknownVariables(body), ...unknownVariables(subject)]

  const insertVariable = (v: string) => {
    const el = bodyRef.current
    const token = `{{${v}}}`
    if (!el) return setBody((b) => b + token)
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    if (next.length > MAX_BODY) return
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const n = name.trim()
    if (n.length < 2) return setError('Informe um nome com pelo menos 2 caracteres.')
    if (!body.trim()) return setError('Escreva o texto do modelo.')
    if (unknown.length) return setError(`Variáveis desconhecidas: ${unknown.join(', ')}.`)
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
      dirty={save.isPending || name !== (initial?.name ?? '') || subject !== (initial?.subject ?? '') || body !== (initial?.body ?? '')}
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
          <Input label="Assunto (e-mail)" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />
          <div>
            <Textarea
              ref={bodyRef}
              label="Texto"
              required
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={MAX_BODY}
              error={unknown.length ? `Variáveis desconhecidas: ${unknown.map((v) => `{{${v}}}`).join(', ')}` : null}
            />
            <p className="mt-1 text-right text-[12px] text-ink-subtle tabular">
              {body.length}/{MAX_BODY}
            </p>
          </div>
          <InlineError message={error} />
        </div>
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-ink">Inserir variável</p>
            <div className="flex flex-wrap gap-1.5">
              {MESSAGE_VARIABLES.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  title={v.label}
                  onClick={() => insertVariable(v.name)}
                  className="rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-accent-700 hover:border-accent-200 hover:bg-accent-50"
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-ink">Prévia com dados de exemplo</p>
            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas/60 p-3 text-[12.5px] leading-relaxed text-ink scrollbar-thin">
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
