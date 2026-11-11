import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui'
import { AgendaPage } from './AgendaPage'

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

// A página usa todayISO() para montar o intervalo; fixamos a data para o teste.
vi.mock('@/lib/format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/format')>()
  return { ...actual, todayISO: () => '2026-11-11' }
})

vi.mock('@/hooks/useOrgData', () => ({
  qk: {
    members: (org: string) => ['members', org],
    dashboard: (org: string) => ['dashboard', org],
  },
  useMembers: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useMemberNames: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    map: new Map([['user-1', 'Ana Advogada']]),
    options: [],
  }),
}))

vi.mock('@/features/contracts/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/contracts/api')>()
  return { ...actual, fetchClientNames: async () => new Map([['cli-1', 'Maria Cliente']]) }
})

const rpc = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  rows: [] as Record<string, unknown>[],
  error: null as { message: string } | null,
}))

vi.mock('@/lib/supabase', () => {
  const emptyQuery = () => {
    const q: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'lte', 'lt', 'gte', 'neq', 'is', 'not', 'or', 'order', 'limit', 'range']) {
      q[method] = () => q
    }
    q.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve)
    return q
  }
  return {
    supabase: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpc.calls.push({ fn, args })
        return { data: rpc.error ? null : rpc.rows, error: rpc.error }
      },
      from: () => emptyQuery(),
    },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) throw new Error(String(r.error))
      return r.data as T
    },
    fetchAllRows: async () => [],
  }
})

function renderPage(initialEntry = '/agenda') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <AgendaPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function task(over: Record<string, unknown> = {}) {
  return {
    kind: 'task',
    id: 't-1',
    title: 'Juntar documentos',
    date: '2026-11-11',
    overdue: false,
    status: 'pendente',
    client_id: 'cli-1',
    demand_id: null,
    assignee_id: 'user-1',
    amount: null,
    ...over,
  }
}

function nextAction(over: Record<string, unknown> = {}) {
  return {
    kind: 'next_action',
    id: 'dem-1',
    title: 'Protocolar contestação',
    date: '2026-11-11',
    overdue: false,
    status: 'em_andamento',
    client_id: 'cli-1',
    demand_id: 'dem-1',
    assignee_id: 'user-1',
    amount: null,
    ...over,
  }
}

function installment(over: Record<string, unknown> = {}) {
  return {
    kind: 'installment',
    id: 'inst-1',
    title: 'Parcela 1',
    date: '2026-11-11',
    overdue: false,
    status: 'a_vencer',
    client_id: 'cli-1',
    demand_id: null,
    assignee_id: null,
    amount: 150.5,
    contract_id: 'con-1',
    ...over,
  }
}

beforeEach(() => {
  rpc.calls = []
  rpc.rows = []
  rpc.error = null
})

describe('<AgendaPage>', () => {
  it('chama agenda_items com o intervalo da aba (hoje, semana e mês)', async () => {
    renderPage()

    await waitFor(() => expect(rpc.calls.length).toBeGreaterThan(0))
    expect(rpc.calls[0].fn).toBe('agenda_items')
    expect(rpc.calls[0].args).toMatchObject({
      p_org: 'org-1',
      p_from: '2026-11-11',
      p_to: '2026-11-11',
    })

    fireEvent.click(screen.getByRole('tab', { name: /Semana/ }))
    await waitFor(() =>
      expect(rpc.calls.at(-1)?.args).toMatchObject({ p_from: '2026-11-09', p_to: '2026-11-15' }),
    )

    fireEvent.click(screen.getByRole('tab', { name: /Mês/ }))
    await waitFor(() =>
      expect(rpc.calls.at(-1)?.args).toMatchObject({ p_from: '2026-11-01', p_to: '2026-11-30' }),
    )
  })

  it('mostra os itens agrupados por dia com os rótulos Hoje, Amanhã e dia da semana', async () => {
    rpc.rows = [
      task({ id: 't-11', title: 'Tarefa de hoje', date: '2026-11-11' }),
      nextAction({ id: 'dem-12', title: 'Ação de amanhã', date: '2026-11-12', demand_id: 'dem-12' }),
      task({ id: 't-16', title: 'Tarefa de segunda', date: '2026-11-16' }),
    ]

    renderPage('/agenda?v=mes')

    expect(await screen.findByText('Tarefa de hoje')).toBeInTheDocument()
    expect(screen.getByText('Hoje')).toBeInTheDocument()
    expect(screen.getByText('Amanhã')).toBeInTheDocument()
    expect(screen.getByText('seg., 16 nov.')).toBeInTheDocument()
    expect(screen.getByText('Ação de amanhã')).toBeInTheDocument()
    expect(screen.getByText('Tarefa de segunda')).toBeInTheDocument()
  })

  it('aba Atrasados usa o intervalo de 60 dias e só mostra itens atrasados', async () => {
    rpc.rows = [
      task({ id: 't-over', title: 'Tarefa atrasada', date: '2026-11-05', overdue: true }),
      task({ id: 't-future', title: 'Tarefa futura', date: '2026-11-20', overdue: false }),
    ]

    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: /Atrasados/ }))

    // 11/11/2026 - 60 dias = 12/09/2026; termina ontem (10/11/2026).
    await waitFor(() =>
      expect(rpc.calls.at(-1)?.args).toMatchObject({ p_from: '2026-09-12', p_to: '2026-11-10' }),
    )
    expect(await screen.findByText('Tarefa atrasada')).toBeInTheDocument()
    expect(screen.queryByText('Tarefa futura')).toBeNull()
    expect(screen.getAllByText('Atrasado').length).toBeGreaterThan(0)
  })

  it('mostra o estado de erro quando a RPC falha', async () => {
    rpc.error = { message: 'Falha ao carregar a agenda' }

    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Falha ao carregar a agenda')
  })

  it('cada tipo leva ao lugar certo e a parcela mostra o valor', async () => {
    rpc.rows = [
      task({ id: 't-1', title: 'Juntar documentos' }),
      nextAction({ id: 'dem-1', title: 'Protocolar contestação', demand_id: 'dem-1' }),
      installment({ id: 'inst-1', title: 'Parcela 1', contract_id: 'con-1', amount: 150.5 }),
    ]

    renderPage('/agenda?v=mes')

    const taskLink = await screen.findByRole('link', { name: /Juntar documentos/ })
    expect(taskLink).toHaveAttribute('href', '/tarefas')

    const demandLink = screen.getByRole('link', { name: /Protocolar contestação/ })
    expect(demandLink).toHaveAttribute('href', '/demandas/dem-1')

    const contractLink = screen.getByRole('link', { name: /Parcela 1/ })
    expect(contractLink).toHaveAttribute('href', '/contratos/con-1')
    expect(contractLink.textContent).toMatch(/150,50/)
  })
})
