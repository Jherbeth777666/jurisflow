import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { ToastProvider } from '@/components/ui'
import { SavedViewsMenu } from './SavedViewsMenu'

const NOW = '2026-11-12T12:00:00.000Z'

type Row = Record<string, unknown>

// L13 — menu de filtros salvos. O Supabase é simulado em memória.
// Contas à mão:
//   * 3 filtros visíveis para a Ana (2 próprios + 1 compartilhado pelo Bruno);
//   * 1 deles é excluído na confirmação → 3 - 1 = 2 filtros restantes.
const mock = vi.hoisted(() => ({
  tables: {
    saved_views: [] as Record<string, unknown>[],
    organization_members: [] as Record<string, unknown>[],
    profiles: [] as Record<string, unknown>[],
  },
  inserts: [] as { table: string; payload: Record<string, unknown> | Record<string, unknown>[] }[],
  deletes: [] as { table: string; filters: { column: string; op: string; value: unknown }[] }[],
  nextId: 1,
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
    op: 'eq' | 'is' | 'in' | 'ilike'
    value: unknown
    negate?: boolean
  }
  interface Sort {
    column: string
    ascending: boolean
  }

  function rowsOf(table: string): Value[] {
    return (mock.tables as Record<string, Value[]>)[table] ?? []
  }

  function matches(row: Value, filters: Filter[]) {
    return filters.every((f) => {
      const value = row[f.column]
      let result: boolean
      if (f.op === 'eq' || f.op === 'is') result = value === f.value
      else if (f.op === 'in') result = Array.isArray(f.value) && f.value.includes(value)
      else result = typeof value === 'string' && value.toLowerCase().includes(String(f.value).toLowerCase())
      return f.negate ? !result : result
    })
  }

  function builder(table: string) {
    const filters: Filter[] = []
    const sorts: Sort[] = []
    let limit: number | null = null
    let offset = 0
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
            if (av == null && bv == null) continue
            if (av == null) return 1
            if (bv == null) return -1
            if (String(av) < String(bv)) return sort.ascending ? -1 : 1
            if (String(av) > String(bv)) return sort.ascending ? 1 : -1
          }
          return 0
        })
      }
      if (limit != null) rows = rows.slice(offset, offset + limit)
      return rows
    }

    const execute = (): { rows: Value[]; error: unknown } => {
      if (op === 'insert') {
        const incoming = Array.isArray(insertPayload) ? insertPayload : [insertPayload as Value]
        if (table === 'saved_views') {
          for (const row of incoming) {
            const duplicate = rowsOf('saved_views').some(
              (v) =>
                v.organization_id === row.organization_id &&
                v.user_id === row.user_id &&
                v.page === row.page &&
                v.name === row.name,
            )
            if (duplicate) {
              return {
                rows: [],
                error: {
                  code: '23505',
                  message:
                    'duplicate key value violates unique constraint "saved_views_organization_id_user_id_page_name_key"',
                },
              }
            }
          }
        }
        const created = incoming.map((row) => ({
          id: `view-${mock.nextId++}`,
          created_at: NOW,
          ...row,
        }))
        rowsOf(table).push(...created)
        mock.inserts.push({ table, payload: Array.isArray(insertPayload) ? (insertPayload as Value[]) : (insertPayload as Value) })
        return { rows: created, error: null }
      }

      if (op === 'update') {
        const rows = applyFilters()
        rows.forEach((row) => Object.assign(row, updatePayload))
        return { rows, error: null }
      }

      if (op === 'delete') {
        const all = rowsOf(table)
        const removed = all.filter((row) => matches(row, filters))
        const kept = all.filter((row) => !matches(row, filters))
        all.length = 0
        all.push(...kept)
        mock.deletes.push({ table, filters: [...filters] })
        return { rows: removed, error: null }
      }

      return { rows: applyFilters(), error: null }
    }

    const q = {
      select: () => q,
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
      order: (column: string, options?: { ascending?: boolean }) => {
        sorts.push({ column, ascending: options?.ascending !== false })
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
        const { rows, error } = execute()
        return Promise.resolve({ data: rows, error, count: rows.length }).then(onfulfilled, onrejected)
      },
    }

    return q
  }

  return {
    supabase: { from: (table: string) => builder(table), rpc: async () => ({ data: null, error: null }) },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) throw new Error(String((r.error as { message?: string }).message ?? r.error))
      return r.data as T
    },
    friendlyError: (error: unknown) => String((error as { message?: string })?.message ?? error),
    fetchAllRows: async () => [],
  }
})

function seed() {
  mock.tables.saved_views = [
    {
      id: 'v1',
      organization_id: 'org-1',
      user_id: 'u1',
      page: 'demandas',
      name: 'Meus urgentes',
      query: 'priority=alta',
      shared: false,
      created_at: NOW,
    },
    {
      id: 'v2',
      organization_id: 'org-1',
      user_id: 'u1',
      page: 'demandas',
      name: 'Meu compartilhado',
      query: 'status=concluida',
      shared: true,
      created_at: NOW,
    },
    {
      id: 'v3',
      organization_id: 'org-1',
      user_id: 'u2',
      page: 'demandas',
      name: 'Do colega',
      query: 'category=prev',
      shared: true,
      created_at: NOW,
      author_name: 'Bruno',
      profile: { full_name: 'Bruno' },
      member: { user_id: 'u2', profile: { full_name: 'Bruno' } },
    },
  ]

  mock.tables.organization_members = [
    {
      id: 'm1',
      organization_id: 'org-1',
      user_id: 'u1',
      role: 'advogado',
      active: true,
      created_at: NOW,
      profile: { id: 'u1', full_name: 'Ana', email: 'ana@teste.local' },
    },
    {
      id: 'm2',
      organization_id: 'org-1',
      user_id: 'u2',
      role: 'advogado',
      active: true,
      created_at: NOW,
      profile: { id: 'u2', full_name: 'Bruno', email: 'bruno@teste.local' },
    },
  ]

  mock.tables.profiles = [
    { id: 'u1', full_name: 'Ana', email: 'ana@teste.local' },
    { id: 'u2', full_name: 'Bruno', email: 'bruno@teste.local' },
  ]
}

function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.search}</span>
}

function renderMenu(initialEntry = '/demandas') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <SavedViewsMenu page="demandas" />
          <LocationProbe />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /filtros salvos/i }))
}

async function clickSaveCurrent() {
  fireEvent.click(await screen.findByText(/salvar filtros atuais/i))
}

beforeEach(() => {
  mock.inserts.length = 0
  mock.deletes.length = 0
  mock.nextId = 1
  seed()
})

describe('<SavedViewsMenu>', () => {
  it('lista os filtros "Meus" e "Da equipe" com o nome de quem criou', async () => {
    renderMenu()
    openMenu()

    // Seções do menu.
    expect(await screen.findByText('Meus')).toBeInTheDocument()
    expect(screen.getByText('Da equipe')).toBeInTheDocument()

    // 2 filtros próprios e 1 compartilhado por outra pessoa.
    expect(screen.getByText('Meus urgentes')).toBeInTheDocument()
    expect(screen.getByText('Meu compartilhado')).toBeInTheDocument()
    expect(screen.getByText('Do colega')).toBeInTheDocument()
    expect(screen.getByText(/Bruno/)).toBeInTheDocument()
  })

  it('aplicar um filtro chama setParams com a query salva', async () => {
    renderMenu('/demandas?aba=todas')
    openMenu()

    fireEvent.click(await screen.findByText('Meus urgentes'))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('priority=alta'))
  })

  it('salvar envia page/name/query/shared e remove parâmetros de abertura de modal', async () => {
    // A URL tem 2 filtros reais (category/priority) + 3 parâmetros de modal.
    renderMenu('/demandas?category=prev&priority=alta&nova=1&novo=1&tarefa=abc')
    openMenu()

    await clickSaveCurrent()
    fireEvent.change(await screen.findByLabelText('Nome do filtro'), {
      target: { value: 'Meus previdenciários urgentes' },
    })
    fireEvent.click(screen.getByLabelText('Compartilhar com a equipe'))
    fireEvent.click(screen.getByRole('button', { name: /^salvar filtro$/i }))

    await waitFor(() => expect(mock.inserts.some((i) => i.table === 'saved_views')).toBe(true))
    const payload = mock.inserts.find((i) => i.table === 'saved_views')!.payload as Row
    expect(payload.page).toBe('demandas')
    expect(payload.name).toBe('Meus previdenciários urgentes')
    expect(payload.shared).toBe(true)
    const query = new URLSearchParams(String(payload.query))
    // Só os 2 filtros reais sobram; nova/novo/tarefa não vão para a query salva.
    expect(Object.fromEntries(query)).toEqual({ category: 'prev', priority: 'alta' })
    expect(query.has('nova')).toBe(false)
    expect(query.has('novo')).toBe(false)
    expect(query.has('tarefa')).toBe(false)
  })

  it('nome duplicado mostra "Já existe um filtro com esse nome."', async () => {
    renderMenu('/demandas?category=prev')
    openMenu()

    await clickSaveCurrent()
    fireEvent.change(await screen.findByLabelText('Nome do filtro'), { target: { value: 'Meus urgentes' } })
    fireEvent.click(screen.getByRole('button', { name: /^salvar filtro$/i }))

    expect(await screen.findByText('Já existe um filtro com esse nome.')).toBeInTheDocument()
  })

  it('desabilita "Salvar filtros atuais" quando não há filtro ativo', async () => {
    renderMenu('/demandas')
    openMenu()

    const text = await screen.findByText(/salvar filtros atuais/i)
    const target = text.closest('button') ?? text
    const disabled =
      target.hasAttribute('disabled') ||
      target.getAttribute('aria-disabled') === 'true' ||
      target.closest('[aria-disabled="true"]') !== null
    expect(disabled).toBe(true)
  })

  it('excluir um filtro próprio pede confirmação antes de apagar', async () => {
    renderMenu()
    openMenu()

    fireEvent.click(await screen.findByRole('button', { name: 'Excluir filtro Meus urgentes' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Meus urgentes')
    // Antes de confirmar, os 3 filtros continuam no banco.
    expect(mock.tables.saved_views).toHaveLength(3)

    fireEvent.click(within(dialog).getByRole('button', { name: /^excluir$/i }))

    // 3 - 1 = 2 filtros restantes.
    await waitFor(() => expect(mock.tables.saved_views).toHaveLength(2))
    expect(mock.deletes.some((d) => d.table === 'saved_views')).toBe(true)
  })
})
