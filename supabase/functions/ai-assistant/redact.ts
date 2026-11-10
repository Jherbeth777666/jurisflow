// Remoção de identificadores pessoais digitados pelo usuário (e defesa em
// profundidade sobre textos vindos do banco) antes de qualquer envio ao provedor.
// Módulo puro.

export type RedactionKind = 'email' | 'cnpj' | 'cpf' | 'nb' | 'rg' | 'telefone'

export const REDACTED = '[dado removido]'
export const LINK_REMOVED = '[link removido]'

// Separador "ponto" de e-mails ofuscados: ".", " . ", "(ponto)", " dot "
const DOT = String.raw`(?:\s*\.\s*|\s*[([{]\s*(?:ponto|dot)\s*[)\]}]\s*|\s+(?:ponto|dot)\s+)`
// "@" ofuscado: "(arroba)", "[at]", " arroba ", " at ", " @ "
const AT = String.raw`(?:\s*[([{]\s*(?:arroba|at)\s*[)\]}]\s*|\s+(?:arroba|at)\s+|\s*@\s*)`
const OBFUSCATED_EMAIL = new RegExp(String.raw`[A-Za-z0-9._%+-]+${AT}[A-Za-z0-9-]+(?:${DOT}[A-Za-z0-9-]+)*${DOT}[A-Za-z]{2,6}(?![A-Za-z0-9])`, 'gi')

const digitsCount = (s: string) => s.replace(/\D/g, '').length

// Ordem importa: do mais específico ao mais genérico.
const PATTERNS: { kind: RedactionKind; re: RegExp; accept?: (m: string) => boolean }[] = [
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g },
  { kind: 'email', re: OBFUSCATED_EMAIL },
  { kind: 'cnpj', re: /(?<![\d])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?![\d])/g },
  { kind: 'cpf', re: /(?<![\d])\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?![\d])/g },
  // NB (número de benefício do INSS): NNN.NNN.NNN-N, ou rotulado ("NB 1234567890", "benefício nº ...")
  { kind: 'nb', re: /(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d(?![\d])/g },
  {
    kind: 'nb',
    re: /\b(?:NB|N\.B\.|benef[ií]cio\s+n(?:[º°o.]|úmero|umero)*)[\s:#º°]*\d[\d.\-\s]{7,14}\d(?![\d])/gi,
    accept: (m) => digitsCount(m) >= 9 && digitsCount(m) <= 11,
  },
  // RG: XX.XXX.XXX-X (dígito verificador obrigatório para não pegar valores como 12.345.678)
  { kind: 'rg', re: /(?<![\d.])\d{1,2}\.\d{3}\.\d{3}-[\dXx](?![\dA-Za-z])/g },
  { kind: 'rg', re: /\bRG[\s:#º°nN.]*\d[\d.\-\s]{5,12}[\dXx](?![\d])/g, accept: (m) => digitsCount(m) >= 6 },
  // Telefones 0800/0300
  { kind: 'telefone', re: /(?<![\d])0[38]00[\s-]?\d{3}[\s-]?\d{4}(?![\d])/g },
  // Telefones BR: +55 opcional, DDD com/sem parênteses, 9 opcional (inclusive separado), 4+4 dígitos
  {
    kind: 'telefone',
    re: /(?<![\d])(?:\+?55[\s-]?)?(?:\(\s?\d{2}\s?\)|\d{2})[\s-]?(?:9[\s-]?)?\d{4}[\s-]?\d{4}(?![\d])/g,
  },
]

export interface RedactionResult {
  text: string
  removed: RedactionKind[]
}

export function redactPII(input: string): RedactionResult {
  let text = input
  const removed = new Set<RedactionKind>()
  for (const { kind, re, accept } of PATTERNS) {
    text = text.replace(re, (m) => {
      if (accept && !accept(m)) return m
      removed.add(kind)
      return REDACTED
    })
  }
  return { text, removed: [...removed] }
}

const TLD = 'com|net|org|br|io|app|dev|xyz|info|me|co|site|online|link|ly|gl|gov|edu|biz|top|club|shop|store|example|tk|ru|cn|page|ai'
// URLs com esquema, "www." ou domínio "nu" com TLD comum (ex.: evil.com/login, bit.ly/x)
const URL_RE = new RegExp(
  String.raw`(?:\b(?:https?|ftp):\/\/|\bwww\.)[^\s<>"']+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:${TLD})\b(?:[/?#][^\s<>"']*)?`,
  'gi',
)

/** Remove links de texto livre (dados não confiáveis podem trazer phishing). */
export function stripUrls(input: string): string {
  return input.replace(URL_RE, LINK_REMOVED)
}

export function containsUrl(input: string): boolean {
  URL_RE.lastIndex = 0
  const r = URL_RE.test(input)
  URL_RE.lastIndex = 0
  return r
}

// Campos estruturais (UUIDs e datas) não passam pela redação — evitam falsos positivos.
const STRUCTURAL_KEY = /^(id|.*_id|today|from|to|week_start|week_end|.*_date)$/

/**
 * Aplica redactPII + remoção de links em todas as strings de texto livre de um
 * valor JSON (resultados de ferramentas).
 */
export function redactDeep<T>(value: T, key?: string): T {
  if (typeof value === 'string') return (key && STRUCTURAL_KEY.test(key) ? value : stripUrls(redactPII(value).text)) as T
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, key)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, k)
    return out as T
  }
  return value
}
