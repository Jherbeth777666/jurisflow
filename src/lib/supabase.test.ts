import { describe, expect, it, vi } from 'vitest'
import * as supabaseModule from './supabase'
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

describe('isAccessDeniedError (1.5)', () => {
  function check(err: unknown): boolean {
    const fn = (supabaseModule as unknown as { isAccessDeniedError?: (e: unknown) => boolean }).isAccessDeniedError
    expect(fn, 'isAccessDeniedError deve ser exportada por src/lib/supabase.ts').toBeTypeOf('function')
    return fn!(err)
  }

  it('reconhece os códigos 42501 e PGRST301', () => {
    expect(check({ code: '42501', message: 'new row violates row-level security policy' })).toBe(true)
    expect(check({ code: 'PGRST301', message: 'JWT expired' })).toBe(true)
  })

  it('reconhece as mensagens amigáveis de permissão e de escritório', () => {
    expect(check(new Error('Você não tem permissão para realizar esta ação.'))).toBe(true)
    expect(check({ message: 'Sem acesso a este escritório.' })).toBe(true)
  })

  it('não trata outros erros (rede, validação, registro ausente) como acesso negado', () => {
    expect(check(null)).toBe(false)
    expect(check(undefined)).toBe(false)
    expect(check({ message: 'Failed to fetch' })).toBe(false)
    expect(check({ code: '23505', message: 'duplicate key value violates unique constraint' })).toBe(false)
    expect(check({ code: 'PGRST116', message: 'Registro não encontrado.' })).toBe(false)
    expect(check(new Error('E-mail ou senha incorretos.'))).toBe(false)
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
