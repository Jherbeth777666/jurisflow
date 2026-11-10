// Lógica pura da paleta de comandos (busca local, recentes, termos).

/** Minúsculas e sem acentos — para comparação tolerante. */
export function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

/** Todas as palavras da consulta aparecem no texto (em qualquer ordem). */
export function matchesQuery(query: string, ...texts: (string | undefined)[]): boolean {
  const q = normalizeText(query)
  if (!q) return true
  const hay = normalizeText(texts.filter(Boolean).join(' '))
  return q.split(/\s+/).every((w) => hay.includes(w))
}

/**
 * Se a consulta parece CPF (só dígitos e pontuação de CPF, ≥ 3 dígitos), devolve os dígitos.
 * Senão, null (busca por nome/título).
 */
export function cpfDigitsFromQuery(query: string): string | null {
  const t = query.trim()
  if (!/^[\d.\-\s]+$/.test(t)) return null
  const d = t.replace(/\D/g, '')
  return d.length >= 3 ? d.slice(0, 11) : null
}

export const assistantPath = (q: string) => `/assistente?q=${encodeURIComponent(q.trim())}`

// ---------------------------------------------------------------------------
// Recentes (localStorage): SOMENTE tipo + id. Nada de nomes de clientes, títulos ou CPF
// no navegador — o rótulo é buscado no servidor (com RLS) quando a paleta abre.
// ---------------------------------------------------------------------------
export type RecentKind = 'cliente' | 'demanda' | 'tarefa' | 'pagina'

export interface RecentRef {
  kind: RecentKind
  /** id do registro; para 'pagina', o caminho (ex.: '/relatorios') */
  id: string
}

export const RECENT_LIMIT = 6

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const recentKey = (orgId: string) => `jurisflow.cmd.recent.${orgId}`

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const KINDS: RecentKind[] = ['cliente', 'demanda', 'tarefa', 'pagina']
const UUIDISH = /^[0-9a-f-]{8,64}$/i

const toRef = (x: unknown): RecentRef | null => {
  if (!x || typeof x !== 'object') return null
  const r = x as Record<string, unknown>
  if (!KINDS.includes(r.kind as RecentKind) || typeof r.id !== 'string') return null
  const kind = r.kind as RecentKind
  if (kind === 'pagina' ? !/^\/[\w\-/]*$/.test(r.id) : !UUIDISH.test(r.id)) return null
  return { kind, id: r.id }
}

function write(orgId: string, list: RecentRef[], storage: StorageLike | null) {
  if (!storage) return
  try {
    storage.setItem(recentKey(orgId), JSON.stringify(list))
  } catch {
    /* armazenamento cheio/indisponível */
  }
}

export function loadRecents(orgId: string, storage: StorageLike | null = safeStorage()): RecentRef[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(recentKey(orgId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    const list = parsed.map(toRef).filter((r): r is RecentRef => !!r).slice(0, RECENT_LIMIT)
    // Versões antigas guardavam rótulo/caminho (nomes de clientes): regrava só tipo+id.
    if (parsed.some((x) => x && typeof x === 'object' && Object.keys(x).some((k) => k !== 'kind' && k !== 'id'))) write(orgId, list, storage)
    return list
  } catch {
    return []
  }
}

export function saveRecent(orgId: string, item: RecentRef, storage: StorageLike | null = safeStorage()): RecentRef[] {
  const ref = toRef(item)
  if (!ref) return loadRecents(orgId, storage)
  const next = [ref, ...loadRecents(orgId, storage).filter((r) => !(r.kind === ref.kind && r.id === ref.id))].slice(0, RECENT_LIMIT)
  write(orgId, next, storage)
  return next
}

/** Caminho para abrir um recente. */
export function recentPath(r: RecentRef): string {
  switch (r.kind) {
    case 'cliente':
      return `/clientes/${r.id}`
    case 'demanda':
      return `/demandas/${r.id}`
    case 'tarefa':
      return `/tarefas?tarefa=${r.id}`
    case 'pagina':
      return r.id
  }
}

/** Ids a resolver no servidor, por tipo. */
export function recentIdsByKind(list: RecentRef[]): { cliente: string[]; demanda: string[]; tarefa: string[] } {
  const out = { cliente: [] as string[], demanda: [] as string[], tarefa: [] as string[] }
  list.forEach((r) => {
    if (r.kind !== 'pagina') out[r.kind].push(r.id)
  })
  return out
}
