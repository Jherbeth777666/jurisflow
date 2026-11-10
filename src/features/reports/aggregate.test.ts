import {
  completionTimeByCategory,
  csvDate,
  demandsByGroup,
  overdueSummary,
  periodBounds,
  receivedByMethod,
  resolvePeriod,
  slugify,
  tasksDoneByPerson,
  toCSV,
  type DemandLite,
} from './aggregate'

const TODAY = '2026-11-09'

describe('resolvePeriod', () => {
  it('presets', () => {
    expect(resolvePeriod('this_month', TODAY)).toEqual({ from: '2026-11-01', to: TODAY })
    expect(resolvePeriod('last_month', TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(resolvePeriod('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(resolvePeriod('last_90', TODAY)).toEqual({ from: '2026-08-12', to: TODAY })
    expect(resolvePeriod('this_year', TODAY)).toEqual({ from: '2026-01-01', to: TODAY })
  })
  it('personalizado inverte datas trocadas e usa padrão', () => {
    expect(resolvePeriod('custom', TODAY, { from: '2026-05-10', to: '2026-03-01' })).toEqual({ from: '2026-03-01', to: '2026-05-10' })
    expect(resolvePeriod('custom', TODAY, {})).toEqual({ from: '2026-11-01', to: TODAY })
  })
  it('limites de timestamp cobrem o último dia inteiro', () => {
    const b = periodBounds({ from: '2026-11-01', to: '2026-11-09' })
    expect(new Date(b.end).getTime() - new Date(b.start).getTime()).toBe(9 * 86_400_000)
  })
})

const P = { from: '2026-11-01', to: '2026-11-30' }
const demands: DemandLite[] = [
  { id: '1', category_id: 'a', responsible_id: 'u1', opened_at: '2026-11-02', closed_at: null, status: 'em_andamento' },
  { id: '2', category_id: 'a', responsible_id: 'u1', opened_at: '2026-10-01', closed_at: '2026-11-05T15:00:00Z', status: 'concluida' },
  { id: '3', category_id: 'b', responsible_id: null, opened_at: '2026-11-03', closed_at: '2026-11-13T15:00:00Z', status: 'concluida' },
  { id: '4', category_id: 'b', responsible_id: 'u2', opened_at: '2026-09-01', closed_at: '2026-09-10T15:00:00Z', status: 'concluida' },
  { id: '5', category_id: 'a', responsible_id: 'u2', opened_at: '2026-11-04', closed_at: '2026-11-06T15:00:00Z', status: 'cancelada' },
]

describe('demandas', () => {
  it('abertas/concluídas por categoria no período (ignora canceladas como concluídas)', () => {
    const r = demandsByGroup(demands, P, (d) => d.category_id, (k) => ({ label: k.toUpperCase() }))
    const a = r.find((x) => x.key === 'a')!
    const b = r.find((x) => x.key === 'b')!
    expect(a).toMatchObject({ opened: 2, closed: 1 })
    expect(b).toMatchObject({ opened: 1, closed: 1 })
    expect(r).toHaveLength(2)
  })
  it('por responsável, com "sem responsável"', () => {
    const r = demandsByGroup(demands, P, (d) => d.responsible_id ?? '', (k) => ({ label: k || 'Sem responsável' }))
    expect(r.find((x) => x.key === '')).toMatchObject({ label: 'Sem responsável', opened: 1, closed: 1 })
    expect(r.find((x) => x.key === 'u1')).toMatchObject({ opened: 1, closed: 1 })
  })
  it('tempo médio de conclusão por categoria', () => {
    const { rows, overall } = completionTimeByCategory(demands, P, (k) => ({ label: k }))
    expect(rows.find((r) => r.key === 'a')).toMatchObject({ count: 1, avgDays: 35, minDays: 35, maxDays: 35 })
    expect(rows.find((r) => r.key === 'b')).toMatchObject({ count: 1, avgDays: 10 })
    expect(overall).toEqual({ count: 2, avgDays: 22.5 })
  })
  it('sem dados → média zero', () => {
    expect(completionTimeByCategory([], P, (k) => ({ label: k })).overall).toEqual({ count: 0, avgDays: 0 })
  })
})

describe('tarefas por pessoa', () => {
  it('separa no prazo, atrasadas e sem prazo', () => {
    const r = tasksDoneByPerson(
      [
        { assignee_id: 'u1', due_date: '2026-11-10', completed_at: '2026-11-05T15:00:00Z' },
        { assignee_id: 'u1', due_date: '2026-11-01', completed_at: '2026-11-05T15:00:00Z' },
        { assignee_id: 'u1', due_date: null, completed_at: '2026-11-05T15:00:00Z' },
        { assignee_id: null, due_date: null, completed_at: '2026-11-05T15:00:00Z' },
        { assignee_id: 'u2', due_date: null, completed_at: '2026-10-05T15:00:00Z' }, // fora do período
        { assignee_id: 'u2', due_date: null, completed_at: null },
      ],
      P,
      (id) => `Pessoa ${id}`,
    )
    expect(r).toEqual([
      { key: 'u1', label: 'Pessoa u1', done: 3, onTime: 1, late: 1, noDue: 1 },
      { key: '', label: 'Sem responsável', done: 1, onTime: 0, late: 0, noDue: 1 },
    ])
  })
})

describe('financeiro', () => {
  it('recebido por forma de pagamento', () => {
    const r = receivedByMethod(
      [
        { amount: '100.10', method: 'pix', paid_at: '2026-11-02' },
        { amount: 200.2, method: 'pix', paid_at: '2026-11-03' },
        { amount: 100, method: 'boleto', paid_at: '2026-11-03' },
        { amount: 999, method: 'boleto', paid_at: '2026-10-31' },
      ],
      P,
    )
    expect(r.total).toBe(400.3)
    expect(r.count).toBe(3)
    expect(r.rows[0]).toMatchObject({ method: 'pix', count: 2, total: 300.3 })
    expect(r.rows[1].share).toBeCloseTo(100 / 400.3)
  })
  it('inadimplência com faixas de atraso', () => {
    const s = overdueSummary(
      [
        { id: '1', contract_id: 'c1', client_id: 'k1', number: 1, due_date: '2026-11-01', remaining_amount: '100.00', status: 'vencida' },
        { id: '2', contract_id: 'c1', client_id: 'k1', number: 2, due_date: '2026-08-01', remaining_amount: 50.5, status: 'vencida' },
        { id: '3', contract_id: 'c2', client_id: 'k2', number: 1, due_date: '2026-10-01', remaining_amount: 10, status: 'vencida' },
        { id: '4', contract_id: 'c3', client_id: 'k3', number: 1, due_date: '2026-10-01', remaining_amount: 10, status: 'a_vencer' },
      ],
      TODAY,
    )
    expect(s.total).toBe(160.5)
    expect(s.count).toBe(3)
    expect(s.clients).toBe(2)
    expect(s.contracts).toBe(2)
    expect(s.buckets.map((b) => b.count)).toEqual([1, 1, 0, 1])
    expect(s.rows[0].id).toBe('2') // mais atrasada primeiro
  })
  it('vencida com vencimento hoje (fuso) entra na 1ª faixa: soma das faixas = total', () => {
    const s = overdueSummary(
      [{ id: '1', contract_id: 'c1', client_id: 'k1', number: 1, due_date: TODAY, remaining_amount: 30, status: 'vencida' }],
      TODAY,
    )
    expect(s.buckets[0]).toMatchObject({ count: 1, total: 30 })
    expect(s.buckets.reduce((a, b) => a + b.total, 0)).toBe(s.total)
  })
})

describe('CSV', () => {
  it('BOM, ponto e vírgula, decimais com vírgula e aspas', () => {
    const csv = toCSV(['Nome', 'Valor', 'Qtd'], [
      ['Ana; Silva', 1234.5, 3],
      ['Diz "oi"', null, 0],
      ['=SOMA(A1)', 10, 1],
    ])
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Nome;Valor;Qtd')
    expect(lines[1]).toBe('"Ana; Silva";1234,50;3')
    expect(lines[2]).toBe('"Diz ""oi""";;0')
    expect(lines[3]).toBe("'=SOMA(A1);10;1")
  })
  it('helpers', () => {
    expect(csvDate('2026-11-09')).toBe('09/11/2026')
    expect(csvDate(null)).toBe('')
    expect(slugify('Demandas por Responsável')).toBe('demandas-por-responsavel')
  })
})
