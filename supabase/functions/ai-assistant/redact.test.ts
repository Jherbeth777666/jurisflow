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
