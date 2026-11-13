// @vitest-environment node
// Testes de aceite do lote L4a — módulo puro de propostas da IA.
// A IA só PROPÕE: nenhuma destas funções executa RPC nem grava nada.
import { describe, expect, it } from 'vitest'
import { MAX_PROPOSALS, PROPOSAL_SPECS, isProposalTool, parseProposal } from './proposals.ts'
import { ToolArgError } from './tools.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Códigos → nomes reais, como o Pseudonymizer.restore faria.
const restore = (s: string) => s.replaceAll('Cliente C1', 'Maria Souza').replaceAll('Responsável R1', 'Bruno Lima')

describe('parseProposal — propor_tarefa', () => {
  it('monta a proposta completa com os campos reais restaurados', () => {
    const p = parseProposal(
      'propor_tarefa',
      {
        title: 'Ligar para Cliente C1',
        due_date: '2026-03-10',
        client: 'Cliente C1',
        demand_title: 'Aposentadoria por idade',
        assignee: 'Responsável R1',
        priority: 'alta',
      },
      restore,
    )

    expect(p.kind).toBe('criar_tarefa')
    expect(p.status).toBe('pendente')
    expect(p.id).toMatch(UUID_RE)
    expect(p.fields).toEqual({
      title: 'Ligar para Maria Souza',
      due_date: '2026-03-10',
      client: 'Maria Souza',
      demand_title: 'Aposentadoria por idade',
      assignee: 'Bruno Lima',
      priority: 'alta',
    })
  })

  it('rejeita título curto: "ab" tem 2 caracteres e o mínimo é 3', () => {
    expect(() => parseProposal('propor_tarefa', { title: 'ab' }, restore)).toThrow(ToolArgError)
  })

  it('aceita título no limite mínimo: "abc" tem exatamente 3 caracteres', () => {
    const p = parseProposal('propor_tarefa', { title: 'abc' }, restore)
    expect(p.fields).toMatchObject({ title: 'abc' })
  })

  it('rejeita data inválida (2026-02-30; fevereiro/2026 tem 28 dias)', () => {
    expect(() => parseProposal('propor_tarefa', { title: 'Revisar prazo', due_date: '2026-02-30' }, restore)).toThrow(
      ToolArgError,
    )
  })

  it('rejeita prioridade fora do enum baixa|media|alta|urgente', () => {
    expect(() =>
      parseProposal('propor_tarefa', { title: 'Revisar prazo', priority: 'critica' }, restore),
    ).toThrow(ToolArgError)
  })

  it('aceita as quatro prioridades reais do enum', () => {
    // enum public.priority_level = baixa, media, alta, urgente (4 valores)
    for (const priority of ['baixa', 'media', 'alta', 'urgente']) {
      expect(() => parseProposal('propor_tarefa', { title: 'Tarefa válida', priority }, restore)).not.toThrow()
    }
  })

  it('descarta chaves desconhecidas enviadas pelo modelo', () => {
    const p = parseProposal(
      'propor_tarefa',
      {
        title: 'Revisar processo',
        p_org: 'outro-escritorio',
        organization_id: '11111111-1111-4111-8111-111111111111',
        user_id: '22222222-2222-4222-8222-222222222222',
        id: 'forjado',
        status: 'confirmada',
        sql: 'drop table clients',
      },
      restore,
    )

    expect(p.fields).toMatchObject({ title: 'Revisar processo' })
    expect(p.fields).not.toHaveProperty('p_org')
    expect(p.fields).not.toHaveProperty('organization_id')
    expect(p.fields).not.toHaveProperty('user_id')
    expect(p.fields).not.toHaveProperty('id')
    expect(p.fields).not.toHaveProperty('status')
    expect(p.fields).not.toHaveProperty('sql')
  })

  it('remove caracteres de controle do texto livre', () => {
    // \u0007 (BEL) não pode chegar ao campo.
    const p = parseProposal('propor_tarefa', { title: 'Ligar\u0007para Cliente C1' }, restore)
    expect(p.fields.title).not.toMatch(/[\u0000-\u001f\u007f]/)
  })

  it('gera ids diferentes para propostas diferentes', () => {
    const a = parseProposal('propor_tarefa', { title: 'Tarefa A' }, restore)
    const b = parseProposal('propor_tarefa', { title: 'Tarefa B' }, restore)
    expect(a.id).not.toBe(b.id)
  })
})

describe('parseProposal — propor_proxima_acao', () => {
  it('monta a proposta e restaura códigos no cliente e no texto livre', () => {
    const p = parseProposal(
      'propor_proxima_acao',
      {
        client: 'Cliente C1',
        demand_title: 'Aposentadoria por idade',
        next_action: 'Protocolar pedido de Cliente C1',
        next_action_date: '2026-04-01',
      },
      restore,
    )

    expect(p.kind).toBe('definir_proxima_acao')
    expect(p.status).toBe('pendente')
    expect(p.fields).toMatchObject({
      client: 'Maria Souza',
      demand_title: 'Aposentadoria por idade',
      next_action: 'Protocolar pedido de Maria Souza',
      next_action_date: '2026-04-01',
    })
  })

  it('exige next_action', () => {
    expect(() =>
      parseProposal('propor_proxima_acao', { demand_title: 'Aposentadoria por idade' }, restore),
    ).toThrow(ToolArgError)
  })

  it('exige demand_title', () => {
    expect(() => parseProposal('propor_proxima_acao', { next_action: 'Protocolar pedido' }, restore)).toThrow(
      ToolArgError,
    )
  })
})

describe('parseProposal — propor_mudanca_etapa', () => {
  it('monta a proposta de mover etapa', () => {
    const p = parseProposal(
      'propor_mudanca_etapa',
      { client: 'Cliente C1', demand_title: 'Aposentadoria por idade', stage_name: 'Aguardando perícia' },
      restore,
    )

    expect(p.kind).toBe('mover_etapa')
    expect(p.status).toBe('pendente')
    expect(p.fields).toMatchObject({
      client: 'Maria Souza',
      demand_title: 'Aposentadoria por idade',
      stage_name: 'Aguardando perícia',
    })
  })

  it('exige stage_name', () => {
    expect(() =>
      parseProposal('propor_mudanca_etapa', { demand_title: 'Aposentadoria por idade' }, restore),
    ).toThrow(ToolArgError)
  })
})

describe('parseProposal — ferramenta desconhecida', () => {
  it('rejeita nome fora das ferramentas de proposta', () => {
    expect(() => parseProposal('executar_sql', { query: 'select 1' }, restore)).toThrow(ToolArgError)
  })
})

describe('PROPOSAL_SPECS', () => {
  const specs = new Map(PROPOSAL_SPECS.map((s) => [s.name, s]))
  const required = (name: string) => [...(specs.get(name)?.parameters.required ?? [])].sort()

  it('expõe exatamente 3 ferramentas de proposta', () => {
    expect(PROPOSAL_SPECS).toHaveLength(3)
    expect([...specs.keys()].sort()).toEqual(['propor_mudanca_etapa', 'propor_proxima_acao', 'propor_tarefa'])
  })

  it('declara os campos obrigatórios de cada proposta', () => {
    expect(required('propor_tarefa')).toEqual(['title'])
    expect(required('propor_proxima_acao')).toEqual(['demand_title', 'next_action'].sort())
    expect(required('propor_mudanca_etapa')).toEqual(['demand_title', 'stage_name'].sort())
  })

  it('orienta o modelo a não inventar datas, só propor e nunca dizer que gravou', () => {
    for (const spec of PROPOSAL_SPECS) {
      expect(spec.description).toMatch(/explicitamente/i)
      expect(spec.description).toMatch(/não invente datas/i)
      expect(spec.description).toMatch(/não grava nada/i)
      expect(spec.description).toMatch(/confirm\w* na tela/i)
    }
  })

  it('usa o enum real de prioridade em propor_tarefa', () => {
    const props = specs.get('propor_tarefa')!.parameters.properties as Record<string, { enum?: string[] }>
    // 4 valores do enum public.priority_level
    expect([...(props.priority.enum ?? [])].sort()).toEqual(['alta', 'baixa', 'media', 'urgente'])
  })

  it(`limita a ${MAX_PROPOSALS} propostas por resposta`, () => {
    expect(MAX_PROPOSALS).toBe(5)
  })
})

describe('isProposalTool', () => {
  it('reconhece as três ferramentas propor_*', () => {
    expect(isProposalTool('propor_tarefa')).toBe(true)
    expect(isProposalTool('propor_proxima_acao')).toBe(true)
    expect(isProposalTool('propor_mudanca_etapa')).toBe(true)
  })

  it('não confunde com ferramentas de consulta nem com nomes arbitrários', () => {
    expect(isProposalTool('ai_overdue_tasks')).toBe(false)
    expect(isProposalTool('run_sql')).toBe(false)
  })
})
