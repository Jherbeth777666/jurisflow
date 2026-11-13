// Assinatura estável dos cabeçalhos da planilha: identifica "a mesma planilha" para lembrar o mapeamento.
// Puro (sem React/Supabase). Não é criptografia: só um identificador compacto.
import { stripAccents } from './normalize'

const normalizeHeader = (h: string) => stripAccents(h).trim().toLowerCase().replace(/\s+/g, ' ')

/** FNV-1a de 32 bits com semente configurável → 8 caracteres hexadecimais. */
function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Mesmos cabeçalhos (em qualquer ordem, caixa ou acentuação) → mesma assinatura de 16 caracteres. */
export function headerSignature(headers: string[]): string {
  const joined = headers
    .map(normalizeHeader)
    .filter((h) => h !== '')
    .sort()
    .join('|')
  return fnv1a(joined, 0x811c9dc5) + fnv1a(joined, 0x9747b28c)
}

/** Mapeamento guardado pelo NOME do cabeçalho (não pela posição): a mesma planilha com colunas reordenadas continua certa. */
export type HeaderMapping = Record<string, string>

export function mappingToHeaders(mapping: Record<string, number | undefined>, headers: string[]): HeaderMapping {
  const out: HeaderMapping = {}
  for (const [field, index] of Object.entries(mapping)) {
    if (index === undefined) continue
    const h = headers[index]
    if (h !== undefined && normalizeHeader(String(h)) !== '') out[field] = normalizeHeader(String(h))
  }
  return out
}

/** Reconstrói o mapeamento por posição; null se algum cabeçalho guardado não existir nesta planilha. */
export function mappingFromHeaders(saved: unknown, headers: string[]): Record<string, number> | null {
  if (!saved || typeof saved !== 'object') return null
  const index = new Map(headers.map((h, i) => [normalizeHeader(String(h ?? '')), i]))
  const out: Record<string, number> = {}
  for (const [field, header] of Object.entries(saved as Record<string, unknown>)) {
    if (typeof header !== 'string') return null
    const i = index.get(header)
    if (i === undefined) return null
    out[field] = i
  }
  return Object.keys(out).length ? out : null
}
