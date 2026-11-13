import { describe, expect, it } from 'vitest'
import { parseTaskFilters, serializeTaskFilters } from './taskFilters'

// L13 — filtros de tarefas passam a morar na URL (como os de Demandas).
// Padrões da tela: aba "Minhas" e status "abertas" (por isso são omitidos na URL).
// Contas à mão usadas nos testes:
//   * 1 conjunto com 7 filtros não padrão → 7 pares chave=valor serializados;
//   * 2 filtros inválidos (aba/prio) + 2 válidos (resp/q) → só os 2 válidos ficam.

const toMap = (params: URLSearchParams) => Object.fromEntries(params.entries())

describe('parseTaskFilters / serializeTaskFilters', () => {
  it('omite os valores padrão: URL vazia continua vazia', () => {
    const filters = parseTaskFilters(new URLSearchParams())
    expect(serializeTaskFilters(filters).toString()).toBe('')
  })

  it('lê e devolve os 7 filtros não padrão da URL', () => {
    const url = new URLSearchParams(
      'aba=todas&resp=user-2&prio=urgente&status=concluida&q=Maria&filter=week&agrupar=pessoa',
    )

    const serialized = serializeTaskFilters(parseTaskFilters(url))

    expect(toMap(serialized)).toEqual({
      aba: 'todas',
      resp: 'user-2',
      prio: 'urgente',
      status: 'concluida',
      q: 'Maria',
      filter: 'week',
      agrupar: 'pessoa',
    })
  })

  it('ida e volta estável: parse → serialize → parse → serialize não muda', () => {
    const inputs = [
      '',
      'aba=todas',
      'aba=todas&resp=none&prio=alta&status=pendente&q=contrato&filter=overdue&agrupar=pessoa',
    ]

    for (const input of inputs) {
      const once = serializeTaskFilters(parseTaskFilters(new URLSearchParams(input))).toString()
      const twice = serializeTaskFilters(parseTaskFilters(new URLSearchParams(once))).toString()
      expect(twice).toBe(once)
    }
  })

  it('descarta aba/prioridade/status inválidos e mantém os filtros válidos', () => {
    const url = new URLSearchParams('aba=outra&prio=extrema&resp=user-2&q=Maria')

    const serialized = serializeTaskFilters(parseTaskFilters(url))

    // 2 válidos sobram; aba inválida volta ao padrão (Minhas) e prio inválida some.
    expect(toMap(serialized)).toEqual({ resp: 'user-2', q: 'Maria' })
  })

  it('preserva o sentinela resp=none (sem responsável)', () => {
    const serialized = serializeTaskFilters(parseTaskFilters(new URLSearchParams('aba=todas&resp=none')))
    expect(toMap(serialized)).toEqual({ aba: 'todas', resp: 'none' })
  })
})
