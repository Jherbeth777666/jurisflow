import { describe, expect, it } from 'vitest'
import { monthDelta } from './logic'

describe('monthDelta', () => {
  it('compara o último mês com o anterior, mesmo fora de ordem', () => {
    const series = [
      { month: '2026-11-01', opened: 4 },
      { month: '2026-09-01', opened: 9 },
      { month: '2026-10-01', opened: 7 },
    ]
    expect(monthDelta(series, (r) => r.opened)).toEqual({ current: 4, previous: 7, diff: -3 })
  })

  it('devolve null sem dois meses', () => {
    expect(monthDelta([{ month: '2026-11-01', opened: 1 }], (r) => r.opened)).toBeNull()
    expect(monthDelta([], () => 0)).toBeNull()
  })
})
