import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui'
import { DemandsPage } from './DemandsPage'

const NOW = '2026-11-12T12:00:00.000Z'

type Row = Record<string, unknown>

// L13 — ações em massa em Demandas.
// Contas à mão:
//   * 3 demandas na página: 2 da categoria Aposentadoria (d1/d2) + 1 trabalhista (d3);
//   * selecionar 2 da mesma categoria → confirmação fala em "2 demandas";
//   * selecionar d1 + d3 (2 categorias) → botão Etapa desabilitado;
//   * "Selecionar todas desta página" → 3 selecionadas.
const mock = vi.hoisted(() => ({
  tables: {
    demand_categories: [] as Record<string, unknown>[],
    workflow_stages: [] as Record<string, unknown>[],
    organization_members: [] as Record<string, unknown>[],
    profiles: [] as Record<string, unknown>[],
    clients: [] as Record<string, unknown>[],
    demands: [] as Record<string, unknown>[],
    saved_views: [] as Record<string, unknown>[],
  },
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
}))

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({
    orgId: 'org-1',
    userId: 'u1',
    role: 'advogado',
    profile: { id: 'u1', full_name: 'Ana', email: 'ana@teste.local' },
    organization: { id: 'org-1', name: 'Escritório Teste' },
    can: () => true,
  }),
}))

vi.mock('@/lib/supabase', () => {
  type Value = Record<string, unknown>
  interface Filter {
    column: string
    op: 'eq' | 'is' | 'in' | 'ilike' | 'lt' | 'lte' | 'gte'
    value: unknown
    negate?: boolean
  }
  interface Sort {
    column: string
    ascending: boolean
    nullsFirst: boolean
  }

  function rowsOf(table: string): Value[] {
    return ((mock.tables as unknown as Record<string, Value[]>)[table] ?? [])
  }

  function matches(row: Value, filters: Filter[]) {
    return filters.every((f) => {
      const value = row[f.column]
      let result: boolean
      if (f.op === 'eq' || f.op === 'is') result = value === f.value
      else if (f.op === 'in') result = Array.isArray(f.value) && f.value.includes(value)
      else if (f.op === 'lt') result = value != null && String(value) < String(f.value)
      else if (f.op === 'lte') result = value != null && String(value) <= String(f.value)
      else if (f.op === 'gte') result = value != null && String(value) >= String(f.value)
      else result = typeof value === 'string' && value.toLowerCase().includes(String(f.value).toLowerCase())
      return f.negate ? !result : result
    })
  }

  function builder(table: string) {
    const filters: Filter[] = []
    const sorts: Sort[] = []
    let limit: number | null = null
    let offset = 0
    let head = false
    type Op = 'select' | 'insert' | 'update' | 'delete'
    let op: Op = 'select'
    let insertPayload: Value | Value[] | null = null
    let updatePayload: Value | null = null

    const applyFilters = () => {
      let rows = rowsOf(table).filter((row) => matches(row, filters))
      if (sorts.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const sort of sorts) {
            const av = a[sort.column]
            const bv = b[sort.column]
            if (av == null || bv == null) {
              if (av == null && bv == null) continue
              return av == null ? (sort.nullsFirst ? -1 : 1) : sort.nullsFirst ? 1 : -1
            }
            if (String(av) < String(bv)) return sort.ascending ? -1 : 1
            if (String(av) > String(bv)) return sort.ascending ? 1 : -1
          }
          return 0
        })
      }
      return rows
    }

    const execute = (): { rows: Value[]; error: unknown; total: number } => {
      if (op === 'insert') {
        const incoming = Array.isArray(insertPayload) ? insertPayload : [insertPayload as Value]
        const created = incoming.map((row) => ({ id: `row-${Math.random().toString(36).slice(2)}`, ...row }))
        rowsOf(table).push(...created)
        return { rows: created, error: null, total: created.length }
      }

      if (op === 'update') {
        const rows = applyFilters()
        rows.forEach((row) => Object.assign(row, updatePayload))
        return { rows, error: null, total: rows.length }
      }

      if (op === 'delete') {
        const all = rowsOf(table)
        const removed = all.filter((row) => matches(row, filters))
        const kept = all.filter((row) => !matches(row, filters))
        all.length = 0
        all.push(...kept)
        return { rows: removed, error: null, total: removed.length }
      }

      const all = applyFilters()
      const total = all.length
      const paged = limit != null ? all.slice(offset, offset + limit) : all
      return { rows: head ? [] : paged, error: null, total }
    }

    const q = {
      select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
        head = options?.head === true
        return q
      },
      insert: (payload: Value | Value[]) => {
        op = 'insert'
        insertPayload = payload
        return q
      },
      update: (payload: Value) => {
        op = 'update'
        updatePayload = payload
        return q
      },
      delete: () => {
        op = 'delete'
        return q
      },
      eq: (column: string, value: unknown) => {
        filters.push({ column, op: 'eq', value })
        return q
      },
      is: (column: string, value: unknown) => {
        filters.push({ column, op: 'is', value })
        return q
      },
      in: (column: string, value: unknown[]) => {
        filters.push({ column, op: 'in', value })
        return q
      },
      ilike: (column: string, value: unknown) => {
        filters.push({ column, op: 'ilike', value: String(value).replaceAll('%', '') })
        return q
      },
      not: (column: string, operation: string, value: unknown) => {
        if (operation === 'in') {
          const parsed = String(value).replace(/^\(|\)$/g, '').split(',').map((v) => v.trim())
          filters.push({ column, op: 'in', value: parsed, negate: true })
        }
        return q
      },
      or: () => q,
      lt: (column: string, value: unknown) => {
        filters.push({ column, op: 'lt', value })
        return q
      },
      lte: (column: string, value: unknown) => {
        filters.push({ column, op: 'lte', value })
        return q
      },
      gte: (column: string, value: unknown) => {
        filters.push({ column, op: 'gte', value })
        return q
      },
      order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
        sorts.push({
          column,
          ascending: options?.ascending !== false,
          nullsFirst: options?.nullsFirst === true,
        })
        return q
      },
      limit: (n: number) => {
        limit = n
        return q
      },
      range: (from: number, to: number) => {
        offset = from
        limit = to - from + 1
        return q
      },
      single: async () => {
        const { rows, error } = execute()
        return { data: rows[0] ?? null, error }
      },
      maybeSingle: async () => {
        const { rows, error } = execute()
        return { data: rows[0] ?? null, error }
      },
      then<TResult1 = { data: Value[]; error: unknown; count: number }, TResult2 = never>(
        onfulfilled?: ((value: { data: Value[]; error: unknown; count: number }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        const { rows, error, total } = execute()
        return Promise.resolve({ data: rows, error, count: total }).then(onfulfilled, onrejected)
      },
    }

    return q
  }

  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        mock.rpcCalls.push({ fn, args })
        if (fn === 'bulk_update_demands') {
          const ids = Array.isArray(args.p_ids) ? args.p_ids : []
          return { data: ids.length, error: null }
        }
        return { data: null, error: null }
      },
    },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) throw new Error(String((r.error as { message?: string }).message ?? r.error))
      return r.data as T
    },
    friendlyError: (error: unknown) => String((error as { message?: string })?.message ?? error),
    fetchAllRows: async () => [],
  }
})

function makeMember(userId: string, fullName: string) {
  return {
    id: `m-${userId}`,
    organization_id: 'org-1',
    user_id: userId,
    role: 'advogado',
    active: true,
    created_at: NOW,
    updated_at: NOW,
    profile: { id: userId, full_name: fullName, email: `${userId}@teste.local` },
  }
}

function makeDemand(over: Row): Row {
  return {
    id: 'd-base',
    organization_id: 'org-1',
    client_id: 'client-1',
    category_id: 'cat-prev',
    stage_id: 'stage-prev-1',
    title: 'Demanda base',
    description: null,
    responsible_id: 'u1',
    opened_at: '2026-11-01',
    priority: 'media',
    status: 'em_andamento',
    next_action: null,
    next_action_date: null,
    notes: null,
    stage_changed_at: NOW,
    closed_at: null,
    created_by: 'u1',
    created_at: NOW,
    updated_at: NOW,
    client: { id: 'client-1', full_name: 'Cliente Um', anonymized_at: null },
    ...over,
  }
}

function seed() {
  const stagePrev1 = {
    id: 'stage-prev-1',
    organization_id: 'org-1',
    category_id: 'cat-prev',
    name: 'Primeiro atendimento',
    position: 0,
    is_final: false,
    is_waiting_docs: false,
    created_at: NOW,
    updated_at: NOW,
  }
  const stagePrev2 = { ...stagePrev1, id: 'stage-prev-2', name: 'Levantamento', position: 1 }
  const stageTrab1 = {
    ...stagePrev1,
    id: 'stage-trab-1',
    category_id: 'cat-trab',
    name: 'Coleta de informações',
  }

  mock.tables.workflow_stages = [stagePrev1, stagePrev2, stageTrab1]
  mock.tables.demand_categories = [
    {
      id: 'cat-prev',
      organization_id: 'org-1',
      name: 'Aposentadoria',
      color: '#2563eb',
      sort_order: 0,
      active: true,
      created_at: NOW,
      updated_at: NOW,
      stages: [stagePrev1, stagePrev2],
    },
    {
      id: 'cat-trab',
      organization_id: 'org-1',
      name: 'Demandas trabalhistas',
      color: '#7c3aed',
      sort_order: 1,
      active: true,
      created_at: NOW,
      updated_at: NOW,
      stages: [stageTrab1],
    },
  ]
  mock.tables.organization_members = [makeMember('u1', 'Ana'), makeMember('u2', 'Bruno')]
  mock.tables.profiles = [
    { id: 'u1', full_name: 'Ana', email: 'u1@teste.local' },
    { id: 'u2', full_name: 'Bruno', email: 'u2@teste.local' },
  ]
  mock.tables.clients = [
    { id: 'client-1', organization_id: 'org-1', full_name: 'Cliente Um', anonymized_at: null },
  ]
  mock.tables.demands = [
    makeDemand({
      id: 'd1',
      title: 'Aposentadoria rural',
      category_id: 'cat-prev',
      stage_id: 'stage-prev-1',
      created_at: '2026-11-12T00:00:03Z',
    }),
    makeDemand({
      id: 'd2',
      title: 'Aposentadoria urbana',
      category_id: 'cat-prev',
      stage_id: 'stage-prev-1',
      created_at: '2026-11-12T00:00:02Z',
    }),
    makeDemand({
      id: 'd3',
      title: 'Reclamação trabalhista',
      category_id: 'cat-trab',
      stage_id: 'stage-trab-1',
      priority: 'baixa',
      created_at: '2026-11-12T00:00:01Z',
    }),
  ]
  mock.tables.saved_views = []
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/demandas']}>
          <DemandsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function selectDemand(title: string) {
  const boxes = await screen.findAllByLabelText(`Selecionar ${title}`)
  fireEvent.click(boxes[0])
}

async function choosePriority(priority: 'alta' | 'baixa' | 'media' | 'urgente') {
  const bar = await screen.findByRole('region', { name: 'Ações em massa' })
  fireEvent.click(within(bar).getByRole('button', { name: 'Prioridade' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Prioridade'), { target: { value: priority } })
  fireEvent.click(within(dialog).getByRole('button', { name: /continuar/i }))
}

beforeEach(() => {
  mock.rpcCalls.length = 0
  seed()
})

describe('<DemandsPage> — ações em massa', () => {
  it('selecionar 2 demandas e alterar a prioridade chama a RPC com os ids', async () => {
    renderPage()
    await selectDemand('Aposentadoria rural')
    await selectDemand('Aposentadoria urbana')

    // 1 + 1 = 2 selecionadas.
    expect(await screen.findByText(/2 selecionada/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Ações em massa' })).toBeInTheDocument()

    await choosePriority('alta')

    expect(await screen.findByText('Alterar a prioridade de 2 demandas para Alta?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar alteração' }))

    await waitFor(() => expect(mock.rpcCalls.some((c) => c.fn === 'bulk_update_demands')).toBe(true))
    const call = mock.rpcCalls.find((c) => c.fn === 'bulk_update_demands')!
    expect(call.args.p_org).toBe('org-1')
    expect(call.args.p_patch).toEqual({ priority: 'alta' })
    expect([...(call.args.p_ids as string[])].sort()).toEqual(['d1', 'd2'])

    // Sucesso: toast com a contagem e seleção limpa.
    expect(await screen.findByText('2 demandas atualizadas.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Ações em massa' })).not.toBeInTheDocument(),
    )
  })

  it('desabilita Etapa quando as demandas selecionadas são de categorias diferentes', async () => {
    renderPage()
    await selectDemand('Aposentadoria rural')
    await selectDemand('Reclamação trabalhista')

    const bar = await screen.findByRole('region', { name: 'Ações em massa' })
    const stage = within(bar).getByRole('button', { name: 'Etapa' })

    expect(stage).toBeDisabled()

    const hint =
      stage.getAttribute('title') === 'Selecione demandas de uma só categoria' ||
      screen.queryByText('Selecione demandas de uma só categoria') !== null
    expect(hint).toBe(true)

    // Nada foi enviado ao banco só por selecionar.
    expect(mock.rpcCalls.filter((c) => c.fn === 'bulk_update_demands')).toHaveLength(0)
  })

  it('cancelar a confirmação não chama a RPC', async () => {
    renderPage()
    await selectDemand('Aposentadoria rural')
    await selectDemand('Aposentadoria urbana')

    await choosePriority('alta')
    expect(await screen.findByText('Alterar a prioridade de 2 demandas para Alta?')).toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    await waitFor(() => expect(screen.queryByText(/Alterar a prioridade de 2 demandas/)).not.toBeInTheDocument())
    expect(mock.rpcCalls.filter((c) => c.fn === 'bulk_update_demands')).toHaveLength(0)
  })

  it('"Selecionar todas desta página" marca as 3 demandas e "Limpar seleção" desmarca', async () => {
    renderPage()

    const all = await screen.findAllByLabelText('Selecionar todas desta página')
    fireEvent.click(all[0])

    // 3 demandas visíveis na página → 3 selecionadas.
    expect(await screen.findByText(/3 selecionada/)).toBeInTheDocument()

    const bar = screen.getByRole('region', { name: 'Ações em massa' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Limpar seleção' }))

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Ações em massa' })).not.toBeInTheDocument(),
    )
  })
})
