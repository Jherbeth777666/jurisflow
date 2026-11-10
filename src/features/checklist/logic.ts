// Lógica pura do checklist (testável).
import { CHECKLIST_LABEL_MAX } from './types'

export interface Progress {
  done: number
  total: number
  percent: number
  complete: boolean
}

export function checklistProgress(items: { done: boolean }[]): Progress {
  const total = items.length
  const done = items.filter((i) => i.done).length
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0, complete: total > 0 && done === total }
}

export const normalizeLabel = (s: string) => s.trim().replace(/\s+/g, ' ')
const key = (s: string) => normalizeLabel(s).toLocaleLowerCase('pt-BR')

export type LabelCheck = { ok: true; label: string } | { ok: false; error: string }

/** Valida um rótulo novo/renomeado contra os existentes (ignorando o próprio item). */
export function validateLabel(raw: string, existing: { id: string; label: string }[], selfId?: string): LabelCheck {
  const label = normalizeLabel(raw)
  if (!label) return { ok: false, error: 'Informe o item.' }
  if (label.length > CHECKLIST_LABEL_MAX) return { ok: false, error: `Máximo de ${CHECKLIST_LABEL_MAX} caracteres.` }
  if (existing.some((e) => e.id !== selfId && key(e.label) === key(label))) {
    return { ok: false, error: 'Este item já está na lista.' }
  }
  return { ok: true, label }
}

/** Move o item de índice `from` uma posição para cima (-1) ou para baixo (+1). Retorna nova ordem de ids. */
export function moveItem<T extends { id: string }>(items: T[], id: string, delta: -1 | 1): T[] | null {
  const from = items.findIndex((i) => i.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= items.length) return null
  const next = items.slice()
  const [it] = next.splice(from, 1)
  next.splice(to, 0, it)
  return next
}

export const pendingLabels = (items: { done: boolean; label: string; position: number }[]) =>
  items
    .filter((i) => !i.done)
    .sort((a, b) => a.position - b.position)
    .map((i) => i.label)
