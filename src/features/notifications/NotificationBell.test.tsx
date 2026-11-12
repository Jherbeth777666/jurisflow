import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '@/components/ui'
import { qk } from '@/hooks/useOrgData'
import { NotificationBell } from './NotificationBell'

interface NotificationRow {
  id: string
  organization_id: string
  user_id: string
  kind: 'resumo_diario' | 'tarefas_atrasadas' | 'prazos_hoje' | 'proximas_acoes_vencidas' | 'demandas_paradas'
  title: string
  body: string | null
  link: string
  ref_date: string
  read_at: string | null
  created_at: string
}

const mockDb = vi.hoisted(() => ({
  notifications: [] as NotificationRow[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
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

vi.mock('@/lib/supabase', () => {
  type Row = Record<string, unknown>
  type Filter = {
    column: string
    op: 'eq' | 'in' | 'is' | 'not' | 'gte' | 'lte' | 'lt'
    value: unknown
  }
  interface Sort {
    column: string
    ascending: boolean
    nullsFirst: boolean
  }
  interface MockQuery {
    select(columns?: string, options?: unknown): MockQuery
    eq(column: string, value: unknown): MockQuery
    in(column: string, values: unknown[]): MockQuery
    is(column: string, value: unknown): MockQuery
    not(...args: unknown[]): MockQuery
    gte(column: string, value: unknown): MockQuery
    lte(column: string, value: unknown): MockQuery
    lt(column: string, value: unknown): MockQuery
    order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): MockQuery
    limit(count: number): MockQuery
    update(patch: Record<string, unknown>): MockQuery
    single(): Promise<{ data: unknown; error: null }>
    maybeSingle(): Promise<{ data: unknown; error: null }>
    then<TResult1 = { data: unknown[]; error: null; count: number }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown[]; error: null; count: number }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2>
  }

  function matches(entry: unknown, filters: Filter[]) {
    const row = entry as Row
    return filters.every((f) => {
      const v = row[f.column]
      if (f.op === 'eq') return v === f.value
      if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(v)
      if (f.op === 'is') return v == null ? f.value == null : v === f.value
      if (f.op === 'not') {
        const target = f.value as { operator: string; value: unknown }
        if (target.operator === 'is') return target.value == null ? v != null : v !== target.value
        if (target.operator === 'eq') return v !== target.value
        return true
      }
      if (f.op === 'gte') return v != null && String(v) >= String(f.value)
      if (f.op === 'lte') return v != null && String(v) <= String(f.value)
      return v != null && String(v) < String(f.value)
    })
  }

  function builder(table: string): MockQuery {
    if (table !== 'notifications') {
      throw new Error(`consulta inesperada à tabela "${table}" — o sino deve usar só notifications`)
    }
    const filters: Filter[] = []
    const sorts: Sort[] = []
    let max: number | null = null

    const filtered = () =>
      (mockDb.notifications as unknown as Row[]).filter((r) => matches(r, filters))
    const apply = () => {
      let rows = filtered()
      if (sorts.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const s of sorts) {
            const av = a[s.column]
            const bv = b[s.column]
            if (av == null || bv == null) {
              if (av == null && bv == null) continue
              return av == null ? (s.nullsFirst ? -1 : 1) : (s.nullsFirst ? 1 : -1)
            }
            if (String(av) < String(bv)) return s.ascending ? -1 : 1
            if (String(av) > String(bv)) return s.ascending ? 1 : -1
          }
          return 0
        })
      }
      const count = rows.length
      if (max != null) rows = rows.slice(0, max)
      return { rows, count }
    }

    const q: MockQuery = {
      select: () => q,
      eq: (column, value) => {
        filters.push({ column, op: 'eq', value })
        return q
      },
      in: (column, values) => {
        filters.push({ column, op: 'in', value: values })
        return q
      },
      is: (column, value) => {
        filters.push({ column, op: 'is', value })
        return q
      },
      not: (column: unknown, operator: unknown, value: unknown) => {
        filters.push({
          column: String(column),
          op: 'not',
          value: { operator: String(operator), value },
        })
        return q
      },
      gte: (column, value) => {
        filters.push({ column, op: 'gte', value })
        return q
      },
      lte: (column, value) => {
        filters.push({ column, op: 'lte', value })
        return q
      },
      lt: (column, value) => {
        filters.push({ column, op: 'lt', value })
        return q
      },
      order: (column, options) => {
        sorts.push({
          column,
          ascending: options?.ascending !== false,
          nullsFirst: options?.nullsFirst === true,
        })
        return q
      },
      limit: (count) => {
        max = count
        return q
      },
      update: (patch) => {
        for (const row of filtered()) Object.assign(row, patch)
        return q
      },
      single: async () => {
        const { rows } = apply()
        return { data: rows[0] ?? null, error: null }
      },
      maybeSingle: async () => {
        const { rows } = apply()
        return { data: rows[0] ?? null, error: null }
      },
      then: (onfulfilled, onrejected) => {
        const { rows, count } = apply()
        return Promise.resolve({ data: rows, error: null, count }).then(onfulfilled, onrejected)
      },
    }
    return q
  }

  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        mockDb.rpcCalls.push({ fn, args })
        if (fn === 'mark_notifications_read') {
          const ids = (args?.p_ids ?? []) as string[]
          for (const row of mockDb.notifications) {
            if (ids.includes(String(row.id))) row.read_at = new Date().toISOString()
          }
        }
        if (fn === 'mark_all_notifications_read') {
          for (const row of mockDb.notifications) {
            if (row.organization_id === args?.p_org && row.read_at == null) {
              row.read_at = new Date().toISOString()
            }
          }
        }
        return { data: null, error: null }
      },
    },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) throw new Error(String(r.error))
      return r.data as T
    },
  }
})

const NOW = Date.now()

function makeNotification(over: Partial<NotificationRow>): NotificationRow {
  return {
    id: 'n1',
    organization_id: 'org-1',
    user_id: 'user-1',
    kind: 'tarefas_atrasadas',
    title: '3 tarefas atrasadas',
    body: 'Você tem tarefas com prazo vencido.',
    link: '/tarefas',
    ref_date: '2026-11-12',
    read_at: null,
    created_at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
    ...over,
  }
}

function renderBell() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<NotificationBell />} />
            <Route path="/tarefas" element={<p>Tela de tarefas</p>} />
            <Route path="/agenda" element={<p>Tela da agenda</p>} />
            <Route path="/relatorios" element={<p>Tela de relatórios</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockDb.notifications.length = 0
  mockDb.rpcCalls.length = 0
})

describe('qk de notificações', () => {
  it('tem a chave prefixada pelo escritório atual', () => {
    expect(qk.notifications('org-1')).toEqual(['notifications', 'org-1'])
  })
})

describe('<NotificationBell>', () => {
  it('mostra o contador de não lidas no aria-label', async () => {
    mockDb.notifications.push(
      makeNotification({ id: 'n1' }),
      makeNotification({ id: 'n2', kind: 'prazos_hoje', title: '2 prazos hoje', link: '/agenda?v=hoje' }),
      makeNotification({ id: 'n3', kind: 'demandas_paradas', title: '3 demandas paradas', link: '/relatorios' }),
      makeNotification({ id: 'n4', read_at: new Date().toISOString() }),
    )

    renderBell()

    expect(await screen.findByRole('button', { name: 'Avisos (3 não lidos)' })).toBeInTheDocument()
  })

  it('limita o contador visual a "9+"', async () => {
    for (let i = 0; i < 12; i++) {
      mockDb.notifications.push(makeNotification({ id: `n${i}`, title: `Aviso ${i}` }))
    }

    renderBell()

    const bell = await screen.findByRole('button', { name: 'Avisos (12 não lidos)' })
    expect(within(bell).getByText('9+')).toBeInTheDocument()

    fireEvent.click(bell)
    expect(await screen.findByText('Aviso 0')).toBeInTheDocument()
  })

  it('abre a lista com título, corpo e tempo relativo', async () => {
    mockDb.notifications.push(makeNotification({ id: 'n1' }))

    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: 'Avisos (1 não lidos)' }))

    expect(await screen.findByText('3 tarefas atrasadas')).toBeInTheDocument()
    expect(screen.getByText('Você tem tarefas com prazo vencido.')).toBeInTheDocument()
    expect(screen.getByText(/há 2 horas/)).toBeInTheDocument()
  })

  it('ao clicar, marca a notificação como lida e navega para o link', async () => {
    mockDb.notifications.push(
      makeNotification({ id: 'n1', kind: 'prazos_hoje', title: '2 prazos hoje', link: '/agenda?v=hoje' }),
      makeNotification({ id: 'n2', title: '3 tarefas atrasadas', link: '/tarefas' }),
    )

    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: 'Avisos (2 não lidos)' }))
    fireEvent.click(await screen.findByText('2 prazos hoje'))

    expect(await screen.findByText('Tela da agenda')).toBeInTheDocument()
    await waitFor(() => {
      expect(mockDb.notifications.find((n) => n.id === 'n1')?.read_at).toBeTruthy()
    })
    expect(mockDb.notifications.find((n) => n.id === 'n2')?.read_at).toBeNull()
  })

  it('marca todas como lidas pelo botão do painel', async () => {
    mockDb.notifications.push(
      makeNotification({ id: 'n1' }),
      makeNotification({ id: 'n2', kind: 'prazos_hoje', title: '2 prazos hoje', link: '/agenda?v=hoje' }),
    )

    renderBell()
    fireEvent.click(await screen.findByRole('button', { name: 'Avisos (2 não lidos)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }))

    await waitFor(() => {
      expect(mockDb.notifications.every((n) => n.read_at != null)).toBe(true)
    })
    expect(await screen.findByRole('button', { name: 'Avisos (0 não lidos)' })).toBeInTheDocument()
  })

  it('mostra o estado vazio quando não há avisos', async () => {
    renderBell()

    const bell = await screen.findByRole('button', { name: 'Avisos (0 não lidos)' })
    fireEvent.click(bell)

    expect(await screen.findByText('Nenhum aviso por aqui.')).toBeInTheDocument()
  })
})
