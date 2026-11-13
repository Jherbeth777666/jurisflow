import { describe, expect, it } from 'vitest'
import { MESSAGE_VARIABLES, normalizeVariables } from './variables'
import { VARIABLE_GROUPS, fromSegments, insertVariable, replaceVariable, toSegments } from './segments'

describe('toSegments', () => {
  it('texto vazio vira lista vazia', () => {
    expect(toSegments('')).toEqual([])
  })

  it('texto sem variável vira um só segmento de texto', () => {
    expect(toSegments('Olá, tudo bem?')).toEqual([{ kind: 'text', text: 'Olá, tudo bem?' }])
  })

  it('separa texto e variáveis conhecidas e desconhecidas', () => {
    expect(toSegments('Oi {{primeiro_nome}}, veja {{xyz}}!')).toEqual([
      { kind: 'text', text: 'Oi ' },
      { kind: 'var', name: 'primeiro_nome', known: true },
      { kind: 'text', text: ', veja ' },
      { kind: 'var', name: 'xyz', known: false },
      { kind: 'text', text: '!' },
    ])
  })

  it('aceita espaços dentro das chaves', () => {
    expect(toSegments('{{ etapa }}')).toEqual([{ kind: 'var', name: 'etapa', known: true }])
  })

  it('variáveis coladas e repetidas', () => {
    const segs = toSegments('{{etapa}}{{etapa}}')
    expect(segs).toHaveLength(2)
    expect(segs.every((s) => s.kind === 'var')).toBe(true)
  })
})

describe('fromSegments', () => {
  it.each([
    '',
    'sem variáveis',
    'Oi {{primeiro_nome}}!',
    'Oi {{ primeiro_nome }}, etapa {{  etapa}} e {{desconhecida}}',
    'linha 1\nlinha 2 {{responsavel}}\n\n{{valor_parcela}}',
    '{{etapa}}{{categoria}}',
    'chaves soltas {{ e }} e {{Maiuscula}}',
  ])('ida e volta equivale a normalizeVariables: %j', (t) => {
    expect(fromSegments(toSegments(t))).toBe(normalizeVariables(t))
  })

  it('serializa var como {{nome}}', () => {
    expect(fromSegments([{ kind: 'text', text: 'a ' }, { kind: 'var', name: 'etapa', known: true }])).toBe('a {{etapa}}')
  })
})

describe('insertVariable', () => {
  it('insere no meio e coloca o caret logo após o token', () => {
    expect(insertVariable('Olá , tudo bem', 4, 'primeiro_nome')).toEqual({
      text: 'Olá {{primeiro_nome}}, tudo bem',
      caret: 4 + '{{primeiro_nome}}'.length,
    })
  })

  it('insere no início e no fim', () => {
    expect(insertVariable('abc', 0, 'etapa')).toEqual({ text: '{{etapa}}abc', caret: 9 })
    expect(insertVariable('abc', 3, 'etapa')).toEqual({ text: 'abc{{etapa}}', caret: 12 })
  })

  it('texto vazio', () => {
    expect(insertVariable('', 0, 'etapa')).toEqual({ text: '{{etapa}}', caret: 9 })
  })
})

describe('replaceVariable', () => {
  it('substitui todas as ocorrências', () => {
    expect(replaceVariable('{{etapa}} e {{etapa}} e {{categoria}}', 'etapa', 'Análise')).toBe('Análise e Análise e {{categoria}}')
  })

  it('aceita ocorrência com espaços', () => {
    expect(replaceVariable('a {{ etapa }} b', 'etapa', 'X')).toBe('a X b')
  })

  it('remove chaves do valor', () => {
    const out = replaceVariable('Oi {{primeiro_nome}}', 'primeiro_nome', '{{Maria}}')
    expect(out).not.toContain('{')
    expect(out).not.toContain('}')
    expect(out).toContain('Maria')
  })

  it('valor com {{outra}} não reintroduz variável', () => {
    expect(replaceVariable('{{etapa}}', 'etapa', 'x {{categoria}} y')).not.toMatch(/\{\{|\}\}/)
  })

  it('sem ocorrência mantém o texto', () => {
    expect(replaceVariable('abc', 'etapa', 'X')).toBe('abc')
  })
})

describe('VARIABLE_GROUPS', () => {
  it('tem os grupos esperados', () => {
    const titles = VARIABLE_GROUPS.map((g) => g.title)
    expect(titles).toEqual(expect.arrayContaining(['Cliente', 'Demanda', 'Financeiro', 'Escritório']))
    expect(titles).toHaveLength(4)
  })

  it('cada variável aparece em exatamente um grupo', () => {
    const all = VARIABLE_GROUPS.flatMap((g) => g.variables.map((v) => v.name))
    expect([...all].sort()).toEqual(MESSAGE_VARIABLES.map((v) => v.name).sort())
    expect(new Set(all).size).toBe(all.length)
  })

  it('agrupa conforme o plano', () => {
    const by = Object.fromEntries(VARIABLE_GROUPS.map((g) => [g.title, g.variables.map((v) => v.name).sort()]))
    expect(by['Cliente']).toEqual(['primeiro_nome'])
    expect(by['Financeiro']).toEqual(['valor_parcela', 'vencimento_parcela'])
    expect(by['Escritório']).toEqual(['nome_escritorio'])
    expect(by['Demanda']).toEqual(
      ['categoria', 'data_proxima_atividade', 'documentos_pendentes', 'etapa', 'proxima_atividade', 'responsavel'].sort(),
    )
  })
})
