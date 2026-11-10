// Tipos espelhando o schema em supabase/migrations.
// Mantidos manualmente para o MVP; podem ser gerados com `supabase gen types typescript`.

export type UUID = string
export type ISODate = string // 'YYYY-MM-DD'
export type ISODateTime = string

export type MemberRole = 'admin' | 'advogado' | 'assistente'
export type ClientStatus = 'prospecto' | 'ativo' | 'inativo' | 'arquivado'
export type PriorityLevel = 'baixa' | 'media' | 'alta' | 'urgente'
export type DemandStatus = 'em_andamento' | 'aguardando_cliente' | 'suspensa' | 'concluida' | 'cancelada'
export type TaskStatus = 'pendente' | 'em_andamento' | 'concluida' | 'cancelada'
export type ContractType = 'honorarios_fixos' | 'exito' | 'misto' | 'consultoria' | 'outro'
export type PaymentMethod = 'pix' | 'boleto' | 'transferencia' | 'dinheiro' | 'cartao' | 'outro'
export type ContractStatus = 'rascunho' | 'ativo' | 'quitado' | 'cancelado'
export type InstallmentStatus = 'paga' | 'cancelada' | 'rascunho' | 'vencida' | 'parcial' | 'a_vencer'
export type AiRole = 'user' | 'assistant'

interface Timestamps {
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface Organization extends Timestamps {
  id: UUID
  name: string
  is_demo: boolean
  settings: Record<string, unknown>
}

export interface Profile extends Timestamps {
  id: UUID
  full_name: string
  email: string | null
}

export interface OrganizationMember extends Timestamps {
  id: UUID
  organization_id: UUID
  user_id: UUID
  role: MemberRole
  active: boolean
}

/** Membro com perfil embutido: select('*, profile:profiles(*)') */
export interface MemberWithProfile extends OrganizationMember {
  profile: Pick<Profile, 'id' | 'full_name' | 'email'> | null
}

export interface OrganizationInvitation extends Timestamps {
  id: UUID
  organization_id: UUID
  email: string
  role: MemberRole
  invited_by: UUID | null
  accepted_at: ISODateTime | null
  /** Migration 010: convite com validade e recusa explícita. */
  expires_at?: ISODateTime | null
  declined_at?: ISODateTime | null
}

export interface Client extends Timestamps {
  id: UUID
  organization_id: UUID
  full_name: string
  cpf: string | null // somente dígitos
  phone: string | null // somente dígitos
  email: string | null
  birth_date: ISODate | null
  address: string | null
  notes: string | null
  status: ClientStatus
  anonymized_at: ISODateTime | null
  created_by: UUID | null
}

export interface DemandCategory extends Timestamps {
  id: UUID
  organization_id: UUID
  name: string
  color: string
  sort_order: number
  active: boolean
}

export interface WorkflowStage extends Timestamps {
  id: UUID
  organization_id: UUID
  category_id: UUID
  name: string
  position: number
  is_final: boolean
  is_waiting_docs: boolean
}

export interface Demand extends Timestamps {
  id: UUID
  organization_id: UUID
  client_id: UUID
  category_id: UUID
  stage_id: UUID | null
  title: string
  description: string | null
  responsible_id: UUID | null
  opened_at: ISODate
  priority: PriorityLevel
  status: DemandStatus
  next_action: string | null
  next_action_date: ISODate | null
  notes: string | null
  stage_changed_at: ISODateTime
  closed_at: ISODateTime | null
  created_by: UUID | null
}

export interface Task extends Timestamps {
  id: UUID
  organization_id: UUID
  title: string
  description: string | null
  client_id: UUID | null
  demand_id: UUID | null
  assignee_id: UUID | null
  due_date: ISODate | null
  priority: PriorityLevel
  status: TaskStatus
  completed_at: ISODateTime | null
  created_by: UUID | null
}

export interface Contract extends Timestamps {
  id: UUID
  organization_id: UUID
  client_id: UUID
  demand_id: UUID | null
  contract_type: ContractType
  description: string | null
  total_amount: number
  payment_method: PaymentMethod
  installments_count: number
  first_due_date: ISODate
  signed_at: ISODate
  status: ContractStatus
  notes: string | null
  created_by: UUID | null
}

/** View public.contract_overview */
export interface ContractOverview extends Contract {
  received_amount: number
  balance_amount: number
  overdue_count: number
  next_due_date: ISODate | null
}

export interface Installment extends Timestamps {
  id: UUID
  organization_id: UUID
  contract_id: UUID
  number: number
  due_date: ISODate
  amount: number
}

/** View public.installment_overview */
export interface InstallmentOverview {
  id: UUID
  organization_id: UUID
  contract_id: UUID
  client_id: UUID
  number: number
  due_date: ISODate
  amount: number
  paid_amount: number
  remaining_amount: number
  status: InstallmentStatus
}

export interface Payment extends Timestamps {
  id: UUID
  organization_id: UUID
  contract_id: UUID
  installment_id: UUID | null
  amount: number
  paid_at: ISODate
  method: PaymentMethod
  notes: string | null
  created_by: UUID | null
}

export interface ActivityLog {
  id: UUID
  organization_id: UUID
  actor_id: UUID | null
  entity_type: 'clients' | 'demands' | 'tasks' | 'contracts' | 'payments' | 'organization_members' | string
  entity_id: UUID
  action: 'created' | 'updated' | 'deleted' | 'stage_changed' | 'status_changed' | string
  /** Valores só aparecem para campos não sensíveis; demais vêm como { changed: true } */
  changes: Record<string, { from?: unknown; to?: unknown; changed?: boolean } | unknown>
  created_at: ISODateTime
}

export interface AiConversation extends Timestamps {
  id: UUID
  organization_id: UUID
  user_id: UUID
  title: string
}

export interface AiMessage {
  id: UUID
  organization_id: UUID
  conversation_id: UUID
  user_id: UUID
  role: AiRole
  content: string
  tools_used: string[]
  created_at: ISODateTime
}

/** Retorno de rpc('dashboard_metrics') */
export interface DashboardMetrics {
  clients_total: number
  demands_in_progress: number
  demands_done: number
  demands_waiting_docs: number
  tasks_pending: number
  tasks_overdue: number
  deadlines_upcoming: number
  fees_expected: number
  fees_received: number
  installments_overdue: number
  by_category: { name: string; color: string; count: number }[]
  by_status: { status: DemandStatus; count: number }[]
  monthly: { month: string; opened: number; closed: number; new_clients: number }[]
  revenue_monthly: { month: string; received: number; expected: number }[]
  productivity: {
    user_id: UUID
    name: string
    tasks_done_30d: number
    demands_closed_30d: number
    open_demands: number
  }[]
}
