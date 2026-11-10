import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addDaysISO,
  diffInDays,
  escapeLike,
  formatCPF,
  formatCurrency,
  formatDate,
  formatMonthShort,
  formatPhone,
  initials,
  isValidCPF,
  isValidEmail,
  isValidPhone,
  maskCPF,
  onlyDigits,
  parseCurrency,
  parseISODate,
  toISODate,
} from './format'

// Datas são testadas em fusos "perigosos": UTC-3 (onde new Date('YYYY-MM-DD')
// mostra o dia anterior) e um fuso com horário de verão.
// process.env sem depender de @types/node no tsconfig da aplicação
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
const originalTZ = env.TZ
beforeAll(() => {
  env.TZ = 'America/Sao_Paulo'
})
afterAll(() => {
  env.TZ = originalTZ
})

describe('CPF', () => {
  it('aceita CPFs válidos, com ou sem máscara', () => {
    expect(isValidCPF('52998224725')).toBe(true)
    expect(isValidCPF('529.982.247-25')).toBe(true)
    expect(isValidCPF('111.444.777-35')).toBe(true)
    expect(isValidCPF('39053344705')).toBe(true)
  })

  it('recusa dígitos verificadores errados', () => {
    expect(isValidCPF('52998224724')).toBe(false)
    expect(isValidCPF('52998224715')).toBe(false)
    expect(isValidCPF('111.444.777-36')).toBe(false)
  })

  it('recusa sequências repetidas (que passam no cálculo)', () => {
    for (let d = 0; d <= 9; d++) expect(isValidCPF(String(d).repeat(11))).toBe(false)
  })

  it('recusa tamanhos inválidos e vazio', () => {
    expect(isValidCPF('')).toBe(false)
    expect(isValidCPF('5299822472')).toBe(false)
    expect(isValidCPF('529982247250')).toBe(false)
    expect(isValidCPF('abc')).toBe(false)
  })

  it('formata progressivamente enquanto digita', () => {
    expect(formatCPF('529')).toBe('529')
    expect(formatCPF('5299')).toBe('529.9')
    expect(formatCPF('5299822')).toBe('529.982.2')
    expect(formatCPF('52998224725')).toBe('529.982.247-25')
    expect(formatCPF('529.982.247-25999')).toBe('529.982.247-25') // corta excesso
    expect(formatCPF(null)).toBe('')
  })

  it('mascara para listagens sem expor início e dígitos verificadores', () => {
    expect(maskCPF('52998224725')).toBe('***.982.247-**')
    expect(maskCPF('529.982.247-25')).toBe('***.982.247-**')
    expect(maskCPF('123')).toBe('—')
    expect(maskCPF(null)).toBe('—')
  })
})

describe('telefone, e-mail e utilitários', () => {
  it('formata celular e fixo', () => {
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321')
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444')
    expect(formatPhone('(11) 98765-4321')).toBe('(11) 98765-4321')
    expect(formatPhone('11')).toBe('11')
    expect(formatPhone(undefined)).toBe('')
  })

  it('valida telefone por quantidade de dígitos (10 a 13)', () => {
    expect(isValidPhone('(11) 98765-4321')).toBe(true)
    expect(isValidPhone('1133334444')).toBe(true)
    expect(isValidPhone('5511987654321')).toBe(true)
    expect(isValidPhone('987654321')).toBe(false)
    expect(isValidPhone('55119876543210')).toBe(false)
  })

  it('valida e-mail', () => {
    expect(isValidEmail('ana@escritorio.com.br')).toBe(true)
    expect(isValidEmail('  ana@escritorio.com  ')).toBe(true)
    expect(isValidEmail('ana@escritorio')).toBe(false)
    expect(isValidEmail('ana escritorio.com')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })

  it('onlyDigits, initials e escapeLike', () => {
    expect(onlyDigits('529.982.247-25')).toBe('52998224725')
    expect(onlyDigits(null)).toBe('')
    expect(initials('Maria da Silva Souza')).toBe('MS')
    expect(initials('ana')).toBe('A')
    expect(initials('  ')).toBe('?')
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b')
    expect(escapeLike('a,b(c)')).toBe('a b c ')
  })
})

describe('moeda', () => {
  it('formata em reais', () => {
    expect(formatCurrency(1234.5)).toMatch(/^R\$\s1\.234,50$/)
    expect(formatCurrency('1000')).toMatch(/^R\$\s1\.000,00$/)
    expect(formatCurrency(0)).toMatch(/^R\$\s0,00$/)
    expect(formatCurrency(null)).toMatch(/^R\$\s0,00$/)
    expect(formatCurrency('abc')).toMatch(/^R\$\s0,00$/)
  })

  it('parseCurrency entende formatos brasileiros com vírgula decimal', () => {
    expect(parseCurrency('1.234,56')).toBe(1234.56)
    expect(parseCurrency('R$ 1.234,56')).toBe(1234.56)
    expect(parseCurrency('R$ 1.234.567,89')).toBe(1234567.89)
    expect(parseCurrency('0,5')).toBe(0.5)
    expect(parseCurrency('10,00')).toBe(10)
    expect(parseCurrency('-10,5')).toBe(-10.5)
  })

  it('parseCurrency aceita números simples e ponto decimal', () => {
    expect(parseCurrency('10')).toBe(10)
    expect(parseCurrency('R$ 10')).toBe(10)
    expect(parseCurrency('1234.56')).toBe(1234.56)
  })

  it('parseCurrency devolve NaN para entradas inválidas', () => {
    expect(parseCurrency('')).toBeNaN()
    expect(parseCurrency('abc')).toBeNaN()
    expect(parseCurrency('R$')).toBeNaN()
    expect(parseCurrency('1,2,3')).toBeNaN()
  })

  // Ambiguidade conhecida: "1.500" sem vírgula hoje vira 1,5 (ponto tratado como
  // decimal). Para um usuário brasileiro significa mil e quinhentos.
  it('parseCurrency("1.500") trata o ponto como separador de milhar', () => {
    expect(parseCurrency('1.500')).toBe(1500)
    expect(parseCurrency('R$ 12.345.678')).toBe(12345678)
    expect(parseCurrency('1.5')).toBe(1.5)
  })
})

describe('datas ISO sem bug de fuso', () => {
  it('parseISODate cria a data local (não UTC)', () => {
    const d = parseISODate('2026-01-01')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(1)
    // a armadilha que a função evita:
    expect(new Date('2026-01-01').getDate()).toBe(31)
  })

  it('formatDate mostra o mesmo dia em UTC-3', () => {
    expect(formatDate('2026-01-01')).toBe('01/01/2026')
    expect(formatDate('2026-11-09')).toBe('09/11/2026')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('')).toBe('—')
  })

  it('toISODate usa a data local', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toISODate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it('addDaysISO atravessa meses, anos e bissextos', () => {
    expect(addDaysISO('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysISO('2026-11-09', 0)).toBe('2026-11-09')
    expect(addDaysISO('2026-11-09', 30)).toBe('2026-12-09')
  })

  it('diffInDays conta dias inteiros (b - a)', () => {
    expect(diffInDays('2026-03-01', '2026-03-31')).toBe(30)
    expect(diffInDays('2026-03-31', '2026-03-01')).toBe(-30)
    expect(diffInDays('2026-11-09', '2026-11-09')).toBe(0)
    expect(diffInDays('2026-12-31', '2027-01-01')).toBe(1)
    expect(diffInDays('2028-02-01', '2028-03-01')).toBe(29)
    expect(diffInDays('2026-11-09T10:00:00Z', '2026-11-10')).toBe(1) // ignora a hora
  })

  it('diffInDays e addDaysISO não erram em virada de horário de verão', () => {
    env.TZ = 'America/New_York' // DST começa em 08/03/2026 (dia de 23h)
    try {
      expect(diffInDays('2026-03-07', '2026-03-09')).toBe(2)
      expect(diffInDays('2026-10-31', '2026-11-02')).toBe(2) // termina em 01/11 (dia de 25h)
      expect(addDaysISO('2026-03-07', 1)).toBe('2026-03-08')
      expect(addDaysISO('2026-03-08', 1)).toBe('2026-03-09')
      expect(addDaysISO('2026-11-01', 1)).toBe('2026-11-02')
    } finally {
      env.TZ = 'America/Sao_Paulo'
    }
  })

  it('formatMonthShort', () => {
    expect(formatMonthShort('2026-11')).toBe('nov/26')
    expect(formatMonthShort('2027-01')).toBe('jan/27')
  })
})
