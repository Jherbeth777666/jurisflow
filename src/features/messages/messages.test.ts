import { describe, expect, it } from 'vitest'
import { DEFAULT_TEMPLATES } from './defaultTemplates'
import {
  EXAMPLE_VALUES,
  extractVariables,
  fillTemplate,
  firstName,
  formatPendingList,
  isKnownVariable,
  splitByVariables,
  unknownVariables,
  validateRewrite,
} from './variables'
import { buildMailtoLink, buildWhatsAppLink, normalizeBrPhone } from './whatsapp'

describe('variáveis', () => {
  it('extrai na ordem, sem repetição, tolerando espaços', () => {
    expect(extractVariables('{{ etapa }} {{primeiro_nome}} {{etapa}}')).toEqual(['etapa', 'primeiro_nome'])
    expect(extractVariables('{nome} {{Nome}} {{}}')).toEqual([])
  })
  it('detecta variáveis desconhecidas', () => {
    expect(unknownVariables('{{primeiro_nome}} {{cpf}}')).toEqual(['cpf'])
    expect(isKnownVariable('valor_parcela')).toBe(true)
  })
  it('preenche e relata faltantes, mantendo-as visíveis', () => {
    const r = fillTemplate('Oi {{primeiro_nome}}, etapa {{ etapa }}, {{cpf}}', { primeiro_nome: 'Maria', etapa: '  ' })
    expect(r.text).toBe('Oi Maria, etapa {{etapa}}, {{cpf}}')
    expect(r.missing).toEqual(['etapa', 'cpf'])
  })
  it('não interpreta $ como padrão de substituição', () => {
    expect(fillTemplate('{{valor_parcela}}', { valor_parcela: 'R$ 1.000,00 $&' }).text).toBe('R$ 1.000,00 $&')
  })
  it('valida reescrita da IA', () => {
    const orig = 'Oi {{primeiro_nome}}, faltam {{documentos_pendentes}}'
    expect(validateRewrite(orig, 'Olá, {{ primeiro_nome }}! Pendências: {{documentos_pendentes}}')).toEqual({
      ok: true,
      text: 'Olá, {{primeiro_nome}}! Pendências: {{documentos_pendentes}}',
    })
    expect(validateRewrite(orig, 'Olá {{primeiro_nome}}').ok).toBe(false)
    expect(validateRewrite(orig, 'Olá {{primeiro_nome}} {{documentos_pendentes}} {{prazo}}').ok).toBe(false)
    expect(validateRewrite(orig, '  ').ok).toBe(false)
  })
  it('primeiro nome capitalizado', () => {
    expect(firstName('MARIA DA SILVA')).toBe('Maria')
    expect(firstName('  ana paula ')).toBe('Ana')
    expect(firstName('élio')).toBe('Élio')
    expect(firstName(null)).toBe('')
  })
  it('lista de pendências', () => {
    expect(formatPendingList(['A', ' ', 'B '])).toBe('• A\n• B')
    expect(formatPendingList([])).toBeNull()
  })
  it('divide texto para destaque', () => {
    expect(splitByVariables('Oi {{primeiro_nome}}!')).toEqual([
      { text: 'Oi ', variable: false },
      { text: 'primeiro_nome', variable: true },
      { text: '!', variable: false },
    ])
  })
  it('modelos padrão usam apenas variáveis conhecidas e não prometem resultado', () => {
    expect(DEFAULT_TEMPLATES).toHaveLength(7)
    for (const t of DEFAULT_TEMPLATES) {
      expect(unknownVariables(t.body)).toEqual([])
      expect(unknownVariables(t.subject ?? '')).toEqual([])
      expect(t.body.length).toBeLessThanOrEqual(2000)
      expect(t.body).not.toMatch(/garant|com certeza (será|vai)|será aprovad/i)
      expect(fillTemplate(t.body, EXAMPLE_VALUES).missing).toEqual([])
    }
  })
})

describe('telefone e links', () => {
  it('normaliza celulares em vários formatos', () => {
    for (const raw of ['11987654321', '(11) 98765-4321', '+55 11 98765-4321', '5511987654321', '011987654321']) {
      const r = normalizeBrPhone(raw)
      expect(r).toMatchObject({ ok: true, international: '5511987654321', kind: 'celular' })
    }
  })
  it('identifica fixo e celular antigo de 8 dígitos', () => {
    expect(normalizeBrPhone('1133334444')).toMatchObject({ ok: true, kind: 'fixo' })
    expect(normalizeBrPhone('8188887777')).toMatchObject({ ok: true, kind: 'celular', international: '558188887777' })
  })
  it('rejeita inválidos', () => {
    expect(normalizeBrPhone('').ok).toBe(false)
    expect(normalizeBrPhone(null).ok).toBe(false)
    expect(normalizeBrPhone('123').ok).toBe(false)
    expect(normalizeBrPhone('20987654321').ok).toBe(false) // DDD 20 não existe
    expect(normalizeBrPhone('11887654321').ok).toBe(false) // 11 dígitos sem 9
    expect(normalizeBrPhone('1103334444').ok).toBe(false)
  })
  it('monta link do WhatsApp com texto codificado', () => {
    expect(buildWhatsAppLink('11987654321', 'Olá, Maria!\nTudo bem? & 100%')).toBe(
      'https://wa.me/5511987654321?text=Ol%C3%A1%2C%20Maria!%0ATudo%20bem%3F%20%26%20100%25',
    )
    expect(buildWhatsAppLink('11987654321', '  ')).toBe('https://wa.me/5511987654321')
    expect(buildWhatsAppLink('999', 'x')).toBeNull()
  })
  it('monta mailto com CRLF e rejeita e-mail inválido', () => {
    expect(buildMailtoLink('maria@exemplo.com', 'Assunto & teste', 'Linha 1\nLinha 2')).toBe(
      'mailto:maria@exemplo.com?subject=Assunto%20%26%20teste&body=Linha%201%0D%0ALinha%202',
    )
    expect(buildMailtoLink('maria@exemplo.com?cc=x@y.z', 'a', 'b')).toBeNull()
    expect(buildMailtoLink(null, 'a', 'b')).toBeNull()
  })
})
