import { describe, expect, it, vi } from 'vitest'
import { fetchAllRows, isRowConstraintError, PAGE_SIZE } from './supabase'

describe('fetchAllRows', () => {
  it('pagina até receber uma página incompleta', async () => {
    const total = PAGE_SIZE * 2 + 5
    const build = vi.fn(async (from: number, to: number) => ({
      data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i),
      error: null,
    }))
    const rows = await fetchAllRows<number>(build)
    expect(rows).toHaveLength(total)
    expect(rows[total - 1]).toBe(total - 1)
    expect(build).toHaveBeenCalledTimes(3)
    expect(build).toHaveBeenNthCalledWith(2, PAGE_SIZE, PAGE_SIZE * 2 - 1)
  })

  it('faz uma requisição a mais quando o total é múltiplo exato da página', async () => {
    const build = vi.fn(async (from: number) => ({ data: from === 0 ? Array(PAGE_SIZE).fill(1) : [], error: null }))
    expect(await fetchAllRows(build)).toHaveLength(PAGE_SIZE)
    expect(build).toHaveBeenCalledTimes(2)
  })

  it('propaga erro em qualquer página', async () => {
    const build = async (from: number) =>
      from === 0 ? { data: Array(PAGE_SIZE).fill(1), error: null } : { data: null, error: { code: '42501', message: 'x' } }
    await expect(fetchAllRows(build)).rejects.toThrow('permissão')
  })
})

describe('isRowConstraintError', () => {
  it('reconhece erros de integridade (classe 23)', () => {
    for (const code of ['23505', '23503', '23514', '23502', '22007', '22P02', 'P0001']) expect(isRowConstraintError({ code })).toBe(true)
  })
  it('não trata rede, permissão ou erro sem código como erro de linha', () => {
    expect(isRowConstraintError({ code: '42501' })).toBe(false)
    expect(isRowConstraintError({ code: 'PGRST301' })).toBe(false)
    expect(isRowConstraintError({ message: 'Failed to fetch' })).toBe(false)
    expect(isRowConstraintError(null)).toBe(false)
  })
})
