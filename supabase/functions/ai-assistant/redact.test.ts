// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LINK_REMOVED, REDACTED, redactDeep, redactPII, stripUrls } from './redact.ts'

describe('redactPII', () => {
  it('remove CPF com e sem máscara', () => {
    const r = redactPII('CPF 529.982.247-25 e 52998224725 ok')
    expect(r.text).toBe(`CPF ${REDACTED} e ${REDACTED} ok`)
    expect(r.removed).toEqual(['cpf'])
  })

  it('remove telefones em formatos comuns', () => {
    for (const phone of ['(11) 98765-4321', '11 98765-4321', '+55 11 98765-4321', '1198765432', '(21) 3456-7890']) {
      const r = redactPII(`ligar para ${phone} amanhã`)
      expect(r.text, phone).toBe(`ligar para ${REDACTED} amanhã`)
      expect(r.removed).toContain('telefone')
    }
  })

  it('remove e-mails e CNPJ', () => {
    const r = redactPII('mande para maria.souza+x@exemplo.com.br, CNPJ 12.345.678/0001-95')
    expect(r.text).toBe(`mande para ${REDACTED}, CNPJ ${REDACTED}`)
    expect(r.removed.sort()).toEqual(['cnpj', 'email'])
  })

  it('não altera datas, valores, anos e números curtos', () => {
    const t = 'Entre 01/11/2026 e 2026-11-30, R$ 1.234,56, 15 dias, processo 2024, 3 tarefas'
    const r = redactPII(t)
    expect(r.text).toBe(t)
    expect(r.removed).toEqual([])
  })

  it('não remove trechos de números maiores (ex.: 12+ dígitos)', () => {
    const t = 'protocolo 123456789012345'
    expect(redactPII(t).text).toBe(t)
  })
})

describe('redactDeep', () => {
  it('aplica em textos livres e preserva ids/datas', () => {
    const v = redactDeep({
      id: 'a1234567-8901-4000-8000-000000000001',
      due_date: '2026-11-09',
      title: 'Ligar 11987654321',
      items: [{ demand: 'CPF 52998224725' }],
      total: 3,
    })
    expect(v).toEqual({
      id: 'a1234567-8901-4000-8000-000000000001',
      due_date: '2026-11-09',
      title: `Ligar ${REDACTED}`,
      items: [{ demand: `CPF ${REDACTED}` }],
      total: 3,
    })
  })
})

describe('redactPII — formatos adicionais', () => {
  it('telefone com espaços e sem espaço após o DDD', () => {
    for (const phone of ['11 9 8765 4321', '(11)98765-4321', '( 11 ) 98765 4321', '0800 777 1234']) {
      expect(redactPII(`ligar ${phone} hoje`).text, phone).toBe(`ligar ${REDACTED} hoje`)
    }
  })
  it('RG e NB do INSS', () => {
    expect(redactPII('RG 12.345.678-9').text).toBe(`RG ${REDACTED}`)
    expect(redactPII('rg: 1.234.567-X').text).toBe(`rg: ${REDACTED}`)
    expect(redactPII('NB 123.456.789-0 ativo').text).toBe(`NB ${REDACTED} ativo`)
    expect(redactPII('NB 1234567890').text).toBe(REDACTED)
    expect(redactPII('benefício nº 1234567890').text).toBe(REDACTED)
    const r = redactPII('RG 12.345.678-9 e NB 123.456.789-0')
    expect(r.removed.sort()).toEqual(['nb', 'rg'])
  })
  it('e-mail ofuscado', () => {
    for (const e of ['fulano (arroba) gmail.com', 'joana(arroba)gmail.com', 'fulano at gmail.com', 'fulano [at] gmail (ponto) com', 'fulano arroba gmail ponto com ponto br']) {
      const r = redactPII(`escreva para ${e}`)
      expect(r.text, e).toBe(`escreva para ${REDACTED}`)
      expect(r.removed).toEqual(['email'])
    }
  })
  it('sem falsos positivos em valores monetários, datas e textos comuns', () => {
    const t = 'R$ 12.345.678,90 em 01/11/2026, 2026-11-30, 10/11/2026 às 14:30, prazo 15 dias, processo 2024, Lei 8.213/91, olhou at home'
    expect(redactPII(t).text).toBe(t)
    expect(redactPII('R$ 1.234.567').text).toBe('R$ 1.234.567')
  })
})

describe('stripUrls / redactDeep sem links', () => {
  it('remove URLs, www e domínios nus; preserva texto comum', () => {
    expect(stripUrls('acesse https://evil.example/login?x=1 agora')).toBe(`acesse ${LINK_REMOVED} agora`)
    expect(stripUrls('veja www.site.com.br/a e bit.ly/abc ou evil.com')).toBe(`veja ${LINK_REMOVED} e ${LINK_REMOVED} ou ${LINK_REMOVED}`)
    expect(stripUrls('Salário-maternidade. Aguardando documentos.')).toBe('Salário-maternidade. Aguardando documentos.')
  })
  it('redactDeep remove links de textos livres', () => {
    expect(redactDeep({ title: 'Clique em http://x.io', due_date: '2026-11-09' })).toEqual({ title: `Clique em ${LINK_REMOVED}`, due_date: '2026-11-09' })
  })
})
