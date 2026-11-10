// Tipos do módulo de mensagens (tabela message_templates — migration 006).
// Mantidos aqui (e não em types/database.ts, que é compartilhado).
import type { ISODateTime, UUID } from '@/types/database'

export interface MessageTemplateRow {
  id: UUID
  organization_id: UUID
  name: string
  subject: string | null
  body: string
  created_by: UUID | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

/** Modelo exibido na UI: padrão (embutido no app) ou do escritório (banco). */
export interface MessageTemplate {
  id: string
  name: string
  subject: string | null
  body: string
  kind: 'padrao' | 'escritorio'
  /** Para que serve — só nos modelos padrão */
  description?: string
}

export type ComposeTone = 'formal' | 'simples' | 'curto'

export const TONE_LABELS: Record<ComposeTone, string> = {
  formal: 'Mais formal',
  simples: 'Mais simples e acolhedor',
  curto: 'Mais curto',
}
