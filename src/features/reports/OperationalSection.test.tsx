import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/ui'
import { OperationalSection } from './OperationalSection'

interface StageMetrics {
  name: string
  category_name: string
  position: number
  open_now: number
  avg_age_open_days: number | null
  oldest_open_days: number | null
  avg_days_completed: number | null
  passes_completed: number
}

interface WorkloadRow {
  user_id: string
  name: string
  open_demands: number
  open_tasks: number
  overdue_tasks: number
  next_actions_overdue: number
}

interface OperationalMetrics {
  stages: StageMetrics[]
  bottlenecks: StageMetrics[]
  workload: WorkloadRow[]
}

const mock = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  metrics: null as unknown,
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
      return mock.error ? { data: null, error: mock.error } : { data: mock.metrics, error: null }
    },
    from: () => {
      throw new Error('A seção operacional deve consultar somente a RPC operational_metrics')
    },
  },
  unwrap: <T,>(res: { data: T | null; error: unknown }): T => {
    if (res?.error) throw new Error(String((res.error as { message?: string }).message ?? res.error))
    return res.data as T
  },
}))

const triagem: StageMetrics = {
  name: 'Triagem',
  category_name: 'Previdenciário',
  position: 0,
  open_now: 7,
  avg_age_open_days: 34,
  oldest_open_days: 60,
  avg_days_completed: 12.5,
  passes_completed: 4,
}

const aguardando: StageMetrics = {
  name: 'Aguardando documentação',
  category_name: 'Previdenciário',
  position: 1,
  open_now: 4,
  avg_age_open_days: 21.5,
  oldest_open_days: 40,
  avg_days_completed: null,
  passes_completed: 0,
}

const protocolo: StageMetrics = {
  name: 'Protocolo',
  category_name: 'Trabalhista',
  position: 0,
  open_now: 2,
  avg_age_open_days: 8,
  oldest_open_days: 12,
  avg_days_completed: 9,
  passes_completed: 3,
}

const concluido: StageMetrics = {
  name: 'Concluído',
  category_name: 'Trabalhista',
  position: 1,
  open_now: 0,
  avg_age_open_days: null,
  oldest_open_days: null,
  avg_days_completed: 18,
  passes_completed: 6,
}

const fullMetrics: OperationalMetrics = {
  stages: [triagem, aguardando, protocolo, concluido],
  bottlenecks: [triagem, aguardando, protocolo],
  workload: [
    { user_id: 'u1', name: 'Ana Advogada', open_demands: 5, open_tasks: 7, overdue_tasks: 3, next_actions_overdue: 2 },
    { user_id: 'u2', name: 'Bruno Assistente', open_demands: 2, open_tasks: 4, overdue_tasks: 0, next_actions_overdue: 1 },
  ],
}

const emptyMetrics: OperationalMetrics = { stages: [], bottlenecks: [], workload: [] }

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <OperationalSection />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mock.calls = []
  mock.metrics = null
  mock.error = null
})

describe('<OperationalSection>', () => {
  it('consulta a RPC operational_metrics com o escritório atual', async () => {
    mock.metrics = fullMetrics
    renderSection()

    expect(await screen.findByText('Gargalos por etapa')).toBeInTheDocument()
    expect(mock.calls).toHaveLength(1)
    expect(mock.calls[0].fn).toBe('operational_metrics')
    expect(mock.calls[0].args).toMatchObject({ p_org: 'org-1' })
  })

  it('destaca até três gargalos em ordem, com etapa, abertas e idade média', async () => {
    mock.metrics = fullMetrics
    renderSection()

    await screen.findByText('Gargalos por etapa')

    const text = document.body.textContent ?? ''
    // Formato do plano: "Etapa X: 7 demandas, 34 dias em média".
    expect(text).toContain('Etapa Triagem: 7 demandas, 34 dias em média')

    const i1 = text.indexOf('Etapa Triagem:')
    const i2 = text.indexOf('Etapa Aguardando documentação:')
    const i3 = text.indexOf('Etapa Protocolo:')
    expect(i1).toBeGreaterThanOrEqual(0)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
  })

  it('mostra a tabela de gargalos com os níveis de alerta', async () => {
    mock.metrics = fullMetrics
    renderSection()

    await screen.findByText('Gargalos por etapa')
    expect(screen.getByText('Abertas agora')).toBeInTheDocument()
    expect(screen.getByText('Idade média')).toBeInTheDocument()
    expect(screen.getByText('Mais antiga')).toBeInTheDocument()
    expect(screen.getByText(/Tempo médio na etapa/)).toBeInTheDocument()

    // Triagem é alto (7 abertas), Aguardando é médio (4 abertas), Protocolo é baixo.
    expect(screen.getAllByText(/^alto$/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^m[eé]dio$/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/^baixo$/i).length).toBeGreaterThan(0)
  })

  it('mostra a carga por responsável, na ordem de atrasos', async () => {
    mock.metrics = fullMetrics
    renderSection()

    await screen.findByText('Carga por responsável')
    expect(screen.getByText('Responsável')).toBeInTheDocument()
    expect(screen.getByText('Demandas abertas')).toBeInTheDocument()
    expect(screen.getByText('Tarefas abertas')).toBeInTheDocument()
    expect(screen.getByText('Tarefas atrasadas')).toBeInTheDocument()
    expect(screen.getByText('Próximas ações vencidas')).toBeInTheDocument()

    const ana = screen.getByText('Ana Advogada').closest('tr')
    const bruno = screen.getByText('Bruno Assistente').closest('tr')
    expect(ana).not.toBeNull()
    expect(bruno).not.toBeNull()

    // Ana: 5 demandas, 7 tarefas abertas, 3 atrasadas, 2 próximas ações vencidas.
    const anaRow = within(ana as HTMLElement)
    expect(anaRow.getByText('5')).toBeInTheDocument()
    expect(anaRow.getByText('7')).toBeInTheDocument()
    expect(anaRow.getByText('3')).toBeInTheDocument()
    expect(anaRow.getByText('2')).toBeInTheDocument()

    const brunoRow = within(bruno as HTMLElement)
    expect(brunoRow.getByText('2')).toBeInTheDocument()
    expect(brunoRow.getByText('4')).toBeInTheDocument()
    expect(brunoRow.getByText('0')).toBeInTheDocument()
    expect(brunoRow.getByText('1')).toBeInTheDocument()

    const text = document.body.textContent ?? ''
    expect(text.indexOf('Ana Advogada')).toBeLessThan(text.indexOf('Bruno Assistente'))
  })

  it('mostra o estado vazio quando ainda não há histórico', async () => {
    mock.metrics = emptyMetrics
    renderSection()

    expect(await screen.findByText(/Ainda não há histórico suficiente/)).toBeInTheDocument()
    expect(
      screen.getByText(/Os tempos aparecem conforme as demandas mudam de etapa/),
    ).toBeInTheDocument()
  })
})
