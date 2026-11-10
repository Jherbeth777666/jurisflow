import { classifyRows, demandTitle, draftsFromTable, effectiveAction, summarize, updatePatch, type ExistingClient } from './rows'

const TODAY = '2026-11-09'
const existing: ExistingClient[] = [
  { id: 'c1', full_name: 'Maria da Silva', cpf: '52998224725', phone: null, birth_date: null, email: null, address: 'Rua A' },
]
const mapping = { full_name: 0, cpf: 1, phone: 2, category: 3 }
const table = [
  ['MARIA DA SILVA', '529.982.247-25', '(11) 98765-4321', 'Maternidade'], // atualizar (CPF)
  ['João Souza', '', '11 3333-4444', 'Aposentadoria'], // novo
  ['joao souza', '', '1133334444', ''], // duplicado de L3 (nome+telefone)
  ['Ana', '111.111.111-11', '', ''], // erro CPF
  ['Maria da Silvaa', '', '', ''], // possível (nome parecido)
]

describe('classifyRows', () => {
  const rows = classifyRows(draftsFromTable(table, mapping, 2), existing, TODAY)
  it('status por linha', () => {
    expect(rows.map((r) => r.status)).toEqual(['atualizar', 'novo', 'duplicado', 'erro', 'possivel'])
    expect(rows[0].values.full_name).toBe('Maria da Silva')
    expect(rows[2].match?.label).toMatch(/Linha 3/)
    expect(rows[3].errors.cpf).toMatch(/inválido/)
  })
  it('ações efetivas respeitam permissões do status', () => {
    expect(effectiveAction(rows[3], { L5: 'criar' })).toBe('ignorar')
    expect(effectiveAction(rows[1], { L3: 'ignorar' })).toBe('ignorar')
    expect(effectiveAction(rows[1], { L3: 'atualizar' })).toBe('criar')
  })
  it('resumo', () => {
    const s = summarize(rows, {}, (r) => !!r.values.category)
    expect(s).toMatchObject({ total: 5, criar: 2, atualizar: 1, ignorar: 2, demandas: 2 })
  })
})

describe('updatePatch', () => {
  it('só completa campos vazios', () => {
    const v = { full_name: 'X', cpf: '12345678909', phone: '11987654321', email: 'a@b.com', birth_date: null, address: 'Rua B', notes: null, status: null, category: null }
    expect(updatePatch(existing[0], v)).toEqual({ phone: '11987654321', email: 'a@b.com' })
  })
})

it('demandTitle', () => {
  expect(demandTitle('Aposentadoria', 'Ana')).toBe('Aposentadoria — Ana')
  expect(demandTitle('x'.repeat(200), 'Ana')).toHaveLength(160)
})
