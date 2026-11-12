import { beforeEach, describe, expect, it, vi } from 'vitest'

// Builder encadeável do supabase-js: registra as chamadas e resolve com `result`.
const calls: [string, unknown[]][] = []
let result: { data: unknown; error: unknown } = { data: null, error: null }
const builder: Record<string, unknown> = {}
for (const m of ['from', 'select', 'eq', 'order', 'limit', 'delete', 'update', 'single']) {
  builder[m] = (...args: unknown[]) => {
    calls.push([m, args])
    return builder
  }
}
builder.then = (resolve: (v: unknown) => unknown) => resolve(result)

vi.mock('@/lib/supabase', async (orig) => ({
  ...(await orig<typeof import('@/lib/supabase')>()),
  supabase: { from: (...a: unknown[]) => (builder.from as (...x: unknown[]) => unknown)(...a) },
}))

const { listMessages, deleteConversation, MESSAGES_LIMIT } = await import('./api')

beforeEach(() => {
  calls.length = 0
  result = { data: null, error: null }
})

describe('listMessages', () => {
  it('busca as mais recentes e devolve em ordem cronológica', async () => {
    result = {
      data: [
        { id: 'c', role: 'assistant', created_at: '2026-11-10T10:02:00Z' },
        { id: 'b', role: 'user', created_at: '2026-11-10T10:02:00Z' },
        { id: 'a', role: 'assistant', created_at: '2026-11-10T10:01:00Z' },
      ],
      error: null,
    }
    const rows = await listMessages('org', 'conv')
    // ordem cronológica; no empate de horário, a pergunta (user) antes da resposta
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(calls).toContainEqual(['select', ['id, role, content, tools_used, created_at, proposals']])
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]])
    expect(calls).toContainEqual(['limit', [MESSAGES_LIMIT]])
  })
})

describe('deleteConversation', () => {
  it('confirma a exclusão pedindo as linhas afetadas', async () => {
    result = { data: [{ id: 'x' }], error: null }
    await expect(deleteConversation('org', 'x')).resolves.toBeUndefined()
    expect(calls).toContainEqual(['select', ['id']])
  })

  it('falha quando nenhuma linha foi excluída (RLS ou inexistente)', async () => {
    result = { data: [], error: null }
    await expect(deleteConversation('org', 'x')).rejects.toThrow('sem permissão')
  })
})
