import { addMonthsISO, computeInstallments, nextOpenInstallment, parseMoneyInput, formatMoneyInput } from './installments'

describe('addMonthsISO', () => {
  it('soma meses simples e vira o ano', () => {
    expect(addMonthsISO('2026-11-10', 1)).toBe('2026-12-10')
    expect(addMonthsISO('2026-11-10', 2)).toBe('2027-01-10')
    expect(addMonthsISO('2026-01-15', 0)).toBe('2026-01-15')
    expect(addMonthsISO('2026-01-15', 24)).toBe('2028-01-15')
  })
  it('limita ao último dia do mês como o Postgres', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsISO('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsISO('2026-01-31', 2)).toBe('2026-03-31')
    expect(addMonthsISO('2026-08-31', 1)).toBe('2026-09-30')
  })
})

describe('computeInstallments', () => {
  it('divide em parcelas iguais quando exato', () => {
    const r = computeInstallments(3000, 3, '2026-12-05')
    expect(r).toEqual([
      { number: 1, due_date: '2026-12-05', amount: 1000 },
      { number: 2, due_date: '2027-01-05', amount: 1000 },
      { number: 3, due_date: '2027-02-05', amount: 1000 },
    ])
  })
  it('trunca em 2 casas e a última absorve o resto', () => {
    const r = computeInstallments(1000, 3, '2026-12-01')
    expect(r.map((i) => i.amount)).toEqual([333.33, 333.33, 333.34])
    const r2 = computeInstallments(100, 7, '2026-12-01')
    expect(r2.slice(0, 6).every((i) => i.amount === 14.28)).toBe(true)
    expect(r2[6].amount).toBe(14.32)
  })
  it('soma das parcelas é igual ao total (centavos)', () => {
    for (const [total, n] of [
      [1234.57, 11],
      [99999.99, 120],
      [0.1, 1],
      [10.01, 3],
    ] as const) {
      const r = computeInstallments(total, n, '2026-01-31')
      const sumCents = r.reduce((s, i) => s + Math.round(i.amount * 100), 0)
      expect(sumCents).toBe(Math.round(total * 100))
      expect(r).toHaveLength(n)
    }
  })
  it('vencimentos sempre a partir do 1º (31 → 28/02 → 31/03)', () => {
    const r = computeInstallments(300, 3, '2026-01-31')
    expect(r.map((i) => i.due_date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })
  it('entrada inválida → lista vazia', () => {
    expect(computeInstallments(0, 1, '2026-01-01')).toEqual([])
    expect(computeInstallments(NaN, 1, '2026-01-01')).toEqual([])
    expect(computeInstallments(100, 0, '2026-01-01')).toEqual([])
    expect(computeInstallments(100, 121, '2026-01-01')).toEqual([])
    expect(computeInstallments(100, 1.5, '2026-01-01')).toEqual([])
    expect(computeInstallments(100, 2, '')).toEqual([])
    expect(computeInstallments(0.05, 10, '2026-01-01')).toEqual([]) // parcela de R$ 0,00
  })
})

describe('parseMoneyInput', () => {
  it('entende formatos brasileiros', () => {
    expect(parseMoneyInput('1.234,56')).toBe(1234.56)
    expect(parseMoneyInput('R$ 1.500,00')).toBe(1500)
    expect(parseMoneyInput('1500')).toBe(1500)
    expect(parseMoneyInput('1500,5')).toBe(1500.5)
    expect(parseMoneyInput('1.500')).toBe(1500)
    expect(parseMoneyInput('12.345.678')).toBe(12345678)
    expect(parseMoneyInput('1234.56')).toBe(1234.56)
  })
  it('inválido → NaN', () => {
    expect(parseMoneyInput('')).toBeNaN()
    expect(parseMoneyInput('abc')).toBeNaN()
  })
  it('formata para edição', () => {
    expect(formatMoneyInput(1234.5)).toBe('1.234,50')
  })
})

describe('nextOpenInstallment', () => {
  it('escolhe a primeira parcela com saldo', () => {
    const list = [
      { number: 2, remaining_amount: '100.00', status: 'a_vencer' },
      { number: 1, remaining_amount: 0, status: 'paga' },
      { number: 3, remaining_amount: 100, status: 'a_vencer' },
    ]
    expect(nextOpenInstallment(list)?.number).toBe(2)
    expect(nextOpenInstallment([{ number: 1, remaining_amount: 0, status: 'paga' }])).toBeUndefined()
  })
})
