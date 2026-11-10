// Provedor compatível com a API OpenAI Chat Completions (tools/tool_calls).
// Atende OpenAI, Gemini (endpoint /v1beta/openai), DeepSeek, Groq e outros
// compatíveis — ver registry.ts. Usa fetch padrão — sem SDK.
import { ProviderError, type ChatMessage, type CompletionRequest, type CompletionResponse, type FetchLike, type LLMProvider } from '../types.ts'
import { combineSignals } from './signal.ts'

type OAIMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

interface OAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OpenAICompatibleOptions {
  /** Nome lógico (openai, gemini, deepseek…) — usado em logs/erros */
  name?: string
  apiKey: string
  model: string
  baseUrl: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

export function toOpenAIMessages(system: string, messages: ChatMessage[]): OAIMessage[] {
  const out: OAIMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content })
    else if (m.role === 'assistant') {
      const calls = (m.toolCalls ?? []).map<OAIToolCall>((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {}) },
      }))
      out.push(calls.length ? { role: 'assistant', content: m.content || null, tool_calls: calls } : { role: 'assistant', content: m.content })
    } else {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    }
  }
  return out
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string
  readonly model: string
  private opts: OpenAICompatibleOptions

  constructor(opts: OpenAICompatibleOptions) {
    this.opts = opts
    this.name = opts.name ?? 'openai'
    this.model = opts.model
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const f = this.opts.fetchImpl ?? fetch
    const body = {
      model: this.model,
      max_tokens: req.maxTokens ?? 1500,
      messages: toOpenAIMessages(req.system, req.messages),
      tools: req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
      tool_choice: req.toolChoice,
    }
    let res: Response
    try {
      res = await f(`${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal: combineSignals(AbortSignal.timeout(this.opts.timeoutMs ?? 60_000), req.signal),
      })
    } catch (e) {
      throw new ProviderError(this.name, `Falha de rede/timeout: ${e instanceof Error ? e.name : 'erro'}`, null)
    }
    if (!res.ok) {
      await res.text().catch(() => '')
      throw new ProviderError(this.name, `HTTP ${res.status}`, res.status)
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<Partial<OAIToolCall>> } }>
    }
    const msg = json.choices?.[0]?.message
    const toolCalls: CompletionResponse['toolCalls'] = []
    for (const [i, c] of (msg?.tool_calls ?? []).entries()) {
      if (!c?.function?.name) continue
      let args: unknown = {}
      try {
        args = c.function.arguments ? JSON.parse(c.function.arguments) : {}
      } catch {
        args = c.function.arguments // inválido → tools.ts rejeita com mensagem ao modelo
      }
      // Alguns compatíveis (ex.: Gemini) podem omitir o id; geramos um estável.
      toolCalls.push({ id: c.id || `call_${i}`, name: c.function.name, args })
    }
    return { text: (msg?.content ?? '').trim(), toolCalls }
  }
}
