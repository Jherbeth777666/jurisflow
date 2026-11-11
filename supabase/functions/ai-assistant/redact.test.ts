// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { REDACTED, redactDeep, redactPII } from './redact.ts'

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

describe('redactPII — dados de saúde e previdenciários (1.4)', () => {
  const CID = '[CID-OCULTO]'
  const PREV = '[DOC-PREVIDENCIARIO]'

  it('redige CID, NB e NIT em texto realista de exigência do INSS/laudo, preservando a data', () => {
    const r = redactPII('Segurado com CID M54.5 e F32.2, NB 123.456.789-0, NIT 123.45678.90-1, perícia em 10/11/2026')
    expect(r.text).toBe(`Segurado com CID ${CID} e ${CID}, NB ${PREV}, NIT ${PREV}, perícia em 10/11/2026`)
    expect(r.removed.sort()).toEqual(['cid', 'nb', 'nit'])
  })

  it('redige CID-10 com ponto sempre e CID sem ponto apenas com prefixo CID', () => {
    const r = redactPII('CID M54; cid 10 G40; CID-10: F32; CID 6A70.0')
    expect(r.text).toBe(`CID ${CID}; cid 10 ${CID}; CID-10: ${CID}; CID ${CID}`)
    expect(r.removed).toEqual(['cid'])
  })

  it('redige NB formatado e NB de 10 dígitos quando há contexto de benefício', () => {
    expect(redactPII('NB 1234567890').text).toBe(`NB ${PREV}`)
    expect(redactPII('beneficio 1234567890').text).toBe(`beneficio ${PREV}`)
    expect(redactPII('benefício 1234567890').text).toBe(`benefício ${PREV}`)
    expect(redactPII('B. 12 1234567890').text).toBe(`B. 12 ${PREV}`)
    expect(redactPII('NB 123.456.789-0').text).toBe(`NB ${PREV}`)
    expect(redactPII('NB 1234567890').removed).toContain('nb')
  })

  it('redige NIT/PIS/PASEP no formato com máscara', () => {
    const r = redactPII('NIT 123.45678.90-1')
    expect(r.text).toBe(`NIT ${PREV}`)
    expect(r.removed).toContain('nit')
  })

  it('mantém 11 dígitos sem máscara caindo na regra de CPF (não vira nit)', () => {
    const r = redactPII('NIT 12345678901')
    expect(r.text).toBe(`NIT ${REDACTED}`)
    expect(r.removed).toContain('cpf')
    expect(r.removed).not.toContain('nit')
  })

  it('não marca 10 dígitos soltos como NB quando não há contexto previdenciário', () => {
    expect(redactPII('protocolo 1234567890').removed).not.toContain('nb')
    expect(redactPII('protocolo 1234567890').text).not.toContain(PREV)
  })

  it('não confunde CID sem ponto e sem prefixo com código de saúde', () => {
    expect(redactPII('código A12 solto').text).toBe('código A12 solto')
    expect(redactPII('código A12 solto').removed).toEqual([])
  })

  it('não mascara datas, valores, códigos internos, CNJ, horários nem valores soltos', () => {
    const t = 'Datas 10/11/2026 e 2026-11-10, valor R$ 1.234,56, códigos CLI_001 e DEM-123, CNJ 0001234-56.2026.8.10.0001, horário 14:30, A12'
    const r = redactPII(t)
    expect(r.text).toBe(t)
    expect(r.removed).toEqual([])
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
