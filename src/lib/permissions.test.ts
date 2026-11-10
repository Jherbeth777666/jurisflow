import { describe, expect, it } from 'vitest'
import { can, type Permission } from './permissions'
import type { MemberRole } from '@/types/database'
import rlsSql from '../../supabase/migrations/20261109000003_rls_policies.sql?raw'

const ROLES: MemberRole[] = ['admin', 'advogado', 'assistente']

/** Matriz esperada — mesma tabela documentada no topo da migration 003. */
const EXPECTED: Record<Permission, MemberRole[]> = {
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

describe('can(role, permission)', () => {
  for (const [perm, allowed] of Object.entries(EXPECTED) as [Permission, MemberRole[]][]) {
    it(`${perm}: ${allowed.join(', ')}`, () => {
      for (const role of ROLES) expect(can(role, perm)).toBe(allowed.includes(role))
    })
  }

  it('sem papel (sem escritório / carregando) nunca tem permissão', () => {
    for (const perm of Object.keys(EXPECTED) as Permission[]) {
      expect(can(null, perm)).toBe(false)
      expect(can(undefined, perm)).toBe(false)
    }
  })

  it('assistente registra pagamento, mas não estorna nem gerencia contratos', () => {
    expect(can('assistente', 'payments.create')).toBe(true)
    expect(can('assistente', 'payments.delete')).toBe(false)
    expect(can('assistente', 'contracts.manage')).toBe(false)
    expect(can('assistente', 'demands.delete')).toBe(false)
  })

  it('advogado gerencia contratos e fluxos, mas não membros nem exclui clientes', () => {
    expect(can('advogado', 'contracts.manage')).toBe(true)
    expect(can('advogado', 'workflows.manage')).toBe(true)
    expect(can('advogado', 'members.manage')).toBe(false)
    expect(can('advogado', 'clients.delete')).toBe(false)
    expect(can('advogado', 'clients.anonymize')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// A UI precisa espelhar a RLS. Lê as chamadas org_policies(...) da migration 003
// e confere que a matriz do frontend bate com o que o banco realmente aplica.
// ---------------------------------------------------------------------------
type Policy = { write: MemberRole[]; del: MemberRole[]; insert: MemberRole[] }

function rolesOf(spec: string): MemberRole[] {
  if (spec === 'all') return [...ROLES]
  return spec.replace(/[{}]/g, '').split(',').map((s) => s.trim()) as MemberRole[]
}

function parsePolicies(sql: string): Record<string, Policy> {
  const out: Record<string, Policy> = {}
  const re = /org_policies\('(\w+)',\s*'([^']+)',\s*'([^']+)'(?:,\s*'([^']+)')?\)/g
  for (const m of sql.matchAll(re)) {
    const [, table, write, del, insert] = m
    out[table] = { write: rolesOf(write), del: rolesOf(del), insert: rolesOf(insert ?? write) }
  }
  return out
}

const sorted = (r: MemberRole[]) => [...r].sort()

describe('matriz da UI = políticas RLS da migration 003', () => {
  const p = parsePolicies(rlsSql)

  it('encontrou as políticas das tabelas operacionais', () => {
    for (const t of ['clients', 'demands', 'tasks', 'demand_categories', 'workflow_stages', 'contracts', 'payments']) {
      expect(p[t], `política de ${t}`).toBeDefined()
    }
  })

  const cases: [Permission, () => MemberRole[]][] = [
    ['clients.delete', () => p.clients.del],
    ['demands.delete', () => p.demands.del],
    ['tasks.delete', () => p.tasks.del],
    ['workflows.manage', () => p.demand_categories.write],
    ['contracts.manage', () => p.contracts.write],
    ['contracts.delete', () => p.contracts.del],
    ['payments.create', () => p.payments.insert],
    ['payments.delete', () => p.payments.del],
  ]
  for (const [perm, fromSql] of cases) {
    it(`${perm} espelha a RLS`, () => {
      expect(sorted(ROLES.filter((r) => can(r, perm)))).toEqual(sorted(fromSql()))
    })
  }

  it('etapas de fluxo seguem a mesma regra das categorias', () => {
    expect(sorted(p.workflow_stages.write)).toEqual(sorted(p.demand_categories.write))
  })

  it('membros, convites e organização são exclusivos do admin na RLS', () => {
    expect(rlsSql).toMatch(/members_update[\s\S]*?has_org_role\(organization_id, array\['admin'\]/)
    expect(rlsSql).toMatch(/invitations_admin_all[\s\S]*?has_org_role\(organization_id, array\['admin'\]/)
    expect(rlsSql).toMatch(/org_update[\s\S]*?has_org_role\(id, array\['admin'\]/)
    expect(ROLES.filter((r) => can(r, 'members.manage'))).toEqual(['admin'])
    expect(ROLES.filter((r) => can(r, 'organization.manage'))).toEqual(['admin'])
  })
})
