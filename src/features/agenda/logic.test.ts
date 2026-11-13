import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupByDay, rangeFor } from './logic'

// 2026-11-11 é uma quarta-feira. Semana: segunda 09/11 a domingo 15/11.
// "Atrasados": 60 dias antes de 11/11 = 12/09/2026 (set/2026 tem 30 dias:
// 18 dias até 30/09 + 31 de outubro + 11 de novembro = 60), e termina ontem (10/11).
describe('agenda logic — rangeFor', () => {
  it('hoje usa apenas o próprio dia', () => {
    expect(rangeFor('hoje', '2026-11-11')).toEqual({ from: '2026-11-11', to: '2026-11-11' })
  })

  it('semana vai da segunda ao domingo da semana de hoje', () => {
    expect(rangeFor('semana', '2026-11-11')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
    // domingo pertence à semana que começou na segunda anterior
    expect(rangeFor('semana', '2026-11-15')).toEqual({ from: '2026-11-09', to: '2026-11-15' })
    // semana que cruza o ano: 01/01/2027 (sexta) → 28/12/2026 a 03/01/2027
    expect(rangeFor('semana', '2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' })
  })

  it('mês vai do primeiro ao último dia', () => {
    expect(rangeFor('mes', '2026-11-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(rangeFor('mes', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    // ano bissexto: fevereiro de 2028 termina em 29
    expect(rangeFor('mes', '2028-02-15')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })

  it('atrasados começa 60 dias antes e termina ontem', () => {
    expect(rangeFor('atrasados', '2026-11-11')).toEqual({ from: '2026-09-12', to: '2026-11-10' })
    // 01/03/2026 - 60 dias: 28 dias de fevereiro + 31 de janeiro + 1 de março = 60 → 31/12/2025
    expect(rangeFor('atrasados', '2026-03-01')).toEqual({ from: '2025-12-31', to: '2026-02-28' })
  })
})

type Item = {
  kind: 'task' | 'next_action' | 'installment'
  id: string
  title: string
  date: string
  overdue: boolean
  status: string
  client_id: string | null
  demand_id: string | null
  assignee_id: string | null
  amount: number | null
}

function item(over: Partial<Item> & Pick<Item, 'id' | 'title' | 'date'>): Item {
  return {
    kind: 'task',
    overdue: false,
    status: 'pendente',
    client_id: null,
    demand_id: null,
    assignee_id: null,
    amount: null,
    ...over,
  }
}

describe('agenda logic — groupByDay', () => {
  beforeEach(() => {
    // groupByDay(items) usa "hoje" para rotular Hoje/Amanhã.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 11, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('agrupa e ordena por data, com Hoje, Amanhã e o dia da semana', () => {
    const items = [
      item({ id: 'd-16', title: 'Tarefa de segunda', date: '2026-11-16' }),
      item({ id: 'd-11', title: 'Tarefa de hoje', date: '2026-11-11' }),
      item({ id: 'd-12', title: 'Ação de amanhã', date: '2026-11-12', kind: 'next_action' }),
    ]

    const groups = groupByDay(items)

    expect(groups.map((g) => g.label)).toEqual(['Hoje', 'Amanhã', 'seg., 16 nov.'])
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['d-11'], ['d-12'], ['d-16']])
  })

  it('mantém grupos de dias consecutivos e usa o rótulo do dia da semana depois de amanhã', () => {
    const items = [
      item({ id: 'd-15', title: 'Domingo', date: '2026-11-15' }),
      item({ id: 'd-13', title: 'Sexta', date: '2026-11-13' }),
      item({ id: 'd-12', title: 'Amanhã', date: '2026-11-12' }),
    ]

    const groups = groupByDay(items)

    expect(groups.map((g) => g.label)).toEqual(['Amanhã', 'sex., 13 nov.', 'dom., 15 nov.'])
    expect(groups.map((g) => g.date)).toEqual(['2026-11-12', '2026-11-13', '2026-11-15'])
  })

  it('lista vazia gera nenhum grupo', () => {
    expect(groupByDay([])).toEqual([])
  })
})
