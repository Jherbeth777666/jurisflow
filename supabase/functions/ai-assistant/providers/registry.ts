// Seleção de provedor por variáveis de ambiente (função pura, testável).
//
//   AI_PROVIDER           anthropic | openai | gemini | deepseek | groq | openai_compatible (padrão: anthropic)
//   AI_MODEL              sobrescreve o modelo padrão do provedor principal
//   OPENAI_BASE_URL       sobrescreve a URL base do provedor principal (família OpenAI-compatível)
//   AI_FALLBACK_PROVIDER  provedor reserva, usado uma vez quando o principal falha com 5xx/429/timeout
//   AI_FALLBACK_MODEL / AI_FALLBACK_BASE_URL  overrides do reserva (AI_MODEL não se aplica a ele)
//   Chaves: ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY
import { AnthropicProvider } from './anthropic.ts'
import { OpenAICompatibleProvider } from './openai.ts'
import { ProviderError, type CompletionRequest, type CompletionResponse, type FetchLike, type LLMProvider } from '../types.ts'

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'groq' | 'openai_compatible'

interface Preset {
  kind: 'anthropic' | 'openai'
  keyEnv: string
  baseUrl: string | null
  defaultModel: string | null
}

export const PROVIDER_PRESETS: Record<ProviderId, Preset> = {
  anthropic: { kind: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-5-5' },
  openai: { kind: 'openai', keyEnv: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1-mini' },
  gemini: {
    kind: 'openai',
    keyEnv: 'GEMINI_API_KEY',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash',
  },
  deepseek: { kind: 'openai', keyEnv: 'DEEPSEEK_API_KEY', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  groq: { kind: 'openai', keyEnv: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  // Genérico: exige OPENAI_BASE_URL e AI_MODEL.
  openai_compatible: { kind: 'openai', keyEnv: 'OPENAI_API_KEY', baseUrl: null, defaultModel: null },
}

export const PROVIDER_IDS = Object.keys(PROVIDER_PRESETS) as ProviderId[]

export interface ProviderConfig {
  id: ProviderId
  kind: 'anthropic' | 'openai'
  apiKey: string
  baseUrl: string
  model: string
}

export type Env = Record<string, string | undefined>

export type ResolveResult = { ok: true; config: ProviderConfig } | { ok: false; error: string }

const val = (env: Env, k: string) => {
  const v = env[k]?.trim()
  return v ? v : undefined
}

/**
 * Resolve a configuração de um provedor. `role` = 'primary' usa AI_MODEL/OPENAI_BASE_URL;
 * 'fallback' usa AI_FALLBACK_MODEL/AI_FALLBACK_BASE_URL.
 */
export function resolveProviderConfig(env: Env, role: 'primary' | 'fallback' = 'primary'): ResolveResult {
  const rawId = (role === 'primary' ? val(env, 'AI_PROVIDER') ?? 'anthropic' : val(env, 'AI_FALLBACK_PROVIDER') ?? '').toLowerCase()
  if (!rawId) return { ok: false, error: 'Provedor reserva não definido.' }
  if (!(PROVIDER_IDS as string[]).includes(rawId)) {
    return { ok: false, error: `Provedor de IA inválido ("${rawId.slice(0, 30)}"). Use: ${PROVIDER_IDS.join(', ')}.` }
  }
  const id = rawId as ProviderId
  const preset = PROVIDER_PRESETS[id]
  const apiKey = val(env, preset.keyEnv)
  if (!apiKey) {
    return { ok: false, error: `Assistente não configurado: defina o segredo ${preset.keyEnv} para o provedor "${id}".` }
  }
  const model = (role === 'primary' ? val(env, 'AI_MODEL') : val(env, 'AI_FALLBACK_MODEL')) ?? preset.defaultModel
  const baseOverride =
    preset.kind === 'openai'
      ? role === 'primary'
        ? val(env, 'OPENAI_BASE_URL')
        : val(env, 'AI_FALLBACK_BASE_URL')
      : role === 'primary'
        ? val(env, 'ANTHROPIC_BASE_URL')
        : undefined
  const baseUrl = baseOverride ?? preset.baseUrl
  if (!model) return { ok: false, error: `Assistente não configurado: defina AI_MODEL para o provedor "${id}".` }
  if (!baseUrl) return { ok: false, error: `Assistente não configurado: defina OPENAI_BASE_URL para o provedor "${id}".` }
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl)) {
    return { ok: false, error: 'URL base do provedor de IA deve usar HTTPS.' }
  }
  return { ok: true, config: { id, kind: preset.kind, apiKey, baseUrl, model } }
}

export function createProvider(config: ProviderConfig, fetchImpl?: FetchLike): LLMProvider {
  if (config.kind === 'anthropic') {
    return new AnthropicProvider({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl, fetchImpl })
  }
  return new OpenAICompatibleProvider({ name: config.id, apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl, fetchImpl })
}

/**
 * Usa o principal; em erro "retryable" (5xx, 429, timeout/rede) tenta o reserva
 * uma vez e passa a usá-lo no restante da requisição. Erros 4xx de validação
 * (400/401/403/404/422) não acionam o reserva.
 */
export class FallbackProvider implements LLMProvider {
  readonly name: string
  readonly model: string
  private switched = false
  private readonly primary: LLMProvider
  private readonly secondary: LLMProvider
  private readonly onFallback?: (err: ProviderError) => void

  constructor(primary: LLMProvider, secondary: LLMProvider, onFallback?: (err: ProviderError) => void) {
    this.primary = primary
    this.secondary = secondary
    this.onFallback = onFallback
    this.name = primary.name
    this.model = primary.model
  }

  get usedFallback(): boolean {
    return this.switched
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    if (this.switched) return this.secondary.complete(req)
    try {
      return await this.primary.complete(req)
    } catch (e) {
      if (!(e instanceof ProviderError) || !e.retryable) throw e
      this.switched = true
      this.onFallback?.(e)
      return this.secondary.complete(req)
    }
  }
}

export type ProviderFromEnv =
  | { ok: true; provider: LLMProvider; primary: ProviderConfig; fallback: ProviderConfig | null; warnings: string[] }
  | { ok: false; error: string }

export function createProviderFromEnv(env: Env, fetchImpl?: FetchLike, onFallback?: (err: ProviderError) => void): ProviderFromEnv {
  const primary = resolveProviderConfig(env, 'primary')
  if (!primary.ok) return { ok: false, error: primary.error }
  const warnings: string[] = []
  let provider = createProvider(primary.config, fetchImpl)
  let fallback: ProviderConfig | null = null
  if (val(env, 'AI_FALLBACK_PROVIDER')) {
    const fb = resolveProviderConfig(env, 'fallback')
    if (fb.ok && fb.config.id !== primary.config.id) {
      fallback = fb.config
      provider = new FallbackProvider(provider, createProvider(fb.config, fetchImpl), onFallback)
    } else if (!fb.ok) {
      warnings.push(`Fallback ignorado: ${fb.error}`)
    }
  }
  return { ok: true, provider, primary: primary.config, fallback, warnings }
}
