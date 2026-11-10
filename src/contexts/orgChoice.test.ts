import { leaveErrorMessage, normalizeInvitations, pickCurrentOrg } from './orgChoice'

const m = (id: string) => ({ organization: { id } })

describe('pickCurrentOrg', () => {
  it('usa o escritório salvo quando ainda é membro', () => {
    expect(pickCurrentOrg([m('a'), m('b')], 'b')?.organization.id).toBe('b')
  })
  it('único escritório é escolhido mesmo sem salvo', () => {
    expect(pickCurrentOrg([m('a')], null)?.organization.id).toBe('a')
    expect(pickCurrentOrg([m('a')], 'saiu')?.organization.id).toBe('a')
  })
  it('vários e nenhum salvo válido → null (mostrar seletor, não o 1º alfabético)', () => {
    expect(pickCurrentOrg([m('a'), m('b')], null)).toBeNull()
    expect(pickCurrentOrg([m('a'), m('b')], 'x')).toBeNull()
    expect(pickCurrentOrg([], null)).toBeNull()
  })
})

describe('convites', () => {
  it('normaliza o retorno da RPC', () => {
    const list = normalizeInvitations([
      { id: 'i1', organization_name: 'Silva Adv.', role: 'advogado', invited_by_name: 'Ana', created_at: 'x', expires_at: 'y' },
      { id: 2 },
      null,
    ])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ organization_name: 'Silva Adv.', role: 'advogado', invited_by_name: 'Ana' })
    expect(normalizeInvitations(null)).toEqual([])
  })
  it('erro de último administrador vira orientação', () => {
    expect(leaveErrorMessage('O escritório precisa de pelo menos um administrador ativo.')).toMatch(/último administrador/)
    expect(leaveErrorMessage('outro')).toBe('outro')
  })
})
