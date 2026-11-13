import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cada insert consome a próxima resposta da fila.
let responses: { error: unknown }[] = []
const insert = vi.fn(async () => responses.shift() ?? { error: null })

vi.mock('@/lib/supabase', async (orig) => ({
  ...(await orig<typeof import('@/lib/supabase')>()),
  supabase: { from: () => ({ insert }) },
}))

const { insertWithFallback } = await import('./api')

const rows = [{ id: '1' }, { id: '2' }, { id: '3' }]

beforeEach(() => {
  insert.mockClear()
  responses = []
})

describe('insertWithFallback', () => {
  it('lote ok: uma requisição só', async () => {
    const onErr = vi.fn()
    const ok = await insertWithFallback('clients', rows, onErr)
    expect([...ok]).toEqual(['1', '2', '3'])
    expect(insert).toHaveBeenCalledTimes(1)
    expect(onErr).not.toHaveBeenCalled()
  })

  it('erro de constraint: isola linha a linha e aponta só a culpada', async () => {
    responses = [{ error: { code: '23505', message: 'cpf' } }, { error: null }, { error: { code: '23505', message: 'cpf' } }, { error: null }]
    const onErr = vi.fn()
    const ok = await insertWithFallback('clients', rows, onErr)
    expect([...ok]).toEqual(['1', '3'])
    expect(insert).toHaveBeenCalledTimes(4)
    expect(onErr).toHaveBeenCalledTimes(1)
    expect(onErr.mock.calls[0][0]).toEqual({ id: '2' })
  })

  it('erro de rede ou permissão: não repete linha a linha e marca o lote inteiro', async () => {
    responses = [{ error: { message: 'Failed to fetch' } }]
    const onErr = vi.fn()
    const ok = await insertWithFallback('clients', rows, onErr)
    expect(ok.size).toBe(0)
    expect(insert).toHaveBeenCalledTimes(1)
    expect(onErr).toHaveBeenCalledTimes(3)
    expect(onErr.mock.calls[0][1]).toContain('conectar')
  })
})
