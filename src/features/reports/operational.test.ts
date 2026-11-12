import { describe, expect, it } from 'vitest'
import { bottleneckLevel, formatDays } from './operational'

// A função recebe uma etapa da RPC operational_metrics; só estes dois campos
// participam da classificação de gargalo.
const stage = (open_now: number, avg_age_open_days: number | null) =>
  ({ open_now, avg_age_open_days }) as Parameters<typeof bottleneckLevel>[0]

describe('formatDays', () => {
  it('trata nulo e menos de um dia', () => {
    expect(formatDays(null)).toBe('—')
    expect(formatDays(0)).toBe('menos de 1 dia')
    expect(formatDays(0.4)).toBe('menos de 1 dia')
  })

  it('usa singular apenas para exatamente 1 dia', () => {
    expect(formatDays(1)).toBe('1 dia')
  })

  it('mostra uma casa decimal até 10 dias e inteiro acima disso', () => {
    // 2,5 dias e 9,5 dias ficam na faixa com uma casa decimal.
    expect(formatDays(2.5)).toBe('2,5 dias')
    expect(formatDays(9.5)).toBe('9,5 dias')
    // Acima de 10 dias o valor é inteiro.
    expect(formatDays(15)).toBe('15 dias')
    expect(formatDays(40)).toBe('40 dias')
  })
})

describe('bottleneckLevel', () => {
  it('alto com 5 ou mais demandas abertas ou 30 ou mais dias de idade média', () => {
    expect(bottleneckLevel(stage(5, 0))).toBe('alto')
    expect(bottleneckLevel(stage(0, 30))).toBe('alto')
    expect(bottleneckLevel(stage(9, 45))).toBe('alto')
  })

  it('medio com 3 ou mais abertas ou 15 ou mais dias, sem atingir o alto', () => {
    expect(bottleneckLevel(stage(3, 5))).toBe('medio')
    expect(bottleneckLevel(stage(0, 15))).toBe('medio')
    expect(bottleneckLevel(stage(4, 29.9))).toBe('medio')
  })

  it('baixo abaixo dos limites', () => {
    expect(bottleneckLevel(stage(2, 14.9))).toBe('baixo')
    expect(bottleneckLevel(stage(0, null))).toBe('baixo')
  })

  it('idade média nula não conta e as abertas continuam valendo', () => {
    expect(bottleneckLevel(stage(4, null))).toBe('medio')
    expect(bottleneckLevel(stage(5, null))).toBe('alto')
  })
})
