// Deduplicação de pessoas (planilha × planilha e planilha × cadastro). Funções puras.
//
// Regras (da mais forte para a mais fraca):
//  1. Mesmo CPF                                   → duplicado certo ('cpf')
//  2. Mesmo nome normalizado + mesmo telefone     → duplicado certo ('nome_telefone')
//  3. Mesmo nome normalizado + mesmo nascimento   → duplicado certo ('nome_nascimento')
//  4. Nomes com Jaro-Winkler ≥ 0,93               → POSSÍVEL duplicado ('nome_similar')
// Se os dois registros têm CPF e os CPFs são diferentes, não são a mesma pessoa
// (regras 2–4 não se aplicam).
import { nameKey } from './normalize'

export const SIMILARITY_THRESHOLD = 0.93

export interface PersonRecord {
  id: string
  name: string
  cpf?: string | null
  phone?: string | null
  birthDate?: string | null
}

export type MatchReason = 'cpf' | 'nome_telefone' | 'nome_nascimento' | 'nome_similar'

export const MATCH_REASON_LABEL: Record<MatchReason, string> = {
  cpf: 'Mesmo CPF',
  nome_telefone: 'Mesmo nome e telefone',
  nome_nascimento: 'Mesmo nome e nascimento',
  nome_similar: 'Nome muito parecido',
}

export interface Match {
  id: string
  reason: MatchReason
  /** 1 para regras exatas; similaridade para 'nome_similar' */
  score: number
  certain: boolean
}

// ---------------------------------------------------------------------------
// Jaro-Winkler
// ---------------------------------------------------------------------------

export function jaro(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0
  if (!a.length || !b.length) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatch = new Array<boolean>(a.length).fill(false)
  const bMatch = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(i + range + 1, b.length)
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue
      aMatch[i] = bMatch[j] = true
      matches++
      break
    }
  }
  if (!matches) return 0
  let t = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue
    while (!bMatch[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  return (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3
}

export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const j = jaro(a, b)
  let prefix = 0
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  return j + prefix * prefixScale * (1 - j)
}

// ---------------------------------------------------------------------------
// Índice para comparação eficiente (blocos por prefixo do nome)
// ---------------------------------------------------------------------------

interface Indexed {
  rec: PersonRecord
  key: string
}

export interface PersonIndex {
  byCpf: Map<string, Indexed[]>
  byName: Map<string, Indexed[]>
  /** bloco = 2 primeiras letras do nome normalizado (limita as comparações fuzzy) */
  byBlock: Map<string, Indexed[]>
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k)
  if (list) list.push(v)
  else m.set(k, [v])
}

const blockOf = (key: string) => key.slice(0, 2)

export function createIndex(records: PersonRecord[] = []): PersonIndex {
  const idx: PersonIndex = { byCpf: new Map(), byName: new Map(), byBlock: new Map() }
  records.forEach((r) => addToIndex(idx, r))
  return idx
}

export function addToIndex(idx: PersonIndex, rec: PersonRecord): void {
  const key = nameKey(rec.name)
  const item = { rec, key }
  if (rec.cpf) push(idx.byCpf, rec.cpf, item)
  if (key) {
    push(idx.byName, key, item)
    push(idx.byBlock, blockOf(key), item)
  }
}

const cpfConflict = (a: PersonRecord, b: PersonRecord) => !!a.cpf && !!b.cpf && a.cpf !== b.cpf

/** Melhor correspondência de `rec` no índice (ignorando o próprio id). */
export function findMatch(idx: PersonIndex, rec: PersonRecord, threshold = SIMILARITY_THRESHOLD): Match | null {
  if (rec.cpf) {
    const hit = idx.byCpf.get(rec.cpf)?.find((x) => x.rec.id !== rec.id)
    if (hit) return { id: hit.rec.id, reason: 'cpf', score: 1, certain: true }
  }
  const key = nameKey(rec.name)
  if (!key) return null

  const same = (idx.byName.get(key) ?? []).filter((x) => x.rec.id !== rec.id && !cpfConflict(x.rec, rec))
  const byPhone = rec.phone ? same.find((x) => x.rec.phone === rec.phone) : undefined
  if (byPhone) return { id: byPhone.rec.id, reason: 'nome_telefone', score: 1, certain: true }
  const byBirth = rec.birthDate ? same.find((x) => x.rec.birthDate === rec.birthDate) : undefined
  if (byBirth) return { id: byBirth.rec.id, reason: 'nome_nascimento', score: 1, certain: true }

  // Nome idêntico sem outro dado em comum também é só "possível" (homônimos existem).
  let best: Match | null = same.length ? { id: same[0].rec.id, reason: 'nome_similar', score: 1, certain: false } : null
  if (best) return best
  for (const x of idx.byBlock.get(blockOf(key)) ?? []) {
    if (x.rec.id === rec.id || cpfConflict(x.rec, rec)) continue
    if (Math.abs(x.key.length - key.length) > 6) continue
    const score = jaroWinkler(key, x.key)
    if (score >= threshold && (!best || score > best.score)) best = { id: x.rec.id, reason: 'nome_similar', score, certain: false }
  }
  return best
}

export interface DuplicatePair {
  a: string
  b: string
  reason: MatchReason
  score: number
  certain: boolean
}

/**
 * Todos os pares de possíveis duplicados de uma lista (cada registro é comparado
 * com os anteriores; cada par aparece uma vez). Usado no painel de qualidade.
 */
export function findDuplicatePairs(records: PersonRecord[], threshold = SIMILARITY_THRESHOLD): DuplicatePair[] {
  const pairs: DuplicatePair[] = []
  const seen = new Set<string>()
  const idx = createIndex()
  for (const rec of records) {
    const key = nameKey(rec.name)
    const add = (other: PersonRecord, reason: MatchReason, score: number, certain: boolean) => {
      const id = [other.id, rec.id].sort().join('|')
      if (seen.has(id)) return
      seen.add(id)
      pairs.push({ a: other.id, b: rec.id, reason, score, certain })
    }
    if (rec.cpf) idx.byCpf.get(rec.cpf)?.forEach((x) => add(x.rec, 'cpf', 1, true))
    if (key) {
      for (const x of idx.byName.get(key) ?? []) {
        if (cpfConflict(x.rec, rec)) continue
        if (rec.phone && x.rec.phone === rec.phone) add(x.rec, 'nome_telefone', 1, true)
        else if (rec.birthDate && x.rec.birthDate === rec.birthDate) add(x.rec, 'nome_nascimento', 1, true)
        else add(x.rec, 'nome_similar', 1, false)
      }
      for (const x of idx.byBlock.get(blockOf(key)) ?? []) {
        if (x.key === key || cpfConflict(x.rec, rec) || Math.abs(x.key.length - key.length) > 6) continue
        const score = jaroWinkler(key, x.key)
        if (score >= threshold) add(x.rec, 'nome_similar', score, false)
      }
    }
    addToIndex(idx, rec)
  }
  return pairs
}
