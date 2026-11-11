// @vitest-environment node
// Testes de aceite do lote L4a — laço do assistente com propostas (não executa RPC).
// Arquivo novo para não alterar assistant.test.ts já commitado.
import { describe, expect, it, vi } from 'vitest'
import { runAssistant } from './assistant.ts'
import { Pseudonymizer } from './pseudonymize.ts'
import { buildSystemPrompt } from './prompt.ts'
import { TOOL_SPECS } from './tools.ts'
import type { CompletionRequest, CompletionResponse, LLMProvider, RpcExecutor } from './types.ts'

const ORG = '11111111-1111-4111-8111-111111111111'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ProposalRecord = {
  id: string
  kind: string
  status: string
  fields: Record<string, unknown>
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

function proposalsOf(result: unknown): ProposalRecord[] {
  return ((result as { proposals?: ProposalRecord[] }).proposals ?? []) as ProposalRecord[]
}

function lastMessage(req: CompletionRequest) {
  return req.messages[req.messages.length - 1] as {
    role: string
    name?: string
    content: string
    isError?: boolean
  }
}

const pseudonymizer = () => new Pseudonymizer({ clients: ['Maria Souza'], members: ['Bruno Lima'] })

describe('runAssistant — ferramentas propor_*', () => {
  it('envia as ferramentas de proposta junto das consultas ao provedor', async () => {
    const provider = new ScriptedProvider([() => ({ text: 'Nada a fazer.', toolCalls: [] })])
    const rpc = vi.fn<RpcExecutor>()

    await runAssistant({
      provider,
      system: 'sys',
      history: [],
      userMessage: 'oi',
      orgId: ORG,
      rpc,
      pseudonymizer: pseudonymizer(),
    })

    const names = provider.calls[0].tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(['propor_tarefa', 'propor_proxima_acao', 'propor_mudanca_etapa']),
    )
    // 9 consultas já existentes + 3 propostas novas = 12 ferramentas hoje
    expect(names).toHaveLength(TOOL_SPECS.length + 3)
  })

  it('registra a proposta com nome real, não executa RPC e avisa o modelo que aguarda confirmação', async () => {
    const provider = new ScriptedProvider([
      () => ({
        text: '',
        toolCalls: [
          {
            id: 'pc1',
            name: 'propor_tarefa',
            args: {
              title: 'Ligar para Cliente C1',
              due_date: '2026-03-10',
              client: 'Cliente C1',
              assignee: 'Responsável R1',
              priority: 'alta',
            },
          },
        ],
      }),
      () => ({ text: 'Proposta registrada; confirme na tela.', toolCalls: [] }),
    ])
    const rpc = vi.fn<RpcExecutor>()

    const result = await runAssistant({
      provider,
      system: 'sys',
      history: [],
      userMessage: 'Crie uma tarefa para ligar para Maria Souza em 10/03/2026',
      orgId: ORG,
      rpc,
      pseudonymizer: pseudonymizer(),
    })

    // A IA só propõe: nada é gravado pelo backend.
    expect(rpc).not.toHaveBeenCalled()

    const proposals = proposalsOf(result)
    expect(proposals).toHaveLength(1)
    expect(proposals[0].id).toMatch(UUID_RE)
    expect(proposals[0]).toMatchObject({
      kind: 'criar_tarefa',
      status: 'pendente',
      fields: {
        title: 'Ligar para Maria Souza',
        client: 'Maria Souza',
        assignee: 'Bruno Lima',
        priority: 'alta',
      },
    })

    const toolMsg = lastMessage(provider.calls[1])
    expect(toolMsg).toMatchObject({ role: 'tool', name: 'propor_tarefa' })
    expect(toolMsg.isError).toBeFalsy()
    expect(JSON.parse(toolMsg.content)).toMatchObject({
      status: 'proposta_registrada',
      aguardando_confirmacao_do_usuario: true,
    })

    // O provedor continua sem ver nomes reais.
    const sent = JSON.stringify(provider.calls)
    expect(sent).not.toContain('Maria Souza')
    expect(sent).not.toContain('Bruno Lima')
    expect(sent).toContain('Cliente C1')
  })

  it('aceita no máximo 5 propostas por resposta (a 6ª vira erro)', async () => {
    const firstFive = Array.from({ length: 5 }, (_, i) => ({
      id: `pc${i + 1}`,
      name: 'propor_tarefa',
      args: { title: `Tarefa ${i + 1}` },
    }))
    const provider = new ScriptedProvider([
      () => ({ text: '', toolCalls: firstFive }),
      () => ({ text: '', toolCalls: [{ id: 'pc6', name: 'propor_tarefa', args: { title: 'Tarefa 6' } }] }),
      () => ({ text: 'Pronto.', toolCalls: [] }),
    ])
    const rpc = vi.fn<RpcExecutor>()

    const result = await runAssistant({
      provider,
      system: 'sys',
      history: [],
      userMessage: 'Crie seis tarefas',
      orgId: ORG,
      rpc,
      pseudonymizer: pseudonymizer(),
    })

    // 5 = MAX_PROPOSALS do plano; a 6ª proposta é recusada.
    expect(proposalsOf(result)).toHaveLength(5)
    expect(rpc).not.toHaveBeenCalled()

    const sixth = lastMessage(provider.calls[2])
    expect(sixth).toMatchObject({ role: 'tool', name: 'propor_tarefa', isError: true })
    expect(sixth.content).toContain('Limite de propostas')
  })

  it('proposta inválida volta como erro ao modelo e não vira proposta', async () => {
    const provider = new ScriptedProvider([
      () => ({ text: '', toolCalls: [{ id: 'bad', name: 'propor_tarefa', args: { title: 'ab' } }] }),
      () => ({ text: 'Não consegui montar a proposta.', toolCalls: [] }),
    ])
    const rpc = vi.fn<RpcExecutor>()

    const result = await runAssistant({
      provider,
      system: 'sys',
      history: [],
      userMessage: 'Crie a tarefa "ab"',
      orgId: ORG,
      rpc,
      pseudonymizer: pseudonymizer(),
    })

    // "ab" tem 2 caracteres; o título exige 3–160 no plano.
    expect(proposalsOf(result)).toHaveLength(0)
    expect(rpc).not.toHaveBeenCalled()

    const toolMsg = lastMessage(provider.calls[1])
    expect(toolMsg).toMatchObject({ role: 'tool', name: 'propor_tarefa', isError: true })
    expect(toolMsg.content).toMatch(/title/i)
  })
})

describe('buildSystemPrompt — regra de propostas (L4a)', () => {
  const prompt = buildSystemPrompt({ now: new Date('2026-11-11T12:00:00-03:00'), role: 'advogado' })

  it('manda usar propor_* e deixar claro que é proposta a confirmar na tela', () => {
    expect(prompt).toMatch(/propor_/i)
    expect(prompt).toMatch(/confirm\w* na tela/i)
  })

  it('proíbe dizer que já foi feito e separa fatos de sugestões', () => {
    expect(prompt).toMatch(/nunca diga que já foi feito|não diga que já foi feito/i)
    expect(prompt).toMatch(/fatos/i)
    expect(prompt).toMatch(/sugestões/i)
  })

  it('proíbe calcular prazo jurídico e inventar datas', () => {
    expect(prompt).toMatch(/prazo jurídico/i)
    expect(prompt).toMatch(/datas ditas pelo usuário|datas informadas pelo usuário/i)
  })
})
