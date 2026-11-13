import { updateDiff, updatePatch, type ExistingClient, type RowValues } from './rows'

// L14 — atualizar por CPF: "completar vazios" (padrão) x "substituir pelos dados da planilha".
const existing: ExistingClient = {
  id: 'c1',
  full_name: 'Maria da Silva',
  cpf: '52998224725',
  phone: '11911112222',
  email: null,
  birth_date: null,
  address: 'Rua A',
}

const values = (over: Partial<RowValues> = {}): RowValues => ({
  full_name: 'Maria S. Outra',
  cpf: '52998224725',
  phone: '11987654321',
  email: 'maria@exemplo.com',
  birth_date: '1980-05-10',
  address: 'Rua B',
  notes: 'obs',
  status: 'inativo',
  category: 'Maternidade',
  ...over,
})

describe('updatePatch — modos', () => {
  it('sem modo continua só completando vazios (comportamento atual)', () => {
    expect(updatePatch(existing, values())).toEqual({ email: 'maria@exemplo.com', birth_date: '1980-05-10' })
  })

  it("'completar' explícito é igual ao padrão", () => {
    expect(updatePatch(existing, values(), 'completar')).toEqual(updatePatch(existing, values()))
  })

  it("'substituir' usa os valores da planilha para campos preenchidos e diferentes", () => {
    expect(updatePatch(existing, values(), 'substituir')).toEqual({
      phone: '11987654321',
      email: 'maria@exemplo.com',
      birth_date: '1980-05-10',
      address: 'Rua B',
    })
  })

  it("'substituir' nunca apaga dado do cadastro com célula vazia na planilha", () => {
    const patch = updatePatch(existing, values({ phone: null, address: null, email: null, birth_date: null }), 'substituir')
    expect(patch).toEqual({})
  })

  it("'substituir' omite o que já é igual e não mexe em nome, observações, situação nem categoria", () => {
    const igual = values({ phone: existing.phone, address: existing.address, email: null, birth_date: null })
    expect(updatePatch(existing, igual, 'substituir')).toEqual({})
    const keys = Object.keys(updatePatch(existing, values(), 'substituir'))
    for (const k of ['full_name', 'notes', 'status', 'category']) expect(keys).not.toContain(k)
  })

  it("'substituir' também preenche campos vazios no cadastro", () => {
    const vazio: ExistingClient = { ...existing, phone: null, address: null }
    expect(updatePatch(vazio, values(), 'substituir')).toMatchObject({ phone: '11987654321', address: 'Rua B' })
  })
})

describe('updateDiff', () => {
  const pick = (d: ReturnType<typeof updateDiff>) => d.map(({ field, from, to }) => ({ field, from, to }))

  it('completar: só os campos vazios que serão preenchidos', () => {
    expect(pick(updateDiff(existing, values(), 'completar'))).toEqual([
      { field: 'email', from: null, to: 'maria@exemplo.com' },
      { field: 'birth_date', from: null, to: '1980-05-10' },
    ])
  })

  it('substituir: mostra valor atual e novo só do que muda', () => {
    expect(pick(updateDiff(existing, values(), 'substituir'))).toEqual([
      { field: 'phone', from: '11911112222', to: '11987654321' },
      { field: 'email', from: null, to: 'maria@exemplo.com' },
      { field: 'birth_date', from: null, to: '1980-05-10' },
      { field: 'address', from: 'Rua A', to: 'Rua B' },
    ])
  })

  it('cada item traz um rótulo legível', () => {
    for (const d of updateDiff(existing, values(), 'substituir')) {
      expect(typeof d.label).toBe('string')
      expect(d.label.length).toBeGreaterThan(0)
    }
  })

  it('sem mudanças devolve lista vazia', () => {
    expect(updateDiff(existing, values({ phone: null, email: null, birth_date: null, address: null }), 'substituir')).toEqual([])
  })

  it('é coerente com updatePatch (mesmos campos)', () => {
    for (const mode of ['completar', 'substituir'] as const) {
      const fields = updateDiff(existing, values(), mode).map((d) => d.field).sort()
      expect(fields).toEqual(Object.keys(updatePatch(existing, values(), mode)).sort())
    }
  })
})
