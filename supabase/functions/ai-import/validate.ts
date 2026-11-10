// Validação da entrada (o que o navegador manda) e da saída do modelo (o que volta).
// Módulo puro: sem APIs do Deno, testável com vitest.
//
// Entrada: só estrutura da planilha — títulos de coluna, até 3 exemplos MASCARADOS
// por coluna (dígitos → 9, letras → A/a) e valores distintos de "tipo de demanda"
// que não parecem dados pessoais. Qualquer sinal de dado real → 400.
// Saída: mapeamento campo→coluna e valor→categoria; tudo que não estiver nas
// listas enviadas é descartado.

export const IMPORT_FIELDS = [
  'full_name',
  'cpf',
  'phone',
  'email',
  'birth_date',
  'address',
  'notes',
  'status',
  'category',
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const LIMITS = {
  bodyBytes: 32 * 1024,
  columns: 60,
  maxColumnIndex: 499,
  headerLength: 80,
  examples: 3,
  exampleLength: 40,
  categories: 50,
  categoryLength: 80,
  values: 80,
  valueLength: 80,
} as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// oxlint-disable-next-line no-control-regex -- remoção intencional de caracteres de controle
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

export interface ImportColumn {
  index: number
  header: string
  examples: string[]
}

export interface AIImportInput {
  organizationId: string
  columns: ImportColumn[]
  categories: string[]
  categoryValues: string[]
}

export type InputValidation = { ok: true; value: AIImportInput } | { ok: false; error: string }

/**
 * Há uma sequência de 5+ dígitos "reais" (não mascarados)? Separadores comuns de
 * CPF/telefone são ignorados ("123.456.789-09" conta como 11 dígitos seguidos).
 * Uma sequência só de 9 é a máscara do navegador e é aceita.
 */
export function hasUnmaskedDigits(s: string): boolean {
  const compact = s.replace(/[\s.\-/()]/g, '')
  return (compact.match(/\d{5,}/g) ?? []).some((run) => /[0-8]/.test(run))
}

export const looksPersonal = (s: string) => s.includes('@') || hasUnmaskedDigits(s)

const clean = (s: string) => s.replace(CONTROL, '').replace(/\s+/g, ' ').trim()

function stringList(raw: unknown, name: string, max: number, maxLen: number): string[] | string {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return `${name} deve ser uma lista.`
  if (raw.length > max) return `${name}: no máximo ${max} itens.`
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') return `${name}: itens devem ser texto.`
    const s = clean(v)
    if (!s) continue
    if (s.length > maxLen) return `${name}: itens com no máximo ${maxLen} caracteres.`
    out.push(s)
  }
  return out
}

export function validateInput(raw: unknown): InputValidation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Corpo da requisição inválido.' }
  const b = raw as Record<string, unknown>
  if (typeof b.organization_id !== 'string' || !UUID_RE.test(b.organization_id)) return { ok: false, error: 'organization_id inválido.' }

  if (!Array.isArray(b.columns) || !b.columns.length) return { ok: false, error: 'Informe as colunas da planilha.' }
  if (b.columns.length > LIMITS.columns) return { ok: false, error: `No máximo ${LIMITS.columns} colunas.` }
  const columns: ImportColumn[] = []
  const seen = new Set<number>()
  for (const c of b.columns) {
    if (!c || typeof c !== 'object') return { ok: false, error: 'Coluna inválida.' }
    const col = c as Record<string, unknown>
    if (typeof col.index !== 'number' || !Number.isInteger(col.index) || col.index < 0 || col.index > LIMITS.maxColumnIndex || seen.has(col.index)) {
      return { ok: false, error: 'Índice de coluna inválido.' }
    }
    seen.add(col.index)
    if (typeof col.header !== 'string') return { ok: false, error: 'Título de coluna inválido.' }
    const header = clean(col.header)
    if (header.length > LIMITS.headerLength) return { ok: false, error: `Títulos com no máximo ${LIMITS.headerLength} caracteres.` }
    if (looksPersonal(header)) return { ok: false, error: 'Um título de coluna parece conter dado pessoal; ele não pode ser enviado.' }
    const examples = stringList(col.examples, 'Exemplos', LIMITS.examples, LIMITS.exampleLength)
    if (typeof examples === 'string') return { ok: false, error: examples }
    if (examples.some(looksPersonal)) {
      return { ok: false, error: 'Exemplos devem estar mascarados (sem dígitos reais nem e-mails).' }
    }
    columns.push({ index: col.index, header, examples })
  }

  const categories = stringList(b.categories, 'Categorias', LIMITS.categories, LIMITS.categoryLength)
  if (typeof categories === 'string') return { ok: false, error: categories }
  const categoryValues = stringList(b.category_values, 'Valores', LIMITS.values, LIMITS.valueLength)
  if (typeof categoryValues === 'string') return { ok: false, error: categoryValues }
  if (categoryValues.some((v) => /\d/.test(v) || v.includes('@'))) {
    return { ok: false, error: 'Valores de tipo de demanda não podem conter números nem e-mails.' }
  }

  // Defesa em profundidade: valores com cara de nome de pessoa são descartados (não vão ao provedor).
  const safeValues = categoryValues.filter((v) => !looksLikePersonName(v, categories))

  return { ok: true, value: { organizationId: b.organization_id.toLowerCase(), columns, categories, categoryValues: safeValues } }
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const NAME_CONNECTORS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'a', 'o', 'por', 'para', 'com', 'sem', 'em', 'no', 'na'])
const CATEGORY_STEMS = [
  'matern', 'patern', 'aposent', 'auxili', 'benefic', 'bpc', 'loas', 'pensao', 'morte', 'incapac', 'invalidez',
  'doenca', 'acident', 'revis', 'trabalh', 'reclamat', 'rescis', 'contrat', 'pesc', 'defeso', 'seguro', 'desemprego',
  'salari', 'especial', 'rural', 'urban', 'idade', 'tempo', 'contribu', 'reclus', 'deficien', 'previd', 'inss',
  'divorc', 'aliment', 'invent', 'familia', 'consumid', 'civel', 'tribut', 'indeniz', 'dano', 'cobranc', 'execuc',
  'outro', 'outra', 'diversos', 'consulta', 'administrativ', 'judicial', 'recurso', 'vida', 'toda', 'hibrid',
  'assistencia', 'amparo', 'social', 'acao', 'adicional', 'fgts', 'verba', 'clt', 'hora', 'extra',
]

/**
 * Heurística: palavra capitalizada (não sigla) fora do vocabulário de categorias
 * = possível nome próprio. "Maria da Silva Souza" e "Aposentadoria da Maria" saem;
 * "Salário-maternidade" e "BPC" ficam.
 */
export function looksLikePersonName(value: string, officeCategories: string[] = []): boolean {
  const extra = new Set(officeCategories.flatMap((c) => fold(c).split(/[^a-z]+/)).filter((w) => w.length >= 3))
  const words = value.split(/[\s\-–/,;.()]+/).filter((w) => w && !NAME_CONNECTORS.has(fold(w)))
  return words.some((w) => {
    if (!/^\p{Lu}/u.test(w) || /^\p{Lu}{2,6}$/u.test(w)) return false
    const f = fold(w)
    return !extra.has(f) && !CATEGORY_STEMS.some((s) => f.startsWith(s))
  })
}

// ---------------------------------------------------------------------------
// Saída do modelo
// ---------------------------------------------------------------------------

export interface AIImportResult {
  mapping: Partial<Record<ImportField, number>>
  /** valor distinto (exatamente como enviado) → nome da categoria (exatamente como enviado) */
  categories: Record<string, string>
}

/** Extrai o primeiro objeto JSON do texto (tolera cercas ```json e texto em volta). */
export function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const src = fenced ? fenced[1] : text
  const start = src.indexOf('{')
  const end = src.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(src.slice(start, end + 1))
  } catch {
    return null
  }
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Valida a resposta do modelo contra o que foi enviado. Campos desconhecidos,
 * colunas inexistentes, colunas repetidas, valores e categorias fora das listas
 * são descartados. Retorna null se não houver JSON utilizável.
 */
export function validateAIResponse(text: string, input: AIImportInput): AIImportResult | null {
  const parsed = extractJSON(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>

  const mapping: AIImportResult['mapping'] = {}
  const validIdx = new Set(input.columns.map((c) => c.index))
  const usedCols = new Set<number>()
  const rawMap = obj.mapping
  if (rawMap && typeof rawMap === 'object' && !Array.isArray(rawMap)) {
    for (const [field, idx] of Object.entries(rawMap as Record<string, unknown>)) {
      if (!(IMPORT_FIELDS as readonly string[]).includes(field)) continue
      if (typeof idx !== 'number' || !Number.isInteger(idx) || !validIdx.has(idx) || usedCols.has(idx)) continue
      mapping[field as ImportField] = idx
      usedCols.add(idx)
    }
  }

  const categories: Record<string, string> = {}
  const valueByNorm = new Map(input.categoryValues.map((v) => [norm(v), v]))
  const catByNorm = new Map(input.categories.map((c) => [norm(c), c]))
  const rawCats = obj.categories
  if (rawCats && typeof rawCats === 'object' && !Array.isArray(rawCats)) {
    for (const [value, cat] of Object.entries(rawCats as Record<string, unknown>)) {
      if (typeof cat !== 'string') continue
      const v = valueByNorm.get(norm(value))
      const c = catByNorm.get(norm(cat))
      if (v && c) categories[v] = c
    }
  }
  return { mapping, categories }
}
