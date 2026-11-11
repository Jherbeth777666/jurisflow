import { describe, expect, it } from 'vitest'
import type { Client, Contract, Demand, Installment, MemberWithProfile, Payment, Task } from '@/types/database'
import type { DemandChecklistItem } from '@/features/checklist/types'
import {
  ROLE_CAPABILITIES,
  activeAdminCount,
  buildClientExport,
  exportFileName,
  parseTab,
  sortMembers,
  validateFullName,
  validateInvitation,
  validateOrgName,
  validatePassword,
  wouldRemoveLastAdmin,
} from './logic'

const member = (over: Partial<MemberWithProfile>): MemberWithProfile => ({
  id: 'm' + Math.random(),
  organization_id: 'org',
  user_id: 'u' + Math.random(),
  role: 'assistente',
  active: true,
  created_at: '',
  updated_at: '',
  profile: { id: 'p', full_name: 'Fulano', email: 'fulano@x.com' },
  ...over,
})

describe('validações', () => {
  it('nome e escritório', () => {
    expect(validateFullName(' A ')).toMatch(/mínimo/)
    expect(validateFullName('Ana Souza')).toBeNull()
    expect(validateFullName('x'.repeat(121))).toMatch(/120/)
    expect(validateOrgName('Silva Advocacia')).toBeNull()
    expect(validateOrgName('')).toMatch(/mínimo/)
  })

  it('senha', () => {
    expect(validatePassword('abc123', 'abc123')).toMatch(/8 caracteres/)
    expect(validatePassword('abcdefgh', 'abcdefgh')).toMatch(/letras e números/)
    expect(validatePassword('12345678', '12345678')).toMatch(/letras e números/)
    expect(validatePassword('abcd1234', 'abcd1235')).toMatch(/não conferem/)
    expect(validatePassword('abcd1234', 'abcd1234')).toBeNull()
  })

  it('convite', () => {
    const members = [member({ profile: { id: '1', full_name: 'Ana', email: 'Ana@Escritorio.com' } })]
    const pending = [{ email: 'pendente@escritorio.com' }]
    expect(validateInvitation('', members, pending)).toMatch(/Informe/)
    expect(validateInvitation('ana@', members, pending)).toMatch(/inválido/)
    expect(validateInvitation(' ana@escritorio.com ', members, pending)).toMatch(/já faz parte/)
    expect(validateInvitation('PENDENTE@escritorio.com', members, pending)).toMatch(/pendente/)
    expect(validateInvitation('novo@escritorio.com', members, pending)).toBeNull()
    // membro desativado pode ser reconvidado
    const inactive = [member({ active: false, profile: { id: '2', full_name: 'B', email: 'b@x.com' } })]
    expect(validateInvitation('b@x.com', inactive, [])).toBeNull()
  })
})

describe('equipe', () => {
  const admin = member({ id: 'a', role: 'admin' })
  const adv = member({ id: 'b', role: 'advogado' })

  it('detecta remoção do último administrador', () => {
    const list = [admin, adv]
    expect(activeAdminCount(list)).toBe(1)
    expect(wouldRemoveLastAdmin(list, admin, { role: 'advogado' })).toBe(true)
    expect(wouldRemoveLastAdmin(list, admin, { active: false })).toBe(true)
    expect(wouldRemoveLastAdmin(list, admin, { role: 'admin' })).toBe(false)
    expect(wouldRemoveLastAdmin(list, adv, { active: false })).toBe(false)
    const two = [admin, member({ id: 'c', role: 'admin' })]
    expect(wouldRemoveLastAdmin(two, admin, { role: 'assistente' })).toBe(false)
    // admin desativado não conta
    const withInactive = [admin, member({ id: 'd', role: 'admin', active: false })]
    expect(wouldRemoveLastAdmin(withInactive, admin, { active: false })).toBe(true)
  })

  it('ordena ativos, depois por papel e nome', () => {
    const list = sortMembers([
      member({ role: 'assistente', profile: { id: '1', full_name: 'Zé', email: null } }),
      member({ role: 'admin', active: false, profile: { id: '2', full_name: 'Ana', email: null } }),
      member({ role: 'advogado', profile: { id: '3', full_name: 'Bia', email: null } }),
      member({ role: 'advogado', profile: { id: '4', full_name: 'Ágata', email: null } }),
    ])
    expect(list.map((m) => m.profile?.full_name)).toEqual(['Ágata', 'Bia', 'Zé', 'Ana'])
  })

  it('tabela de papéis cobre os três papéis em todas as linhas', () => {
    for (const r of ROLE_CAPABILITIES) {
      expect(r.admin && r.advogado && r.assistente).toBeTruthy()
    }
    const row = (s: string) => ROLE_CAPABILITIES.find((r) => r.resource.startsWith(s))!
    expect(row('Pagamentos — registrar').assistente).toBe('Sim')
    expect(row('Pagamentos — estornar').assistente).toBe('Não')
    expect(row('Equipe').advogado).toBe('Não')
  })
})

describe('portabilidade', () => {
  const client = { id: 'c1', organization_id: 'org', created_by: 'u1', full_name: 'Maria', cpf: '52998224725' } as Client
  const contract = { id: 'k1', organization_id: 'org', client_id: 'c1', total_amount: 300 } as Contract
  const otherContract = { id: 'k2', organization_id: 'org', client_id: 'c1', total_amount: 100 } as Contract
  const inst = (id: string, contract_id: string, number: number) => ({ id, contract_id, number, organization_id: 'org' }) as Installment

  it('monta o JSON agrupando parcelas/pagamentos por contrato e sem campos internos', () => {
    const out = buildClientExport({
      organizationName: 'Escritório X',
      client,
      demands: [{ id: 'd1', organization_id: 'org', client_id: 'c1' } as Demand],
      tasks: [{ id: 't1' } as Task, { id: 't1' } as Task, { id: 't2' } as Task],
      contracts: [contract, otherContract],
      installments: [inst('i2', 'k1', 2), inst('i1', 'k1', 1), inst('i3', 'k2', 1)],
      payments: [{ id: 'p1', contract_id: 'k1', amount: 100 } as Payment],
      generatedAt: '2026-11-09T12:00:00.000Z',
    })
    expect(out.controlador).toBe('Escritório X')
    expect(out.gerado_em).toBe('2026-11-09T12:00:00.000Z')
    expect(out.titular).toEqual({ id: 'c1', full_name: 'Maria', cpf: '52998224725' })
    expect(out.demandas[0]).not.toHaveProperty('organization_id')
    expect(out.tarefas.map((t) => t.id)).toEqual(['t1', 't2']) // sem duplicadas
    expect(out.contratos[0].parcelas.map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(out.contratos[0].pagamentos).toHaveLength(1)
    expect(out.contratos[1].parcelas.map((i) => i.id)).toEqual(['i3'])
    expect(out.contratos[1].pagamentos).toHaveLength(0)
  })

  const checklistItem = (id: string, demand_id: string, position: number): DemandChecklistItem =>
    ({
      id,
      organization_id: 'org',
      demand_id,
      label: 'Documento ' + id,
      done: false,
      done_at: null,
      done_by: null,
      position,
      created_at: '2026-11-09T12:00:00.000Z',
      updated_at: '2026-11-09T12:00:00.000Z',
    }) as DemandChecklistItem

  const demand = (id: string) => ({ id, organization_id: 'org', client_id: 'c1' }) as Demand

  it('inclui o checklist dentro de cada demanda, ordenado por position e sem campos internos', () => {
    const out = buildClientExport({
      organizationName: 'Escritório X',
      client,
      demands: [demand('d1'), demand('d2'), demand('d3')],
      tasks: [],
      contracts: [],
      installments: [],
      payments: [],
      // d1 recebido fora de ordem: positions 2, 0, 1 → ordenado 0, 1, 2
      // d2 recebido fora de ordem: positions 5, 4 → ordenado 4, 5
      checklistItems: [
        checklistItem('i-c', 'd1', 2),
        checklistItem('i-a', 'd1', 0),
        checklistItem('i-b', 'd1', 1),
        checklistItem('i-d', 'd2', 5),
        checklistItem('i-e', 'd2', 4),
        checklistItem('i-fora', 'd-fora-do-cliente', 0),
      ],
      generatedAt: '2026-11-09T12:00:00.000Z',
    })
    expect(out.versao).toBe(2)
    expect(out.demandas.map((d) => d.id)).toEqual(['d1', 'd2', 'd3'])
    expect(out.demandas[0].checklist.map((i) => i.id)).toEqual(['i-a', 'i-b', 'i-c'])
    expect(out.demandas[0].checklist.map((i) => i.position)).toEqual([0, 1, 2])
    expect(out.demandas[1].checklist.map((i) => i.id)).toEqual(['i-e', 'i-d'])
    expect(out.demandas[2].checklist).toEqual([]) // demanda sem itens
    // item de demanda que não pertence ao cliente não vaza para nenhuma demanda
    expect(out.demandas.some((d) => d.checklist.some((i) => i.id === 'i-fora'))).toBe(false)
    expect(out.demandas[0].checklist[0]).not.toHaveProperty('organization_id')
    expect(out.demandas[0].checklist[0]).not.toHaveProperty('created_by')
    expect(out.observacao).toMatch(/checklist de documentos/i)
  })

  it('sem checklistItems informado continua funcionando com checklist vazio', () => {
    const out = buildClientExport({
      organizationName: 'Escritório X',
      client,
      demands: [demand('d1'), demand('d2')],
      tasks: [],
      contracts: [],
      installments: [],
      payments: [],
      generatedAt: '2026-11-09T12:00:00.000Z',
    })
    expect(out.versao).toBe(2)
    expect(out.demandas.every((d) => Array.isArray(d.checklist) && d.checklist.length === 0)).toBe(true)
  })

  it('nome de arquivo seguro', () => {
    expect(exportFileName('José da Silva / Ação', '2026-11-09')).toBe('dados-jose-da-silva-acao-2026-11-09.json')
    expect(exportFileName('***', '2026-11-09')).toBe('dados-cliente-2026-11-09.json')
  })

  it('aba padrão', () => {
    expect(parseTab(null)).toBe('perfil')
    expect(parseTab('equipe')).toBe('equipe')
    expect(parseTab('xyz')).toBe('perfil')
  })
})
