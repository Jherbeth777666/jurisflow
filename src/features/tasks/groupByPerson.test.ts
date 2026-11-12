import { describe, expect, it } from 'vitest'
import { groupByPerson } from './groupByPerson'

const names = new Map([
  ['u-bruno', 'Bruno'],
  ['u-ana', 'Ana'],
])

const t = (id: string, assignee_id: string | null, due_date: string | null, status = 'pendente') => ({ id, assignee_id, due_date, status })

describe('groupByPerson', () => {
  it('agrupa por responsável em ordem alfabética, com "Sem responsável" por último', () => {
    const groups = groupByPerson(
      [t('1', 'u-bruno', '2026-11-10'), t('2', null, null), t('3', 'u-ana', '2026-11-20'), t('4', 'u-bruno', '2026-11-15')],
      names,
      '2026-11-12',
    )
    expect(groups.map((g) => g.name)).toEqual(['Ana', 'Bruno', 'Sem responsável'])
    expect(groups[1].items.map((i) => i.id)).toEqual(['1', '4'])
  })

  it('conta só as abertas e vencidas de cada pessoa', () => {
    const groups = groupByPerson(
      [t('1', 'u-ana', '2026-11-01'), t('2', 'u-ana', '2026-11-02', 'concluida'), t('3', 'u-ana', '2026-11-30')],
      names,
      '2026-11-12',
    )
    expect(groups[0].overdue).toBe(1)
  })

  it('nomeia quem saiu da equipe sem quebrar', () => {
    const [g] = groupByPerson([t('1', 'u-x', null)], names, '2026-11-12')
    expect(g.name).toBe('Pessoa removida da equipe')
  })
})
