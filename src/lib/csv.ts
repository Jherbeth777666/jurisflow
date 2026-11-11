// Utilitários de CSV (leitura e escrita) — funções puras, exceto downloadCSV.
//
// Leitura: detecta separador (; , ou tab), aspas (RFC 4180, inclusive quebras de
// linha dentro de campos), remove BOM e, quando os bytes não são UTF-8 válidos
// (planilhas salvas pelo Excel no Windows), decodifica como Windows-1252.
//
// Escrita: BOM UTF-8 + ';' (o Excel em PT-BR abre direto), aspas quando
// necessário e proteção contra CSV/formula injection (OWASP).

import { downloadBlob } from './download'

export type CSVDelimiter = ';' | ',' | '\t'
export type CSVEncoding = 'utf-8' | 'windows-1252'

export interface ParsedCSV {
  rows: string[][]
  delimiter: CSVDelimiter
  encoding: CSVEncoding
}

const BOM = '﻿'
const DELIMITERS: CSVDelimiter[] = [';', ',', '\t']

/**
 * Decodifica bytes de um arquivo de texto. Tenta UTF-8 estrito; se houver bytes
 * inválidos (ou o texto tiver caracteres de substituição), usa Windows-1252
 * (superconjunto do Latin-1 usado pelo Excel em português).
 */
export function decodeText(input: ArrayBuffer | Uint8Array): { text: string; encoding: CSVEncoding } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (!text.includes('�')) return { text: stripBOM(text), encoding: 'utf-8' }
  } catch {
    /* bytes não são UTF-8 válido → tenta Windows-1252 */
  }
  return { text: stripBOM(new TextDecoder('windows-1252').decode(bytes)), encoding: 'windows-1252' }
}

export const stripBOM = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

/** Conta ocorrências de cada separador fora de aspas, linha a linha (até 20 linhas). */
export function detectDelimiter(text: string): CSVDelimiter {
  type Counts = Record<CSVDelimiter, number>
  const lines: Counts[] = []
  let current: Counts = { ';': 0, ',': 0, '\t': 0 }
  let inQuotes = false
  const push = () => {
    if (current[';'] || current[','] || current['\t']) lines.push(current)
    current = { ';': 0, ',': 0, '\t': 0 }
  }
  for (let i = 0; i < text.length && lines.length < 20; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++
      else inQuotes = !inQuotes
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      push()
    } else if (!inQuotes && (ch === ';' || ch === ',' || ch === '\t')) {
      current[ch]++
    }
  }
  push()
  if (!lines.length) return ';'

  // Melhor separador: aparece na 1ª linha (cabeçalho) e com a mesma contagem nas demais.
  let best: CSVDelimiter = ';'
  let bestScore = -1
  for (const d of DELIMITERS) {
    const first = lines[0][d]
    if (!first) continue
    const consistent = lines.filter((l) => l[d] === first).length / lines.length
    const score = consistent * 1000 + Math.min(first, 999)
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

/**
 * Lê CSV a partir de texto ou bytes. Linhas totalmente vazias são descartadas.
 * `delimiter` força o separador (senão é detectado).
 */
export function parseCSV(input: string | ArrayBuffer | Uint8Array, opts: { delimiter?: CSVDelimiter } = {}): ParsedCSV {
  let text: string
  let encoding: CSVEncoding = 'utf-8'
  if (typeof input === 'string') text = stripBOM(input)
  else ({ text, encoding } = decodeText(input))

  const delimiter = opts.delimiter ?? detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStarted = false // campo começou com aspas

  const endField = () => {
    row.push(fieldStarted ? field : field.trim())
    field = ''
    fieldStarted = false
  }
  const endRow = () => {
    endField()
    if (row.some((v) => v !== '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"' && field.trim() === '') {
      inQuotes = true
      fieldStarted = true
      field = ''
    } else if (ch === delimiter) endField()
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endRow()
    } else field += ch
  }
  if (field !== '' || row.length) endRow()

  return { rows, delimiter, encoding }
}

export type CSVValue = string | number | boolean | null | undefined

/** Caracteres que fazem o Excel/LibreOffice interpretar a célula como fórmula. */
const FORMULA_START = /^[=+\-@\t\r]/

/** Escapa um valor para CSV, neutralizando fórmulas (prefixo apóstrofo). */
export function escapeCSVValue(value: CSVValue, delimiter: string = ';'): string {
  if (value === null || value === undefined) return ''
  let s: string
  if (typeof value === 'number') s = Number.isFinite(value) ? String(value).replace('.', ',') : ''
  else if (typeof value === 'boolean') s = value ? 'Sim' : 'Não'
  else {
    s = value
    if (FORMULA_START.test(s)) s = `'${s}`
  }
  if (s.includes('"') || s.includes(delimiter) || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Gera CSV (BOM + ';' + CRLF) pronto para abrir no Excel em português. */
export function toCSV(rows: CSVValue[][], opts: { delimiter?: string; bom?: boolean } = {}): string {
  const delimiter = opts.delimiter ?? ';'
  const body = rows.map((r) => r.map((v) => escapeCSVValue(v, delimiter)).join(delimiter)).join('\r\n')
  return (opts.bom === false ? '' : BOM) + body + (rows.length ? '\r\n' : '')
}

/** Nome de arquivo seguro, com extensão .csv. */
export function csvFilename(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  const safe = base || 'exportacao'
  return safe.endsWith('.csv') ? safe : `${safe}.csv`
}

/** Gera e baixa um CSV no navegador (nada é enviado a servidor). */
export function downloadCSV(nome: string, linhas: CSVValue[][]): void {
  downloadBlob(csvFilename(nome), toCSV(linhas), 'text/csv;charset=utf-8')
}
