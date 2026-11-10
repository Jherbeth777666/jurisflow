import { buildImportSystemPrompt, buildImportUserMessage } from './prompt'
import { extractJSON, hasUnmaskedDigits, validateAIResponse, validateInput, type AIImportInput } from './validate'

const ORG = '11111111-2222-3333-4444-555555555555'
const base = () => ({
  organization_id: ORG,
  columns: [
    { index: 0, header: 'Nome da segurada', examples: ['Aaaaa aa Aaaaa', 'Aaaa Aaaaa'] },
    { index: 1, header: 'CPF', examples: ['999.999.999-99'] },
    { index: 2, header: 'Whats', examples: ['(99) 99999-9999'] },
    { index: 3, header: 'Benefício', examples: ['Aaaaaaa aaaaaaaaaaa'] },
  ],
  categories: ['Salário-maternidade', 'Aposentadoria'],
  category_values: ['Salário maternidade', 'Aposentadoria por idade', 'Divórcio'],
})

describe('hasUnmaskedDigits', () => {
  it('detecta CPF/telefone reais mesmo com pontuação', () => {
    expect(hasUnmaskedDigits('123.456.789-09')).toBe(true)
    expect(hasUnmaskedDigits('(11) 98765-4321')).toBe(true)
    expect(hasUnmaskedDigits('12345')).toBe(true)
  })
  it('aceita máscara e números curtos', () => {
    expect(hasUnmaskedDigits('999.999.999-99')).toBe(false)
    expect(hasUnmaskedDigits('99/99/9999')).toBe(false)
    expect(hasUnmaskedDigits('Rua 12')).toBe(false)
  })
})

describe('validateInput', () => {
  it('aceita entrada mascarada', () => {
    const r = validateInput(base())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.columns).toHaveLength(4)
      expect(r.value.categoryValues).toHaveLength(3)
    }
  })
  it('exige organization_id válido', () => {
    expect(validateInput({ ...base(), organization_id: 'x' }).ok).toBe(false)
    expect(validateInput(null).ok).toBe(false)
    expect(validateInput([]).ok).toBe(false)
  })
  it('rejeita exemplos não mascarados (dígitos reais ou @)', () => {
    const b = base()
    b.columns[1].examples = ['529.982.247-25']
    expect(validateInput(b)).toMatchObject({ ok: false, error: expect.stringMatching(/mascarados/) })
    const c = base()
    c.columns[0].examples = ['ana@x.com']
    expect(validateInput(c).ok).toBe(false)
  })
  it('rejeita título com dado pessoal', () => {
    const b = base()
    b.columns[0].header = 'maria@x.com'
    expect(validateInput(b).ok).toBe(false)
  })
  it('limites: colunas, exemplos, tamanhos, valores', () => {
    const many = base()
    many.columns = Array.from({ length: 61 }, (_, i) => ({ index: i, header: `C${i}`, examples: [] }))
    expect(validateInput(many).ok).toBe(false)

    const ex = base()
    ex.columns[0].examples = ['Aa', 'Aa', 'Aa', 'Aa']
    expect(validateInput(ex).ok).toBe(false)

    const long = base()
    long.columns[0].examples = ['A'.repeat(41)]
    expect(validateInput(long).ok).toBe(false)

    const vals = base()
    vals.category_values = Array.from({ length: 81 }, (_, i) => `Tipo ${String.fromCharCode(65 + (i % 26))}`)
    expect(validateInput(vals).ok).toBe(false)

    const longVal = base()
    longVal.category_values = ['a'.repeat(81)]
    expect(validateInput(longVal).ok).toBe(false)
  })
  it('rejeita valores de categoria com números ou @', () => {
    const b = base()
    b.category_values = ['Processo 0001234']
    expect(validateInput(b).ok).toBe(false)
  })
  it('rejeita índices repetidos ou inválidos', () => {
    const b = base()
    b.columns[1].index = 0
    expect(validateInput(b).ok).toBe(false)
    const c = base()
    c.columns[0].index = -1
    expect(validateInput(c).ok).toBe(false)
  })
})

describe('validateAIResponse', () => {
  const input = (() => {
    const r = validateInput(base())
    if (!r.ok) throw new Error('fixture')
    return r.value
  })() as AIImportInput

  it('aceita JSON em cerca de código e normaliza categorias', () => {
    const text =
      'Segue:\n```json\n{"mapping":{"full_name":0,"cpf":1,"phone":2,"category":3},"categories":{"salario maternidade":"salário-maternidade","Aposentadoria por idade":"Aposentadoria","Divórcio":null}}\n```'
    expect(validateAIResponse(text, input)).toEqual({
      mapping: { full_name: 0, cpf: 1, phone: 2, category: 3 },
      categories: { 'Salário maternidade': 'Salário-maternidade', 'Aposentadoria por idade': 'Aposentadoria' },
    })
  })
  it('descarta campos desconhecidos, colunas inexistentes ou repetidas e categorias inventadas', () => {
    const text = JSON.stringify({
      mapping: { full_name: 0, cpf: 0, hacker: 1, email: 9, phone: '2', birth_date: 1.5, notes: 3 },
      categories: { 'Salário maternidade': 'Família', 'Valor inventado': 'Aposentadoria' },
    })
    expect(validateAIResponse(text, input)).toEqual({ mapping: { full_name: 0, notes: 3 }, categories: {} })
  })
  it('retorna null sem JSON', () => {
    expect(validateAIResponse('não sei', input)).toBeNull()
    expect(validateAIResponse('[1,2]', input)).toBeNull()
    expect(extractJSON('{quebrado')).toBeNull()
  })
})

describe('prompt', () => {
  it('lista os campos e envia só a estrutura', () => {
    const r = validateInput(base())
    if (!r.ok) throw new Error('fixture')
    expect(buildImportSystemPrompt()).toMatch(/full_name/)
    expect(buildImportSystemPrompt()).toMatch(/JSON/)
    const msg = buildImportUserMessage(r.value)
    expect(msg).toContain('"header":"CPF"')
    expect(msg).toContain('999.999.999-99')
    expect(msg).not.toContain(ORG)
  })
})
