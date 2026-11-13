// Remoção de identificadores pessoais digitados pelo usuário (e defesa em
// profundidade sobre textos vindos do banco) antes de qualquer envio ao provedor.
// Módulo puro.

export type RedactionKind = 'email' | 'cnpj' | 'cpf' | 'telefone' | 'cid' | 'nb' | 'nit'

export const REDACTED = '[dado removido]'
export const CID_REDACTED = '[CID-OCULTO]'
export const PREVIDENCIARIO_REDACTED = '[DOC-PREVIDENCIARIO]'

interface RedactionRule {
  kind: RedactionKind
  re: RegExp
  /** Recebe o prefixo capturado (quando houver) para preservá-lo no texto. */
  replace: (prefix?: string) => string
}

const keepRedacted = () => REDACTED
const keepPrefix = (prefix?: string) => `${prefix ?? ''}${PREVIDENCIARIO_REDACTED}`
const keepCidPrefix = (prefix?: string) => `${prefix ?? ''}${CID_REDACTED}`

// Ordem importa: identificadores de contato/documento primeiro, depois dados de
// saúde/previdenciários (NB antes de CPF/telefone), por fim as regras genéricas.
const PATTERNS: RedactionRule[] = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, replace: keepRedacted },
  { kind: 'cnpj', re: /(?<![\d])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![\d])/g, replace: keepRedacted },

  // CID-10 com ponto é sempre código de saúde (ex.: M54.5, F32.2).
  { kind: 'cid', re: /\b[A-TV-Z]\d{2}\.\d{1,2}\b/g, replace: () => CID_REDACTED },
  // CID-11 com ponto (ex.: 6A70.0) apenas com prefixo CID.
  {
    kind: 'cid',
    re: /(CID(?:[-\s]?(?:10|11))?[:\s]*)(\d[A-TV-Z]\d{2}\.\d{1,2})\b/gi,
    replace: keepCidPrefix,
  },
  // CID sem ponto apenas quando precedido por CID (ex.: "CID M54", "cid 10 G40").
  {
    kind: 'cid',
    re: /(CID(?:[-\s]?(?:10|11))?[:\s]*)([A-TV-Z]\d{2})\b/gi,
    replace: keepCidPrefix,
  },

  // NIT/PIS/PASEP com máscara (11 dígitos sem máscara continuam caindo em CPF).
  { kind: 'nit', re: /(?<![\d])\d{3}\.\d{5}\.\d{2}-\d(?![\d])/g, replace: () => PREVIDENCIARIO_REDACTED },
  // NB formatado (ex.: 123.456.789-0) é sempre número de benefício.
  { kind: 'nb', re: /(?<![\d])\d{3}\.\d{3}\.\d{3}-\d(?![\d])/g, replace: () => PREVIDENCIARIO_REDACTED },
  // NB de 10 dígitos só com contexto previdenciário próximo (até ~15 caracteres).
  {
    kind: 'nb',
    re: /((?:NB|benef[ií]cio|B\.\s?\d{2})[^\d\n]{0,15})(?<!\d)\d{10}(?!\d)/gi,
    replace: keepPrefix,
  },

  { kind: 'cpf', re: /(?<![\d])\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?![\d])/g, replace: keepRedacted },
  // Telefones BR: +55 opcional, DDD com/sem parênteses, 8 ou 9 dígitos com separador opcional
  {
    kind: 'telefone',
    re: /(?<![\d])(?:\+?55[\s-]?)?(?:\(\d{2}\)|\d{2})[\s-]?9?\d{4}[\s-]?\d{4}(?![\d])/g,
    replace: keepRedacted,
  },
]

export interface RedactionResult {
  text: string
  removed: RedactionKind[]
}

export function redactPII(input: string): RedactionResult {
  let text = input
  const removed = new Set<RedactionKind>()
  for (const { kind, re, replace } of PATTERNS) {
    text = text.replace(re, (_match, prefix?: string) => {
      removed.add(kind)
      return replace(prefix)
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
