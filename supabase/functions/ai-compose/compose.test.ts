import { describe, expect, it } from 'vitest'
import {
  MAX_TEMPLATE_CHARS,
  buildComposeUserMessage,
  checkRewrite,
  cleanModelOutput,
  extractPlaceholders,
  validateComposeBody,
} from './compose'

const ORG = '11111111-2222-3333-4444-555555555555'
const TEMPLATE = 'Olá, {{primeiro_nome}}! Faltam: {{documentos_pendentes}}. Equipe {{nome_escritorio}}.'

describe('validateComposeBody', () => {
  it('aceita corpo válido e normaliza', () => {
    const r = validateComposeBody({ organization_id: ORG.toUpperCase(), template: '  Oi {{primeiro_nome}} ', tone: 'curto' })
    expect(r).toEqual({ ok: true, value: { organizationId: ORG, template: 'Oi {{primeiro_nome}}', tone: 'curto' } })
  })
  it('rejeita org, tom e modelo inválidos', () => {
    expect(validateComposeBody({ organization_id: 'x', template: 'a', tone: 'curto' }).ok).toBe(false)
    expect(validateComposeBody({ organization_id: ORG, template: 'a', tone: 'agressivo' }).ok).toBe(false)
    expect(validateComposeBody({ organization_id: ORG, template: '   ', tone: 'formal' }).ok).toBe(false)
    expect(validateComposeBody({ organization_id: ORG, template: 'a'.repeat(MAX_TEMPLATE_CHARS + 1), tone: 'formal' }).ok).toBe(false)
    expect(validateComposeBody(null).ok).toBe(false)
    expect(validateComposeBody([]).ok).toBe(false)
  })
})

describe('extractPlaceholders', () => {
  it('retorna conjunto ordenado e tolera espaços', () => {
    expect(extractPlaceholders('{{ b }} {{a}} {{b}}')).toEqual(['a', 'b'])
    expect(extractPlaceholders('{nome} {{Nome}}')).toEqual([])
  })
})

describe('checkRewrite', () => {
  it('aceita reescrita que preserva as variáveis (em outra ordem)', () => {
    const r = checkRewrite(TEMPLATE, 'Equipe {{nome_escritorio}} aqui. {{primeiro_nome}}, ainda faltam: {{documentos_pendentes}}.')
    expect(r.ok).toBe(true)
  })
  it('normaliza espaços dentro das chaves e remove cercas', () => {
    const r = checkRewrite(TEMPLATE, '```\nOi {{ primeiro_nome }}, faltam {{documentos_pendentes}} — {{nome_escritorio}}\n```')
    expect(r).toEqual({ ok: true, text: 'Oi {{primeiro_nome}}, faltam {{documentos_pendentes}} — {{nome_escritorio}}' })
  })
  it('rejeita variável removida', () => {
    const r = checkRewrite(TEMPLATE, 'Oi {{primeiro_nome}}, faltam documentos.')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('{{documentos_pendentes}}')
  })
  it('rejeita variável inventada', () => {
    const r = checkRewrite(TEMPLATE, 'Oi {{primeiro_nome}} {{sobrenome}}, faltam {{documentos_pendentes}} — {{nome_escritorio}}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('{{sobrenome}}')
  })
  it('rejeita marcador malformado ou espaço reservado inventado', () => {
    expect(checkRewrite(TEMPLATE, 'Oi {primeiro_nome} {{primeiro_nome}} {{documentos_pendentes}} {{nome_escritorio}}').ok).toBe(false)
    expect(checkRewrite(TEMPLATE, 'Oi [Nome do cliente] {{primeiro_nome}} {{documentos_pendentes}} {{nome_escritorio}}').ok).toBe(false)
    expect(checkRewrite(TEMPLATE, 'Oi <data> {{primeiro_nome}} {{documentos_pendentes}} {{nome_escritorio}}').ok).toBe(false)
  })
  it('permite colchetes se já existiam no original', () => {
    const orig = 'Oi {{primeiro_nome}} [obs]'
    expect(checkRewrite(orig, 'Olá {{primeiro_nome}} [obs]').ok).toBe(true)
  })
  it('rejeita resposta vazia', () => {
    expect(checkRewrite(TEMPLATE, '   ').ok).toBe(false)
  })
})

describe('texto livre enviado ao provedor (1.4)', () => {
  it('redige CID e NB do modelo antes de montar a mensagem ao provedor', () => {
    const msg = buildComposeUserMessage('Olá {{primeiro_nome}}, laudo com CID M54.5 e NB 123.456.789-0', 'formal')
    expect(msg).toContain('{{primeiro_nome}}')
    expect(msg).not.toContain('M54.5')
    expect(msg).not.toContain('123.456.789-0')
    expect(msg).toContain('[CID-OCULTO]')
    expect(msg).toContain('[DOC-PREVIDENCIARIO]')
  })

  it('redige NIT e mantém datas e variáveis do modelo', () => {
    const msg = buildComposeUserMessage('Perícia {{data_pericia}} — NIT 123.45678.90-1', 'simples')
    expect(msg).toContain('{{data_pericia}}')
    expect(msg).not.toContain('123.45678.90-1')
    expect(msg).toContain('[DOC-PREVIDENCIARIO]')
  })
})

describe('cleanModelOutput / prompt', () => {
  it('remove aspas e delimitadores', () => {
    expect(cleanModelOutput('"Olá {{ primeiro_nome }}"')).toBe('Olá {{primeiro_nome}}')
    expect(cleanModelOutput('<<<\nOlá\n>>>')).toBe('Olá')
  })
  it('mensagem ao provedor contém apenas o modelo com variáveis e a instrução', () => {
    const msg = buildComposeUserMessage(TEMPLATE, 'formal')
    expect(msg).toContain(TEMPLATE)
    expect(msg).toContain('formal')
  })
})
