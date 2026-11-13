import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui'
import { TasksPage } from './TasksPage'

const NOW = '2026-11-12T12:00:00.000Z'

type Row = Record<string, unknown>

// L13 — ações em massa em Tarefas.
// Contas à mão:
//   * 2 tarefas abertas do usuário logado (t1/t2);
//   * selecionar as 2 → confirmação "Concluir 2 tarefas?" → RPC com 2 ids;
//   * sem permissão tasks.delete → ação "Excluir" não aparece;
//   * com permissão → exclusão em massa usa DELETE ... in (t1, t2).
const mock = vi.hoisted(() => ({
  canDelete: true,
  tables: {
    tasks: [] as Record<string, unknown>[],
    organization_members: [] as Record<string, unknown>[],
    profiles: [] as Record<string, unknown>[],
    clients: [] as Record<string, unknown>[],
    demands: [] as Record<string, unknown>[],
    saved_views: [] as Record<string, unknown>[],
  },
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  deletes: [] as { table: string; filters: { column: string; op: string; value: unknown }[] }[],
}))

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({
    orgId: 'org-1',
    userId: 'u1',
    role: 'advogado',
    profile: { id: 'u1', full_name: 'Ana', email: 'ana@teste.local' },
    organization: { id: 'org-1', name: 'Escritório Teste' },
    can: (permission: string) => (permission === 'tasks.delete' ? mock.canDelete : true),
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
        mock.deletes.push({ table, filters: [...filters] })
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
        if (fn === 'bulk_update_tasks') {
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

function makeTask(over: Row): Row {
  return {
    id: 't-base',
    organization_id: 'org-1',
    title: 'Tarefa base',
    description: null,
    client_id: null,
    demand_id: null,
    assignee_id: 'u1',
    due_date: '2026-11-20',
    priority: 'media',
    status: 'pendente',
    completed_at: null,
    created_by: 'u1',
    created_at: NOW,
    updated_at: NOW,
    client: null,
    demand: null,
    ...over,
  }
}

function seed() {
  mock.tables.organization_members = [makeMember('u1', 'Ana'), makeMember('u2', 'Bruno')]
  mock.tables.profiles = [
    { id: 'u1', full_name: 'Ana', email: 'u1@teste.local' },
    { id: 'u2', full_name: 'Bruno', email: 'u2@teste.local' },
  ]
  mock.tables.tasks = [
    makeTask({ id: 't1', title: 'Enviar contestação', due_date: '2026-11-15' }),
    makeTask({ id: 't2', title: 'Ligar para o cliente', due_date: '2026-11-16' }),
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
        <MemoryRouter initialEntries={['/tarefas']}>
          <TasksPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function selectTask(title: string) {
  fireEvent.click(await screen.findByLabelText(`Selecionar ${title}`))
}

beforeEach(() => {
  mock.canDelete = true
  mock.rpcCalls.length = 0
  mock.deletes.length = 0
  seed()
})

describe('<TasksPage> — ações em massa', () => {
  it('selecionar 2 tarefas e Concluir chama bulk_update_tasks com status concluida', async () => {
    renderPage()
    await selectTask('Enviar contestação')
    await selectTask('Ligar para o cliente')

    // 1 + 1 = 2 tarefas selecionadas.
    expect(await screen.findByText(/2 selecionada/)).toBeInTheDocument()

    const bar = screen.getByRole('region', { name: 'Ações em massa' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Concluir' }))

    expect(await screen.findByText('Concluir 2 tarefas?')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /confirmar|concluir/i }))

    await waitFor(() => expect(mock.rpcCalls.some((c) => c.fn === 'bulk_update_tasks')).toBe(true))
    const call = mock.rpcCalls.find((c) => c.fn === 'bulk_update_tasks')!
    expect(call.args.p_org).toBe('org-1')
    expect(call.args.p_patch).toEqual({ status: 'concluida' })
    expect([...(call.args.p_ids as string[])].sort()).toEqual(['t1', 't2'])

    // Sucesso: toast com a contagem e seleção limpa.
    expect(await screen.findByText(/2 tarefas/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Ações em massa' })).not.toBeInTheDocument(),
    )
  })

  it('sem permissão tasks.delete a ação Excluir não aparece', async () => {
    mock.canDelete = false
    renderPage()
    await selectTask('Enviar contestação')
    await selectTask('Ligar para o cliente')

    const bar = await screen.findByRole('region', { name: 'Ações em massa' })
    expect(within(bar).queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('com permissão, Excluir pede confirmação e apaga as 2 tarefas selecionadas', async () => {
    renderPage()
    await selectTask('Enviar contestação')
    await selectTask('Ligar para o cliente')

    const bar = await screen.findByRole('region', { name: 'Ações em massa' })
    fireEvent.click(within(bar).getByRole('button', { name: 'Excluir' }))

    expect(await screen.findByText('Excluir 2 tarefas? Esta ação não pode ser desfeita.')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    // Antes de confirmar, as 2 tarefas continuam no banco.
    expect(mock.tables.tasks).toHaveLength(2)

    fireEvent.click(within(dialog).getByRole('button', { name: /^excluir$/i }))

    // 2 - 2 = 0 tarefas restantes.
    await waitFor(() => expect(mock.tables.tasks).toHaveLength(0))
    const deletion = mock.deletes.find((d) => d.table === 'tasks')
    expect(deletion).toBeTruthy()
    const idFilter = deletion!.filters.find((f) => f.column === 'id' && f.op === 'in')
    expect(idFilter).toBeTruthy()
    expect([...(idFilter!.value as string[])].sort()).toEqual(['t1', 't2'])
  })
})
