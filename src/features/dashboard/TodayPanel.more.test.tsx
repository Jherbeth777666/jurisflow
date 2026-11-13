import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui'
import { addDaysISO, todayISO } from '@/lib/format'
import type { Demand, Task } from '@/types/database'
import { TodayPanel } from './TodayPanel'

const STAMP = '2026-11-01T00:00:00.000Z'

const mockDb = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  updates: [] as { table: string; patch: Record<string, unknown> }[],
}))

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({
    orgId: 'org-1',
    userId: 'user-1',
    role: 'advogado',
    profile: { id: 'user-1', full_name: 'Ana Advogada', email: 'ana@teste.com' },
    organization: { id: 'org-1', name: 'Escritório Teste' },
    can: () => true,
  }),
}))

vi.mock('@/features/contracts/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/contracts/api')>()
  return {
    ...actual,
    fetchClientNames: async (_orgId: string, ids: string[]) =>
      new Map(ids.filter((id) => id === 'cli-1').map((id) => [id, 'Maria Cliente'])),
  }
})

vi.mock('@/lib/supabase', () => {
  type Row = Record<string, unknown>
  interface Filter {
    op: 'eq' | 'in' | 'lte' | 'lt'
    column: string
    value: unknown
  }
  interface MockQuery {
    select(columns?: string, options?: unknown): MockQuery
    eq(column: string, value: unknown): MockQuery
    in(column: string, values: unknown[]): MockQuery
    lte(column: string, value: unknown): MockQuery
    lt(column: string, value: unknown): MockQuery
    gte(column: string, value: unknown): MockQuery
    neq(column: string, value: unknown): MockQuery
    is(column: string, value: unknown): MockQuery
    not(...args: unknown[]): MockQuery
    or(...args: unknown[]): MockQuery
    order(...args: unknown[]): MockQuery
    limit(count: number): MockQuery
    range(from: number, to: number): MockQuery
    update(patch: Record<string, unknown>): MockQuery
    delete(): MockQuery
    single(): Promise<{ data: unknown; error: null }>
    maybeSingle(): Promise<{ data: unknown; error: null }>
    then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2>
  }
  function matches(entry: unknown, filters: Filter[]) {
    const row = entry as Row
    return filters.every((f) => {
      const v = row[f.column]
      if (f.op === 'eq') return v === f.value
      if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(v)
      if (f.op === 'lte') return v != null && String(v) <= String(f.value)
      return v != null && String(v) < String(f.value)
    })
  }
  function builder(table: string): MockQuery {
    const filters: Filter[] = []
    const result = () => ({ data: (mockDb.tables[table] ?? []).filter((r) => matches(r, filters)), error: null })
    const q: MockQuery = {
      select: () => q,
      eq: (column, value) => {
        filters.push({ op: 'eq', column, value })
        return q
      },
      in: (column, values) => {
        filters.push({ op: 'in', column, value: values })
        return q
      },
      lte: (column, value) => {
        filters.push({ op: 'lte', column, value })
        return q
      },
      lt: (column, value) => {
        filters.push({ op: 'lt', column, value })
        return q
      },
      gte: () => q,
      neq: () => q,
      is: () => q,
      not: () => q,
      or: () => q,
      order: () => q,
      limit: () => q,
      range: () => q,
      update: (patch) => {
        mockDb.updates.push({ table, patch })
        return q
      },
      delete: () => q,
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (onfulfilled, onrejected) => Promise.resolve(result()).then(onfulfilled, onrejected),
    }
    return q
  }
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: async () => ({ data: null, error: null }),
    },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) throw new Error(String(r.error))
      return r.data as T
    },
  }
})

function makeTask(over: Partial<Task>): Task {
  return {
    id: 't',
    organization_id: 'org-1',
    title: 'Tarefa',
    description: null,
    client_id: null,
    demand_id: null,
    assignee_id: 'user-1',
    due_date: null,
    priority: 'media',
    status: 'pendente',
    completed_at: null,
    created_by: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  } as Task
}

function makeDemand(over: Partial<Demand>): Demand {
  return {
    id: 'd',
    organization_id: 'org-1',
    client_id: 'cli-1',
    category_id: 'cat-1',
    stage_id: null,
    title: 'Demanda',
    description: null,
    responsible_id: 'user-1',
    opened_at: '2026-11-01',
    priority: 'media',
    status: 'em_andamento',
    next_action: null,
    next_action_date: null,
    notes: null,
    stage_changed_at: STAMP,
    closed_at: null,
    created_by: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  } as Demand
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <TodayPanel />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockDb.tables = { tasks: [], demands: [] }
  mockDb.updates = []
  localStorage.clear()
})

describe('<TodayPanel> — "Ver todos" e contexto do item', () => {
  it('com 10 itens mostra no máximo 8 e o link "Ver todos (10)" para hoje', async () => {
    const today = todayISO()
    mockDb.tables.tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({
        id: `t-${i + 1}`,
        title: `Tarefa ${String(i + 1).padStart(2, '0')}`,
        due_date: today,
        assignee_id: 'user-1',
      }),
    )

    renderPanel()

    expect(await screen.findByText('Tarefa 08')).toBeInTheDocument()
    expect(screen.getByText('Tarefa 01')).toBeInTheDocument()
    expect(screen.queryByText('Tarefa 09')).toBeNull()
    expect(screen.queryByText('Tarefa 10')).toBeNull()

    const link = screen.getByRole('link', { name: 'Ver todos (10)' })
    expect(link).toHaveAttribute('href', '/agenda?v=hoje')
    // O contador continua com o total real (não apenas os 8 exibidos).
    expect(screen.getAllByText('10').length).toBeGreaterThan(0)
  })

  it('quando há atrasado, "Ver todos (10)" aponta para a aba Atrasados', async () => {
    const today = todayISO()
    mockDb.tables.tasks = [
      ...Array.from({ length: 9 }, (_, i) =>
        makeTask({
          id: `t-${i + 1}`,
          title: `Tarefa ${String(i + 1).padStart(2, '0')}`,
          due_date: today,
          assignee_id: 'user-1',
        }),
      ),
      makeTask({
        id: 't-overdue',
        title: 'Tarefa atrasada',
        due_date: addDaysISO(today, -2),
        assignee_id: 'user-1',
      }),
    ]

    renderPanel()

    expect(await screen.findByText('Tarefa atrasada')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Ver todos (10)' })
    expect(link).toHaveAttribute('href', '/agenda?v=atrasados')
  })

  it('mostra o nome do cliente e o título da demanda abaixo do título', async () => {
    mockDb.tables.tasks = [
      makeTask({
        id: 't-1',
        title: 'Protocolar recurso',
        due_date: todayISO(),
        demand_id: 'dem-1',
        client_id: 'cli-1',
      }),
    ]
    mockDb.tables.demands = [makeDemand({ id: 'dem-1', title: 'Ação trabalhista', next_action_date: null })]

    renderPanel()

    expect(await screen.findByText('Protocolar recurso')).toBeInTheDocument()
    expect(screen.getByText(/Maria Cliente/)).toBeInTheDocument()
    expect(screen.getByText(/Ação trabalhista/)).toBeInTheDocument()
  })
})
