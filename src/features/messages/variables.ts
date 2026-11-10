// Variáveis de modelos de mensagem: extrair, validar e preencher. Módulo puro.

export const MESSAGE_VARIABLES = [
  { name: 'primeiro_nome', label: 'Primeiro nome do cliente', example: 'Maria' },
  { name: 'nome_escritorio', label: 'Nome do escritório', example: 'Escritório Exemplo' },
  { name: 'categoria', label: 'Categoria da demanda', example: 'Salário-maternidade' },
  { name: 'etapa', label: 'Etapa atual da demanda', example: 'Preparação do requerimento' },
  { name: 'proxima_atividade', label: 'Próxima atividade', example: 'Conferência dos documentos' },
  { name: 'data_proxima_atividade', label: 'Data da próxima atividade', example: '18/11/2026' },
  { name: 'responsavel', label: 'Responsável pela demanda', example: 'Dra. Ana' },
  { name: 'documentos_pendentes', label: 'Itens pendentes do checklist', example: '• Comprovante de residência\n• Extrato CNIS' },
  { name: 'valor_parcela', label: 'Valor da próxima parcela', example: 'R$ 500,00' },
  { name: 'vencimento_parcela', label: 'Vencimento da próxima parcela', example: '10/12/2026' },
] as const

export type MessageVariable = (typeof MESSAGE_VARIABLES)[number]['name']
export type VariableValues = Partial<Record<MessageVariable, string | null | undefined>>

export const VARIABLE_NAMES: readonly string[] = MESSAGE_VARIABLES.map((v) => v.name)

const VAR_RE = /\{\{\s*([a-z][a-z0-9_]{0,40})\s*\}\}/g

export const isKnownVariable = (name: string): name is MessageVariable => VARIABLE_NAMES.includes(name)

/** Variáveis na ordem da primeira ocorrência (sem repetição). */
export function extractVariables(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

export function unknownVariables(text: string): string[] {
  return extractVariables(text).filter((v) => !isKnownVariable(v))
}

/** Normaliza `{{ nome }}` → `{{nome}}`. */
export function normalizeVariables(text: string): string {
  return text.replace(VAR_RE, (_, n: string) => `{{${n}}}`)
}

export interface FillResult {
  text: string
  /** Variáveis sem valor (permanecem no texto como {{nome}}) */
  missing: string[]
}

/** Substitui as variáveis conhecidas que têm valor; as demais ficam visíveis no texto. */
export function fillTemplate(template: string, values: VariableValues): FillResult {
  const missing: string[] = []
  const text = template.replace(VAR_RE, (_whole, name: string) => {
    const v = isKnownVariable(name) ? values[name] : undefined
    if (v === undefined || v === null || v.trim() === '') {
      if (!missing.includes(name)) missing.push(name)
      return `{{${name}}}`
    }
    return v
  })
  return { text, missing }
}

/** Variáveis ainda não resolvidas em um texto já preenchido/editado. */
export function unresolvedVariables(text: string): string[] {
  return extractVariables(text)
}

export type RewriteValidation = { ok: true; text: string } | { ok: false; error: string }

/**
 * Valida a reescrita da IA (defesa em profundidade — o servidor também valida):
 * o conjunto de variáveis deve ser exatamente o mesmo do original.
 */
export function validateRewrite(original: string, rewritten: string): RewriteValidation {
  const text = normalizeVariables(rewritten.trim())
  if (!text) return { ok: false, error: 'A IA não devolveu texto.' }
  const a = [...extractVariables(original)].sort()
  const b = [...extractVariables(text)].sort()
  const missing = a.filter((v) => !b.includes(v))
  const invented = b.filter((v) => !a.includes(v))
  if (missing.length) return { ok: false, error: `A IA removeu variáveis (${missing.join(', ')}). O texto foi mantido.` }
  if (invented.length) return { ok: false, error: `A IA criou variáveis inexistentes (${invented.join(', ')}). O texto foi mantido.` }
  return { ok: true, text }
}

/** "MARIA DA SILVA" → "Maria"; "  ana  paula" → "Ana". */
export function firstName(fullName: string | null | undefined): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? ''
  if (!first) return ''
  const lower = first.toLocaleLowerCase('pt-BR')
  return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1)
}

/** Lista de pendências para o corpo da mensagem (uma por linha, com marcador). */
export function formatPendingList(labels: string[]): string | null {
  const clean = labels.map((l) => l.trim()).filter(Boolean)
  if (!clean.length) return null
  return clean.map((l) => `• ${l}`).join('\n')
}

/** Divide o texto em partes para destacar variáveis na prévia. */
export function splitByVariables(text: string): { text: string; variable: boolean }[] {
  const parts: { text: string; variable: boolean }[] = []
  let last = 0
  for (const m of text.matchAll(VAR_RE)) {
    const i = m.index ?? 0
    if (i > last) parts.push({ text: text.slice(last, i), variable: false })
    parts.push({ text: m[1], variable: true })
    last = i + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last), variable: false })
  return parts
}

export const EXAMPLE_VALUES: VariableValues = Object.fromEntries(MESSAGE_VARIABLES.map((v) => [v.name, v.example]))

export const variableLabel = (name: string) => MESSAGE_VARIABLES.find((v) => v.name === name)?.label ?? name
