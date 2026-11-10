import { analyzeBase, scoreLabel, WEIGHTS, type QClient, type QDemand, type QTask } from './logic'

const TODAY = '2026-11-09'
const client = (id: string, over: Partial<QClient> = {}): QClient => ({
  id,
  full_name: `Cliente ${id}`,
  cpf: '52998224725',
  phone: '11987654321',
  birth_date: null,
  status: 'ativo',
  created_at: '2026-10-01T10:00:00Z',
  ...over,
})
const demand = (id: string, over: Partial<QDemand> = {}): QDemand => ({
  id,
  title: `D ${id}`,
  client_id: 'a',
  status: 'em_andamento',
  responsible_id: 'u1',
  next_action: 'Ligar',
  updated_at: '2026-11-01T10:00:00Z',
  closed_at: null,
  ...over,
})
const task = (id: string, over: Partial<QTask> = {}): QTask => ({
  id,
  title: `T ${id}`,
  demand_id: null,
  client_id: null,
  due_date: '2026-11-08',
  status: 'pendente',
  ...over,
})

describe('analyzeBase', () => {
  it('base vazia = 100', () => {
    const r = analyzeBase({ clients: [], demands: [], tasks: [] }, TODAY)
    expect(r.score).toBe(100)
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('encontra todos os problemas', () => {
    const r = analyzeBase(
      {
        clients: [
          client('a', { full_name: 'Maria da Silva' }),
          client('b', { full_name: 'Maria Silva', cpf: '52998224725' }), // mesmo CPF de a
          client('c', { full_name: 'Pedro Alves', cpf: null, phone: null }), // incompleto + parado
          client('d', { full_name: 'Joana Reis', cpf: '12345678900', created_at: '2026-01-01T00:00:00Z' }), // CPF inválido, parada
          client('e', { full_name: 'Rita Lopes', cpf: '11144477735', status: 'arquivado', phone: null }), // arquivado não conta
        ],
        demands: [
          demand('d1', { client_id: 'a' }),
          demand('d2', { client_id: 'a', responsible_id: null, next_action: null }), // sem resp. e sem próxima (sem tarefa)
          demand('d3', { client_id: 'a', next_action: '  ' }), // sem próxima, mas tem tarefa aberta
          demand('d4', { client_id: 'd', status: 'concluida', closed_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' }),
        ],
        tasks: [task('t1', { demand_id: 'd3' }), task('t2', { due_date: '2026-10-20' }), task('t3', { due_date: '2026-10-01', status: 'concluida' })],
      },
      TODAY,
    )
    expect(r.duplicates).toHaveLength(1)
    expect(r.duplicates[0]).toMatchObject({ a: 'a', b: 'b', reason: 'cpf', aName: 'Maria da Silva' })
    expect(r.incomplete.map((x) => [x.client.id, x.issues])).toEqual([
      ['c', ['sem_cpf', 'sem_telefone']],
      ['d', ['cpf_invalido']],
    ])
    expect(r.noResponsible.map((d) => d.id)).toEqual(['d2'])
    expect(r.noNextAction.map((d) => d.id)).toEqual(['d2'])
    expect(r.overdueTasks.map((t) => [t.id, t.daysLate])).toEqual([['t2', 20]])
    // c foi criada há 39 dias (não é parada); d teve última movimentação em 01/03 (253 dias)
    expect(r.staleClients.map((s) => [s.client.id, s.lastActivity])).toEqual([['d', '2026-03-01']])
    expect(r.indicators.duplicates).toMatchObject({ problems: 2, total: 5 })
    expect(r.score).toBeGreaterThan(0)
    expect(r.score).toBeLessThan(100)
  })
})

it('scoreLabel', () => {
  expect(scoreLabel(90).tone).toBe('success')
  expect(scoreLabel(70).tone).toBe('warning')
  expect(scoreLabel(40).tone).toBe('danger')
})
