import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useSelection } from './useSelection'

// L13 — seleção múltipla de demandas/tarefas.
// O argumento é a chave dos filtros atuais: quando ela muda (ex.: URL nova),
// a seleção é descartada para não agir em itens que saíram da tela.
// Contas à mão:
//   * 2 toggles em ids distintos → count = 2;
//   * toggleAll com 3 ids → count = 3;
//   * clear → count = 0.

describe('useSelection', () => {
  it('adiciona e remove itens com toggle', () => {
    const { result } = renderHook(() => useSelection('filtros:iniciais'))

    expect(result.current.count).toBe(0)
    expect(result.current.has('d1')).toBe(false)

    act(() => result.current.toggle('d1'))
    act(() => result.current.toggle('d2'))

    // 1 + 1 = 2 itens selecionados.
    expect(result.current.count).toBe(2)
    expect(result.current.has('d1')).toBe(true)
    expect(result.current.has('d2')).toBe(true)

    act(() => result.current.toggle('d1'))

    // 2 - 1 = 1 item restante.
    expect(result.current.count).toBe(1)
    expect(result.current.has('d1')).toBe(false)
    expect(result.current.has('d2')).toBe(true)
  })

  it('toggleAll seleciona todos os ids informados e clear esvazia', () => {
    const { result } = renderHook(() => useSelection('filtros:iniciais'))

    act(() => result.current.toggleAll(['d1', 'd2', 'd3']))
    // 3 ids informados → 3 selecionados.
    expect(result.current.count).toBe(3)
    expect(result.current.has('d3')).toBe(true)

    act(() => result.current.clear())
    expect(result.current.count).toBe(0)
    expect(result.current.has('d3')).toBe(false)
  })

  it('limpa a seleção quando os filtros mudam', () => {
    const { result, rerender } = renderHook(({ key }: { key: string }) => useSelection(key), {
      initialProps: { key: 'aba=minhas' },
    })

    act(() => result.current.toggleAll(['d1', 'd2']))
    expect(result.current.count).toBe(2)

    rerender({ key: 'aba=todas' })

    expect(result.current.count).toBe(0)
    expect(result.current.has('d1')).toBe(false)
  })

  it('mantém a seleção quando a chave de filtros não muda', () => {
    const { result, rerender } = renderHook(({ key }: { key: string }) => useSelection(key), {
      initialProps: { key: 'aba=minhas' },
    })

    act(() => result.current.toggle('d1'))
    rerender({ key: 'aba=minhas' })

    expect(result.current.count).toBe(1)
    expect(result.current.has('d1')).toBe(true)
  })
})
