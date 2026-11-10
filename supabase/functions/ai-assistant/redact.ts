// Remoção de identificadores pessoais digitados pelo usuário (e defesa em
// profundidade sobre textos vindos do banco) antes de qualquer envio ao provedor.
// Módulo puro.

export type RedactionKind = 'email' | 'cnpj' | 'cpf' | 'telefone'

export const REDACTED = '[dado removido]'

// Ordem importa: e-mail → CNPJ → CPF → telefone (do mais específico ao mais genérico).
const PATTERNS: { kind: RedactionKind; re: RegExp }[] = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g },
  { kind: 'cnpj', re: /(?<![\d])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![\d])/g },
  { kind: 'cpf', re: /(?<![\d])\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?![\d])/g },
  // Telefones BR: +55 opcional, DDD com/sem parênteses, 8 ou 9 dígitos com separador opcional
  { kind: 'telefone', re: /(?<![\d])(?:\+?55[\s-]?)?(?:\(\d{2}\)|\d{2})[\s-]?9?\d{4}[\s-]?\d{4}(?![\d])/g },
]

export interface RedactionResult {
  text: string
  removed: RedactionKind[]
}

export function redactPII(input: string): RedactionResult {
  let text = input
  const removed = new Set<RedactionKind>()
  for (const { kind, re } of PATTERNS) {
    text = text.replace(re, () => {
      removed.add(kind)
      return REDACTED
    })
  }
  return { text, removed: [...removed] }
}

// Campos estruturais (UUIDs e datas) não passam pela redação — evitam falsos positivos.
const STRUCTURAL_KEY = /^(id|.*_id|today|from|to|week_start|week_end|.*_date)$/

/** Aplica redactPII em todas as strings de texto livre de um valor JSON (resultados de ferramentas). */
export function redactDeep<T>(value: T, key?: string): T {
  if (typeof value === 'string') return (key && STRUCTURAL_KEY.test(key) ? value : redactPII(value).text) as T
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, key)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, k)
    return out as T
  }
  return value
}
