// Acesso a dados das tarefas-modelo por categoria (migration L9) e da RPC kickoff_demand.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/AuthContext'
import type { ISODate, ISODateTime, PriorityLevel, UUID } from '@/types/database'

export interface TaskTemplateRow {
  id: UUID
  organization_id: UUID
  category_id: UUID
  title: string
  offset_days: number | null
  priority: PriorityLevel
  position: number
  created_at: ISODateTime
  updated_at: ISODateTime
}

export const TASK_TITLE_MIN = 3
export const TASK_TITLE_MAX = 160
export const OFFSET_MAX = 365

export const taskTemplateKeys = {
  all: (org: string) => ['task-templates', org] as const,
}

const sortByPosition = <T extends { position: number; created_at: string }>(list: T[]) =>
  list.slice().sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))

/** Busca os modelos de uma categoria (usada no passo "Preparar a demanda"). */
export async function fetchCategoryTaskTemplates(orgId: string, categoryId: string): Promise<TaskTemplateRow[]> {
  return sortByPosition(
    unwrap(
      await supabase.from('task_templates').select('*').eq('organization_id', orgId).eq('category_id', categoryId).order('position'),
    ) as TaskTemplateRow[],
  )
}

/** Quantos itens de checklist-modelo a categoria tem. */
export async function countCategoryChecklistTemplates(orgId: string, categoryId: string): Promise<number> {
  const rows = unwrap(
    await supabase.from('checklist_templates').select('id').eq('organization_id', orgId).eq('category_id', categoryId),
  ) as { id: string }[]
  return rows.length
}

export function useTaskTemplates() {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: taskTemplateKeys.all(orgId),
    queryFn: async () =>
      sortByPosition(
        unwrap(await supabase.from('task_templates').select('*').eq('organization_id', orgId).order('position')) as TaskTemplateRow[],
      ),
    staleTime: 60_000,
  })
}

export interface TaskTemplateInput {
  title: string
  offset_days: number | null
  priority: PriorityLevel
}

export function useTaskTemplateActions() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const key = taskTemplateKeys.all(orgId)
  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  const add = useMutation({
    mutationFn: async ({ categoryId, input }: { categoryId: string; input: TaskTemplateInput }) => {
      const list = (qc.getQueryData<TaskTemplateRow[]>(key) ?? []).filter((t) => t.category_id === categoryId)
      const position = list.reduce((m, t) => Math.max(m, t.position + 1), 0)
      return unwrap(
        await supabase
          .from('task_templates')
          .insert({ organization_id: orgId, category_id: categoryId, ...input, position })
          .select('*')
          .single(),
      ) as TaskTemplateRow
    },
    onSettled: invalidate,
  })

  /** Insere vários de uma vez (sugestão inicial). */
  const addMany = useMutation({
    mutationFn: async ({ categoryId, inputs }: { categoryId: string; inputs: TaskTemplateInput[] }) => {
      const rows = inputs.map((input, position) => ({ organization_id: orgId, category_id: categoryId, ...input, position }))
      unwrap(await supabase.from('task_templates').insert(rows).select('id'))
    },
    onSettled: invalidate,
  })

  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: TaskTemplateInput }) => {
      unwrap(await supabase.from('task_templates').update(input).eq('id', id).eq('organization_id', orgId).select('id').single())
    },
    onSettled: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap(
        await supabase.from('task_templates').delete().eq('id', id).eq('organization_id', orgId).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('Você não tem permissão para editar os modelos.')
    },
    onSettled: invalidate,
  })

  const reorder = useMutation({
    mutationFn: async ({ categoryId, ids }: { categoryId: string; ids: string[] }) => {
      unwrap(await supabase.rpc('reorder_task_templates', { p_category: categoryId, p_ids: ids }))
    },
    onMutate: async ({ ids }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<TaskTemplateRow[]>(key)
      if (prev) {
        const pos = new Map(ids.map((id, i) => [id, i]))
        qc.setQueryData(key, sortByPosition(prev.map((t) => (pos.has(t.id) ? { ...t, position: pos.get(t.id)! } : t))))
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSettled: invalidate,
  })

  return { add, addMany, update, remove, reorder }
}

export interface KickoffTaskInput {
  title: string
  due_date: ISODate | null
  priority: PriorityLevel
  assignee_id: UUID | null
}

export interface KickoffResult {
  checklist_items: number
  tasks_created: number
}

export function useKickoffDemand() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ demandId, checklist, tasks }: { demandId: string; checklist: boolean; tasks: KickoffTaskInput[] }) =>
      unwrap(await supabase.rpc('kickoff_demand', { p_demand: demandId, p_checklist: checklist, p_tasks: tasks })) as KickoffResult,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', orgId] })
      qc.invalidateQueries({ queryKey: ['checklist', orgId] })
      qc.invalidateQueries({ queryKey: ['dashboard', orgId] })
    },
  })
}
