// Regras puras de contratos/parcelas — espelham public.generate_installments (migration 002).
import { parseCurrency } from '@/lib/format'

export interface InstallmentPreview {
  number: number
  due_date: string // 'YYYY-MM-DD'
  amount: number
}

/** Soma `months` meses a uma data ISO, limitando ao último dia do mês (igual ao Postgres: 31/01 + 1 mês = 28/02). */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12 // 0..11
  const lastDay = new Date(ny, nm + 1, 0).getDate()
  const nd = Math.min(d, lastDay)
  return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(nd).padStart(2, '0')}`
}

/**
 * Calcula as parcelas exatamente como o banco:
 * - base = trunc(total / n, 2) (truncado em 2 casas)
 * - a última parcela absorve a diferença
 * - vencimentos mensais a partir do 1º vencimento (sempre calculados a partir dele)
 * Trabalha em centavos para evitar erros de ponto flutuante.
 */
export function computeInstallments(total: number, count: number, firstDueDate: string): InstallmentPreview[] {
  if (!Number.isFinite(total) || total <= 0) return []
  if (!Number.isInteger(count) || count < 1 || count > 120) return []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) return []
  const totalCents = Math.round(total * 100)
  const baseCents = Math.floor(totalCents / count)
  if (baseCents <= 0) return [] // parcela de 0,00 seria rejeitada pelo banco (amount > 0)
  const lastCents = totalCents - baseCents * (count - 1)
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    due_date: addMonthsISO(firstDueDate, i),
    amount: (i === count - 1 ? lastCents : baseCents) / 100,
  }))
}

/**
 * Lê um valor monetário digitado em pt-BR. Aceita "1.234,56", "1234,5", "1234.56", "R$ 10".
 * Trata "1.234" / "12.345.678" (sem vírgula) como separador de milhar, como um brasileiro escreveria.
 * Retorna NaN se inválido; arredonda para centavos.
 */
export function parseMoneyInput(input: string): number {
  const t = input.trim().replace(/^R\$\s*/i, '')
  if (!t) return NaN
  const thousandsOnly = /^\d{1,3}(\.\d{3})+$/.test(t)
  const n = thousandsOnly ? Number(t.replace(/\./g, '')) : parseCurrency(t)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n * 100) / 100
}

/** Formata número para o campo de edição ("1.234,56", sem símbolo). */
export function formatMoneyInput(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Primeira parcela com saldo em aberto (padrão do modal de pagamento). */
export function nextOpenInstallment<T extends { number: number; remaining_amount: number | string; status: string }>(
  list: T[],
): T | undefined {
  return [...list]
    .sort((a, b) => a.number - b.number)
    .find((i) => Number(i.remaining_amount) > 0 && i.status !== 'cancelada' && i.status !== 'paga')
}
