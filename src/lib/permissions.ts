import type { MemberRole } from '@/types/database'

/**
 * Permissões da interface — espelham as políticas RLS (migration 003).
 * A UI usa isto apenas para esconder/desabilitar ações; quem garante o acesso é o banco.
 */
export type Permission =
  | 'clients.delete'
  | 'clients.anonymize'
  | 'demands.delete'
  | 'tasks.delete'
  | 'workflows.manage'
  | 'contracts.manage'
  | 'contracts.delete'
  | 'payments.create'
  | 'payments.delete'
  | 'members.manage'
  | 'organization.manage'

const MATRIX: Record<Permission, MemberRole[]> = {
  'clients.delete': ['admin'],
  'clients.anonymize': ['admin'],
  'demands.delete': ['admin', 'advogado'],
  'tasks.delete': ['admin', 'advogado'],
  'workflows.manage': ['admin', 'advogado'],
  'contracts.manage': ['admin', 'advogado'],
  'contracts.delete': ['admin'],
  'payments.create': ['admin', 'advogado', 'assistente'],
  'payments.delete': ['admin', 'advogado'],
  'members.manage': ['admin'],
  'organization.manage': ['admin'],
}

export function can(role: MemberRole | null | undefined, permission: Permission): boolean {
  return !!role && MATRIX[permission].includes(role)
}
