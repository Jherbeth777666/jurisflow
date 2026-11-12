import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Demand, WorkflowStage } from '@/types/database'
import type { TaskTemplateRow } from './taskTemplatesApi'
import { fetchCategoryTaskTemplates, fetchStageTaskTemplates } from './taskTemplatesApi'
import { useStageEntryPrompt } from './stageRules'

const NOW = '2026-11-12T12:00:00.000Z'

interface Filter {
  op: 'eq' | 'is'
  column: string
  value: unknown
}

interface Sort {
  column: string
  ascending?: boolean
}

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  error: null as unknown,
  filters: [] as Filter[],
  orders: [] as Sort[],
  fromCalls: [] as string[],
}))

vi.mock('@/lib/supabase', () => {
  function builder() {
    const q = {
      select: () => q,
      eq: (column: string, value: unknown) => {
        db.filters.push({ op: 'eq', column, value })
        return q
      },
      is: (column: string, value: unknown) => {
        db.filters.push({ op: 'is', column, value })
        return q
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        db.orders.push({ column, ascending: options?.ascending })
        return q
      },
      then<TResult1 = { data: unknown[] | null; error: unknown }, TResult2 = never>(
        onfulfilled?: ((value: { data: unknown[] | null; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): Promise<TResult1 | TResult2> {
        const result = db.error ? { data: null, error: db.error } : { data: db.rows, error: null }
        return Promise.resolve(result).then(onfulfilled, onrejected)
      },
    }
    return q
  }

  return {
    supabase: {
      from: (table: string) => {
        db.fromCalls.push(table)
        return builder()
      },
    },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) throw new Error(String((r.error as { message?: string }).message ?? r.error))
      return r.data as T
    },
  }
})

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({ orgId: 'org-1', userId: 'user-1', role: 'advogado', can: () => true }),
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

const finalStage: WorkflowStage = { ...stage, id: 'stage-final', name: 'Concluído', is_final: true, position: 1 }

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

beforeEach(() => {
  db.rows = []
  db.error = null
  db.filters = []
  db.orders = []
  db.fromCalls = []
})

describe('fetchCategoryTaskTemplates', () => {
  it('filtra stage_id nulo para não mostrar modelos de etapa no passo de criação', async () => {
    db.rows = [
      makeTemplate({ id: 't2', position: 1, stage_id: null, created_at: '2026-11-12T00:00:02Z' }),
      makeTemplate({ id: 't1', position: 0, stage_id: null, created_at: '2026-11-12T00:00:01Z' }),
    ]

    const rows = await fetchCategoryTaskTemplates('org-1', 'cat-1')

    expect(db.filters).toContainEqual({ op: 'eq', column: 'organization_id', value: 'org-1' })
    expect(db.filters).toContainEqual({ op: 'eq', column: 'category_id', value: 'cat-1' })
    expect(db.filters).toContainEqual({ op: 'is', column: 'stage_id', value: null })
    expect(rows.map((r) => r.id)).toEqual(['t1', 't2'])
  })
})

describe('fetchStageTaskTemplates', () => {
  it('busca os modelos da etapa ordenados por position', async () => {
    db.rows = [
      makeTemplate({ id: 't2', stage_id: 'stage-1', position: 1, created_at: '2026-11-12T00:00:02Z' }),
      makeTemplate({ id: 't1', stage_id: 'stage-1', position: 0, created_at: '2026-11-12T00:00:01Z' }),
    ]

    const rows = await fetchStageTaskTemplates('org-1', 'stage-1')

    expect(db.filters).toContainEqual({ op: 'eq', column: 'organization_id', value: 'org-1' })
    expect(db.filters).toContainEqual({ op: 'eq', column: 'stage_id', value: 'stage-1' })
    expect(db.orders.some((o) => o.column === 'position')).toBe(true)
    expect(rows.map((r) => r.id)).toEqual(['t1', 't2'])
  })
})

describe('useStageEntryPrompt', () => {
  it('não busca nem abre para etapa final', async () => {
    const { result } = renderHook(() => useStageEntryPrompt())

    await act(async () => {
      await Promise.resolve(result.current.promptFor(makeDemand(), finalStage))
    })

    expect(db.fromCalls).not.toContain('task_templates')
    expect(result.current.prompt ?? null).toBeNull()
  })

  it('não abre quando a etapa não tem modelos', async () => {
    db.rows = []
    const { result } = renderHook(() => useStageEntryPrompt())

    await act(async () => {
      await Promise.resolve(result.current.promptFor(makeDemand(), stage))
    })

    expect(db.fromCalls).toContain('task_templates')
    expect(result.current.prompt ?? null).toBeNull()
  })

  it('não abre quando a busca falha', async () => {
    db.error = { message: 'falha de rede' }
    const { result } = renderHook(() => useStageEntryPrompt())

    await act(async () => {
      await Promise.resolve(result.current.promptFor(makeDemand(), stage))
    })

    expect(result.current.prompt ?? null).toBeNull()
  })

  it('abre o prompt quando a etapa tem modelos', async () => {
    db.rows = [makeTemplate({ id: 't1', stage_id: 'stage-1', title: 'Conferir documentos' })]
    const { result } = renderHook(() => useStageEntryPrompt())

    await act(async () => {
      await Promise.resolve(result.current.promptFor(makeDemand(), stage))
    })

    expect(result.current.prompt).toBeTruthy()
  })
})
