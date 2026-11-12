import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui'
import type { Demand, WorkflowStage } from '@/types/database'
import type { TaskTemplateRow } from './taskTemplatesApi'
import { StageTasksPrompt } from './StageTasksPrompt'

const NOW = '2026-11-12T12:00:00.000Z'

const rpcCalls = vi.hoisted(() => [] as { fn: string; args: Record<string, unknown> }[])

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({ orgId: 'org-1', userId: 'user-1', role: 'advogado', can: () => true }),
}))

vi.mock('@/hooks/useOrgData', () => ({
  useMemberNames: () => ({
    map: new Map([['user-1', 'Ana Advogada']]),
    options: [{ value: 'user-1', label: 'Ana Advogada' }],
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      if (fn === 'kickoff_demand') {
        const tasks = Array.isArray(args.p_tasks) ? args.p_tasks : []
        return { data: { checklist_items: 0, tasks_created: tasks.length }, error: null }
      }
      return { data: null, error: null }
    }),
  },
  unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
    if (r?.error) throw new Error(String(r.error))
    return r.data as T
  },
}))

const stage: WorkflowStage = {
  id: 'stage-1',
  organization_id: 'org-1',
  category_id: 'cat-1',
  name: 'Análise inicial',
  position: 0,
  is_final: false,
  is_waiting_docs: false,
  created_at: NOW,
  updated_at: NOW,
}

function makeDemand(over: Partial<Demand> = {}): Demand {
  return {
    id: 'demand-1',
    organization_id: 'org-1',
    client_id: 'client-1',
    category_id: 'cat-1',
    stage_id: 'stage-1',
    title: 'Aposentadoria por idade',
    description: null,
    responsible_id: 'user-1',
    opened_at: '2026-11-01',
    priority: 'media',
    status: 'em_andamento',
    next_action: null,
    next_action_date: null,
    notes: null,
    stage_changed_at: NOW,
    closed_at: null,
    created_by: 'user-1',
    created_at: NOW,
    updated_at: NOW,
    ...over,
  }
}

function makeTemplate(over: Partial<TaskTemplateRow> = {}): TaskTemplateRow {
  return {
    id: `template-${Math.random().toString(36).slice(2)}`,
    organization_id: 'org-1',
    category_id: 'cat-1',
    stage_id: 'stage-1',
    title: 'Conferir documentos',
    offset_days: 0,
    priority: 'media',
    position: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  }
}

function renderPrompt(templates: TaskTemplateRow[], demand: Demand = makeDemand()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } })
  const onClose = vi.fn()
  const view = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <StageTasksPrompt demand={demand} stage={stage} templates={templates} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...view, onClose }
}

function kickoffCalls() {
  return rpcCalls.filter((c) => c.fn === 'kickoff_demand')
}

beforeEach(() => {
  rpcCalls.length = 0
  // Data fixa: 12/11/2026 (quinta-feira). Assim as datas de suggestTasks são determinísticas.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-12T12:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('<StageTasksPrompt> — tarefas sugeridas ao entrar na etapa', () => {
  it('mostra as sugestões marcadas, com datas de suggestTasks e responsável da demanda', () => {
    renderPrompt([
      makeTemplate({ id: 't1', title: 'Conferir documentos', offset_days: 0, position: 0 }),
      makeTemplate({ id: 't2', title: 'Solicitar documentos', offset_days: 2, position: 1 }),
      makeTemplate({ id: 't3', title: 'Retorno ao cliente', offset_days: 7, position: 2 }),
    ])

    expect(screen.getByText(/Etapa “Análise inicial”: criar tarefas sugeridas\?/)).toBeInTheDocument()
    expect(screen.getByText('Datas sugeridas para organização interna. Confira os prazos legais do caso.')).toBeInTheDocument()

    expect(screen.getByLabelText('Incluir Conferir documentos')).toBeChecked()
    expect(screen.getByLabelText('Incluir Solicitar documentos')).toBeChecked()
    expect(screen.getByLabelText('Incluir Retorno ao cliente')).toBeChecked()

    // 12/11/2026 é quinta. offset 0 = 12/11 (qui); offset 2 = 14/11 (sáb) → 16/11 (seg); offset 7 = 19/11 (qui).
    expect(screen.getByLabelText('Data da tarefa 1')).toHaveValue('2026-11-12')
    expect(screen.getByLabelText('Data da tarefa 2')).toHaveValue('2026-11-16')
    expect(screen.getByLabelText('Data da tarefa 3')).toHaveValue('2026-11-19')

    expect(screen.getByLabelText('Título da tarefa 1')).toHaveValue('Conferir documentos')
    expect(screen.getByLabelText('Responsável da tarefa 1')).toHaveValue('user-1')

    expect(screen.getByRole('button', { name: 'Criar tarefas' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agora não' })).toBeInTheDocument()
  })

  it('desmarcar uma tarefa não a envia na RPC', async () => {
    renderPrompt([
      makeTemplate({ id: 't1', title: 'Conferir documentos', offset_days: 0, position: 0 }),
      makeTemplate({ id: 't2', title: 'Solicitar documentos', offset_days: 2, position: 1 }),
    ])

    fireEvent.click(screen.getByLabelText('Incluir Conferir documentos'))
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefas' }))

    await waitFor(() => expect(kickoffCalls()).toHaveLength(1))
    const tasks = kickoffCalls()[0].args.p_tasks as { title: string }[]
    expect(tasks.map((t) => t.title)).toEqual(['Solicitar documentos'])
  })

  it('editar a data envia a data editada', async () => {
    renderPrompt([makeTemplate({ id: 't1', title: 'Retorno ao cliente', offset_days: 2, position: 0 })])

    fireEvent.change(screen.getByLabelText('Data da tarefa 1'), { target: { value: '2026-12-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefas' }))

    await waitFor(() => expect(kickoffCalls()).toHaveLength(1))
    const tasks = kickoffCalls()[0].args.p_tasks as { title: string; due_date: string | null }[]
    expect(tasks).toEqual([expect.objectContaining({ title: 'Retorno ao cliente', due_date: '2026-12-31' })])
  })

  it('envia p_checklist: false e mostra o toast com a quantidade criada', async () => {
    renderPrompt([
      makeTemplate({ id: 't1', title: 'Conferir documentos', offset_days: 0, position: 0 }),
      makeTemplate({ id: 't2', title: 'Solicitar documentos', offset_days: 2, position: 1 }),
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefas' }))

    await waitFor(() => expect(kickoffCalls()).toHaveLength(1))
    expect(kickoffCalls()[0].args.p_checklist).toBe(false)
    expect(kickoffCalls()[0].args.p_demand).toBe('demand-1')
    expect(await screen.findByText('2 tarefa(s) criada(s).')).toBeInTheDocument()
  })

  it('"Agora não" fecha sem chamar a RPC', async () => {
    const { onClose } = renderPrompt([makeTemplate({ id: 't1', title: 'Conferir documentos' })])

    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(kickoffCalls()).toHaveLength(0)
  })

  it('valida o título como o KickoffStep e não chama a RPC com título curto', async () => {
    renderPrompt([makeTemplate({ id: 't1', title: 'Conferir documentos' })])

    fireEvent.change(screen.getByLabelText('Título da tarefa 1'), { target: { value: 'ab' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefas' }))

    expect(await screen.findByText(/entre 3 e 160 caracteres/)).toBeInTheDocument()
    expect(kickoffCalls()).toHaveLength(0)
  })
})
