import { createIndex, findDuplicatePairs, findMatch, jaroWinkler, addToIndex } from './dedupe'

describe('jaroWinkler', () => {
  it('valores de referência', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3)
    expect(jaroWinkler('dwayne', 'duane')).toBeCloseTo(0.84, 2)
    expect(jaroWinkler('abc', 'abc')).toBe(1)
    expect(jaroWinkler('', 'abc')).toBe(0)
  })
  it('erros de digitação comuns em nomes passam de 0,93', () => {
    expect(jaroWinkler('maria aparecida da silva', 'maria aparecida da silvs')).toBeGreaterThanOrEqual(0.93)
    expect(jaroWinkler('maria aparecida da silva', 'joao pedro')).toBeLessThan(0.93)
  })
})

describe('findMatch', () => {
  const existing = [
    { id: 'c1', name: 'Maria da Silva', cpf: '52998224725', phone: '11987654321', birthDate: '1990-05-10' },
    { id: 'c2', name: 'João Souza', cpf: null, phone: '1133334444', birthDate: null },
    { id: 'c3', name: 'Ana Lima', cpf: null, phone: null, birthDate: '1980-01-01' },
    { id: 'c4', name: 'Carlos Pereira', cpf: '11144477735', phone: null, birthDate: null },
  ]
  const idx = createIndex(existing)

  it('mesmo CPF', () => {
    expect(findMatch(idx, { id: 'r', name: 'Outro Nome', cpf: '52998224725' })).toMatchObject({ id: 'c1', reason: 'cpf', certain: true })
  })
  it('nome sem acento + mesmo telefone', () => {
    expect(findMatch(idx, { id: 'r', name: 'JOAO  SOUZA', phone: '1133334444' })).toMatchObject({ id: 'c2', reason: 'nome_telefone' })
  })
  it('nome + mesmo nascimento', () => {
    expect(findMatch(idx, { id: 'r', name: 'ana lima', birthDate: '1980-01-01' })).toMatchObject({ id: 'c3', reason: 'nome_nascimento' })
  })
  it('nome parecido é só possível duplicado', () => {
    const m = findMatch(idx, { id: 'r', name: 'Maria da Silvaa' })
    expect(m).toMatchObject({ id: 'c1', reason: 'nome_similar', certain: false })
    expect(m!.score).toBeGreaterThanOrEqual(0.93)
  })
  it('mesmo nome, nada mais em comum → possível (homônimo)', () => {
    expect(findMatch(idx, { id: 'r', name: 'Ana Lima' })).toMatchObject({ id: 'c3', certain: false })
  })
  it('CPFs diferentes nunca são a mesma pessoa', () => {
    expect(findMatch(idx, { id: 'r', name: 'Carlos Pereira', cpf: '52998224725' })?.id).toBe('c1') // bate pelo CPF com c1
    expect(findMatch(idx, { id: 'r', name: 'Carlos Pereira', cpf: '12345678909' })).toBeNull()
  })
  it('sem correspondência', () => {
    expect(findMatch(idx, { id: 'r', name: 'Zuleica Andrade' })).toBeNull()
  })
  it('uso incremental (dentro da planilha)', () => {
    const sheetIdx = createIndex()
    const r1 = { id: 'l1', name: 'Pedro Alves', cpf: '12345678909' }
    expect(findMatch(sheetIdx, r1)).toBeNull()
    addToIndex(sheetIdx, r1)
    expect(findMatch(sheetIdx, { id: 'l2', name: 'Pedro A.', cpf: '12345678909' })).toMatchObject({ id: 'l1', reason: 'cpf' })
  })
})

describe('findDuplicatePairs', () => {
  it('lista cada par uma vez com o motivo mais forte', () => {
    const pairs = findDuplicatePairs([
      { id: 'a', name: 'Maria da Silva', cpf: '52998224725' },
      { id: 'b', name: 'Maria Silva', cpf: '52998224725' },
      { id: 'c', name: 'José Santos', phone: '11999990000' },
      { id: 'd', name: 'Jose Santos', phone: '11999990000' },
      { id: 'e', name: 'Roberta Nunes Ferreira' },
      { id: 'f', name: 'Roberta Nunes Ferreiar' },
      { id: 'g', name: 'Outra Pessoa' },
    ])
    expect(pairs).toEqual([
      { a: 'a', b: 'b', reason: 'cpf', score: 1, certain: true },
      { a: 'c', b: 'd', reason: 'nome_telefone', score: 1, certain: true },
      expect.objectContaining({ a: 'e', b: 'f', reason: 'nome_similar', certain: false }),
    ])
  })
})
