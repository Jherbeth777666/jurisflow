// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { FallbackProvider, createProviderFromEnv, resolveProviderConfig } from './registry.ts'
import { ProviderError, type CompletionRequest, type FetchLike, type LLMProvider } from '../types.ts'

const REQ: CompletionRequest = { system: 's', messages: [{ role: 'user', content: 'oi' }], tools: [], toolChoice: 'auto' }

describe('resolveProviderConfig', () => {
  it('padrão é Anthropic com claude-sonnet-5-5', () => {
    const r = resolveProviderConfig({ ANTHROPIC_API_KEY: 'a' })
    expect(r).toEqual({
      ok: true,
      config: { id: 'anthropic', kind: 'anthropic', apiKey: 'a', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5-5' },
    })
  })

  it.each([
    ['gemini', 'GEMINI_API_KEY', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-flash'],
    ['deepseek', 'DEEPSEEK_API_KEY', 'https://api.deepseek.com/v1', 'deepseek-chat'],
    ['groq', 'GROQ_API_KEY', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile'],
    ['openai', 'OPENAI_API_KEY', 'https://api.openai.com/v1', 'gpt-4.1-mini'],
  ])('preset %s', (id, keyEnv, baseUrl, model) => {
    const r = resolveProviderConfig({ AI_PROVIDER: id, [keyEnv]: 'k' })
    expect(r).toEqual({ ok: true, config: { id, kind: 'openai', apiKey: 'k', baseUrl, model } })
  })

  it('AI_MODEL e OPENAI_BASE_URL sobrescrevem o preset', () => {
    const r = resolveProviderConfig({ AI_PROVIDER: 'GEMINI', GEMINI_API_KEY: 'k', AI_MODEL: 'gemini-2.5-pro', OPENAI_BASE_URL: 'https://proxy.exemplo/v1' })
    expect(r.ok && r.config).toMatchObject({ id: 'gemini', model: 'gemini-2.5-pro', baseUrl: 'https://proxy.exemplo/v1' })
  })

  it('erro claro quando a chave do provedor escolhido falta', () => {
    const r = resolveProviderConfig({ AI_PROVIDER: 'deepseek', GEMINI_API_KEY: 'k' })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/DEEPSEEK_API_KEY/)
  })

  it('openai_compatible exige base e modelo; rejeita provedor desconhecido e http remoto', () => {
    expect(resolveProviderConfig({ AI_PROVIDER: 'openai_compatible', OPENAI_API_KEY: 'k' })).toMatchObject({ ok: false })
    expect(
      resolveProviderConfig({ AI_PROVIDER: 'openai_compatible', OPENAI_API_KEY: 'k', AI_MODEL: 'm', OPENAI_BASE_URL: 'http://localhost:11434/v1' }),
    ).toMatchObject({ ok: true })
    expect(
      resolveProviderConfig({ AI_PROVIDER: 'openai_compatible', OPENAI_API_KEY: 'k', AI_MODEL: 'm', OPENAI_BASE_URL: 'http://evil.exemplo/v1' }),
    ).toMatchObject({ ok: false })
    expect(resolveProviderConfig({ AI_PROVIDER: 'xyz' })).toMatchObject({ ok: false })
  })

  it('fallback usa AI_FALLBACK_MODEL e não herda AI_MODEL', () => {
    const env = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', AI_MODEL: 'gemini-2.5-pro', AI_FALLBACK_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd' }
    expect(resolveProviderConfig(env, 'fallback')).toMatchObject({ ok: true, config: { id: 'deepseek', model: 'deepseek-chat' } })
  })
})

describe('createProviderFromEnv', () => {
  it('sem chave → erro (503 na função)', () => {
    expect(createProviderFromEnv({})).toMatchObject({ ok: false })
  })

  it('fallback com chave ausente é ignorado com aviso', () => {
    const r = createProviderFromEnv({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', AI_FALLBACK_PROVIDER: 'deepseek' })
    expect(r.ok && r.fallback).toBeNull()
    expect(r.ok && r.warnings[0]).toMatch(/DEEPSEEK_API_KEY/)
  })

  function statusFetch(statusByHost: Record<string, number>) {
    const hits: string[] = []
    const impl: FetchLike = async (url) => {
      const host = new URL(url).host
      hits.push(host)
      const status = statusByHost[host] ?? 200
      const body = status === 200 ? { choices: [{ message: { content: `ok de ${host}` } }] } : { error: 'x' }
      return new Response(JSON.stringify(body), { status })
    }
    return { impl, hits }
  }
  const ENV = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', AI_FALLBACK_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd' }

  it('fallback acionado em 5xx (uma vez) e mantido no resto da requisição', async () => {
    const f = statusFetch({ 'generativelanguage.googleapis.com': 503 })
    const onFallback = vi.fn()
    const r = createProviderFromEnv(ENV, f.impl, onFallback)
    if (!r.ok) throw new Error('config')
    expect((await r.provider.complete(REQ)).text).toBe('ok de api.deepseek.com')
    expect((await r.provider.complete(REQ)).text).toBe('ok de api.deepseek.com')
    expect(f.hits).toEqual(['generativelanguage.googleapis.com', 'api.deepseek.com', 'api.deepseek.com'])
    expect(onFallback).toHaveBeenCalledTimes(1)
  })

  it('fallback acionado em 429', async () => {
    const f = statusFetch({ 'generativelanguage.googleapis.com': 429 })
    const r = createProviderFromEnv(ENV, f.impl)
    if (!r.ok) throw new Error('config')
    expect((await r.provider.complete(REQ)).text).toBe('ok de api.deepseek.com')
  })

  it('fallback NÃO acionado em 4xx de validação', async () => {
    for (const status of [400, 401, 403, 422]) {
      const f = statusFetch({ 'generativelanguage.googleapis.com': status })
      const r = createProviderFromEnv(ENV, f.impl)
      if (!r.ok) throw new Error('config')
      await expect(r.provider.complete(REQ)).rejects.toMatchObject({ status, retryable: false })
      expect(f.hits).toEqual(['generativelanguage.googleapis.com'])
    }
  })

  it('fallback acionado em timeout/erro de rede; erro do reserva é propagado', async () => {
    const primary: LLMProvider = {
      name: 'p',
      model: 'm',
      complete: () => Promise.reject(new ProviderError('p', 'timeout', null)),
    }
    const secondary: LLMProvider = {
      name: 's',
      model: 'm',
      complete: () => Promise.reject(new ProviderError('s', 'HTTP 500', 500)),
    }
    const fb = new FallbackProvider(primary, secondary)
    await expect(fb.complete(REQ)).rejects.toMatchObject({ provider: 's' })
    expect(fb.usedFallback).toBe(true)
  })
})
