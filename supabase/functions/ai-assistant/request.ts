// Validação do corpo da requisição, CORS e utilitários HTTP. Módulo puro.

export const MAX_MESSAGE_CHARS = 2000
export const MAX_BODY_BYTES = 16 * 1024

/** Tamanho real em bytes UTF-8 (String.length conta unidades UTF-16: "á" = 1, mas são 2 bytes). */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AssistantRequest {
  organizationId: string
  conversationId: string | null
  message: string
}

export type BodyValidation = { ok: true; value: AssistantRequest } | { ok: false; error: string }

export function validateBody(raw: unknown): BodyValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Corpo da requisição inválido.' }
  const b = raw as Record<string, unknown>
  if (typeof b.organization_id !== 'string' || !UUID_RE.test(b.organization_id)) {
    return { ok: false, error: 'organization_id inválido.' }
  }
  let conversationId: string | null = null
  if (b.conversation_id !== undefined && b.conversation_id !== null && b.conversation_id !== '') {
    if (typeof b.conversation_id !== 'string' || !UUID_RE.test(b.conversation_id)) {
      return { ok: false, error: 'conversation_id inválido.' }
    }
    conversationId = b.conversation_id.toLowerCase()
  }
  if (typeof b.message !== 'string') return { ok: false, error: 'Mensagem obrigatória.' }
  // remove caracteres de controle (exceto quebra de linha e tab)
  const message = b.message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (message.length < 1) return { ok: false, error: 'Mensagem obrigatória.' }
  if (message.length > MAX_MESSAGE_CHARS) return { ok: false, error: `A mensagem deve ter no máximo ${MAX_MESSAGE_CHARS} caracteres.` }
  return { ok: true, value: { organizationId: b.organization_id.toLowerCase(), conversationId, message } }
}

/** Título da conversa a partir da 1ª pergunta (já sem dados pessoais). */
export function conversationTitle(message: string, max = 60): string {
  const oneLine = message.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine || 'Nova conversa'
  const cut = oneLine.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`
}

// ---------------------------------------------------------------------------
// CORS: só origens explicitamente permitidas. Sem ALLOWED_ORIGINS configurado,
// o fallback seguro aceita apenas o servidor de desenvolvimento local.
// ---------------------------------------------------------------------------
export const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

export function parseAllowedOrigins(value: string | undefined): string[] {
  const list = (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s && s !== '*') // curinga nunca é aceito
  return list.length ? list : DEV_ORIGINS
}

export function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return true // chamadas sem Origin (servidor/CLI) não são cross-site; o JWT continua obrigatório
  return allowed.includes(origin.replace(/\/+$/, ''))
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (origin && isOriginAllowed(origin, allowed)) h['Access-Control-Allow-Origin'] = origin
  return h
}

export function bearerToken(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+([A-Za-z0-9\-_.]+)$/)
  return m ? m[1] : null
}
