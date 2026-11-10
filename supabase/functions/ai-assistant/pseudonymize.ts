// Pseudonimização reversível: nomes de clientes e membros viram tokens
// ("Cliente C1", "Responsável R1") antes de qualquer envio ao provedor de IA,
// e são restaurados no texto final mostrado ao usuário. O mapa vive apenas na
// memória da requisição — nunca é persistido nem enviado.
//
// Comparação de nomes: sem acento (NFD sem diacríticos), sem diferenciar
// maiúsculas, com limites de palavra ("Ana" não casa dentro de "Mariana") e nas
// DUAS pontas (registro e busca): "João" e "Joao" são o mesmo nome.
// Primeiros nomes (≥3 letras, fora da stoplist) também são registrados: se só
// um nome completo conhecido começa com ele, recebe o MESMO token desse nome;
// se for ambíguo, ganha um token próprio (restaurado como o primeiro nome).
// Módulo puro.

export type EntityKind = 'client' | 'member'

const PREFIX: Record<EntityKind, string> = { client: 'Cliente C', member: 'Responsável R' }

/** Campos dos resultados das ferramentas que contêm nomes de pessoas. */
export const NAME_KEYS: Record<string, EntityKind> = {
  client: 'client',
  client_name: 'client',
  responsible: 'member',
  responsible_name: 'member',
  assignee: 'member',
  assignee_name: 'member',
}

/**
 * Campos removidos antes do envio (defesa em profundidade: as funções SQL já
 * não os retornam). `id` também sai — o modelo não precisa de identificadores.
 */
const DROP_KEYS = new Set(['id', 'client_id', 'user_id', 'cpf', 'phone', 'email', 'address', 'birth_date', 'notes'])

const MIN_DICTIONARY_NAME = 3

/** Forma canônica para comparar nomes: sem acentos, minúsculas, espaços únicos. */
export function foldName(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Palavras que NÃO viram apelido de primeiro nome mesmo sendo nomes de pessoas
 * em alguns casos: palavras comuns do português, termos jurídicos/previdenciários,
 * nomes de status/etapas típicas e tratamentos. Já em forma `foldName`.
 */
export const FIRST_NAME_STOPLIST: ReadonlySet<string> = new Set(
  [
    // tratamentos e partículas
    'dr', 'dra', 'sr', 'sra', 'srta', 'dona', 'seu', 'prof', 'profa', 'doutor', 'doutora', 'senhor', 'senhora',
    'da', 'de', 'do', 'das', 'dos', 'del', 'van', 'von',
    // tokens do próprio sistema
    'cliente', 'clientes', 'responsavel', 'responsaveis', 'anonimizado', 'anonimizada',
    // palavras comuns
    'que', 'qual', 'quais', 'quem', 'quanto', 'quantos', 'quanta', 'quantas', 'como', 'onde', 'quando', 'porque',
    'para', 'por', 'pelo', 'pela', 'com', 'sem', 'sobre', 'entre', 'ate', 'apos', 'desde', 'mais', 'menos', 'muito',
    'muita', 'pouco', 'todo', 'toda', 'todos', 'todas', 'nao', 'sim', 'esta', 'este', 'essa', 'esse', 'isso', 'isto',
    'aqui', 'ali', 'hoje', 'ontem', 'amanha', 'semana', 'mes', 'ano', 'dia', 'dias', 'agora', 'novo', 'nova', 'bem',
    'boa', 'bom', 'mal', 'favor', 'obrigado', 'obrigada', 'ola', 'oi', 'tem', 'ter', 'ser', 'estar', 'fazer', 'ver',
    'lista', 'listar', 'mostre', 'mostrar', 'resumo', 'total', 'geral', 'outro', 'outra', 'outros', 'outras',
    'mae', 'pai', 'filho', 'filha', 'esposa', 'marido', 'irmao', 'irma', 'avo', 'neto', 'neta',
    // palavras que também são prenomes comuns, mas aparecem em textos
    'rosa', 'clara', 'branca', 'vitoria', 'gloria', 'socorro', 'paz', 'luz', 'cruz', 'graca', 'gracas', 'amparo',
    'esperanca', 'fe', 'celeste', 'serena', 'aurora', 'natal', 'pascoa', 'prudente', 'franco', 'franca', 'justo',
    'jesus', 'deus', 'santo', 'santa', 'sao', 'bela', 'linda', 'flor', 'abril', 'maio', 'junho', 'neves', 'reis',
    'dores', 'conceicao', 'assuncao', 'piedade', 'mercedes', 'consolacao', 'lourdes', 'fatima', 'aparecida',
    // termos jurídicos / previdenciários / categorias e etapas típicas
    'acao', 'acoes', 'processo', 'processos', 'demanda', 'demandas', 'tarefa', 'tarefas', 'etapa', 'etapas',
    'prazo', 'prazos', 'categoria', 'categorias', 'status', 'documento', 'documentos', 'documentacao',
    'aguardando', 'andamento', 'concluida', 'concluido', 'cancelada', 'cancelado', 'suspensa', 'suspenso',
    'atendimento', 'primeiro', 'inicial', 'protocolo', 'protocolado', 'pericia', 'recurso', 'audiencia',
    'sentenca', 'acordo', 'peticao', 'analise', 'exigencia', 'cumprimento', 'execucao', 'implantacao', 'arquivado',
    'auxilio', 'salario', 'maternidade', 'aposentadoria', 'beneficio', 'beneficios', 'pensao', 'morte', 'idade',
    'rural', 'urbana', 'especial', 'invalidez', 'incapacidade', 'doenca', 'acidente', 'reclusao', 'revisao',
    'tempo', 'contribuicao', 'bpc', 'loas', 'inss', 'trabalhista', 'reclamatoria', 'rescisao', 'contrato',
    'contratos', 'honorarios', 'pagamento', 'pagamentos', 'parcela', 'parcelas', 'valor', 'valores', 'financeiro',
    'pescador', 'pescadora', 'defeso', 'seguro', 'desemprego', 'deficiencia', 'deficiente', 'segurado', 'segurada',
    'administrativo', 'judicial', 'requerimento', 'cadastro', 'certidao', 'laudo', 'procuracao', 'urgente',
    'alta', 'media', 'baixa', 'prioridade', 'pendente', 'pendentes', 'atrasada', 'atrasadas', 'vencida', 'vencidas',
  ].map(foldName),
)

const HONORIFIC = /^(?:dr|dra|sr|sra|srta|dona|seu|prof|profa|doutor|doutora)\.?$/i
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Primeiro nome "útil" de um nome completo (pula tratamentos), ou null. */
export function firstNameOf(full: string): string | null {
  const words = full.trim().split(/\s+/).filter((w) => !HONORIFIC.test(w))
  if (words.length < 2) return null // nome de uma palavra já é o próprio nome completo
  const first = words[0].replace(/[^\p{L}'’-]/gu, '')
  const key = foldName(first)
  if (key.length < MIN_DICTIONARY_NAME || !/^[a-z]+$/.test(key)) return null
  return first
}

/** Texto dobrado (foldName caractere a caractere) + mapa de posições para o original. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = ''
  const map: number[] = []
  let i = 0
  for (const ch of text) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    for (let k = 0; k < f.length; k++) map.push(i)
    folded += f
    i += ch.length
  }
  map.push(i)
  return { folded, map }
}

interface Entry {
  real: string
  kind: EntityKind
  token: string | null
}

export interface PseudonymizerOptions {
  clients?: string[]
  members?: string[]
  /** Palavras extras que não podem virar apelido (ex.: nomes de categorias/etapas do escritório). */
  stopwords?: string[]
}

export class Pseudonymizer {
  private entries = new Map<string, Entry>() // nome completo dobrado → entrada
  private aliasOwners = new Map<string, { display: string; owners: string[] }>() // primeiro nome dobrado → donos
  private aliasEntries = new Map<string, Entry>() // apelidos ambíguos com token próprio
  private tokens = new Map<string, string>() // token em minúsculas → nome real
  private counters: Record<EntityKind, number> = { client: 0, member: 0 }
  private stop: Set<string>
  private pattern: RegExp | null = null

  constructor(opts?: PseudonymizerOptions) {
    this.stop = new Set(FIRST_NAME_STOPLIST)
    for (const s of opts?.stopwords ?? []) for (const w of foldName(s).split(/[^a-z]+/)) if (w) this.stop.add(w)
    opts?.members?.forEach((n) => this.register(n, 'member'))
    opts?.clients?.forEach((n) => this.register(n, 'client'))
  }

  /** Torna um nome conhecido (será substituído onde aparecer em texto livre). */
  register(name: string, kind: EntityKind): void {
    const key = foldName(name)
    if (!key || this.entries.has(key)) return
    this.entries.set(key, { real: name.trim().replace(/\s+/g, ' '), kind, token: null })
    this.pattern = null
    const first = firstNameOf(name)
    if (first) {
      const fk = foldName(first)
      if (!this.stop.has(fk)) {
        const cur = this.aliasOwners.get(fk)
        if (cur) cur.owners.push(key)
        else this.aliasOwners.set(fk, { display: first, owners: [key] })
      }
    }
  }

  /** Quantidade de nomes completos conhecidos. */
  get size(): number {
    return this.entries.size
  }

  private assignToken(entry: Entry): string {
    if (!entry.token) {
      this.counters[entry.kind] += 1
      entry.token = `${PREFIX[entry.kind]}${this.counters[entry.kind]}`
      this.tokens.set(entry.token.toLowerCase(), entry.real)
    }
    return entry.token
  }

  /** Entrada para uma chave dobrada (nome completo, apelido único ou ambíguo). */
  private lookup(key: string): Entry | null {
    const full = this.entries.get(key)
    if (full) return full
    const alias = this.aliasOwners.get(key)
    if (!alias) return null
    const owners = [...new Set(alias.owners)]
    if (owners.length === 1) return this.entries.get(owners[0]) ?? null
    let e = this.aliasEntries.get(key)
    if (!e) {
      e = { real: alias.display, kind: this.entries.get(owners[0])?.kind ?? 'client', token: null }
      this.aliasEntries.set(key, e)
    }
    return e
  }

  /** Token estável para um nome (mesmo nome → mesmo token na requisição). */
  tokenFor(name: string, kind: EntityKind): string {
    this.register(name, kind)
    return this.assignToken(this.entries.get(foldName(name))!)
  }

  private regex(): RegExp | null {
    if (this.pattern) return this.pattern
    const keys = new Set<string>()
    for (const k of this.entries.keys()) if (k.length >= MIN_DICTIONARY_NAME) keys.add(k)
    for (const k of this.aliasOwners.keys()) keys.add(k)
    if (!keys.size) return null
    // Mais longos primeiro: "Ana Maria" vence "Ana".
    const names = [...keys].sort((a, b) => b.length - a.length)
    const alts = names.map((n) => escapeRegExp(n).replace(/ /g, '\\s+'))
    this.pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'gu')
    return this.pattern
  }

  /** Substitui nomes conhecidos (com ou sem acento, qualquer caixa) por tokens em texto livre. */
  pseudonymizeText(text: string): string {
    if (!text) return text
    const re = this.regex()
    if (!re) return text
    const { folded, map } = foldWithMap(text)
    let out = ''
    let last = 0
    re.lastIndex = 0
    for (const m of folded.matchAll(re)) {
      const entry = this.lookup(m[0].replace(/\s+/g, ' '))
      if (!entry) continue
      const start = map[m.index!]
      const end = map[m.index! + m[0].length]
      out += text.slice(last, start) + this.assignToken(entry)
      last = end
    }
    return out + text.slice(last)
  }

  /**
   * Pseudonimiza um resultado de ferramenta (JSON). Duas passadas: primeiro
   * registra todos os nomes dos campos conhecidos; depois troca nomes em todos
   * os textos (ex.: título "Salário-maternidade Maria Souza").
   */
  pseudonymizeValue<T>(value: T): T {
    this.collectNames(value)
    return this.replaceDeep(value) as T
  }

  private collectNames(value: unknown, key?: string): void {
    if (typeof value === 'string') {
      const kind = key ? NAME_KEYS[key] : undefined
      if (kind && value.trim()) this.register(value, kind)
    } else if (Array.isArray(value)) {
      value.forEach((v) => this.collectNames(v, key))
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) this.collectNames(v, k)
    }
  }

  private replaceDeep(value: unknown, key?: string): unknown {
    if (typeof value === 'string') {
      const kind = key ? NAME_KEYS[key] : undefined
      if (kind && value.trim()) return this.tokenFor(value, kind)
      return this.pseudonymizeText(value)
    }
    if (Array.isArray(value)) return value.map((v) => this.replaceDeep(v, key))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (DROP_KEYS.has(k)) continue
        out[k] = this.replaceDeep(v, k)
      }
      return out
    }
    return value
  }

  /** Restaura os nomes reais no texto produzido pelo modelo. */
  restore(text: string): string {
    if (!this.tokens.size) return text
    return text.replace(/(?:Cliente C|Responsável R)\d+(?!\d)/giu, (tok) => this.tokens.get(tok.toLowerCase()) ?? tok)
  }

  /** Quantidade de nomes efetivamente substituídos (para auditoria/testes). */
  get tokenCount(): number {
    return this.tokens.size
  }
}

/** Textos livres (fora dos campos de nome) de um valor JSON — para buscar nomes citados. */
export function freeTextsOf(value: unknown, key?: string, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (!(key && NAME_KEYS[key]) && value.trim()) out.push(value)
  } else if (Array.isArray(value)) {
    value.forEach((v) => freeTextsOf(v, key, out))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) freeTextsOf(v, k, out)
  }
  return out
}

/**
 * Palavras candidatas a nome de pessoa em textos (para buscar clientes citados
 * fora do dicionário dos mais recentes). Prioriza palavras capitalizadas.
 * Devolve formas dobradas (sem acento, minúsculas), únicas, ≥3 letras, fora da stoplist.
 */
export function nameCandidates(texts: string[], max = 12, extraStop: Iterable<string> = []): string[] {
  const stop = new Set([...FIRST_NAME_STOPLIST, ...[...extraStop].map(foldName)])
  const caps: string[] = []
  const lower: string[] = []
  const seen = new Set<string>()
  for (const t of texts) {
    for (const m of t.matchAll(/\p{L}[\p{L}\p{M}'’]*/gu)) {
      const w = m[0]
      const k = foldName(w).replace(/[^a-z]/g, '')
      if (k.length < MIN_DICTIONARY_NAME || stop.has(k) || seen.has(k)) continue
      seen.add(k)
      ;(/^\p{Lu}/u.test(w) ? caps : lower).push(k)
    }
  }
  return [...caps, ...lower].slice(0, max)
}
