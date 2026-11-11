// Pseudonimização reversível: nomes de clientes e membros viram tokens
// ("Cliente C1", "Responsável R1") antes de qualquer envio ao provedor de IA,
// e são restaurados no texto final mostrado ao usuário. O mapa vive apenas na
// memória da requisição — nunca é persistido nem enviado.
// Módulo puro.

export type EntityKind = 'client' | 'member'

const PREFIX: Record<EntityKind, string> = { client: 'Cliente C', member: 'Responsável R' }

/** Campos dos resultados das ferramentas que contêm nomes de pessoas. */
const NAME_KEYS: Record<string, EntityKind> = {
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

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR')

interface Entry {
  real: string
  kind: EntityKind
  token: string | null
}

export class Pseudonymizer {
  private entries = new Map<string, Entry>() // nome normalizado → entrada
  private tokens = new Map<string, string>() // token normalizado → nome real
  private counters: Record<EntityKind, number> = { client: 0, member: 0 }
  private pattern: RegExp | null = null

  constructor(dictionary?: { clients?: string[]; members?: string[] }) {
    dictionary?.members?.forEach((n) => this.register(n, 'member'))
    dictionary?.clients?.forEach((n) => this.register(n, 'client'))
  }

  /** Torna um nome conhecido (será substituído onde aparecer em texto livre). */
  register(name: string, kind: EntityKind): void {
    const key = norm(name)
    if (!key || this.entries.has(key)) return
    this.entries.set(key, { real: name.trim().replace(/\s+/g, ' '), kind, token: null })
    this.pattern = null
  }

  /** Token estável para um nome (mesmo nome → mesmo token na requisição). */
  tokenFor(name: string, kind: EntityKind): string {
    this.register(name, kind)
    const entry = this.entries.get(norm(name))!
    if (!entry.token) {
      this.counters[entry.kind] += 1
      entry.token = `${PREFIX[entry.kind]}${this.counters[entry.kind]}`
      this.tokens.set(norm(entry.token), entry.real)
    }
    return entry.token
  }

  /**
   * Pré-atribui tokens a todos os nomes do dicionário. Assim o modelo pode
   * referenciar alguém por código (ex.: propostas da IA) mesmo sem o nome ter
   * aparecido no texto desta requisição; `restore` consegue devolver o nome real.
   */
  primeTokens(): void {
    for (const entry of [...this.entries.values()]) this.tokenFor(entry.real, entry.kind)
  }

  private regex(): RegExp | null {
    if (this.pattern) return this.pattern
    const names = [...this.entries.keys()].filter((k) => k.length >= MIN_DICTIONARY_NAME)
    if (!names.length) return null
    // Mais longos primeiro: "Ana Maria" vence "Ana".
    names.sort((a, b) => b.length - a.length)
    const alts = names.map((n) => escapeRegExp(n).replace(/ /g, '\\s+'))
    this.pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu')
    return this.pattern
  }

  /** Substitui nomes conhecidos por tokens em texto livre. */
  pseudonymizeText(text: string): string {
    const re = this.regex()
    if (!re || !text) return text
    return text.replace(re, (match) => {
      const entry = this.entries.get(norm(match))
      return entry ? this.tokenFor(entry.real, entry.kind) : match
    })
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
    return text.replace(/(?:Cliente C|Responsável R)\d+(?!\d)/giu, (tok) => this.tokens.get(norm(tok)) ?? tok)
  }

  /** Quantidade de nomes efetivamente substituídos (para auditoria/testes). */
  get tokenCount(): number {
    return this.tokens.size
  }
}
