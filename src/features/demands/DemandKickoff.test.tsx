import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui'
import type { Demand } from '@/types/database'
import { DemandFormModal } from './DemandFormModal'

const NOW = vi.hoisted(() => '2026-11-09T12:00:00.000Z')

const mockDb = vi.hoisted(() => ({
  taskTemplates: [] as Record<string, unknown>[],
  checklistTemplates: [] as Record<string, unknown>[],
  demands: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
}))

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({
    orgId: 'org-1',
    userId: 'user-1',
    role: 'advogado',
    profile: { id: 'user-1', full_name: 'Ana Advogada', email: 'ana@teste.local' },
    organization: { id: 'org-1', name: 'Escritório Teste' },
    can: () => true,
  }),
}))

vi.mock('@/lib/supabase', () => {
  type Row = Record<string, unknown>
  interface Filter {
    column: string
    op: 'eq' | 'is' | 'in' | 'ilike'
    value: unknown
  }
  interface Sort {
    column: string
    ascending: boolean
    nullsFirst: boolean
  }

  const client: Row = {
    id: 'client-1',
    organization_id: 'org-1',
    full_name: 'Maria Souza',
    cpf: null,
    phone: null,
    email: null,
    birth_date: null,
    address: null,
    notes: null,
    status: 'ativo',
    anonymized_at: null,
    created_by: null,
    created_at: NOW,
    updated_at: NOW,
  }
  const stage: Row = {
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
  const category: Row = {
    id: 'cat-1',
    organization_id: 'org-1',
    name: 'Aposentadoria',
    color: '#1f2937',
    sort_order: 0,
    active: true,
    created_at: NOW,
    updated_at: NOW,
    stages: [stage],
  }
  const member: Row = {
    id: 'member-1',
    organization_id: 'org-1',
    user_id: 'user-1',
    role: 'advogado',
    active: true,
    created_at: NOW,
    updated_at: NOW,
    profile: { id: 'user-1', full_name: 'Ana Advogada', email: 'ana@teste.local' },
  }

  function rowsOf(table: string): Row[] {
    switch (table) {
      case 'clients':
        return [client]
      case 'organization_members':
        return [member]
      case 'profiles':
        return [member.profile as Row]
      case 'demand_categories':
        return [category]
      case 'workflow_stages':
        return [stage]
      case 'task_templates':
        return mockDb.taskTemplates
      case 'checklist_templates':
        return mockDb.checklistTemplates
      case 'demands':
        return mockDb.demands
      default:
        return []
    }
  }

  function matches(row: Row, filters: Filter[]) {
    return filters.every((f) => {
      const value = row[f.column]
      if (f.op === 'eq' || f.op === 'is') return value === f.value
      if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(value)
      return typeof value === 'string' && value.toLowerCase().includes(String(f.value).toLowerCase())
    })
  }

  let nextId = 1

  function builder(table: string) {
    const filters: Filter[] = []
    const sorts: Sort[] = []
    let limit: number | null = null
    let offset = 0
    type Op = 'select' | 'insert' | 'update' | 'delete'
    let op: Op = 'select'
    let insertPayload: Row | null = null
    let updatePayload: Row | null = null

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
      if (limit != null) rows = rows.slice(offset, offset + limit)
      return rows
    }

    const execute = (): Row[] => {
      if (op === 'insert') {
        const row: Row = {
          id: `demand-${nextId++}`,
          created_at: NOW,
          updated_at: NOW,
          stage_changed_at: NOW,
          ...insertPayload,
        }
        rowsOf(table).push(row)
        return [row]
      }
      if (op === 'update') {
        const rows = applyFilters()
        for (const row of rows) Object.assign(row, updatePayload)
        return rows
      }
      if (op === 'delete') {
        const all = rowsOf(table)
        const removed = all.filter((row) => matches(row, filters))
        const kept = all.filter((row) => !matches(row, filters))
        all.length = 0
        all.push(...kept)
        return removed
      }
      return applyFilters()
    }

    const q = {
      select: () => q,
      insert: (payload: Row) => {
        op = 'insert'
        insertPayload = payload
        return q
      },
      update: (payload: Row) => {
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
      like: (column: string, value: unknown) => {
        filters.push({ column, op: 'ilike', value: String(value).replaceAll('%', '') })
        return q
      },
      not: () => q,
      order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
        sorts.push({ column, ascending: options?.ascending !== false, nullsFirst: options?.nullsFirst === true })
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
      single: async () => ({ data: execute()[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: execute()[0] ?? null, error: null }),
      then<TResult1 = { data: Row[]; error: null; count: number }, TResult2 = never>(
        onfulfilled?: ((value: { data: Row[]; error: null; count: number }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        const rows = execute()
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(onfulfilled, onrejected)
      },
    }

    return q
  }

  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        mockDb.rpcCalls.push({ fn, args })
        if (fn === 'kickoff_demand') {
          const tasks = Array.isArray(args.p_tasks) ? args.p_tasks : []
          return {
            data: {
              checklist_items: args.p_checklist ? mockDb.checklistTemplates.length : 0,
              tasks_created: tasks.length,
            },
            error: null,
          }
        }
        return { data: null, error: null }
      },
    },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) throw new Error(String(r.error))
      return r.data as T
    },
    fetchAllRows: async () => [],
  }
})

function seedTaskTemplate(over: Partial<Record<string, unknown>> = {}) {
  mockDb.taskTemplates.push({
    id: `task-template-${mockDb.taskTemplates.length + 1}`,
    organization_id: 'org-1',
    category_id: 'cat-1',
    title: 'Conferir documentos pessoais do cliente',
    offset_days: 0,
    priority: 'media',
    position: 0,
    stage_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  })
}

function seedChecklistTemplate(over: Partial<Record<string, unknown>> = {}) {
  mockDb.checklistTemplates.push({
    id: `checklist-template-${mockDb.checklistTemplates.length + 1}`,
    organization_id: 'org-1',
    category_id: 'cat-1',
    label: 'Documento de identificação com CPF',
    position: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  })
}

function makeDemand(over: Partial<Demand> = {}): Demand {
  return {
    id: 'demand-existing',
    organization_id: 'org-1',
    client_id: 'client-1',
    category_id: 'cat-1',
    stage_id: 'stage-1',
    title: 'Demanda antiga',
    description: null,
    responsible_id: 'user-1',
    opened_at: '2020-01-10',
    priority: 'media',
    status: 'em_andamento',
    next_action: null,
    next_action_date: null,
    notes: null,
    stage_changed_at: NOW,
    closed_at: null,
    created_by: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  }
}

type ModalProps = Omit<Parameters<typeof DemandFormModal>[0], 'open'>

function renderModal(props: Partial<ModalProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } })
  const onClose = props.onClose ?? vi.fn()
  const onSaved = props.onSaved ?? vi.fn()
  const view = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DemandFormModal
          open
          onClose={onClose}
          onSaved={onSaved}
          defaults={{ client_id: 'client-1', category_id: 'cat-1' }}
          {...props}
        />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { ...view, onClose, onSaved }
}

async function fillAndCreate(title = 'Aposentadoria por idade') {
  fireEvent.change(await screen.findByLabelText(/^Título/), { target: { value: title } })
  fireEvent.change(screen.getByLabelText(/^Responsável/), { target: { value: 'user-1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Criar demanda' }))
}

function kickoffCalls() {
  return mockDb.rpcCalls.filter((c) => c.fn === 'kickoff_demand')
}

function checkboxNear(text: string): HTMLInputElement {
  const input = screen.getByText(text).closest('label')?.querySelector('input[type="checkbox"]')
  if (!(input instanceof HTMLInputElement)) throw new Error(`checkbox não encontrado para "${text}"`)
  return input
}

/** Sobe do título editável até o contêiner que tem o checkbox e a data da tarefa. */
function taskRow(title: string): HTMLElement {
  let el: HTMLElement | null = screen.getByDisplayValue(title) as HTMLElement
  while (el) {
    if (el.querySelector('input[type="checkbox"]') && el.querySelector('input[type="date"]')) return el
    el = el.parentElement
  }
  throw new Error(`linha da tarefa "${title}" não encontrada`)
}

beforeEach(() => {
  mockDb.taskTemplates.length = 0
  mockDb.checklistTemplates.length = 0
  mockDb.demands.length = 0
  mockDb.rpcCalls.length = 0

  seedChecklistTemplate()
  seedChecklistTemplate({ label: 'Comprovante de residência', position: 1 })
  seedTaskTemplate()
  seedTaskTemplate({
    title: 'Solicitar documentos pendentes ao cliente',
    offset_days: 2,
    priority: 'alta',
    position: 1,
  })
})

describe('<DemandFormModal> — preparação da demanda após criar', () => {
  it('mostra o passo com sugestões, checklist marcado, aviso e responsável padrão', async () => {
    renderModal()
    await fillAndCreate()

    expect(await screen.findByText('Preparar a demanda')).toBeInTheDocument()
    expect(
      screen.getByText('Datas sugeridas para organização interna. Confira os prazos legais do caso.'),
    ).toBeInTheDocument()

    expect(screen.getByText('Aplicar checklist da categoria (2 itens)')).toBeInTheDocument()
    expect(checkboxNear('Aplicar checklist da categoria (2 itens)')).toBeChecked()

    expect(screen.getByDisplayValue('Conferir documentos pessoais do cliente')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Solicitar documentos pendentes ao cliente')).toBeInTheDocument()

    // Responsável padrão de cada sugestão = responsável escolhido na demanda.
    expect(taskRow('Solicitar documentos pendentes ao cliente').querySelector('select')?.value).toBe('user-1')

    expect(screen.getByRole('button', { name: 'Criar e abrir demanda' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pular' })).toBeInTheDocument()
  })

  it('envia o checklist quando marcado e todas as tarefas selecionadas', async () => {
    renderModal()
    await fillAndCreate()
    await screen.findByText('Preparar a demanda')

    fireEvent.click(screen.getByRole('button', { name: 'Criar e abrir demanda' }))

    await waitFor(() => expect(kickoffCalls()).toHaveLength(1))
    const args = kickoffCalls()[0].args
    expect(args.p_checklist).toBe(true)
    const tasks = args.p_tasks as { title: string }[]
    expect(tasks.map((t) => t.title)).toEqual([
      'Conferir documentos pessoais do cliente',
      'Solicitar documentos pendentes ao cliente',
    ])
  })

  it('desmarcar uma tarefa não a envia', async () => {
    mockDb.checklistTemplates.length = 0
    renderModal()
    await fillAndCreate()
    await screen.findByText('Preparar a demanda')

    const row = taskRow('Conferir documentos pessoais do cliente')
    fireEvent.click(row.querySelector('input[type="checkbox"]') as HTMLInputElement)

    fireEvent.click(screen.getByRole('button', { name: 'Criar e abrir demanda' }))

    await waitFor(() => expect(kickoffCalls()).toHaveLength(1))
    const args = kickoffCalls()[0].args
    expect(args.p_checklist).toBe(false)
    expect((args.p_tasks as { title: string }[]).map((t) => t.title)).toEqual([
      'Solicitar documentos pendentes ao cliente',
    ])
  })

  it('editar a data de uma sugestão envia a data editada', async () => {
    mockDb.taskTemplates.length = 0
    mockDb.checklistTemplates.length = 0
    seedTaskTemplate({ title: 'Retorno ao cliente', offset_days: 2, position: 0 })

    renderModal()
    await fillAndCreate('Revisão de benefício')
    await screen.findByText('Preparar a demanda')

    const dateInput = taskRow('Retorno ao cliente').querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-12-31' } })

    fireEvent.click(screen.getByRole('button', { name: 'Criar e abrir demanda' }))

    await waitFor(() => expect(kickoffCalls()).toHaveLength(1))
    const tasks = kickoffCalls()[0].args.p_tasks as { title: string; due_date: string | null }[]
    expect(tasks).toEqual([
      expect.objectContaining({ title: 'Retorno ao cliente', due_date: '2026-12-31' }),
    ])
  })

  it('"Pular" não chama a RPC e fecha o modal', async () => {
    const { onClose } = renderModal()
    await fillAndCreate()
    await screen.findByText('Preparar a demanda')

    fireEvent.click(screen.getByRole('button', { name: 'Pular' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(kickoffCalls()).toHaveLength(0)
  })

  it('editar uma demanda existente não mostra o passo de preparação', async () => {
    const demand = makeDemand()
    mockDb.demands.push(demand as unknown as Record<string, unknown>)

    const { onClose } = renderModal({ demand })
    fireEvent.change(await screen.findByLabelText(/^Título/), { target: { value: 'Demanda atualizada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Preparar a demanda')).not.toBeInTheDocument()
    expect(kickoffCalls()).toHaveLength(0)
  })

  it('categoria sem tarefas-modelo nem checklist fecha como antes', async () => {
    mockDb.taskTemplates.length = 0
    mockDb.checklistTemplates.length = 0

    const { onClose } = renderModal()
    await fillAndCreate()

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Preparar a demanda')).not.toBeInTheDocument()
    expect(kickoffCalls()).toHaveLength(0)
  })
})
