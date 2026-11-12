import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ToastProvider } from '@/components/ui'
import type { PriorityLevel } from '@/types/database'
import { TaskTemplatesEditor } from './TaskTemplatesEditor'

const NOW = '2026-11-12T12:00:00.000Z'

interface TemplateRow {
  id: string
  organization_id: string
  category_id: string
  stage_id: string | null
  title: string
  offset_days: number | null
  priority: PriorityLevel
  position: number
  created_at: string
  updated_at: string
}

const mocks = vi.hoisted(() => ({
  templates: [] as TemplateRow[],
  add: vi.fn(),
  update: vi.fn(),
  addMany: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({ orgId: 'org-1', userId: 'user-1', role: 'advogado', can: () => true }),
}))

vi.mock('@/hooks/useOrgData', () => ({
  useCategories: () => ({
    data: [
      {
        id: 'cat-1',
        organization_id: 'org-1',
        name: 'Aposentadoria',
        color: '#2563eb',
        sort_order: 0,
        active: true,
        created_at: NOW,
        updated_at: NOW,
        stages: [
          {
            id: 'stage-1',
            organization_id: 'org-1',
            category_id: 'cat-1',
            name: 'Análise inicial',
            position: 0,
            is_final: false,
            is_waiting_docs: false,
            created_at: NOW,
            updated_at: NOW,
          },
          {
            id: 'stage-2',
            organization_id: 'org-1',
            category_id: 'cat-1',
            name: 'Concluído',
            position: 1,
            is_final: true,
            is_waiting_docs: false,
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('./taskTemplatesApi', () => ({
  TASK_TITLE_MIN: 3,
  TASK_TITLE_MAX: 160,
  OFFSET_MAX: 365,
  useTaskTemplates: () => ({
    data: mocks.templates,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useTaskTemplateActions: () => ({
    add: { mutateAsync: mocks.add, isPending: false },
    addMany: { mutateAsync: mocks.addMany, isPending: false },
    update: { mutateAsync: mocks.update, isPending: false },
    remove: { mutateAsync: mocks.remove, isPending: false },
    reorder: { mutate: mocks.reorder, isPending: false },
  }),
}))

function makeTemplate(over: Partial<TemplateRow> = {}): TemplateRow {
  return {
    id: `template-${Math.random().toString(36).slice(2)}`,
    organization_id: 'org-1',
    category_id: 'cat-1',
    stage_id: null,
    title: 'Conferir documentos',
    offset_days: 0,
    priority: 'media',
    position: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  }
}

function renderEditor() {
  return render(
    <ToastProvider>
      <TaskTemplatesEditor initialCategoryId="cat-1" />
    </ToastProvider>,
  )
}

beforeEach(() => {
  mocks.templates.length = 0
  mocks.add.mockReset().mockResolvedValue({})
  mocks.update.mockReset().mockResolvedValue({})
  mocks.addMany.mockReset().mockResolvedValue({})
  mocks.remove.mockReset().mockResolvedValue({})
  mocks.reorder.mockReset()
})

describe('<TaskTemplatesEditor> — gatilho por etapa', () => {
  it('o select "Quando sugerir" lista a criação e as etapas da categoria', () => {
    renderEditor()

    const select = screen.getByLabelText('Quando sugerir')
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]

    expect(options.map((o) => o.textContent)).toEqual([
      'Ao criar a demanda',
      'Ao entrar em Análise inicial',
      'Ao entrar em Concluído',
    ])
    expect(options[0].value).toBe('')
    expect(options[1].value).toBe('stage-1')
    expect(options[2].value).toBe('stage-2')
  })

  it('salvar com etapa grava stage_id no modelo', async () => {
    renderEditor()

    fireEvent.change(screen.getByLabelText('Título da tarefa sugerida'), { target: { value: 'Conferir documentos' } })
    fireEvent.change(screen.getByLabelText('Quando sugerir'), { target: { value: 'stage-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))

    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1))
    expect(mocks.add).toHaveBeenCalledWith({
      categoryId: 'cat-1',
      input: expect.objectContaining({ title: 'Conferir documentos', stage_id: 'stage-1' }),
    })
  })

  it('mostra o selo do gatilho: "Ao criar a demanda" e "Ao entrar em <etapa>"', () => {
    mocks.templates.push(
      makeTemplate({ id: 't-create', stage_id: null, title: 'Modelo de criação', position: 0 }),
      makeTemplate({ id: 't-stage', stage_id: 'stage-1', title: 'Modelo da etapa', position: 1 }),
    )
    renderEditor()

    const creation = screen.getByText('Modelo de criação').closest('li')
    const stageModel = screen.getByText('Modelo da etapa').closest('li')
    expect(creation).toHaveTextContent('Ao criar a demanda')
    expect(stageModel).toHaveTextContent('Ao entrar em Análise inicial')
  })

  it('agrupa primeiro os modelos de criação e depois as etapas na ordem de position', () => {
    mocks.templates.push(
      makeTemplate({ id: 't-c2', stage_id: null, title: 'Criação B', position: 1 }),
      makeTemplate({ id: 't-s2', stage_id: 'stage-2', title: 'Etapa dois', position: 5 }),
      makeTemplate({ id: 't-c1', stage_id: null, title: 'Criação A', position: 0 }),
      makeTemplate({ id: 't-s1', stage_id: 'stage-1', title: 'Etapa um', position: 4 }),
    )
    const { container } = renderEditor()

    const ordered = Array.from(container.querySelectorAll('li')).map((li) => li.textContent ?? '')
    const indexOf = (text: string) => ordered.findIndex((t) => t.includes(text))

    expect(indexOf('Criação A')).toBeGreaterThanOrEqual(0)
    expect(indexOf('Criação A')).toBeLessThan(indexOf('Criação B'))
    expect(indexOf('Criação B')).toBeLessThan(indexOf('Etapa um'))
    expect(indexOf('Etapa um')).toBeLessThan(indexOf('Etapa dois'))
  })

  it('com só modelos de etapa não oferece "Usar sugestão inicial"', () => {
    mocks.templates.push(makeTemplate({ id: 't-stage', stage_id: 'stage-1', title: 'Modelo da etapa' }))
    renderEditor()

    expect(screen.queryByRole('button', { name: 'Usar sugestão inicial' })).not.toBeInTheDocument()
  })
})
