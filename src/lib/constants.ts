import type {
  ClientStatus,
  ContractStatus,
  ContractType,
  DemandStatus,
  InstallmentStatus,
  MemberRole,
  PaymentMethod,
  PriorityLevel,
  TaskStatus,
} from '@/types/database'
import type { BadgeTone } from '@/components/ui/Badge'

type LabelMap<T extends string> = Record<T, { label: string; tone: BadgeTone }>

export const ROLE_LABELS: Record<MemberRole, string> = {
  admin: 'Administrador',
  advogado: 'Advogado',
  assistente: 'Assistente',
}

export const CLIENT_STATUS: LabelMap<ClientStatus> = {
  prospecto: { label: 'Prospecto', tone: 'blue' },
  ativo: { label: 'Ativo', tone: 'green' },
  inativo: { label: 'Inativo', tone: 'gray' },
  arquivado: { label: 'Arquivado', tone: 'gray' },
}

export const PRIORITY: LabelMap<PriorityLevel> = {
  baixa: { label: 'Baixa', tone: 'gray' },
  media: { label: 'Média', tone: 'blue' },
  alta: { label: 'Alta', tone: 'amber' },
  urgente: { label: 'Urgente', tone: 'red' },
}

export const PRIORITY_ORDER: Record<PriorityLevel, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 }

export const DEMAND_STATUS: LabelMap<DemandStatus> = {
  em_andamento: { label: 'Em andamento', tone: 'blue' },
  aguardando_cliente: { label: 'Aguardando cliente', tone: 'amber' },
  suspensa: { label: 'Suspensa', tone: 'gray' },
  concluida: { label: 'Concluída', tone: 'green' },
  cancelada: { label: 'Cancelada', tone: 'red' },
}

export const TASK_STATUS: LabelMap<TaskStatus> = {
  pendente: { label: 'Pendente', tone: 'gray' },
  em_andamento: { label: 'Em andamento', tone: 'blue' },
  concluida: { label: 'Concluída', tone: 'green' },
  cancelada: { label: 'Cancelada', tone: 'red' },
}

export const CONTRACT_TYPE: Record<ContractType, string> = {
  honorarios_fixos: 'Honorários fixos',
  exito: 'Êxito',
  misto: 'Fixo + êxito',
  consultoria: 'Consultoria',
  outro: 'Outro',
}

export const CONTRACT_STATUS: LabelMap<ContractStatus> = {
  rascunho: { label: 'Rascunho', tone: 'gray' },
  ativo: { label: 'Ativo', tone: 'blue' },
  quitado: { label: 'Quitado', tone: 'green' },
  cancelado: { label: 'Cancelado', tone: 'red' },
}

export const INSTALLMENT_STATUS: LabelMap<InstallmentStatus> = {
  paga: { label: 'Paga', tone: 'green' },
  parcial: { label: 'Parcial', tone: 'amber' },
  vencida: { label: 'Vencida', tone: 'red' },
  a_vencer: { label: 'A vencer', tone: 'gray' },
  cancelada: { label: 'Cancelada', tone: 'gray' },
  rascunho: { label: 'Rascunho', tone: 'gray' },
}

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  transferencia: 'Transferência',
  dinheiro: 'Dinheiro',
  cartao: 'Cartão',
  outro: 'Outro',
}

export const PAGE_SIZE = 20

/** Converte um LabelMap em opções para <Select> */
export function toOptions<T extends string>(map: Record<T, { label: string } | string>) {
  return (Object.keys(map) as T[]).map((value) => {
    const v = map[value]
    return { value, label: typeof v === 'string' ? v : v.label }
  })
}
