import {
  forwardRef,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { Button, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { insertVariable as insertToken, replaceVariable, toSegments } from './segments'
import { normalizeVariables, variableLabel } from './variables'

export interface VariableEditorHandle {
  /** Insere a variável no cursor (ou no fim, se não houver cursor no editor). */
  insertVariable: (name: string) => void
  focus: () => void
}

export interface VariableEditorProps {
  value: string
  onChange: (text: string) => void
  label: string
  singleLine?: boolean
  maxLength?: number
  error?: string | null
  minRows?: number
  /** 'compose': todas as variáveis são tratadas como sem dado (âmbar) e podem ser preenchidas na hora. */
  mode?: 'template' | 'compose'
  onFillVariable?: (name: string, value: string) => void
}

const control =
  'w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-body text-ink shadow-[var(--shadow-xs)] ' +
  'transition-[border-color,box-shadow] hover:border-ink-subtle/40 focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100 ' +
  'aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-100'

const ZWSP = '​'

const TAG_BASE ='mx-px inline-block rounded-md px-1.5 text-label align-baseline ring-1 ring-inset select-none '
const TAG_KNOWN = TAG_BASE + 'bg-accent-50 text-accent-700 ring-accent-200'
const TAG_UNKNOWN = TAG_BASE + 'bg-red-50 text-red-700 ring-red-200'
const TAG_MISSING = TAG_BASE + 'cursor-pointer bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100'

/** Texto serializado de um nó (texto + `{{variável}}`). */
function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/​/g, '')
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return ''
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement
    if (el.dataset.var) return `{{${el.dataset.var}}}`
    if (el.tagName === 'BR') return '\n'
  }
  return Array.from(node.childNodes).map(serializeNode).join('')
}

function buildTag(name: string, known: boolean, compose: boolean): HTMLElement {
  const tag = document.createElement('span')
  tag.setAttribute('contenteditable', 'false')
  tag.dataset.var = name
  const label = variableLabel(name)
  if (compose) {
    tag.setAttribute('role', 'button')
    tag.setAttribute('tabindex', '0')
    tag.className = TAG_MISSING
    tag.textContent = `Falta: ${label}`
  } else if (known) {
    tag.className = TAG_KNOWN
    tag.textContent = label
  } else {
    tag.className = TAG_UNKNOWN
    tag.textContent = `Variável desconhecida: ${name}`
  }
  return tag
}

export const VariableEditor = forwardRef<VariableEditorHandle, VariableEditorProps>(function VariableEditor(
  { value, onChange, label, singleLine = false, maxLength, error, minRows = 6, mode = 'template', onFillVariable },
  ref,
) {
  const id = useId()
  const editorRef = useRef<HTMLDivElement>(null)
  const lastValue = useRef(value)
  const [raw, setRaw] = useState(false)
  const [fill, setFill] = useState<{ name: string; value: string } | null>(null)
  const compose = mode === 'compose'

  // Última posição do cursor dentro do editor (serializada). Usada quando o foco sai para o seletor de variáveis.
  const savedOffset = useRef<number | null>(null)

  const renderDom = (text: string) => {
    const el = editorRef.current
    if (!el) return
    const segments = toSegments(text)
    const nodes: Node[] = segments.map((s) =>
      s.kind === 'text' ? document.createTextNode(s.text) : buildTag(s.name, s.known, compose),
    )
    // Espaço invisível (removido ao serializar) antes/depois de etiquetas nas pontas: sem ele o
    // navegador não consegue pôr o cursor antes da primeira ou depois da última etiqueta.
    if (segments[0]?.kind === 'var') nodes.unshift(document.createTextNode(ZWSP))
    if (segments[segments.length - 1]?.kind === 'var') nodes.push(document.createTextNode(ZWSP))
    el.replaceChildren(...nodes)
  }

  const currentText = () => (editorRef.current ? serializeNode(editorRef.current) : lastValue.current)

  // Reconstrói ao trocar de modo (etiquetas muda de aparência) ou ao voltar da visão de texto
  useLayoutEffect(() => {
    if (!raw) renderDom(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, compose])

  // Sincroniza mudanças externas do valor sem mexer no cursor quando o DOM já está igual
  useLayoutEffect(() => {
    lastValue.current = value
    if (!raw && editorRef.current && serializeNode(editorRef.current) !== value) renderDom(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const emit = (text: string) => {
    lastValue.current = text
    onChange(text)
  }

  const selectionRange = (): Range | null => {
    const el = editorRef.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0) return null
    const r = sel.getRangeAt(0)
    return el.contains(r.startContainer) ? r : null
  }

  const offsetOf = (r: Range): number => {
    const el = editorRef.current!
    const pre = document.createRange()
    pre.selectNodeContents(el)
    pre.setEnd(r.startContainer, r.startOffset)
    return serializeNode(pre.cloneContents()).length
  }

  const rememberCaret = () => {
    const r = selectionRange()
    if (r) savedOffset.current = offsetOf(r)
  }

  const placeCaret = (offset: number) => {
    const el = editorRef.current
    const sel = window.getSelection()
    if (!el || !sel) return
    const range = document.createRange()
    let acc = 0
    let placed = false
    const nodes = Array.from(el.childNodes)
    for (let i = 0; i < nodes.length && !placed; i++) {
      const n = nodes[i]
      const len = serializeNode(n).length
      if (offset <= acc + len) {
        if (n.nodeType === Node.TEXT_NODE) range.setStart(n, offset - acc)
        else range.setStartAfter(n)
        placed = true
      }
      acc += len
    }
    if (!placed) {
      range.selectNodeContents(el)
      range.collapse(false)
    }
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }

  const insertPlainText = (text: string) => {
    const r = selectionRange()
    if (!r) return
    r.deleteContents()
    const node = document.createTextNode(text)
    r.insertNode(node)
    r.setStartAfter(node)
    r.collapse(true)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
    editorRef.current?.normalize()
    emit(currentText())
  }

  useImperativeHandle(ref, () => ({
    insertVariable(name: string) {
      if (raw) {
        emit(insertToken(lastValue.current, lastValue.current.length, name).text)
        return
      }
      const text = currentText()
      const r = selectionRange()
      const at = r ? offsetOf(r) : (savedOffset.current ?? text.length)
      const next = insertToken(text, Math.min(at, text.length), name)
      if (maxLength && next.text.length > maxLength) return
      renderDom(next.text)
      editorRef.current?.focus()
      placeCaret(next.caret)
      savedOffset.current = next.caret
      emit(next.text)
    },
    focus() {
      ;(raw ? undefined : editorRef.current)?.focus()
    },
  }))

  const onInput = () => {
    const text = currentText()
    if (maxLength && text.length > maxLength) {
      renderDom(lastValue.current)
      placeCaret(lastValue.current.length)
      return
    }
    emit(text)
  }

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    let text = e.clipboardData.getData('text/plain')
    if (singleLine) text = text.replace(/\s*\n\s*/g, ' ')
    if (maxLength) text = text.slice(0, Math.max(0, maxLength - currentText().length))
    if (text) insertPlainText(text)
  }

  const openFill = (el: HTMLElement | null) => {
    const name = el?.closest<HTMLElement>('[data-var]')?.dataset.var
    if (compose && name) setFill({ name, value: '' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target !== e.currentTarget && target.dataset.var) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openFill(target)
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!singleLine && !(maxLength && currentText().length >= maxLength)) insertPlainText('\n')
    }
  }

  const applyFill = () => {
    if (!fill || !fill.value.trim()) return
    const next = replaceVariable(currentText(), fill.name, fill.value.trim())
    onFillVariable?.(fill.name, fill.value.trim())
    setFill(null)
    emit(next)
  }

  const fillLabel = fill ? `Preencher ${variableLabel(fill.name)}` : ''

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span id={`${id}-label`} className="text-label font-medium text-ink">
          {label}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setFill(null)
            setRaw((v) => !v)
          }}
        >
          {raw ? 'Ver com etiquetas' : 'Ver como texto'}
        </Button>
      </div>
      {raw ? (
        <textarea
          aria-label={label}
          aria-invalid={!!error || undefined}
          rows={singleLine ? 1 : minRows}
          maxLength={maxLength}
          value={value}
          onChange={(e) => emit(singleLine ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
          className={cn(control, 'py-2 leading-relaxed resize-y font-mono text-body-sm')}
        />
      ) : (
        <div
          ref={editorRef}
          role="textbox"
          aria-multiline={!singleLine}
          aria-label={label}
          aria-invalid={!!error || undefined}
          contentEditable
          spellCheck
          onInput={onInput}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onDrop={(e) => e.preventDefault()}
          onClick={(e) => openFill(e.target as HTMLElement)}
          onKeyUp={rememberCaret}
          onMouseUp={rememberCaret}
          onBlur={() => {
            rememberCaret()
            const text = currentText()
            const normalized = normalizeVariables(text)
            // Só remonta se a pessoa digitou um {{nome}} completo (vira etiqueta); senão preserva o DOM.
            if (normalized !== text || /\{\{[^}]*\}\}/.test(text)) {
              renderDom(normalized)
              if (normalized !== text) emit(normalized)
            }
          }}
          style={singleLine ? undefined : { minHeight: `${minRows * 1.625}em` }}
          className={cn(
            control,
            'py-2 leading-relaxed',
            singleLine ? 'overflow-x-auto whitespace-nowrap' : 'whitespace-pre-wrap break-words',
          )}
        />
      )}
      {compose && fill && (
        <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius-control)] border border-amber-200 bg-amber-50 p-2">
          <Input
            label={fillLabel}
            value={fill.value}
            onChange={(e) => setFill({ ...fill, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyFill()
              }
            }}
            wrapperClassName="min-w-0 flex-1"
            data-autofocus
          />
          <Button size="sm" variant="primary" onClick={applyFill} disabled={!fill.value.trim()}>
            Aplicar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFill(null)}>
            Cancelar
          </Button>
        </div>
      )}
      {error && <p className="text-caption text-red-600">{error}</p>}
    </div>
  )
})
