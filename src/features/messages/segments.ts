// Segmentos de texto com variáveis: base do editor com etiquetas. Módulo puro.
import { MESSAGE_VARIABLES, isKnownVariable } from './variables'

export type Segment = { kind: 'text'; text: string } | { kind: 'var'; name: string; known: boolean }

// Mesmo padrão de variables.ts (aceita espaços dentro das chaves)
const VAR_RE = /\{\{\s*([a-z][a-z0-9_]{0,40})\s*\}\}/g

export function toSegments(text: string): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(VAR_RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ kind: 'text', text: text.slice(last, i) })
    out.push({ kind: 'var', name: m[1], known: isKnownVariable(m[1]) })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

export function fromSegments(segments: Segment[]): string {
  return segments.map((s) => (s.kind === 'text' ? s.text : `{{${s.name}}}`)).join('')
}

/** Insere `{{name}}` na posição `offset` (caracteres do texto serializado). */
export function insertVariable(text: string, offset: number, name: string): { text: string; caret: number } {
  const at = Math.max(0, Math.min(offset, text.length))
  const token = `{{${name}}}`
  return { text: text.slice(0, at) + token + text.slice(at), caret: at + token.length }
}

/** Substitui todas as ocorrências de `{{name}}` por texto puro (chaves do valor são removidas). */
export function replaceVariable(text: string, name: string, value: string): string {
  const clean = value.replace(/[{}]/g, '')
  return text.replace(VAR_RE, (whole, n: string) => (n === name ? clean : whole))
}

const GROUPS: { title: string; names: string[] }[] = [
  { title: 'Cliente', names: ['primeiro_nome'] },
  {
    title: 'Demanda',
    names: ['categoria', 'etapa', 'proxima_atividade', 'data_proxima_atividade', 'responsavel', 'documentos_pendentes'],
  },
  { title: 'Financeiro', names: ['valor_parcela', 'vencimento_parcela'] },
  { title: 'Escritório', names: ['nome_escritorio'] },
]

export const VARIABLE_GROUPS = GROUPS.map((g) => ({
  title: g.title,
  variables: g.names.flatMap((n) => MESSAGE_VARIABLES.filter((v) => v.name === n)),
}))
