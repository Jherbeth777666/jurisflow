// Normalização local (sem IA) dos valores vindos da planilha. Funções puras.
import { isValidCPF, isValidEmail, onlyDigits, todayISO } from '@/lib/format'
import type { ClientStatus } from '@/types/database'

/** Resultado de normalização: valor pronto para o banco (ou null) + erro legível. */
export interface Normalized<T = string> {
  value: T | null
  error?: string
}

const ok = <T>(value: T): Normalized<T> => ({ value })
const empty = <T = string>(): Normalized<T> => ({ value: null })
const fail = <T>(error: string): Normalized<T> => ({ value: null, error })

/** Valor bruto de célula: texto do CSV ou tipos do .xlsx */
export type RawCell = string | number | boolean | Date | null | undefined

export function cellToString(v: RawCell): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10)
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não'
  return v.replace(/ /g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Texto / nomes
// ---------------------------------------------------------------------------

export const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Chave de comparação de nomes: minúsculas, sem acentos, sem pontuação, espaços simples. */
export function nameKey(s: string | null | undefined): string {
  return stripAccents(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'van', 'von'])

function capitalize(word: string): string {
  // Respeita hífen e apóstrofo: "maria-clara" → "Maria-Clara", "d'avila" → "D'Avila"
  return word
    .split(/([-'’])/)
    .map((p) => (p.length && !/[-'’]/.test(p) ? p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1) : p))
    .join('')
}

/** "MARIA DA SILVA e SOUZA" → "Maria da Silva e Souza" */
export function toTitleCaseName(input: string): string {
  const words = input.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR').split(' ').filter(Boolean)
  return words.map((w, i) => (i > 0 && PARTICLES.has(w) ? w : capitalize(w))).join(' ')
}

export function normalizeName(raw: RawCell): Normalized {
  const s = cellToString(raw)
  if (!s) return fail('Nome em branco.')
  const name = toTitleCaseName(s)
  if (name.length < 2) return fail('Nome muito curto.')
  if (name.length > 160) return fail('Nome com mais de 160 caracteres.')
  if (/\d{3,}/.test(name)) return fail('Nome contém números — confira a coluna mapeada.')
  return ok(name)
}

// ---------------------------------------------------------------------------
// CPF / telefone / e-mail
// ---------------------------------------------------------------------------

/**
 * CPF só com dígitos e validado. O Excel costuma "comer" zeros à esquerda quando a
 * coluna é numérica: se faltarem 1–2 dígitos e o CPF completado for válido, completa.
 */
export function normalizeCPF(raw: RawCell): Normalized {
  const s = cellToString(raw)
  if (!s) return empty()
  let d = onlyDigits(typeof raw === 'number' ? String(Math.round(raw)) : s)
  if (!d) return fail('CPF inválido.')
  if (d.length >= 9 && d.length < 11 && isValidCPF(d.padStart(11, '0'))) d = d.padStart(11, '0')
  if (d.length !== 11) return fail(`CPF com ${d.length} dígitos (precisa de 11).`)
  if (!isValidCPF(d)) return fail('CPF inválido (dígitos verificadores não conferem).')
  return ok(d)
}

/**
 * Telefone brasileiro com DDD, só dígitos (10 ou 11). Aceita +55, 0 de operadora,
 * espaços, parênteses, traços e pontos. Sem DDD → erro.
 */
export function normalizePhone(raw: RawCell): Normalized {
  const s = cellToString(raw)
  if (!s) return empty()
  // Várias opções na mesma célula ("(11) 9999-0000 / (11) 3333-0000") → usa a primeira.
  const first = s.split(/\s*(?:\/|\bou\b|,|;|\|)\s*/i).find((p) => onlyDigits(p).length >= 8) ?? s
  let d = onlyDigits(first)
  if (!d) return fail('Telefone inválido.')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2)
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1)
  if (d.length === 8 || d.length === 9) return fail('Telefone sem DDD.')
  if (d.length !== 10 && d.length !== 11) return fail('Telefone inválido (use DDD + número).')
  if (d[0] === '0' || d[1] === '0') return fail('DDD inválido.')
  if (d.length === 11 && d[2] !== '9') return fail('Celular com 11 dígitos deve começar com 9 após o DDD.')
  return ok(d)
}

export function normalizeEmail(raw: RawCell): Normalized {
  const s = cellToString(raw).toLowerCase().replace(/^mailto:/, '').replace(/\s+/g, '')
  if (!s) return empty()
  return isValidEmail(s) ? ok(s) : fail('E-mail inválido.')
}

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= days
}

/** Número serial do Excel (sistema 1900) → 'YYYY-MM-DD'. */
export function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null
  // 25569 = dias entre 1899-12-30 e 1970-01-01 (já compensa o bug do ano bissexto de 1900)
  const ms = Math.round((Math.floor(serial) - 25569) * 86_400_000)
  const dt = new Date(ms)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/**
 * Converte datas em vários formatos para 'YYYY-MM-DD':
 * dd/mm/aaaa, d/m/aa, dd-mm-aaaa, dd.mm.aaaa, aaaa-mm-dd, serial do Excel e Date.
 * Ano com 2 dígitos: se ficar no futuro em relação a `today`, usa o século anterior.
 */
export function parseDateBR(raw: RawCell, today: string = todayISO()): Normalized {
  if (raw === null || raw === undefined || raw === '') return empty()
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return fail('Data inválida.')
    // read-excel-file entrega datas em UTC à meia-noite
    return ok(`${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`)
  }
  if (typeof raw === 'number') {
    const iso = excelSerialToISO(raw)
    return iso ? ok(iso) : fail('Data inválida.')
  }
  const s = cellToString(raw)
  if (!s) return empty()

  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const iso = excelSerialToISO(Number(s))
    return iso ? ok(iso) : fail('Data inválida.')
  }

  let y: number, m: number, d: number
  let match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/)
  if (match) {
    y = Number(match[1])
    m = Number(match[2])
    d = Number(match[3])
  } else {
    match = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/)
    if (!match) {
      const compact = s.match(/^(\d{2})(\d{2})(\d{4})$/) // 31121990
      if (!compact) return fail('Data em formato não reconhecido (use dd/mm/aaaa).')
      match = compact
    }
    d = Number(match[1])
    m = Number(match[2])
    y = Number(match[3])
    if (match[3].length === 2) {
      const currentYear = Number(today.slice(0, 4))
      y = 2000 + y > currentYear ? 1900 + y : 2000 + y
    }
  }
  if (!isRealDate(y, m, d)) return fail('Data inexistente.')
  return ok(`${y}-${pad(m)}-${pad(d)}`)
}

/** Data de nascimento: além do formato, precisa estar entre 1900 e hoje (regra do banco). */
export function normalizeBirthDate(raw: RawCell, today: string = todayISO()): Normalized {
  const r = parseDateBR(raw, today)
  if (!r.value) return r
  if (r.value <= '1900-01-01') return fail('Data de nascimento muito antiga.')
  if (r.value > today) return fail('Data de nascimento no futuro.')
  return r
}

// ---------------------------------------------------------------------------
// Status do cliente / textos livres
// ---------------------------------------------------------------------------

const STATUS_WORDS: [RegExp, ClientStatus][] = [
  [/^(inativ|desativ|parad|baixad)/, 'inativo'],
  [/^(arquiv|encerrad|finaliz)/, 'arquivado'],
  [/^(prospec|potencial|lead|interessad|contato)/, 'prospecto'],
  [/^(ativ|em andamento|andamento|cliente|sim)/, 'ativo'],
]

/** "Ativa", "INATIVO", "Prospect" → status do sistema. Vazio/desconhecido → null (usa o padrão). */
export function normalizeClientStatus(raw: RawCell): Normalized<ClientStatus> {
  const s = nameKey(cellToString(raw))
  if (!s) return empty<ClientStatus>()
  for (const [re, status] of STATUS_WORDS) if (re.test(s)) return ok(status)
  return empty<ClientStatus>()
}

export function normalizeText(raw: RawCell, max: number): Normalized {
  const s = cellToString(raw).replace(/\s+\n/g, '\n')
  if (!s) return empty()
  return s.length > max ? ok(s.slice(0, max)) : ok(s)
}
