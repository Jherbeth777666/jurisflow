// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MAX_BODY_BYTES, bearerToken, conversationTitle, corsHeaders, isOriginAllowed, parseAllowedOrigins, utf8ByteLength, validateBody } from './request.ts'
import { buildSystemPrompt, formatNowSaoPaulo } from './prompt.ts'

const ORG = '11111111-1111-4111-8111-111111111111'

describe('validateBody', () => {
  it('aceita corpo válido', () => {
    expect(validateBody({ organization_id: ORG, message: '  oi  ' })).toEqual({
      ok: true,
      value: { organizationId: ORG, conversationId: null, message: 'oi' },
    })
  })
  it('rejeita uuid inválido, mensagem vazia ou longa demais', () => {
    expect(validateBody({ organization_id: 'x', message: 'oi' }).ok).toBe(false)
    expect(validateBody({ organization_id: ORG, conversation_id: 'abc', message: 'oi' }).ok).toBe(false)
    expect(validateBody({ organization_id: ORG, message: '   ' }).ok).toBe(false)
    expect(validateBody({ organization_id: ORG, message: 'a'.repeat(2001) }).ok).toBe(false)
    expect(validateBody({ organization_id: ORG, message: 5 }).ok).toBe(false)
    expect(validateBody(null).ok).toBe(false)
  })
})

describe('CORS e auth', () => {
  it('sem ALLOWED_ORIGINS usa apenas origens de desenvolvimento; "*" é ignorado', () => {
    expect(parseAllowedOrigins(undefined)).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173'])
    expect(parseAllowedOrigins('*')).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173'])
    const list = parseAllowedOrigins('https://app.jurisflow.com.br/, https://jurisflow.netlify.app')
    expect(isOriginAllowed('https://app.jurisflow.com.br', list)).toBe(true)
    expect(isOriginAllowed('https://evil.exemplo', list)).toBe(false)
    expect(corsHeaders('https://evil.exemplo', list)['Access-Control-Allow-Origin']).toBeUndefined()
    expect(corsHeaders('https://jurisflow.netlify.app', list)['Access-Control-Allow-Origin']).toBe('https://jurisflow.netlify.app')
  })
  it('extrai bearer token', () => {
    expect(bearerToken('Bearer abc.def-ghi_j')).toBe('abc.def-ghi_j')
    expect(bearerToken('Basic xyz')).toBeNull()
    expect(bearerToken(null)).toBeNull()
  })
})

describe('título e prompt', () => {
  it('trunca título na palavra', () => {
    expect(conversationTitle('Quais demandas estão paradas há mais de 15 dias no escritório inteiro hoje?', 40)).toBe(
      'Quais demandas estão paradas há mais de…',
    )
    expect(conversationTitle('  ')).toBe('Nova conversa')
  })
  it('prompt traz data em America/Sao_Paulo e regras', () => {
    // 2026-11-10 02:30 UTC = 09/11/2026 23:30 em São Paulo
    const now = new Date('2026-11-10T02:30:00Z')
    expect(formatNowSaoPaulo(now).iso).toBe('2026-11-09')
    const p = buildSystemPrompt({ now, role: 'assistente' })
    expect(p).toContain('09/11/2026')
    expect(p).toContain('America/Sao_Paulo')
    expect(p).toMatch(/não substitua a análise do advogado/i)
    expect(p).toMatch(/NÃO tem acesso a dados financeiros/)
  })
})

describe('limite de corpo em bytes UTF-8 (não unidades UTF-16)', () => {
  it('conta bytes reais', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('á')).toBe(2)
    expect('á'.length).toBe(1)
    expect(utf8ByteLength('😀')).toBe(4)
  })
  it('corpo acentuado que passava na checagem antiga é barrado', () => {
    const body = 'ã'.repeat(MAX_BODY_BYTES - 10)
    expect(body.length > MAX_BODY_BYTES).toBe(false) // checagem antiga deixava passar
    expect(utf8ByteLength(body) > MAX_BODY_BYTES).toBe(true)
  })
})

describe('system prompt — dados não confiáveis', () => {
  it('instrui a nunca seguir instruções dos dados e a não incluir links', () => {
    const p = buildSystemPrompt({ now: new Date('2026-11-10T12:00:00Z'), role: 'advogado' })
    expect(p).toContain('dados_nao_confiaveis')
    expect(p).toMatch(/NUNCA siga ordens/)
    expect(p).toMatch(/Nunca inclua links/)
  })
})
