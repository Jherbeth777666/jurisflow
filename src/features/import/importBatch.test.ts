import { beforeEach, describe, expect, it, vi } from 'vitest'

// L14 — runImport cria o lote antes, marca clientes/demandas com import_batch_id e
// registra previous/applied de cada cliente atualizado.
type Call = { table: string; op: 'insert' | 'update'; payload: unknown; eqs: [string, unknown][] }
const state = vi.hoisted(() => ({ calls: [] as Call[], batchError: false }))

vi.mock('@/lib/supabase', async (orig) => {
  const real = await orig<typeof import('@/lib/supabase')>()
  function result(table: string, op: 'insert' | 'update', payload: unknown) {
    const call: Call = { table, op, payload, eqs: [] }
    state.calls.push(call)
    const failed = state.batchError && table === 'import_batches' && op === 'insert'
    // data serve tanto para `.single()` ({ id }) quanto para `.select()` ([{ id }])
    const data = table === 'import_batches' && op === 'insert' ? Object.assign([{ id: 'batch-1' }], { id: 'batch-1' }) : null
    const res = { data: failed ? null : data, error: failed ? { message: 'falhou ao criar lote' } : null }
    const chain: Record<string, unknown> = {
      select: () => chain,
      single: () => chain,
      maybeSingle: () => chain,
      eq: (c: string, v: unknown) => {
        call.eqs.push([c, v])
        return chain
      },
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ko),
    }
    return chain
  }
  return {
    ...real,
    supabase: {
      from: (table: string) => ({
        insert: (payload: unknown) => result(table, 'insert', payload),
        update: (payload: unknown) => result(table, 'update', payload),
      }),
    },
  }
})

const { runImport } = await import('./api')
const { classifyRows, draftsFromTable } = await import('./rows')

const TODAY = '2026-11-09'
const existingList = [
  { id: 'c1', full_name: 'Maria da Silva', cpf: '52998224725', phone: null, birth_date: null, email: null, address: 'Rua A' },
  { id: 'c2', full_name: 'Joao Souza', cpf: '11144477735', phone: '11911112222', birth_date: null, email: null, address: null },
]
const existing = new Map(existingList.map((c) => [c.id, c]))
const rows = classifyRows(
  draftsFromTable(
    [
      ['Maria da Silva', '529.982.247-25', '(11) 98765-4321', ''],
      ['Joao Souza', '111.444.777-35', '(11) 98888-7777', ''],
      ['Pedro Novo', '', '11 3333-4444', 'Aposentadoria'],
    ],
    { full_name: 0, cpf: 1, phone: 2, category: 3 },
    2,
  ),
  existingList,
  TODAY,
)

const ctx = () => ({ orgId: 'org-1', userId: 'u1', existing, ignored: 0, onProgress: () => {}, fileName: 'clientes-novembro.xlsx' })
const plan = () => [
  { row: rows[0], action: 'atualizar' as const, categoryId: null, categoryName: null },
  { row: rows[1], action: 'atualizar' as const, mode: 'substituir' as const, categoryId: null, categoryName: null },
  { row: rows[2], action: 'criar' as const, categoryId: 'cat-1', categoryName: 'Aposentadoria' },
]

const of = (table: string, op: Call['op']) => state.calls.filter((c) => c.table === table && c.op === op)
const asList = (p: unknown) => (Array.isArray(p) ? p : [p]) as Record<string, unknown>[]
const batchIdSent = () => (asList(state.calls[0].payload)[0].id as string | undefined) ?? 'batch-1'

beforeEach(() => {
  state.calls = []
  state.batchError = false
})

describe('runImport com lote', () => {
  it('as linhas do teste foram classificadas como esperado', () => {
    expect(rows.map((r) => r.status)).toEqual(['atualizar', 'atualizar', 'novo'])
    expect(rows[1].match?.reason).toBe('cpf')
  })

  it('cria o lote antes de qualquer outra gravação, com organização e nome do arquivo', async () => {
    await runImport(plan(), ctx())
    expect(state.calls[0].table).toBe('import_batches')
    expect(state.calls[0].op).toBe('insert')
    expect(asList(state.calls[0].payload)[0]).toMatchObject({ organization_id: 'org-1', file_name: 'clientes-novembro.xlsx' })
  })

  it('grava import_batch_id nos clientes e nas demandas criados', async () => {
    const rep = await runImport(plan(), ctx())
    expect(rep.created).toBe(1)
    expect(rep.demands).toBe(1)
    const clients = of('clients', 'insert').flatMap((c) => asList(c.payload))
    const demands = of('demands', 'insert').flatMap((c) => asList(c.payload))
    expect(clients).toHaveLength(1)
    expect(demands).toHaveLength(1)
    expect(clients[0]).toMatchObject({ full_name: 'Pedro Novo', import_batch_id: batchIdSent() })
    expect(demands[0]).toMatchObject({ category_id: 'cat-1', import_batch_id: batchIdSent() })
  })

  it('registra previous/applied de cada cliente atualizado (completar e substituir)', async () => {
    const rep = await runImport(plan(), ctx())
    expect(rep.updated).toBe(2)
    const log = of('import_batch_updates', 'insert').flatMap((c) => asList(c.payload))
    expect(log).toHaveLength(2)
    const byClient = Object.fromEntries(log.map((l) => [l.client_id as string, l]))
    expect(byClient.c1).toMatchObject({
      organization_id: 'org-1',
      batch_id: batchIdSent(),
      previous: { phone: null },
      applied: { phone: '11987654321' },
    })
    expect(byClient.c2).toMatchObject({
      organization_id: 'org-1',
      batch_id: batchIdSent(),
      previous: { phone: '11911112222' },
      applied: { phone: '11988887777' },
    })
  })

  it('o update do cliente usa o patch do modo escolhido (substituir troca o valor)', async () => {
    await runImport(plan(), ctx())
    const patches = of('clients', 'update')
    const patchFor = (id: string) => patches.find((c) => c.eqs.some(([k, v]) => k === 'id' && v === id))?.payload
    expect(patchFor('c1')).toEqual({ phone: '11987654321' })
    expect(patchFor('c2')).toEqual({ phone: '11988887777' })
  })

  it('atualiza as contagens do lote no fim', async () => {
    await runImport(plan(), ctx())
    const updates = of('import_batches', 'update')
    expect(updates.length).toBeGreaterThan(0)
    expect(updates[updates.length - 1].payload).toMatchObject({ created_clients: 1, updated_clients: 2, created_demands: 1 })
    expect(state.calls[state.calls.length - 1].table).toBe('import_batches')
  })

  it('se criar o lote falhar, a importação não começa', async () => {
    state.batchError = true
    await expect(runImport(plan(), ctx())).rejects.toThrow()
    expect(of('clients', 'insert')).toHaveLength(0)
    expect(of('clients', 'update')).toHaveLength(0)
    expect(of('demands', 'insert')).toHaveLength(0)
    expect(of('import_batch_updates', 'insert')).toHaveLength(0)
  })
})
