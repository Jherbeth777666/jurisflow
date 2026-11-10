import {
  buildAIRequest,
  columnLetter,
  columnsOf,
  distinctValues,
  guessCategory,
  isSafeCategoryValue,
  isShareableCategoryValue,
  looksLikeHeader,
  maskValue,
  suggestMapping,
  toTable,
} from './mapping'

const sheet = [
  ['Nome da segurada', 'CPF', 'Whats', 'E-mail', 'Data de nascimento', 'Benefício', 'Situação', 'Obs'],
  ['MARIA DA SILVA', '529.982.247-25', '(11) 98765-4321', 'maria@x.com', '10/05/1990', 'Salário maternidade', 'Ativa', ''],
  ['João Souza', '', '11 3333-4444', '', '01/01/1970', 'Aposentadoria por idade', 'ativo', 'ligar'],
]

describe('toTable / cabeçalho', () => {
  it('detecta cabeçalho e descarta colunas vazias', () => {
    const t = toTable([
      ['Nome', '', 'CPF'],
      ['Ana', '', '52998224725'],
    ])
    expect(t.hasHeader).toBe(true)
    expect(t.headers).toEqual(['Nome', 'CPF'])
    expect(t.rows).toEqual([['Ana', '52998224725']])
  })
  it('sem cabeçalho: gera "Coluna A/B" e mantém a 1ª linha como dado', () => {
    const t = toTable([
      ['Ana Souza', '529.982.247-25'],
      ['Bia Lima', '111'],
    ])
    expect(t.hasHeader).toBe(false)
    expect(t.headers).toEqual(['Coluna A', 'Coluna B'])
    expect(t.rows).toHaveLength(2)
  })
  it('looksLikeHeader', () => {
    expect(looksLikeHeader(['Nome', 'CPF', 'Telefone'])).toBe(true)
    expect(looksLikeHeader(['ana@x.com', 'Ana'])).toBe(false)
    expect(looksLikeHeader(['10/10/2020', '12', 'x'])).toBe(false)
  })
  it('columnLetter', () => {
    expect(columnLetter(0)).toBe('A')
    expect(columnLetter(25)).toBe('Z')
    expect(columnLetter(26)).toBe('AA')
  })
})

describe('suggestMapping', () => {
  it('mapeia sinônimos PT-BR com alta confiança', () => {
    const s = suggestMapping(columnsOf(toTable(sheet)))
    expect(s.mapping).toEqual({
      full_name: 0,
      cpf: 1,
      phone: 2,
      email: 3,
      birth_date: 4,
      category: 5,
      status: 6,
      notes: 7,
    })
    expect(s.lowConfidence).toBe(false)
  })
  it('usa o conteúdo quando o título não ajuda e sinaliza baixa confiança', () => {
    const s = suggestMapping(
      columnsOf(
        toTable([
          ['Coluna 1', 'Coluna 2', 'Coluna 3'],
          ['Ana Maria Souza', '529.982.247-25', 'ana@x.com'],
          ['Bruno Lima', '123.456.789-09', 'b@y.com'],
        ]),
      ),
    )
    expect(s.mapping.cpf).toBe(1)
    expect(s.mapping.email).toBe(2)
    expect(s.mapping.full_name).toBe(0)
    expect(s.lowConfidence).toBe(true)
  })
  it('uma coluna não é usada para dois campos', () => {
    const s = suggestMapping(columnsOf(toTable([['Cliente'], ['Ana']])))
    expect(Object.values(s.mapping)).toEqual([0])
  })
})

describe('mascaramento para a IA', () => {
  it('troca dígitos por 9 e letras por A/a mantendo comprimento', () => {
    expect(maskValue('Maria (11) 98765-4321')).toBe('Aaaaa (99) 99999-9999')
    expect(maskValue('José')).toBe('Aaaa')
    expect(maskValue('ana@x.com')).toBe('aaa#a.aaa')
    expect(maskValue('x'.repeat(100))).toHaveLength(40)
  })
  it('valores de categoria com dígitos ou @ não são compartilhados', () => {
    expect(isShareableCategoryValue('Salário-maternidade')).toBe(true)
    expect(isShareableCategoryValue('Processo 12345')).toBe(false)
    expect(isShareableCategoryValue('a@b')).toBe(false)
    expect(isShareableCategoryValue('x')).toBe(false)
  })
  it('buildAIRequest não contém nenhum valor real', () => {
    const t = toTable(sheet)
    const req = buildAIRequest(columnsOf(t), ['Aposentadoria'], distinctValues(t.rows, 5))
    const json = JSON.stringify(req)
    expect(json).not.toMatch(/MARIA|529|98765|maria@x/)
    expect(req.columns[0].examples).toEqual(['AAAAA AA AAAAA', 'Aaaa Aaaaa'])
    expect(req.category_values).toEqual(['Salário maternidade', 'Aposentadoria por idade'])
  })
  it('título com dado pessoal é substituído pela letra da coluna', () => {
    const req = buildAIRequest([{ index: 2, header: 'ana@x.com', samples: [] }], [], [])
    expect(req.columns[0].header).toBe('Coluna C')
  })
})

describe('distinctValues / guessCategory', () => {
  it('distintos sem diferenciar maiúsculas/acentos, por frequência', () => {
    expect(distinctValues([['BPC'], ['Pesca'], ['bpc'], ['']], 0)).toEqual(['BPC', 'Pesca'])
  })
  it('sugere categoria do escritório', () => {
    const cats = [
      { id: 'm', name: 'Salário-maternidade' },
      { id: 'a', name: 'Aposentadoria' },
      { id: 'i', name: 'Benefícios por incapacidade' },
      { id: 'p', name: 'Benefícios relacionados à pesca' },
      { id: 't', name: 'Demandas trabalhistas' },
    ]
    expect(guessCategory('salario maternidade', cats)).toBe('m')
    expect(guessCategory('Aposentadoria por idade rural', cats)).toBe('a')
    expect(guessCategory('Auxílio-doença', cats)).toBe('i')
    expect(guessCategory('Seguro defeso', cats)).toBe('p')
    expect(guessCategory('Reclamatória', cats)).toBe('t')
    expect(guessCategory('Divórcio', cats)).toBeNull()
  })
})

describe('valores de categoria enviados à IA — sem nomes de pessoas', () => {
  it('filtra nomes próprios e mantém categorias/benefícios', () => {
    const values = ['Maria da Silva Souza', 'Aposentadoria da Maria', 'Salário-maternidade', 'BPC']
    const req = buildAIRequest([{ index: 0, header: 'Benefício', samples: values }], ['Aposentadoria'], values)
    expect(req.category_values).toEqual(['Salário-maternidade', 'BPC'])
  })
  it('isSafeCategoryValue: vocabulário, curtos sem padrão de nome e coluna de nomes', () => {
    expect(isSafeCategoryValue('Pensão por Morte')).toBe(true)
    expect(isSafeCategoryValue('Auxílio-Doença')).toBe(true)
    expect(isSafeCategoryValue('revisão da vida toda')).toBe(true)
    expect(isSafeCategoryValue('previdenciário')).toBe(true)
    expect(isSafeCategoryValue('Maria')).toBe(false)
    expect(isSafeCategoryValue('José Carlos Pereira')).toBe(false)
    expect(isSafeCategoryValue('Rua das Flores')).toBe(false)
    expect(isSafeCategoryValue('Planejamento Premium', { officeCategories: ['Planejamento Premium'] })).toBe(true)
    expect(isSafeCategoryValue('aposentadoria', { personNames: new Set(['aposentadoria']) })).toBe(false)
  })
  it('valores iguais aos da coluna mapeada como nome não saem', () => {
    const cols = [
      { index: 0, header: 'Nome', samples: ['ana', 'bia'] },
      { index: 1, header: 'Tipo', samples: ['ana', 'bpc'] },
    ]
    expect(buildAIRequest(cols, [], ['ana', 'bpc'], { full_name: 0, category: 1 }).category_values).toEqual(['bpc'])
  })
})
