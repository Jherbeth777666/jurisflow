// Laço de tool use, independente de provedor. Módulo puro.
//
// Garantias:
//  * O provedor só recebe texto pseudonimizado (histórico, pergunta e resultados).
//  * Só ferramentas da whitelist são executadas; p_org vem da requisição.
//  * No máximo `maxRounds` rodadas de ferramentas; depois força resposta em texto.
import { Pseudonymizer } from './pseudonymize.ts'
import { redactDeep } from './redact.ts'
import { TOOL_SPECS, executeTool } from './tools.ts'
import type { ChatMessage, LLMProvider, RpcExecutor } from './types.ts'

export const MAX_TOOL_ROUNDS = 4
export const MAX_CALLS_PER_ROUND = 5
const MAX_TOOL_RESULT_CHARS = 16_000
export const MAX_ANSWER_CHARS = 19_000

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface RunAssistantInput {
  provider: LLMProvider
  system: string
  history: HistoryMessage[]
  /** Pergunta do usuário já com CPF/telefone/e-mail removidos (redact.ts) */
  userMessage: string
  orgId: string
  rpc: RpcExecutor
  pseudonymizer: Pseudonymizer
  maxRounds?: number
}

export interface RunAssistantResult {
  text: string
  toolsUsed: string[]
  rounds: number
}

/** Remove mensagens iniciais do assistente e une mensagens consecutivas do mesmo papel. */
export function normalizeHistory(history: HistoryMessage[]): HistoryMessage[] {
  const out: HistoryMessage[] = []
  for (const m of history) {
    if (!m.content?.trim()) continue
    if (!out.length && m.role !== 'user') continue
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += `\n\n${m.content}`
    else out.push({ role: m.role, content: m.content })
  }
  return out
}

function serializeToolResult(data: unknown, p: Pseudonymizer): string {
  const safe = p.pseudonymizeValue(redactDeep(data))
  const json = JSON.stringify(safe ?? null)
  return json.length > MAX_TOOL_RESULT_CHARS ? `${json.slice(0, MAX_TOOL_RESULT_CHARS)}…[resultado truncado]` : json
}

export async function runAssistant(input: RunAssistantInput): Promise<RunAssistantResult> {
  const { provider, system, orgId, rpc, pseudonymizer: p } = input
  const maxRounds = input.maxRounds ?? MAX_TOOL_ROUNDS

  const messages: ChatMessage[] = normalizeHistory([...input.history, { role: 'user', content: input.userMessage }]).map(
    (m) => ({ role: m.role, content: p.pseudonymizeText(m.content) }),
  )
  // A última mensagem precisa ser do usuário (o histórico pode terminar com outra pergunta sem resposta).
  if (messages[messages.length - 1]?.role !== 'user') {
    messages.push({ role: 'user', content: p.pseudonymizeText(input.userMessage) })
  }

  const toolsUsed = new Set<string>()
  let finalText = ''
  let rounds = 0

  for (let round = 0; ; round++) {
    const toolChoice = round < maxRounds ? 'auto' : 'none'
    const resp = await provider.complete({ system, messages, tools: TOOL_SPECS, toolChoice })

    if (toolChoice === 'none' || resp.toolCalls.length === 0) {
      finalText = resp.text
      break
    }

    rounds += 1
    messages.push({ role: 'assistant', content: resp.text, toolCalls: resp.toolCalls })

    for (const [i, call] of resp.toolCalls.entries()) {
      if (i >= MAX_CALLS_PER_ROUND) {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          isError: true,
          content: JSON.stringify({ error: 'Limite de chamadas por rodada atingido.' }),
        })
        continue
      }
      const outcome = await executeTool(call.name, call.args, orgId, rpc)
      if (outcome.ok) {
        toolsUsed.add(outcome.name)
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: serializeToolResult(outcome.data, p) })
      } else {
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          isError: true,
          content: JSON.stringify({ error: outcome.error }),
        })
      }
    }
  }

  let text = p.restore(finalText.trim())
  if (!text) text = 'Não consegui gerar uma resposta agora. Tente reformular a pergunta.'
  if (text.length > MAX_ANSWER_CHARS) text = `${text.slice(0, MAX_ANSWER_CHARS)}\n\n…(resposta truncada)`
  return { text, toolsUsed: [...toolsUsed], rounds }
}
