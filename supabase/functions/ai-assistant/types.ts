// Tipos neutros (independentes de provedor) usados pelo laço do assistente.
// Módulo puro: sem APIs do Deno, testável no Node/vitest.

export interface ToolCall {
  id: string
  name: string
  /** Argumentos como o modelo enviou — NÃO confiáveis até passarem por tools.ts */
  args: unknown
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean }

/** Definição de ferramenta exposta ao modelo (JSON Schema dos argumentos). */
export interface ToolSpec {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
}

export interface CompletionRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  /** 'none' força resposta em texto (usado após o limite de rodadas) */
  toolChoice: 'auto' | 'none'
  maxTokens?: number
}

export interface CompletionResponse {
  text: string
  toolCalls: ToolCall[]
}

export interface LLMProvider {
  readonly name: string
  readonly model: string
  complete(req: CompletionRequest): Promise<CompletionResponse>
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Erro do provedor de IA. `retryable` = 5xx, 429, timeout ou falha de rede. */
export class ProviderError extends Error {
  readonly status: number | null
  readonly retryable: boolean
  readonly provider: string
  constructor(provider: string, message: string, status: number | null, retryable?: boolean) {
    super(message)
    this.name = 'ProviderError'
    this.provider = provider
    this.status = status
    this.retryable = retryable ?? (status === null || status === 429 || status >= 500)
  }
}

/** Executa uma RPC do Supabase (com o JWT do usuário). */
export type RpcExecutor = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
