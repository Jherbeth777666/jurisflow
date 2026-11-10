// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { normalizeHistory, runAssistant, MAX_TOOL_ROUNDS } from './assistant.ts'
import { Pseudonymizer } from './pseudonymize.ts'
import { AnthropicProvider } from './providers/anthropic.ts'
import { OpenAICompatibleProvider } from './providers/openai.ts'
import type { CompletionRequest, CompletionResponse, FetchLike, LLMProvider, RpcExecutor } from './types.ts'

const ORG = '11111111-1111-4111-8111-111111111111'

const STALLED = {
  total: 2,
  items: [
    { id: 'd1', title: 'Salário-maternidade Maria Souza', client: 'Maria Souza', responsible: 'Bruno Lima', days_stalled: 20, cpf: '52998224725' },
    { id: 'd2', title: 'Aposentadoria', client: 'José Santos', responsible: 'Bruno Lima', days_stalled: 17 },
  ],
}

/** Provedor falso: devolve respostas roteirizadas e grava cada requisição. */
class ScriptedProvider implements LLMProvider {
  readonly name = 'fake'
  readonly model = 'fake-1'
  calls: CompletionRequest[] = []
  private script: Array<(req: CompletionRequest) => CompletionResponse>
  constructor(script: Array<(req: CompletionRequest) => CompletionResponse>) {
    this.script = script
  }
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    // cópia profunda: o laço continua mutando o array de mensagens
    this.calls.push(JSON.parse(JSON.stringify(req)))
    const step = this.script[Math.min(this.calls.length - 1, this.script.length - 1)]
    return step(req)
  }
}

const rpcReturning = (data: unknown) => vi.fn<RpcExecutor>().mockResolvedValue({ data, error: null })

describe('runAssistant (laço de tool use)', () => {
  it('executa a ferramenta, pseudonimiza o payload e restaura nomes na resposta', async () => {
    const provider = new ScriptedProvider([
      () => ({ text: '', toolCalls: [{ id: 't1', name: 'ai_stalled_demands', args: { days: 15, p_org: 'outro-escritorio' } }] }),
      (req) => {
        const last = req.messages[req.messages.length - 1]
        expect(last.role).toBe('tool')
        return { text: 'Há 2 demandas paradas: **Cliente C1** (Responsável R1) e Cliente C2.', toolCalls: [] }
      },
    ])
    const rpc = rpcReturning(STALLED)
    const out = await runAssistant({
      provider,
      system: 'sys',
      history: [],
      userMessage: 'Quais demandas estão paradas há mais de 15 dias?',
      orgId: ORG,
      rpc,
      pseudonymizer: new Pseudonymizer(),
    })

    expect(rpc).toHaveBeenCalledWith('ai_stalled_demands', { p_days: 15, p_org: ORG })
    expect(out.text).toBe('Há 2 demandas paradas: **Maria Souza** (Bruno Lima) e José Santos.')
    expect(out.toolsUsed).toEqual(['ai_stalled_demands'])
    expect(out.rounds).toBe(1)

    const sent = JSON.stringify(provider.calls)
    expect(sent).not.toMatch(/Maria|Souza|José|Santos|Bruno|Lima/)
    expect(sent).not.toContain('52998224725')
    expect(sent).toContain('Cliente C1')
  })

  it('pseudonimiza histórico e pergunta com o dicionário de nomes', async () => {
    const provider = new ScriptedProvider([() => ({ text: 'Ok, Cliente C1.', toolCalls: [] })])
    const out = await runAssistant({
      provider,
      system: 'sys',
      history: [
        { role: 'assistant', content: 'mensagem órfã inicial' },
        { role: 'user', content: 'Fale da Maria Souza' },
        { role: 'assistant', content: 'Maria Souza tem 1 demanda.' },
      ],
      userMessage: 'E a maria souza tem tarefas?',
      orgId: ORG,
      rpc: rpcReturning(null),
      pseudonymizer: new Pseudonymizer({ clients: ['Maria Souza'] }),
    })
    const sent = JSON.stringify(provider.calls)
    expect(sent).not.toMatch(/maria souza/i)
    expect(sent).not.toContain('órfã') // histórico não pode começar com o assistente
    expect(out.text).toBe('Ok, Maria Souza.')
  })

  it('ferramenta fora da whitelist é rejeitada e devolvida como erro ao modelo', async () => {
    const provider = new ScriptedProvider([
      () => ({ text: '', toolCalls: [{ id: 'x', name: 'run_sql', args: { query: 'select cpf from clients' } }] }),
      (req) => {
        const last = req.messages[req.messages.length - 1]
        expect(last).toMatchObject({ role: 'tool', isError: true })
        return { text: 'Não tenho acesso a isso.', toolCalls: [] }
      },
    ])
    const rpc = vi.fn<RpcExecutor>()
    const out = await runAssistant({ provider, system: 's', history: [], userMessage: 'cpfs?', orgId: ORG, rpc, pseudonymizer: new Pseudonymizer() })
    expect(rpc).not.toHaveBeenCalled()
    expect(out.toolsUsed).toEqual([])
    expect(out.text).toBe('Não tenho acesso a isso.')
  })

  it(`limita a ${MAX_TOOL_ROUNDS} rodadas e força resposta em texto`, async () => {
    const provider = new ScriptedProvider([
      (req) =>
        req.toolChoice === 'none'
          ? { text: 'Resumo final.', toolCalls: [{ id: 'ignored', name: 'ai_overdue_tasks', args: {} }] }
          : { text: '', toolCalls: [{ id: `t${Math.random()}`, name: 'ai_overdue_tasks', args: {} }] },
    ])
    const rpc = rpcReturning({ total: 0, items: [] })
    const out = await runAssistant({ provider, system: 's', history: [], userMessage: 'loop', orgId: ORG, rpc, pseudonymizer: new Pseudonymizer() })
    expect(rpc).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS)
    expect(provider.calls).toHaveLength(MAX_TOOL_ROUNDS + 1)
    expect(provider.calls.at(-1)!.toolChoice).toBe('none')
    expect(out.text).toBe('Resumo final.')
  })
})

describe('normalizeHistory', () => {
  it('une mensagens consecutivas do mesmo papel', () => {
    expect(
      normalizeHistory([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: 'c' },
      ]),
    ).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' },
    ])
  })
})

// ---------------------------------------------------------------------------
// Adaptadores reais com fetch falso: formato do payload e tool calling
// ---------------------------------------------------------------------------
function fakeFetch(responses: unknown[]) {
  const bodies: Array<Record<string, unknown>> = []
  const urls: string[] = []
  const headers: Array<Record<string, string>> = []
  let i = 0
  const impl: FetchLike = async (url, init) => {
    urls.push(url)
    headers.push(init?.headers as Record<string, string>)
    bodies.push(JSON.parse(String(init?.body)))
    const r = responses[Math.min(i++, responses.length - 1)]
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { impl, bodies, urls, headers }
}

describe('adaptador Anthropic', () => {
  it('converte tool_use/tool_result e não envia nomes reais', async () => {
    const f = fakeFetch([
      { content: [{ type: 'tool_use', id: 'tu1', name: 'ai_stalled_demands', input: { days: 20 } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Cliente C1 está parada há 20 dias.' }], stop_reason: 'end_turn' },
    ])
    const provider = new AnthropicProvider({ apiKey: 'sk-test', model: 'claude-sonnet-5-5', fetchImpl: f.impl })
    const out = await runAssistant({
      provider,
      system: 'sys',
      history: [],
      userMessage: 'paradas?',
      orgId: ORG,
      rpc: rpcReturning(STALLED),
      pseudonymizer: new Pseudonymizer(),
    })
    expect(out.text).toBe('Maria Souza está parada há 20 dias.')
    expect(f.urls[0]).toBe('https://api.anthropic.com/v1/messages')
    expect(f.headers[0]['x-api-key']).toBe('sk-test')
    const second = f.bodies[1] as { messages: Array<{ role: string; content: Array<Record<string, unknown>> }>; tools: unknown[] }
    expect(second.tools).toHaveLength(9)
    expect(second.messages[1].content[0]).toMatchObject({ type: 'tool_use', id: 'tu1', name: 'ai_stalled_demands' })
    expect(second.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1' })
    expect(JSON.stringify(f.bodies)).not.toMatch(/Maria|Bruno|José/)
  })
})

describe('adaptador OpenAI-compatível (OpenAI/Gemini/DeepSeek/Groq)', () => {
  it('usa tools/tool_calls e mensagens role=tool', async () => {
    const f = fakeFetch([
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: '', type: 'function', function: { name: 'ai_overdue_tasks', arguments: '{}' } }],
            },
          },
        ],
      },
      { choices: [{ message: { content: 'Responsável R1 tem 1 tarefa atrasada.' } }] },
    ])
    const provider = new OpenAICompatibleProvider({
      name: 'gemini',
      apiKey: 'g-key',
      model: 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      fetchImpl: f.impl,
    })
    const out = await runAssistant({
      provider,
      system: 'sys',
      history: [],
      userMessage: 'atrasadas?',
      orgId: ORG,
      rpc: rpcReturning({ total: 1, items: [{ title: 'Protocolo', assignee: 'Carla Dias' }] }),
      pseudonymizer: new Pseudonymizer(),
    })
    expect(out.text).toBe('Carla Dias tem 1 tarefa atrasada.')
    expect(f.urls[0]).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    expect(f.headers[0].authorization).toBe('Bearer g-key')
    const first = f.bodies[0] as { tools: Array<{ type: string; function: { name: string } }>; messages: Array<{ role: string }> }
    expect(first.tools[0].type).toBe('function')
    expect(first.messages[0].role).toBe('system')
    const second = f.bodies[1] as { messages: Array<Record<string, unknown>> }
    const asst = second.messages[2] as { tool_calls: Array<{ id: string; function: { name: string } }> }
    expect(asst.tool_calls[0]).toMatchObject({ id: 'call_0', function: { name: 'ai_overdue_tasks' } })
    expect(second.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_0' })
    expect(JSON.stringify(f.bodies)).not.toContain('Carla')
  })
})
