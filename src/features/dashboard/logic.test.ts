import { diffInDays } from '@/lib/format'
import { dueTone, firstName, greeting, sortPriorityTasks } from './logic'

describe('dashboard logic', () => {
  it('saudação por horário', () => {
    expect(greeting(8)).toBe('Bom dia')
    expect(greeting(13)).toBe('Boa tarde')
    expect(greeting(20)).toBe('Boa noite')
    expect(greeting(2)).toBe('Boa noite')
  })
  it('primeiro nome com fallback no e-mail', () => {
    expect(firstName('Maria da Silva')).toBe('Maria')
    expect(firstName('', 'joao@x.com')).toBe('joao')
    expect(firstName(null, null)).toBe('')
  })
  it('ordena tarefas por vencimento e prioridade', () => {
    const r = sortPriorityTasks([
      { id: 'a', due_date: null, priority: 'urgente' as const },
      { id: 'b', due_date: '2026-11-10', priority: 'baixa' as const },
      { id: 'c', due_date: '2026-11-10', priority: 'urgente' as const },
      { id: 'd', due_date: '2026-11-01', priority: 'media' as const },
    ])
    expect(r.map((t) => t.id)).toEqual(['d', 'c', 'b', 'a'])
  })
  it('classifica vencimento', () => {
    const t = '2026-11-09'
    expect(dueTone('2026-11-08', t, 3, diffInDays)).toBe('overdue')
    expect(dueTone('2026-11-09', t, 3, diffInDays)).toBe('today')
    expect(dueTone('2026-11-11', t, 3, diffInDays)).toBe('soon')
    expect(dueTone('2026-11-30', t, 3, diffInDays)).toBe('later')
    expect(dueTone(null, t, 3, diffInDays)).toBe('none')
  })
})
