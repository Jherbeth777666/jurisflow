// Telefones brasileiros e links de WhatsApp (wa.me) / e-mail (mailto). Módulo puro.
// Sem API do WhatsApp: o link apenas abre a conversa com o texto preenchido —
// o envio é sempre confirmado pelo usuário.

// DDDs válidos no Brasil (Anatel)
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53,
  54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96,
  97, 98, 99,
])

export type PhoneKind = 'celular' | 'fixo'

export type PhoneCheck =
  | { ok: true; international: string; national: string; kind: PhoneKind }
  | { ok: false; reason: string }

/**
 * Normaliza um telefone BR para o formato internacional usado pelo wa.me
 * (55 + DDD + número). Aceita com/sem +55, com 0 de longa distância e máscara.
 */
export function normalizeBrPhone(raw: string | null | undefined): PhoneCheck {
  let d = (raw ?? '').replace(/\D/g, '')
  if (!d) return { ok: false, reason: 'Cliente sem telefone cadastrado.' }
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1) // 0 + DDD + 8 dígitos
  else if (d.length === 12 && d.startsWith('0')) d = d.slice(1) // 0 + DDD + 9 dígitos
  if (d.length !== 10 && d.length !== 11) return { ok: false, reason: 'Telefone com quantidade de dígitos inválida.' }
  const ddd = Number(d.slice(0, 2))
  if (!VALID_DDD.has(ddd)) return { ok: false, reason: `DDD ${d.slice(0, 2)} inválido.` }
  const number = d.slice(2)
  if (d.length === 11) {
    if (number[0] !== '9') return { ok: false, reason: 'Celular com 9 dígitos deve começar com 9.' }
    return { ok: true, international: `55${d}`, national: d, kind: 'celular' }
  }
  // 8 dígitos: 2–5 = fixo; 6–9 = celular antigo (sem o 9) — o WhatsApp costuma resolver
  if (/^[2-5]/.test(number)) return { ok: true, international: `55${d}`, national: d, kind: 'fixo' }
  if (/^[6-9]/.test(number)) return { ok: true, international: `55${d}`, national: d, kind: 'celular' }
  return { ok: false, reason: 'Número de telefone inválido.' }
}

/** Link wa.me com texto. Retorna null se o telefone for inválido. */
export function buildWhatsAppLink(phone: string | null | undefined, text: string): string | null {
  const p = normalizeBrPhone(phone)
  if (!p.ok) return null
  const t = text.trim()
  return t ? `https://wa.me/${p.international}?text=${encodeURIComponent(t)}` : `https://wa.me/${p.international}`
}

const EMAIL_RE = /^[^@\s,;?&]+@[^@\s,;?&]+\.[^@\s,;?&]+$/

/** Link mailto com assunto e corpo (quebras de linha em CRLF, como pede a RFC 6068). */
export function buildMailtoLink(email: string | null | undefined, subject: string, body: string): string | null {
  const e = (email ?? '').trim()
  if (!EMAIL_RE.test(e)) return null
  const params: string[] = []
  if (subject.trim()) params.push(`subject=${encodeURIComponent(subject.trim())}`)
  if (body.trim()) params.push(`body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`)
  return `mailto:${e}${params.length ? `?${params.join('&')}` : ''}`
}
