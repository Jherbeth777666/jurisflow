// Tipos do checklist de pendências (migration 006). Somente lista textual —
// nenhum arquivo é armazenado.
import type { ISODateTime, UUID } from '@/types/database'

export interface ChecklistTemplate {
  id: UUID
  organization_id: UUID
  category_id: UUID
  label: string
  position: number
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface DemandChecklistItem {
  id: UUID
  organization_id: UUID
  demand_id: UUID
  label: string
  done: boolean
  done_at: ISODateTime | null
  done_by: UUID | null
  position: number
  created_at: ISODateTime
  updated_at: ISODateTime
}

export const CHECKLIST_LABEL_MAX = 160
