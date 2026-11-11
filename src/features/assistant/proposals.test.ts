import { describe, expect, it } from 'vitest'
import { matchByName, proposalSummary, type Proposal } from './proposals'

const options = [
  { id: 'cli-1', name: 'José da Silva' },
  { id: 'cli-2', name: 'Maria Souza' },
  { id: 'cli-3', name: 'Joana Silva' },
]

function candidatesOf(result: ReturnType<typeof matchByName>) {
  if ('id' in result) throw new Error(`esperava candidatos, veio o id ${result.id}`)
  return result.candidates
}

describe('matchByName', () => {
  it('casa igualdade ignorando acentos e caixa', () => {
    expect(matchByName('JOSE DA SILVA', options)).toEqual({ id: 'cli-1' })
    expect(matchByName('josé da silva', options)).toEqual({ id: 'cli-1' })
  })

  it('prefere a igualdade exata em vez de um nome que apenas contém o texto', () => {
    const comExato = [
      { id: 'parcial', name: 'Aposentadoria por idade' },
      { id: 'exato', name: 'Aposentadoria' },
    ]
    expect(matchByName('aposentadoria', comExato)).toEqual({ id: 'exato' })
  })

  it('devolve todos os candidatos quando não há igualdade', () => {
    const result = matchByName('silva', options)
    const ids = candidatesOf(result)
      .map((c) => c.id)
      .sort()
    expect(ids).toEqual(['cli-1', 'cli-3'])
  })

  it('limita a 5 candidatos', () => {
    const muitos = Array.from({ length: 7 }, (_, i) => ({ id: `d-${i}`, name: `Aposentadoria ${i}` }))
    const result = matchByName('aposentadoria', muitos)
    expect(candidatesOf(result)).toHaveLength(5)
  })

  it('devolve lista vazia quando nada contém o texto', () => {
    expect(candidatesOf(matchByName('inexistente', options))).toEqual([])
  })
})

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p-1',
    kind: 'criar_tarefa',
    fields: {},
    status: 'pendente',
    ...over,
  }
}

describe('proposalSummary', () => {
  it('resume a criação de tarefa com o prazo em dd/mm/aaaa', () => {
    // 2026-11-12 → 12/11/2026
    expect(proposalSummary(proposal({ fields: { title: 'Revisar prazo', due_date: '2026-11-12' } }))).toBe(
      'Criar tarefa “Revisar prazo” para 12/11/2026',
    )
  })

  it('resume a criação de tarefa sem prazo', () => {
    expect(proposalSummary(proposal({ fields: { title: 'Revisar prazo' } }))).toBe('Criar tarefa “Revisar prazo”')
  })

  it('resume a próxima ação com demanda e data', () => {
    const text = proposalSummary(
      proposal({
        kind: 'definir_proxima_acao',
        fields: {
          demand_title: 'Aposentadoria por idade',
          next_action: 'Protocolar recurso',
          next_action_date: '2026-11-30',
        },
      }),
    )
    expect(text).toContain('Protocolar recurso')
    expect(text).toContain('Aposentadoria por idade')
    // 2026-11-30 → 30/11/2026
    expect(text).toContain('30/11/2026')
    expect(text.length).toBeLessThanOrEqual(160)
  })

  it('resume a mudança de etapa com demanda e etapa', () => {
    const text = proposalSummary(
      proposal({
        kind: 'mover_etapa',
        fields: { demand_title: 'Aposentadoria por idade', stage_name: 'Protocolado' },
      }),
    )
    expect(text).toContain('Aposentadoria por idade')
    expect(text).toContain('Protocolado')
    expect(text.length).toBeLessThanOrEqual(160)
  })
})
