import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ClientOverview } from '@/types/database'
import { ClientSummary } from './ClientSummary'

const mock = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  overview: null as ClientOverview | null,
  error: null as { message: string } | null,
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

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mock.calls.push({ fn, args })
      return mock.error ? { data: null, error: mock.error } : { data: mock.overview, error: null }
    },
    from: () => {
      throw new Error('ClientSummary deve consultar somente a RPC client_overview')
    },
  },
  unwrap: <T,>(res: { data: T | null; error: unknown }): T => {
    if (res?.error) throw new Error(String((res.error as { message?: string }).message ?? res.error))
    return res.data as T
  },
}))

const fullOverview: ClientOverview = {
  open_demands: [
    {
      id: 'd1',
      title: 'Revisar aposentadoria',
      status: 'em_andamento',
      stage_name: 'Protocolo',
      category_name: 'Aposentadoria',
      next_action: 'Protocolar recurso',
      next_action_date: '2026-11-05',
      next_action_overdue: true,
      checklist_pending: 3,
      checklist_total: 5,
      days_in_stage: 7,
    },
    {
      id: 'd2',
      title: 'Demanda em dia',
      status: 'aguardando_cliente',
      stage_name: 'Aguardando documentação',
      category_name: 'Outros',
      next_action: null,
      next_action_date: null,
      next_action_overdue: false,
      checklist_pending: 0,
      checklist_total: 2,
      days_in_stage: 3,
    },
    {
      id: 'd3',
      title: 'Demanda sem checklist',
      status: 'em_andamento',
      stage_name: 'A fazer',
      category_name: 'Outros',
      next_action: null,
      next_action_date: null,
      next_action_overdue: false,
      checklist_pending: 0,
      checklist_total: 0,
      days_in_stage: 0,
    },
  ],
  checklist_pending_items: [
    { demand_id: 'd1', demand_title: 'Revisar aposentadoria', label: 'RG' },
    { demand_id: 'd1', demand_title: 'Revisar aposentadoria', label: 'Comprovante de residência' },
    { demand_id: 'd1', demand_title: 'Revisar aposentadoria', label: 'Procuração' },
  ],
  tasks: { open: 4, overdue: 2, next_due_date: '2026-11-12' },
  finance: { open_amount: 1234.56, overdue_amount: 300, overdue_count: 1, next_due_date: '2026-11-20' },
  last_activity_at: '2026-11-05T12:00:00',
}

const emptyOverview: ClientOverview = {
  open_demands: [],
  checklist_pending_items: [],
  tasks: { open: 0, overdue: 0, next_due_date: null },
  finance: { open_amount: 0, overdue_amount: 0, overdue_count: 0, next_due_date: null },
  last_activity_at: null,
}

function renderSummary() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClientSummary clientId="cli-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mock.calls = []
  mock.overview = null
  mock.error = null
})

describe('<ClientSummary>', () => {
  it('consulta a RPC do cliente e mostra os indicadores', async () => {
    mock.overview = fullOverview
    renderSummary()

    const openDemands = await screen.findByRole('group', { name: 'Demandas abertas' })
    expect(within(openDemands).getByText('3')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Próximas ações atrasadas' })).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Documentos pendentes' })).getByText('3')).toBeInTheDocument()

    const tasks = screen.getByRole('group', { name: 'Tarefas atrasadas' })
    expect(within(tasks).getByText('2')).toBeInTheDocument()
    expect(within(tasks).getByText('de 4 abertas')).toBeInTheDocument()

    const finance = screen.getByRole('group', { name: 'Em aberto' })
    expect(within(finance).getByText(/R\$\s1\.234,56/)).toBeInTheDocument()
    expect(within(finance).getByText(/R\$\s300,00 vencido/)).toBeInTheDocument()

    expect(mock.calls[0]).toEqual({ fn: 'client_overview', args: { p_client: 'cli-1' } })
  })

  it('mostra as demandas em andamento com etapa, idade, próxima ação e checklist', async () => {
    mock.overview = fullOverview
    renderSummary()

    const link = await screen.findByRole('link', { name: 'Revisar aposentadoria' })
    expect(link).toHaveAttribute('href', '/demandas/d1')
    expect(screen.getByText(/Protocolo/)).toBeInTheDocument()
    expect(screen.getByText(/há 7 dias/)).toBeInTheDocument()
    expect(screen.getByText(/Protocolar recurso/)).toBeInTheDocument()
    expect(screen.getByText('Atrasada')).toBeInTheDocument()
    expect(screen.getByText('3 de 5 documentos')).toBeInTheDocument()
  })

  it('lista os documentos pendentes com o título da demanda e a última movimentação', async () => {
    mock.overview = fullOverview
    renderSummary()

    expect(await screen.findByText('RG')).toBeInTheDocument()
    expect(screen.getByText('Comprovante de residência')).toBeInTheDocument()
    expect(screen.getByText('Procuração')).toBeInTheDocument()
    expect(screen.getAllByText('Revisar aposentadoria').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Última movimentação: 05/11/2026')).toBeInTheDocument()
  })

  it('mostra o estado vazio quando não há documentos pendentes nem movimentação', async () => {
    mock.overview = emptyOverview
    renderSummary()

    expect(await screen.findByText('Nenhum documento pendente')).toBeInTheDocument()
    expect(screen.getByText('Sem movimentação registrada')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Demandas abertas' })).getByText('0')).toBeInTheDocument()
  })

  it('mostra o estado de erro quando a RPC falha', async () => {
    mock.error = { message: 'Sem acesso a este escritório' }
    renderSummary()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Não foi possível carregar os dados')
    expect(alert).toHaveTextContent('Sem acesso a este escritório')
  })
})
