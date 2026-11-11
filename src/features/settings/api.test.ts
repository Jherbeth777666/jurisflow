import { beforeEach, describe, expect, it, vi } from 'vitest'

// Builder encadeável do supabase-js por tabela: registra as chamadas e resolve
// com o resultado da tabela (array ou uma função que devolve a página pedida).
type Call = [string, string, unknown[]]
let calls: Call[] = []

type Resolver = unknown | ((from: number, to: number) => unknown)
let tableData: Record<string, Resolver> = {}
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null }

function makeBuilder(table: string) {
  let range: [number, number] = [0, 999]
  const builder: Record<string, unknown> = {}
  const record = (method: string, args: unknown[]) => {
    calls.push([table, method, args])
    return builder
  }
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'single']) {
    builder[m] = (...args: unknown[]) => record(m, args)
  }
  builder.range = (...args: unknown[]) => {
    range = [args[0] as number, args[1] as number]
    return record('range', args)
  }
  builder.then = (resolve: (value: unknown) => unknown) => {
    const resolver = tableData[table]
    const data = typeof resolver === 'function' ? (resolver as (from: number, to: number) => unknown)(range[0], range[1]) : (resolver ?? [])
    return resolve({ data, error: null })
  }
  return builder
}

vi.mock('@/lib/supabase', async (orig) => ({
  ...(await orig<typeof import('@/lib/supabase')>()),
  supabase: {
    from: (table: string) => makeBuilder(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push(['rpc', name, [args]])
      return Promise.resolve(rpcResult)
    },
  },
}))

const { fetchClientExport, logClientExport } = await import('./api')

const checklistItem = (id: string, demand_id: string, position: number) => ({
  id,
  organization_id: 'org-1',
  demand_id,
  label: 'Documento ' + id,
  done: false,
  done_at: null,
  done_by: null,
  position,
  created_at: '2026-11-11T00:00:00.000Z',
  updated_at: '2026-11-11T00:00:00.000Z',
})

beforeEach(() => {
  calls = []
  rpcResult = { data: null, error: null }
  tableData = {
    clients: { id: 'c1', organization_id: 'org-1', full_name: 'Maria Teste', cpf: '52998224725' },
    demands: [
      { id: 'd1', organization_id: 'org-1', client_id: 'c1', opened_at: '2026-01-01' },
      { id: 'd2', organization_id: 'org-1', client_id: 'c1', opened_at: '2026-01-02' },
    ],
    tasks: [],
    contracts: [],
    installments: [],
    payments: [],
  }
})

describe('fetchClientExport — checklist de documentos', () => {
  it('busca demand_checklist_items das demandas do cliente paginando e devolve os itens', async () => {
    // 1ª página cheia (1000 itens) força uma 2ª consulta; a 2ª traz 1 item → total 1001.
    const page1 = Array.from({ length: 1000 }, (_, n) => checklistItem('i' + n, n % 2 === 0 ? 'd1' : 'd2', n))
    const page2 = [checklistItem('i1000', 'd1', 1000)]
    tableData.demand_checklist_items = (from: number) => (from === 0 ? page1 : page2)

    const out = await fetchClientExport('org-1', 'Escritório X', 'c1')

    expect(out.demandas.every((d) => Array.isArray(d.checklist))).toBe(true)
    // d1: 500 itens pares da 1ª página + 1 da 2ª = 501; d2: 500 ímpares → 1001 no total
    expect(out.demandas.reduce((total, d) => total + d.checklist.length, 0)).toBe(1001)

    const checklistCalls = calls.filter(([table]) => table === 'demand_checklist_items')
    expect(checklistCalls).toContainEqual(['demand_checklist_items', 'eq', ['organization_id', 'org-1']])
    expect(checklistCalls).toContainEqual(['demand_checklist_items', 'in', ['demand_id', ['d1', 'd2']]])
    expect(checklistCalls).toContainEqual(['demand_checklist_items', 'order', ['demand_id']])
    expect(checklistCalls).toContainEqual(['demand_checklist_items', 'order', ['position']])
    expect(checklistCalls).toContainEqual(['demand_checklist_items', 'order', ['id']])
    expect(checklistCalls).toContainEqual(['demand_checklist_items', 'range', [0, 999]])
    expect(checklistCalls).toContainEqual(['demand_checklist_items', 'range', [1000, 1999]])
  })

  it('não consulta o checklist quando o cliente não tem demandas', async () => {
    tableData.demands = []

    const out = await fetchClientExport('org-1', 'Escritório X', 'c1')

    expect(out.demandas).toEqual([])
    expect(calls.some(([table]) => table === 'demand_checklist_items')).toBe(false)
  })
})

describe('logClientExport', () => {
  it('registra a exportação LGPD via rpc log_export', async () => {
    await logClientExport('org-1', 'c1', 42)

    expect(calls).toContainEqual([
      'rpc',
      'log_export',
      [{ p_org: 'org-1', p_resource: 'client_lgpd_export', p_row_count: 42, p_sensitive: true, p_entity: 'c1' }],
    ])
  })

  it('falha no registro não impede o download (não lança)', async () => {
    rpcResult = { data: null, error: { message: 'falha simulada' } }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await expect(logClientExport('org-1', 'c1', 42)).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
