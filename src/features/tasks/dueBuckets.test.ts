import { describe, expect, it } from 'vitest'
import { dueBucket, dueLabel, groupByDueBucket, parseRangeFilter, rangeBounds } from './dueBuckets'

const TODAY = '2026-11-09'

describe('dueBucket', () => {
  it('classifica vencidas', () => {
    expect(dueBucket('2026-11-08', 'pendente', TODAY)).toBe('overdue')
    expect(dueBucket('2025-01-01', 'em_andamento', TODAY)).toBe('overdue')
  })
  it('classifica hoje e amanhã', () => {
    expect(dueBucket('2026-11-09', 'pendente', TODAY)).toBe('today')
    expect(dueBucket('2026-11-10', 'pendente', TODAY)).toBe('tomorrow')
  })
  it('classifica esta semana (até 7 dias) e depois', () => {
    expect(dueBucket('2026-11-11', 'pendente', TODAY)).toBe('week')
    expect(dueBucket('2026-11-16', 'pendente', TODAY)).toBe('week')
    expect(dueBucket('2026-11-17', 'pendente', TODAY)).toBe('later')
  })
  it('atravessa virada de mês/ano sem erro de fuso', () => {
    expect(dueBucket('2027-01-01', 'pendente', '2026-12-31')).toBe('tomorrow')
    expect(dueBucket('2026-11-30', 'pendente', '2026-12-01')).toBe('overdue')
  })
  it('sem data', () => {
    expect(dueBucket(null, 'pendente', TODAY)).toBe('none')
  })
  it('concluídas e canceladas nunca geram alerta', () => {
    expect(dueBucket('2026-11-01', 'concluida', TODAY)).toBe('done')
    expect(dueBucket('2026-11-09', 'cancelada', TODAY)).toBe('done')
    expect(dueBucket(null, 'concluida', TODAY)).toBe('done')
  })
})

describe('groupByDueBucket', () => {
  it('agrupa na ordem das faixas e omite vazias', () => {
    const items = [
      { id: 'a', due_date: null, status: 'pendente' as const },
      { id: 'b', due_date: '2026-11-20', status: 'pendente' as const },
      { id: 'c', due_date: '2026-11-01', status: 'pendente' as const },
      { id: 'd', due_date: '2026-11-09', status: 'concluida' as const },
      { id: 'e', due_date: '2026-11-02', status: 'em_andamento' as const },
    ]
    const groups = groupByDueBucket(items, TODAY)
    expect(groups.map((g) => g.bucket)).toEqual(['overdue', 'later', 'none', 'done'])
    expect(groups[0].items.map((i) => i.id)).toEqual(['c', 'e'])
  })
})

describe('dueLabel', () => {
  it('descreve o vencimento', () => {
    expect(dueLabel(null, TODAY)).toBe('Sem data')
    expect(dueLabel('2026-11-08', TODAY)).toBe('Venceu há 1 dia')
    expect(dueLabel('2026-11-06', TODAY)).toBe('Venceu há 3 dias')
    expect(dueLabel('2026-11-09', TODAY)).toBe('Vence hoje')
    expect(dueLabel('2026-11-10', TODAY)).toBe('Amanhã')
    expect(dueLabel('2026-11-20', TODAY)).toBe('20/11/2026')
  })
})

describe('filtros de URL', () => {
  it('aceita apenas valores conhecidos', () => {
    expect(parseRangeFilter('overdue')).toBe('overdue')
    expect(parseRangeFilter('week')).toBe('week')
    expect(parseRangeFilter('xyz')).toBeNull()
    expect(parseRangeFilter(null)).toBeNull()
  })
  it('calcula intervalos', () => {
    expect(rangeBounds('overdue', TODAY)).toEqual({ lt: TODAY })
    expect(rangeBounds('today', TODAY)).toEqual({ gte: TODAY, lte: TODAY })
    expect(rangeBounds('week', TODAY)).toEqual({ gte: TODAY, lte: '2026-11-16' })
    expect(rangeBounds('nodate', TODAY)).toEqual({ isNull: true })
  })
})
