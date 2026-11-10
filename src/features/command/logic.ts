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
// Recentes (localStorage): apenas tipo, id, rótulo e caminho — nunca CPF.
// ---------------------------------------------------------------------------
export type RecentKind = 'cliente' | 'demanda' | 'tarefa' | 'pagina'

export interface RecentItem {
  kind: RecentKind
  id: string
  label: string
  path: string
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

const isRecent = (x: unknown): x is RecentItem => {
  if (!x || typeof x !== 'object') return false
  const r = x as Record<string, unknown>
  return (
    ['cliente', 'demanda', 'tarefa', 'pagina'].includes(r.kind as string) &&
    typeof r.id === 'string' &&
    typeof r.label === 'string' &&
    typeof r.path === 'string' &&
    r.path.startsWith('/')
  )
}

export function loadRecents(orgId: string, storage: StorageLike | null = safeStorage()): RecentItem[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(recentKey(orgId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

/** Remove dígitos de CPF que eventualmente estejam no rótulo (defesa extra). */
const sanitizeLabel = (label: string) => label.replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)

export function saveRecent(orgId: string, item: RecentItem, storage: StorageLike | null = safeStorage()): RecentItem[] {
  const clean: RecentItem = { kind: item.kind, id: item.id, label: sanitizeLabel(item.label), path: item.path }
  const next = [clean, ...loadRecents(orgId, storage).filter((r) => !(r.kind === clean.kind && r.id === clean.id))].slice(
    0,
    RECENT_LIMIT,
  )
  if (storage) {
    try {
      storage.setItem(recentKey(orgId), JSON.stringify(next))
    } catch {
      /* armazenamento cheio/indisponível */
    }
  }
  return next
}
