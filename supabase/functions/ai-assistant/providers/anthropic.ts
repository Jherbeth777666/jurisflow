// Provedor Anthropic (Messages API com tool use). Usa fetch padrão — sem SDK.
import { ProviderError, type ChatMessage, type CompletionRequest, type CompletionResponse, type FetchLike, type LLMProvider } from '../types.ts'

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | Block[]
}

export interface AnthropicOptions {
  apiKey: string
  model: string
  baseUrl?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

/** Converte o histórico neutro para o formato da Messages API. */
export function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: m.content }] })
    } else if (m.role === 'assistant') {
      const blocks: Block[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const c of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args && typeof c.args === 'object' ? c.args : {} })
      }
      if (blocks.length) out.push({ role: 'assistant', content: blocks })
    } else {
      out.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content, ...(m.isError ? { is_error: true } : {}) }],
      })
    }
  }
  // Mensagens consecutivas do mesmo papel são unidas (exigência da API).
  const merged: AnthropicMessage[] = []
  for (const m of out) {
    const last = merged[merged.length - 1]
    if (last && last.role === m.role) {
      last.content = [...(last.content as Block[]), ...(m.content as Block[])]
    } else {
      merged.push({ ...m, content: [...(m.content as Block[])] })
    }
  }
  return merged
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic'
  readonly model: string
  private opts: AnthropicOptions

  constructor(opts: AnthropicOptions) {
    this.opts = opts
    this.model = opts.model
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const f = this.opts.fetchImpl ?? fetch
    const body = {
      model: this.model,
      max_tokens: req.maxTokens ?? 1500,
      system: req.system,
      messages: toAnthropicMessages(req.messages),
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      tool_choice: { type: req.toolChoice },
    }
    let res: Response
    try {
      res = await f(`${(this.opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '')}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 60_000),
      })
    } catch (e) {
      throw new ProviderError(this.name, `Falha de rede/timeout: ${e instanceof Error ? e.name : 'erro'}`, null)
    }
    if (!res.ok) {
      // O corpo de erro do provedor não é repassado ao usuário (pode conter detalhes internos).
      await res.text().catch(() => '')
      throw new ProviderError(this.name, `HTTP ${res.status}`, res.status)
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> }
    const text: string[] = []
    const toolCalls: CompletionResponse['toolCalls'] = []
    for (const b of json.content ?? []) {
      if (b.type === 'text' && b.text) text.push(b.text)
      if (b.type === 'tool_use' && b.name) toolCalls.push({ id: b.id ?? `call_${toolCalls.length}`, name: b.name, args: b.input ?? {} })
    }
    return { text: text.join('\n').trim(), toolCalls }
  }
}
