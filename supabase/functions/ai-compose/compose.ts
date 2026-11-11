// Lógica pura da Edge Function `ai-compose` (testável com vitest, sem APIs do Deno).
//
// Privacidade por construção: o provedor recebe SOMENTE o modelo de mensagem com
// as variáveis {{...}} ainda NÃO substituídas + a instrução de tom. Nomes, valores
// e datas reais são preenchidos depois, no navegador. Se o modelo contiver
// CPF/telefone/e-mail digitados, a requisição é recusada (não há o que "limpar").
// Dados de saúde/previdenciários (CID, NB, NIT) são redigidos antes do envio.

import { redactPII } from '../ai-assistant/redact.ts'

export const MAX_TEMPLATE_CHARS = 2000
export const MAX_OUTPUT_CHARS = 2400
export const MAX_BODY_BYTES = 8 * 1024

export type ComposeTone = 'formal' | 'simples' | 'curto'

export const TONE_INSTRUCTIONS: Record<ComposeTone, string> = {
  formal:
    'Reescreva em tom mais formal e profissional, mantendo a cordialidade. Use tratamento respeitoso, sem jargão jurídico excessivo.',
  simples:
    'Reescreva em linguagem mais simples, clara e acolhedora, como uma conversa gentil com alguém que não conhece termos jurídicos. Frases curtas.',
  curto:
    'Reescreva de forma mais curta e direta, mantendo apenas o essencial e a cordialidade. Ideal para leitura rápida no WhatsApp.',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** {{ nome_variavel }} — apenas letras minúsculas, dígitos e _ */
const VAR_RE = /\{\{\s*([a-z][a-z0-9_]{0,40})\s*\}\}/g

export interface ComposeRequest {
  organizationId: string
  template: string
  tone: ComposeTone
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string }

export function validateComposeBody(raw: unknown): Validation<ComposeRequest> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Corpo da requisição inválido.' }
  const b = raw as Record<string, unknown>
  if (typeof b.organization_id !== 'string' || !UUID_RE.test(b.organization_id)) {
    return { ok: false, error: 'organization_id inválido.' }
  }
  if (typeof b.tone !== 'string' || !(b.tone in TONE_INSTRUCTIONS)) {
    return { ok: false, error: 'Tom inválido. Use: formal, simples ou curto.' }
  }
  if (typeof b.template !== 'string') return { ok: false, error: 'Modelo obrigatório.' }
  const template = b.template.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (!template) return { ok: false, error: 'Modelo obrigatório.' }
  if (template.length > MAX_TEMPLATE_CHARS) {
    return { ok: false, error: `O modelo deve ter no máximo ${MAX_TEMPLATE_CHARS} caracteres.` }
  }
  return { ok: true, value: { organizationId: b.organization_id.toLowerCase(), template, tone: b.tone as ComposeTone } }
}

/** Conjunto (ordenado) de variáveis presentes no texto. */
export function extractPlaceholders(text: string): string[] {
  const set = new Set<string>()
  for (const m of text.matchAll(VAR_RE)) set.add(m[1])
  return [...set].sort()
}

/** Normaliza `{{ nome }}` → `{{nome}}`. */
export function normalizePlaceholders(text: string): string {
  return text.replace(VAR_RE, (_, name: string) => `{{${name}}}`)
}

export function buildComposeSystemPrompt(): string {
  return [
    'Você ajusta o tom de modelos de mensagem que um escritório de advocacia envia a clientes por WhatsApp ou e-mail.',
    'Regras obrigatórias:',
    '1. Responda SOMENTE com o texto reescrito, em português do Brasil, sem comentários, aspas ou explicações.',
    '2. O texto contém marcadores no formato {{nome_da_variavel}}. Preserve CADA marcador exatamente como está (mesma grafia, com chaves duplas). Não traduza, não renomeie e não remova nenhum.',
    '3. Não crie marcadores novos e não use colchetes ou outros espaços reservados (como [nome] ou <data>).',
    '4. Não invente nomes, datas, valores, números de processo, telefones, links ou fatos que não estejam no texto.',
    '5. Não prometa resultados nem prazos de decisões (ex.: "seu benefício será aprovado"). Não dê orientação jurídica nova.',
    '6. Mantenha o mesmo objetivo e as mesmas informações da mensagem original.',
  ].join('\n')
}

export function buildComposeUserMessage(template: string, tone: ComposeTone): string {
  return `${TONE_INSTRUCTIONS[tone]}\n\nModelo:\n<<<\n${redactPII(template).text}\n>>>`
}

/** Remove cercas de código/aspas/delimitadores que alguns modelos acrescentam. */
export function cleanModelOutput(text: string): string {
  let t = text.trim()
  t = t.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```$/, '').trim()
  t = t.replace(/^<<<\s*\n?/, '').replace(/\n?>>>$/, '').trim()
  if (t.length >= 2 && /^["“'].*["”']$/s.test(t)) t = t.slice(1, -1).trim()
  return normalizePlaceholders(t)
}

export type RewriteCheck = { ok: true; text: string } | { ok: false; error: string }

/**
 * Aceita a reescrita somente se ela preserva exatamente o mesmo conjunto de
 * variáveis do original e não introduz espaços reservados inventados.
 */
export function checkRewrite(original: string, rewrittenRaw: string): RewriteCheck {
  const text = cleanModelOutput(rewrittenRaw)
  if (!text) return { ok: false, error: 'A IA não devolveu texto.' }
  if (text.length > MAX_OUTPUT_CHARS) return { ok: false, error: 'A IA devolveu um texto longo demais.' }

  const before = extractPlaceholders(original)
  const after = extractPlaceholders(text)
  const missing = before.filter((v) => !after.includes(v))
  const invented = after.filter((v) => !before.includes(v))
  if (missing.length) return { ok: false, error: `A IA removeu variáveis: ${missing.map((v) => `{{${v}}}`).join(', ')}.` }
  if (invented.length) return { ok: false, error: `A IA criou variáveis inexistentes: ${invented.map((v) => `{{${v}}}`).join(', ')}.` }

  // Chaves soltas após remover as variáveis válidas = marcador malformado ({nome}, {{Nome}} etc.)
  const stripped = text.replace(VAR_RE, '')
  const originalStripped = original.replace(VAR_RE, '')
  if (/[{}]/.test(stripped) && !/[{}]/.test(originalStripped)) {
    return { ok: false, error: 'A IA alterou o formato das variáveis.' }
  }
  // Espaços reservados inventados no estilo [nome do cliente] ou <data>
  const PLACEHOLDER_RE = /\[[^\]\n]{2,40}\]|<[^>\n]{2,40}>/
  if (PLACEHOLDER_RE.test(stripped) && !PLACEHOLDER_RE.test(originalStripped)) {
    return { ok: false, error: 'A IA incluiu espaços reservados que não existem no modelo.' }
  }
  return { ok: true, text }
}
