// Mapeamento de colunas da planilha → campos do sistema.
// 1) Heurística local por sinônimos PT-BR nos títulos + "farejo" do conteúdo.
// 2) Preparação do pedido à IA com amostras MASCARADAS (nenhum valor real sai do navegador).
import { isValidCPF, isValidEmail, onlyDigits } from '@/lib/format'
import { cellToString, nameKey, parseDateBR, type RawCell } from './normalize'

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

export const FIELD_LABELS: Record<ImportField, string> = {
  full_name: 'Nome completo',
  cpf: 'CPF',
  phone: 'Telefone / WhatsApp',
  email: 'E-mail',
  birth_date: 'Data de nascimento',
  address: 'Endereço',
  notes: 'Observações',
  status: 'Situação do cliente',
  category: 'Tipo de demanda',
}

export const FIELD_HINTS: Partial<Record<ImportField, string>> = {
  full_name: 'Obrigatório',
  category: 'Vira categoria do escritório (opcional: cria demanda)',
  status: 'Ativo, inativo, prospecto…',
}

/** Sinônimos já normalizados (sem acento, minúsculas). Ordem = preferência. */
const SYNONYMS: Record<ImportField, string[]> = {
  full_name: ['nome completo', 'nome do cliente', 'nome da cliente', 'nome', 'cliente', 'segurada', 'segurado', 'requerente', 'autor', 'autora', 'beneficiario', 'beneficiaria', 'parte', 'contratante'],
  cpf: ['cpf', 'cpf do cliente', 'cpf cliente', 'documento', 'doc', 'n cpf', 'num cpf'],
  phone: ['telefone', 'fone', 'tel', 'celular', 'cel', 'whatsapp', 'whats', 'zap', 'contato', 'telefone whatsapp'],
  email: ['e mail', 'email', 'mail', 'correio eletronico'],
  birth_date: ['data de nascimento', 'data nascimento', 'nascimento', 'nasc', 'dt nasc', 'dn', 'aniversario', 'data nasc'],
  address: ['endereco', 'endereco completo', 'logradouro', 'rua', 'residencia', 'end'],
  notes: ['observacoes', 'observacao', 'obs', 'anotacoes', 'comentarios', 'comentario', 'notas', 'historico'],
  status: ['status', 'situacao', 'situacao do cliente', 'status do cliente', 'ativo'],
  category: ['tipo de demanda', 'tipo', 'beneficio', 'assunto', 'demanda', 'tipo de acao', 'acao', 'area', 'servico', 'categoria', 'especie', 'materia', 'tipo de beneficio', 'natureza'],
}

export interface ColumnInfo {
  index: number
  header: string
  /** Valores (texto) não vazios da coluna — usados só localmente. */
  samples: string[]
}

export type Mapping = Partial<Record<ImportField, number>>

export interface MappingSuggestion {
  mapping: Mapping
  /** 0–1 por campo mapeado */
  confidence: Partial<Record<ImportField, number>>
  /** true quando vale a pena oferecer/rodar a IA */
  lowConfidence: boolean
}

function headerScore(header: string, field: ImportField): number {
  const h = nameKey(header)
  if (!h) return 0
  const syns = SYNONYMS[field]
  if (syns.includes(h)) return 1 - syns.indexOf(h) * 0.005
  const tokens = h.split(' ')
  let best = 0
  for (const syn of syns) {
    const synTokens = syn.split(' ')
    // sinônimo de várias palavras contido no título
    if (synTokens.length > 1 && ` ${h} `.includes(` ${syn} `)) best = Math.max(best, 0.85)
    // sinônimo curto como palavra inteira ("nome do segurado" contém "segurado")
    else if (synTokens.length === 1 && tokens.includes(syn)) best = Math.max(best, syn.length <= 3 ? 0.6 : 0.75)
  }
  return best
}

/** Fração de amostras que satisfazem um predicado (0 se não houver amostras). */
function ratio(samples: string[], pred: (s: string) => boolean): number {
  if (!samples.length) return 0
  return samples.filter(pred).length / samples.length
}

function contentScore(samples: string[], field: ImportField): number {
  const s = samples.slice(0, 30)
  switch (field) {
    case 'cpf':
      return ratio(s, (v) => {
        const d = onlyDigits(v)
        return (d.length === 11 || d.length === 10 || d.length === 9) && isValidCPF(d.padStart(11, '0'))
      }) * 0.9
    case 'email':
      return ratio(s, (v) => isValidEmail(v)) * 0.95
    case 'phone':
      return ratio(s, (v) => {
        const d = onlyDigits(v)
        return d.length >= 10 && d.length <= 13 && !isValidCPF(d) && /[\s()\-+]/.test(v)
      }) * 0.8
    case 'birth_date':
      return ratio(s, (v) => /[/\-.]/.test(v) && !!parseDateBR(v).value) * 0.6
    case 'full_name':
      return ratio(s, (v) => /^[\p{L}'’.\s-]{5,}$/u.test(v) && v.trim().includes(' ')) * 0.5
    default:
      return 0
  }
}

/**
 * Sugere um mapeamento com base nos títulos e no conteúdo. Atribuição gulosa pelo
 * maior escore (cada coluna serve a no máximo um campo).
 */
export function suggestMapping(columns: ColumnInfo[]): MappingSuggestion {
  const candidates: { field: ImportField; index: number; score: number }[] = []
  for (const col of columns) {
    for (const field of IMPORT_FIELDS) {
      const score = Math.max(headerScore(col.header, field), contentScore(col.samples, field))
      if (score >= 0.45) candidates.push({ field, index: col.index, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const mapping: Mapping = {}
  const confidence: Partial<Record<ImportField, number>> = {}
  const used = new Set<number>()
  for (const c of candidates) {
    if (mapping[c.field] !== undefined || used.has(c.index)) continue
    mapping[c.field] = c.index
    confidence[c.field] = c.score
    used.add(c.index)
  }
  const scores = Object.values(confidence) as number[]
  const lowConfidence =
    mapping.full_name === undefined || (confidence.full_name ?? 0) < 0.7 || scores.some((s) => s < 0.7) || scores.length < 2
  return { mapping, confidence, lowConfidence }
}

// ---------------------------------------------------------------------------
// Cabeçalho e colunas
// ---------------------------------------------------------------------------

/** Letra da coluna estilo Excel: 0 → A, 26 → AA */
export function columnLetter(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Um título "parece dado pessoal" se tiver @ ou sequência de 5+ dígitos. */
export const looksPersonal = (s: string) => /@/.test(s) || /\d{5,}/.test(s.replace(/[\s.\-/()]/g, ''))

/**
 * A primeira linha é cabeçalho? Não é se alguma célula parecer dado pessoal
 * (CPF, telefone, e-mail) ou se a maioria das células for número/data.
 */
export function looksLikeHeader(row: RawCell[]): boolean {
  const cells = row.map(cellToString).filter(Boolean)
  if (!cells.length) return false
  if (cells.some(looksPersonal)) return false
  const numeric = cells.filter((c) => /^[\d\s.,/-]+$/.test(c)).length
  return numeric / cells.length < 0.5
}

export interface SheetTable {
  headers: string[]
  rows: RawCell[][]
  hasHeader: boolean
}

/** Separa cabeçalho e dados, normaliza largura e descarta colunas totalmente vazias. */
export function toTable(raw: RawCell[][]): SheetTable {
  const nonEmpty = raw.filter((r) => r.some((c) => cellToString(c) !== ''))
  if (!nonEmpty.length) return { headers: [], rows: [], hasHeader: false }
  const hasHeader = looksLikeHeader(nonEmpty[0])
  const body = hasHeader ? nonEmpty.slice(1) : nonEmpty
  const width = Math.max(...nonEmpty.map((r) => r.length))
  const keep: number[] = []
  for (let c = 0; c < width; c++) {
    const head = hasHeader ? cellToString(nonEmpty[0][c]) : ''
    if (head || body.some((r) => cellToString(r[c]) !== '')) keep.push(c)
  }
  const headers = keep.map((c, i) => {
    const h = hasHeader ? cellToString(nonEmpty[0][c]) : ''
    return h || `Coluna ${columnLetter(hasHeader ? c : i)}`
  })
  const rows = body.map((r) => keep.map((c) => r[c] ?? null))
  return { headers, rows, hasHeader }
}

export function columnsOf(table: SheetTable, maxSamples = 50): ColumnInfo[] {
  return table.headers.map((header, index) => {
    const samples: string[] = []
    for (const r of table.rows) {
      const v = cellToString(r[index])
      if (v) samples.push(v)
      if (samples.length >= maxSamples) break
    }
    return { index, header, samples }
  })
}

// ---------------------------------------------------------------------------
// Pedido à IA — somente estrutura, nunca valores reais
// ---------------------------------------------------------------------------

/**
 * Máscara de formato: dígitos → 9, maiúsculas → A, minúsculas → a (inclusive
 * acentuadas); pontuação e espaços preservados. "Maria (11) 9876" → "Aaaaa (99) 9999"
 */
export function maskValue(value: string, max = 40): string {
  return value
    .slice(0, max)
    .replace(/\d/g, '9')
    .replace(/\p{Lu}/gu, 'A')
    .replace(/\p{Ll}/gu, 'a')
    .replace(/@/g, '#')
    .replace(/[^\s9Aa#.,;:/()\-+_]/g, '*')
}

/** Valor de "tipo de demanda" pode ir à IA? Só se não parecer dado pessoal (dígitos, @, tamanho). */
export function isShareableCategoryValue(v: string): boolean {
  const s = v.trim()
  return s.length >= 2 && s.length <= 80 && !/\d/.test(s) && !s.includes('@')
}

/**
 * Vocabulário de categorias/benefícios/áreas (radicais sem acento). Um valor com
 * esses termos é "tipo de demanda"; sem eles, é tratado com desconfiança.
 */
const CATEGORY_VOCAB = [
  'matern', 'patern', 'aposent', 'auxili', 'benefic', 'bpc', 'loas', 'pensao', 'pensoes', 'morte', 'incapac',
  'invalidez', 'doenca', 'acident', 'revis', 'trabalh', 'reclamat', 'rescis', 'contrat', 'pesc', 'defeso', 'seguro',
  'desemprego', 'salari', 'especial', 'rural', 'urban', 'idade', 'tempo', 'contribu', 'reclus', 'deficien',
  'previd', 'inss', 'rpps', 'servidor', 'divorc', 'aliment', 'invent', 'familia', 'guarda', 'consumid', 'civel',
  'tribut', 'usucapi', 'indeniz', 'dano', 'cobranc', 'execuc', 'planejament', 'cadastr', 'adicional', 'insalubr',
  'periculos', 'hora', 'extra', 'fgts', 'verba', 'clt', 'outro', 'outra', 'diversos', 'consulta', 'administrativ',
  'judicial', 'recurso', 'vida', 'toda', 'hibrid', 'program', 'mandado', 'seguranca', 'criminal', 'penal',
  'empresarial', 'imobiliar', 'locac', 'despejo', 'assistencia', 'assistencial', 'amparo', 'social', 'acao',
  'demanda', 'processo', 'pedido', 'requerimento', 'restabelec', 'concess', 'averbac', 'certid', 'ctc', 'cnis',
  'abono', 'pis', 'pasep', 'atrasad', 'diferenc', 'temporari', 'permanente', 'acompanhament',
]
const CONNECTORS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'a', 'o', 'por', 'para', 'com', 'sem', 'em', 'no', 'na'])

const isVocabWord = (folded: string, extra: Set<string>) =>
  extra.has(folded) || CATEGORY_VOCAB.some((stem) => folded.startsWith(stem))

/**
 * Valor distinto pode ir ao provedor? Exige: não parecer dado pessoal; não estar
 * na coluna de nomes; e (a) casar com o vocabulário de categorias sem nenhuma
 * outra palavra capitalizada (possível nome: "Aposentadoria da Maria" sai), ou
 * (b) ter 1–3 palavras sem padrão de nome próprio (nenhuma palavra capitalizada,
 * exceto siglas em maiúsculas como "BPC").
 */
export function isSafeCategoryValue(v: string, opts: { officeCategories?: string[]; personNames?: Set<string> } = {}): boolean {
  if (!isShareableCategoryValue(v)) return false
  if (opts.personNames?.has(nameKey(v))) return false
  const extra = new Set((opts.officeCategories ?? []).flatMap((c) => nameKey(c).split(' ')).filter((w) => w.length >= 3))
  const words = v.trim().split(/[\s\-–/,;.()]+/).filter(Boolean)
  const meaningful = words.filter((w) => !CONNECTORS.has(nameKey(w)))
  if (!meaningful.length) return false
  const isAcronym = (w: string) => /^\p{Lu}{2,6}$/u.test(w)
  const vocab = meaningful.map((w) => isVocabWord(nameKey(w), extra))
  // palavra capitalizada fora do vocabulário (e que não é sigla) = possível nome próprio
  const suspicious = meaningful.some((w, i) => !vocab[i] && /^\p{Lu}/u.test(w) && !isAcronym(w))
  if (suspicious) return false
  if (vocab.some(Boolean)) return true
  return meaningful.length <= 3 && meaningful.every((w) => !/^\p{Lu}/u.test(w) || isAcronym(w))
}

/** Valores (dobrados) da coluna de nomes, para nunca enviá-los como "tipo de demanda". */
function personNameSet(columns: ColumnInfo[], nameColumn: number | undefined): Set<string> {
  const col = nameColumn === undefined ? undefined : columns.find((c) => c.index === nameColumn)
  return new Set((col?.samples ?? []).map((s) => nameKey(s)).filter(Boolean))
}

/** Valores distintos (case-insensitive) de uma coluna, em ordem de frequência. */
export function distinctValues(rows: RawCell[][], index: number): string[] {
  const counts = new Map<string, { label: string; n: number }>()
  for (const r of rows) {
    const v = cellToString(r[index]).replace(/\s+/g, ' ')
    if (!v) continue
    const k = nameKey(v)
    const cur = counts.get(k)
    if (cur) cur.n++
    else counts.set(k, { label: v, n: 1 })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((x) => x.label)
}

export interface AIImportRequest {
  columns: { index: number; header: string; examples: string[] }[]
  fields: ImportField[]
  categories: string[]
  category_values: string[]
}

export const AI_LIMITS = { columns: 60, examples: 3, exampleLength: 40, values: 80, valueLength: 80 } as const

export function buildAIRequest(
  columns: ColumnInfo[],
  categories: string[],
  categoryValues: string[],
  mapping?: Mapping,
): AIImportRequest {
  const nameColumn = mapping?.full_name ?? suggestMapping(columns).mapping.full_name
  const personNames = personNameSet(columns, nameColumn)
  return {
    columns: columns.slice(0, AI_LIMITS.columns).map((c) => ({
      index: c.index,
      header: looksPersonal(c.header) ? `Coluna ${columnLetter(c.index)}` : c.header.slice(0, 80),
      examples: c.samples.slice(0, AI_LIMITS.examples).map((s) => maskValue(s, AI_LIMITS.exampleLength)),
    })),
    fields: [...IMPORT_FIELDS],
    categories: categories.slice(0, 50).map((c) => c.slice(0, 80)),
    category_values: categoryValues
      .filter((v) => isSafeCategoryValue(v, { officeCategories: categories, personNames }))
      .slice(0, AI_LIMITS.values),
  }
}

// ---------------------------------------------------------------------------
// Categorias: correspondência local (sem IA)
// ---------------------------------------------------------------------------

const CATEGORY_HINTS: [RegExp, RegExp][] = [
  [/matern/, /matern/],
  [/aposent|idade|tempo de contrib|especial|rural/, /aposent/],
  [/incapac|auxilio doenca|doenca|invalidez|acidente|bpc|loas|deficien/, /incapac|bpc|loas/],
  [/pesc|defeso/, /pesc/],
  [/trabalh|reclamat|rescis|clt|fgts|verbas/, /trabalh/],
  [/contrat/, /contrat/],
  [/pensao|morte/, /pensao|morte/],
]

/** Sugere a categoria do escritório para um valor de texto livre (null = sem palpite). */
export function guessCategory(value: string, categories: { id: string; name: string }[]): string | null {
  const v = nameKey(value)
  if (!v) return null
  const exact = categories.find((c) => nameKey(c.name) === v)
  if (exact) return exact.id
  const contains = categories.find((c) => {
    const n = nameKey(c.name)
    return n.length >= 4 && (v.includes(n) || n.includes(v))
  })
  if (contains) return contains.id
  for (const [valueRe, catRe] of CATEGORY_HINTS) {
    if (!valueRe.test(v)) continue
    const cat = categories.find((c) => catRe.test(nameKey(c.name)))
    if (cat) return cat.id
  }
  return null
}
