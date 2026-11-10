// Lógica pura do módulo de demandas: filtros (URL ⇄ objeto), validação e regras de exibição.
import { DEMAND_STATUS, PRIORITY } from '@/lib/constants'
import { STALLED_DAYS, daysSince, stalledCutoff, todayISO } from '@/lib/format'
import type { Demand, DemandStatus, PriorityLevel } from '@/types/database'

export const CLOSED_STATUSES: DemandStatus[] = ['concluida', 'cancelada']
export const OPEN_STATUSES: DemandStatus[] = (Object.keys(DEMAND_STATUS) as DemandStatus[]).filter((s) => !CLOSED_STATUSES.includes(s))
export { STALLED_DAYS, stalledCutoff }

export const isOpenStatus = (s: DemandStatus) => !CLOSED_STATUSES.includes(s)

/** 'abertas' (padrão), 'todas' ou um status específico */
export type DemandStatusFilter = 'abertas' | 'todas' | DemandStatus

export interface DemandFilters {
  q: string
  category: string
  stage: string
  /** user_id, 'none' (sem responsável) ou '' */
  responsible: string
  priority: PriorityLevel | ''
  status: DemandStatusFilter
  /** só demandas abertas em etapa marcada como "aguardando documentação" */
  waitingDocs: boolean
  /** só demandas abertas paradas na etapa há N dias ou mais (0 = desligado) */
  stalled: number
  page: number
}

const isDemandStatus = (v: string): v is DemandStatus => v in DEMAND_STATUS
const isPriority = (v: string): v is PriorityLevel => v in PRIORITY

export function parseDemandFilters(p: URLSearchParams): DemandFilters {
  const rawStatus = p.get('status') ?? ''
  const status: DemandStatusFilter =
    rawStatus === 'todas' || rawStatus === 'all' ? 'todas' : isDemandStatus(rawStatus) ? rawStatus : 'abertas'
  const priority = p.get('priority') ?? ''
  const stalled = Math.floor(Number(p.get('stalled') ?? 0))
  const page = Math.floor(Number(p.get('page') ?? 0))
  const category = p.get('category') ?? ''
  return {
    q: p.get('q') ?? '',
    category,
    // etapa só faz sentido com categoria
    stage: category ? p.get('stage') ?? '' : '',
    responsible: p.get('responsible') ?? '',
    priority: isPriority(priority) ? priority : '',
    status,
    waitingDocs: ['1', 'true'].includes(p.get('waiting_docs') ?? ''),
    stalled: Number.isFinite(stalled) && stalled > 0 ? stalled : 0,
    page: Number.isFinite(page) && page > 0 ? page : 0,
  }
}

/** Serializa só o que difere do padrão, para URLs curtas e compartilháveis. */
export function serializeDemandFilters(f: DemandFilters): URLSearchParams {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q.trim())
  if (f.category) p.set('category', f.category)
  if (f.category && f.stage) p.set('stage', f.stage)
  if (f.responsible) p.set('responsible', f.responsible)
  if (f.priority) p.set('priority', f.priority)
  if (f.status !== 'abertas') p.set('status', f.status)
  if (f.waitingDocs) p.set('waiting_docs', '1')
  if (f.stalled > 0) p.set('stalled', String(f.stalled))
  if (f.page > 0) p.set('page', String(f.page))
  return p
}

export interface DemandStatusConstraint {
  eq: DemandStatus | null
  excludeClosed: boolean
}

/**
 * Regra única do filtro de status: um status específico sempre vence os atalhos
 * "só abertas" (aguardando documentação/paradas); sem status específico, os
 * atalhos excluem concluídas e canceladas. Evita consulta contraditória (lista vazia).
 */
export function statusConstraint(f: Pick<DemandFilters, 'status' | 'waitingDocs' | 'stalled'>): DemandStatusConstraint {
  if (f.status !== 'abertas' && f.status !== 'todas') return { eq: f.status, excludeClosed: false }
  if (f.status === 'abertas' || f.waitingDocs || f.stalled > 0) return { eq: null, excludeClosed: true }
  return { eq: null, excludeClosed: false }
}

/** Aplica uma alteração de filtro; qualquer mudança que não seja de página volta à página 0. */
export function patchDemandFilters(f: DemandFilters, patch: Partial<DemandFilters>): DemandFilters {
  const next = { ...f, ...patch }
  if ('category' in patch && patch.category !== f.category && !('stage' in patch)) next.stage = ''
  if (!('page' in patch)) next.page = 0
  return next
}

export function hasActiveFilters(f: DemandFilters): boolean {
  return !!(f.q.trim() || f.category || f.responsible || f.priority || f.status !== 'abertas' || f.waitingDocs || f.stalled)
}

export function isStalled(d: Pick<Demand, 'stage_changed_at' | 'status'>, days = STALLED_DAYS): boolean {
  return isOpenStatus(d.status) && daysSince(d.stage_changed_at) >= days
}

export function isNextActionOverdue(d: Pick<Demand, 'next_action_date' | 'status'>, today = todayISO()): boolean {
  return !!d.next_action_date && isOpenStatus(d.status) && d.next_action_date < today
}

export function formatDaysStalled(days: number): string {
  if (days <= 0) return 'hoje'
  return days === 1 ? '1 dia' : `${days} dias`
}

// ---------------------------------------------------------------------------
// Formulário
// ---------------------------------------------------------------------------

export interface DemandFormValues {
  client_id: string
  category_id: string
  stage_id: string
  title: string
  description: string
  responsible_id: string
  opened_at: string
  priority: PriorityLevel
  status: DemandStatus
  next_action: string
  next_action_date: string
  notes: string
}

export type DemandFormErrors = Partial<Record<keyof DemandFormValues, string>>

export function validateDemandForm(v: DemandFormValues, today = todayISO()): DemandFormErrors {
  const e: DemandFormErrors = {}
  if (!v.client_id) e.client_id = 'Selecione o cliente.'
  if (!v.category_id) e.category_id = 'Selecione a categoria.'
  const t = v.title.trim()
  if (!t) e.title = 'Informe um título.'
  else if (t.length < 2) e.title = 'Título muito curto.'
  else if (t.length > 160) e.title = 'Máximo de 160 caracteres.'
  if (!v.opened_at) e.opened_at = 'Informe a data de abertura.'
  else if (v.opened_at > today) e.opened_at = 'A abertura não pode estar no futuro.'
  if (v.description.length > 4000) e.description = 'Máximo de 4.000 caracteres.'
  if (v.notes.length > 4000) e.notes = 'Máximo de 4.000 caracteres.'
  if (v.next_action.length > 300) e.next_action = 'Máximo de 300 caracteres.'
  if (v.next_action_date && !v.next_action.trim()) e.next_action = 'Descreva a próxima atividade para a data informada.'
  return e
}

const nullIfEmpty = (s: string) => (s.trim() ? s.trim() : null)

export function demandFormToPayload(v: DemandFormValues) {
  return {
    client_id: v.client_id,
    category_id: v.category_id,
    stage_id: v.stage_id || null,
    title: v.title.trim(),
    description: nullIfEmpty(v.description),
    responsible_id: v.responsible_id || null,
    opened_at: v.opened_at,
    priority: v.priority,
    status: v.status,
    next_action: nullIfEmpty(v.next_action),
    next_action_date: v.next_action_date || null,
    notes: nullIfEmpty(v.notes),
  }
}
