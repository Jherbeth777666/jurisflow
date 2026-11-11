import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui'
import type { Proposal } from './proposals'
import { ProposalCard } from './ProposalCard'

const ui = vi.hoisted(() => ({
  can: true,
  clients: [] as { id: string; full_name: string; cpf: string | null }[],
  members: [] as Record<string, unknown>[],
  categories: [] as Record<string, unknown>[],
}))

const patchDemand = vi.hoisted(() => vi.fn())

const mock = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  inserts: [] as { table: string; payload: Record<string, unknown> }[],
  updates: [] as { table: string; patch: Record<string, unknown>; filters: [string, unknown][] }[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  taskRow: { id: 'task-new' } as Record<string, unknown>,
  rpcError: null as { message: string } | null,
}))

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({
    orgId: 'org-1',
    userId: 'user-1',
    role: 'advogado',
    profile: { id: 'user-1', full_name: 'Ana Advogada', email: 'ana@teste.com' },
    organization: { id: 'org-1', name: 'Escritório Teste' },
    can: () => ui.can,
  }),
}))

vi.mock('@/hooks/useOrgData', () => ({
  qk: {
    members: (org: string) => ['members', org],
    categories: (org: string) => ['categories', org],
    clients: (org: string, ...rest: unknown[]) => ['clients', org, ...rest],
    demands: (org: string, ...rest: unknown[]) => ['demands', org, ...rest],
    tasks: (org: string, ...rest: unknown[]) => ['tasks', org, ...rest],
    dashboard: (org: string) => ['dashboard', org],
    activity: (org: string, ...rest: unknown[]) => ['activity', org, ...rest],
    ai: (org: string, ...rest: unknown[]) => ['ai', org, ...rest],
  },
  useClientLookup: () => ({ data: ui.clients, isLoading: false, isError: false, error: null }),
  useMembers: () => ({ data: ui.members, isLoading: false, isError: false, error: null }),
  useCategories: () => ({ data: ui.categories, isLoading: false, isError: false, error: null }),
  useMemberNames: () => ({
    data: ui.members,
    isLoading: false,
    isError: false,
    error: null,
    map: new Map<string, string>(),
    options: [],
  }),
  memberName: (m: { profile?: { full_name?: string } } | null) => m?.profile?.full_name ?? '—',
}))

vi.mock('@/features/demands/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/demands/api')>()
  return { ...actual, usePatchDemand: () => ({ mutateAsync: patchDemand, isPending: false }) }
})

vi.mock('@/lib/supabase', () => {
  type Row = Record<string, unknown>
  interface Query {
    select(columns?: string, options?: unknown): Query
    eq(column: string, value: unknown): Query
    neq(column: string, value: unknown): Query
    in(column: string, values: unknown[]): Query
    is(column: string, value: unknown): Query
    not(column: string, operator: string, value: unknown): Query
    ilike(column: string, value: unknown): Query
    like(column: string, value: unknown): Query
    or(value: string): Query
    order(column: string, options?: unknown): Query
    limit(count: number): Query
    range(from: number, to: number): Query
    insert(payload: Row): Query
    update(patch: Row): Query
    delete(): Query
    single(): Promise<{ data: unknown; error: unknown }>
    maybeSingle(): Promise<{ data: unknown; error: unknown }>
    then<T1 = { data: unknown[]; error: unknown }, T2 = never>(
      onfulfilled?: ((value: { data: unknown[]; error: unknown }) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): Promise<T1 | T2>
  }
  function builder(table: string): Query {
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Row | null = null
    const filters: [string, unknown][] = []
    const q: Query = {
      select: () => q,
      eq: (column, value) => {
        filters.push([column, value])
        return q
      },
      neq: () => q,
      in: () => q,
      is: () => q,
      not: () => q,
      ilike: () => q,
      like: () => q,
      or: () => q,
      order: () => q,
      limit: () => q,
      range: () => q,
      insert: (p) => {
        mode = 'insert'
        payload = p
        mock.inserts.push({ table, payload: p })
        return q
      },
      update: (p) => {
        mode = 'update'
        payload = p
        mock.updates.push({ table, patch: p, filters })
        return q
      },
      delete: () => {
        mode = 'delete'
        return q
      },
      single: async () => {
        if (mode === 'insert') return { data: mock.taskRow, error: null }
        if (mode === 'update') return { data: { id: 'dem-1', ...(payload ?? {}) }, error: null }
        return { data: null, error: null }
      },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (onfulfilled, onrejected) => {
        const data = mode === 'select' ? (mock.tables[table] ?? []) : mode === 'insert' ? [mock.taskRow] : []
        return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected)
      },
    }
    return q
  }
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        mock.rpcCalls.push({ fn, args })
        return { data: null, error: mock.rpcError }
      },
    },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) {
        const err = r.error as { message?: string }
        throw new Error(err?.message ?? String(r.error))
      }
      return r.data as T
    },
    fetchAllRows: async () => [],
  }
})

function makeProposal(over: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p-1',
    kind: 'criar_tarefa',
    fields: { title: 'Revisar prazo', due_date: '2026-11-12' },
    status: 'pendente',
    ...over,
  }
}

function renderCard(proposal: Proposal) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ProposalCard proposal={proposal} messageId="msg-1" />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  ui.can = true
  ui.clients = [{ id: 'cli-1', full_name: 'Maria Cliente', cpf: null }]
  ui.members = [
    {
      id: 'mem-1',
      organization_id: 'org-1',
      user_id: 'user-1',
      role: 'advogado',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      profile: { id: 'user-1', full_name: 'Ana Advogada', email: 'ana@teste.com' },
    },
  ]
  ui.categories = [
    {
      id: 'cat-1',
      organization_id: 'org-1',
      name: 'Previdenciário',
      color: '#2563eb',
      sort_order: 1,
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      stages: [
        { id: 'stg-1', organization_id: 'org-1', category_id: 'cat-1', name: 'Em análise', position: 1, is_final: false, is_waiting_docs: false },
        { id: 'stg-2', organization_id: 'org-1', category_id: 'cat-1', name: 'Protocolado', position: 2, is_final: false, is_waiting_docs: false },
      ],
    },
  ]
  mock.tables = {}
  mock.inserts = []
  mock.updates = []
  mock.rpcCalls = []
  mock.taskRow = { id: 'task-new' }
  mock.rpcError = null
  patchDemand.mockReset()
  patchDemand.mockResolvedValue({ id: 'dem-1' })
})

describe('<ProposalCard>', () => {
  it('proposta pendente avisa que nada foi gravado', async () => {
    renderCard(makeProposal())

    expect(await screen.findByText('Sugestão gerada por IA. Nada foi gravado ainda.')).toBeInTheDocument()
    expect(screen.getByText('Proposta da IA — confira antes de gravar')).toBeInTheDocument()
    expect(screen.getByText('Pendente')).toBeInTheDocument()
  })

  it('confirmar tarefa grava em tasks com os valores editados e registra a confirmação', async () => {
    renderCard(makeProposal())

    const title = await screen.findByLabelText(/título/i)
    expect(title).toHaveValue('Revisar prazo')
    fireEvent.change(title, { target: { value: 'Revisar prazo do recurso' } })
    const due = screen.getByLabelText(/prazo/i)
    expect(due).toHaveValue('2026-11-12')
    fireEvent.change(due, { target: { value: '2026-11-20' } })

    const confirm = screen.getByRole('button', { name: 'Confirmar' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() => expect(mock.rpcCalls).toHaveLength(1))
    const inserted = mock.inserts.find((i) => i.table === 'tasks')
    expect(inserted?.payload).toMatchObject({
      title: 'Revisar prazo do recurso',
      due_date: '2026-11-20',
      organization_id: 'org-1',
      status: 'pendente',
    })
    expect(mock.rpcCalls[0]).toEqual({
      fn: 'ai_proposal_done',
      args: { p_message: 'msg-1', p_proposal: 'p-1', p_status: 'confirmada', p_entity: 'task-new' },
    })
  })

  it('confirmar próxima ação atualiza a demanda e registra a confirmação', async () => {
    mock.tables.demands = [
      { id: 'dem-1', title: 'Aposentadoria por idade', client_id: 'cli-1', category_id: 'cat-1', status: 'em_andamento' },
    ]
    renderCard(
      makeProposal({
        id: 'p-2',
        kind: 'definir_proxima_acao',
        fields: {
          demand_title: 'Aposentadoria por idade',
          next_action: 'Protocolar recurso',
          next_action_date: '2026-11-30',
        },
      }),
    )

    const confirm = await screen.findByRole('button', { name: 'Confirmar' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() => expect(mock.rpcCalls).toHaveLength(1))
    const update = mock.updates.find((u) => u.table === 'demands')
    expect(update?.patch).toMatchObject({ next_action: 'Protocolar recurso', next_action_date: '2026-11-30' })
    expect(update?.filters).toContainEqual(['organization_id', 'org-1'])
    expect(update?.filters).toContainEqual(['id', 'dem-1'])
    expect(mock.rpcCalls[0]).toEqual({
      fn: 'ai_proposal_done',
      args: { p_message: 'msg-1', p_proposal: 'p-2', p_status: 'confirmada', p_entity: 'dem-1' },
    })
  })

  it('confirmar mudança de etapa usa usePatchDemand e registra a confirmação', async () => {
    mock.tables.demands = [
      { id: 'dem-1', title: 'Aposentadoria por idade', client_id: 'cli-1', category_id: 'cat-1', status: 'em_andamento' },
    ]
    renderCard(
      makeProposal({
        id: 'p-3',
        kind: 'mover_etapa',
        fields: { demand_title: 'Aposentadoria por idade', stage_name: 'Protocolado' },
      }),
    )

    const confirm = await screen.findByRole('button', { name: 'Confirmar' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() => expect(patchDemand).toHaveBeenCalled())
    expect(patchDemand).toHaveBeenCalledWith({ id: 'dem-1', patch: { stage_id: 'stg-2' } })
    await waitFor(() => expect(mock.rpcCalls).toHaveLength(1))
    expect(mock.rpcCalls[0]).toEqual({
      fn: 'ai_proposal_done',
      args: { p_message: 'msg-1', p_proposal: 'p-3', p_status: 'confirmada', p_entity: 'dem-1' },
    })
  })

  it('descartar registra a decisão sem gravar nada', async () => {
    renderCard(makeProposal())

    const discard = await screen.findByRole('button', { name: 'Descartar' })
    fireEvent.click(discard)

    await waitFor(() => expect(mock.rpcCalls).toHaveLength(1))
    expect(mock.rpcCalls[0]).toMatchObject({
      fn: 'ai_proposal_done',
      args: { p_message: 'msg-1', p_proposal: 'p-1', p_status: 'descartada' },
    })
    expect(mock.inserts).toHaveLength(0)
    expect(mock.updates).toHaveLength(0)
    expect(patchDemand).not.toHaveBeenCalled()
  })

  it('nome ambíguo deixa Confirmar desabilitado até escolher o cliente', async () => {
    ui.clients = [
      { id: 'cli-1', full_name: 'Aposentadoria por idade', cpf: null },
      { id: 'cli-2', full_name: 'Aposentadoria por tempo de contribuição', cpf: null },
    ]
    renderCard(makeProposal({ fields: { title: 'Revisar prazo', client: 'Aposentadoria' } }))

    const confirm = await screen.findByRole('button', { name: 'Confirmar' })
    await waitFor(() => expect(confirm).toBeDisabled())
    expect(screen.getByText(/Confira: a IA citou/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/cliente/i), { target: { value: 'cli-2' } })
    await waitFor(() => expect(confirm).toBeEnabled())
  })

  it('não confirma tarefa sem título', async () => {
    renderCard(makeProposal())

    const title = await screen.findByLabelText(/título/i)
    fireEvent.change(title, { target: { value: '   ' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled())
  })

  it('proposta descartada aparece só como resumo, sem botões', async () => {
    renderCard(makeProposal({ status: 'descartada' }))

    expect(await screen.findByText('Descartada')).toBeInTheDocument()
    expect(screen.getByText('Criar tarefa “Revisar prazo” para 12/11/2026')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Descartar' })).toBeNull()
  })

  it('proposta já confirmada aparece só como resumo, sem botões', async () => {
    renderCard(makeProposal({ status: 'confirmada' }))

    expect(await screen.findByText('Feita')).toBeInTheDocument()
    expect(screen.getByText('Criar tarefa “Revisar prazo” para 12/11/2026')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirmar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Descartar' })).toBeNull()
  })

  it('mostra o erro no cartão quando a confirmação falha', async () => {
    mock.rpcError = { message: 'Falha ao registrar a proposta' }
    renderCard(makeProposal())

    const confirm = await screen.findByRole('button', { name: 'Confirmar' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao registrar a proposta')
  })
})
