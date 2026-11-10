// Acesso a dados do checklist de pendências e dos modelos por categoria.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/AuthContext'
import type { ChecklistTemplate, DemandChecklistItem } from './types'

export const checklistKeys = {
  items: (org: string, demandId: string) => ['checklist', org, demandId] as const,
  templates: (org: string) => ['checklist-templates', org] as const,
}

const sortByPosition = <T extends { position: number; created_at: string }>(list: T[]) =>
  list.slice().sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))

// ---------------------------------------------------------------------------
// Itens da demanda
// ---------------------------------------------------------------------------
export function useChecklistItems(demandId: string | null | undefined) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: checklistKeys.items(orgId, demandId ?? ''),
    enabled: !!demandId,
    queryFn: async () =>
      sortByPosition(
        unwrap(
          await supabase
            .from('demand_checklist_items')
            .select('*')
            .eq('organization_id', orgId)
            .eq('demand_id', demandId!)
            .order('position'),
        ) as DemandChecklistItem[],
      ),
    staleTime: 30_000,
  })
}

export function useChecklistActions(demandId: string) {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const key = checklistKeys.items(orgId, demandId)
  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  /** Atualização otimista com rollback em caso de erro. */
  const optimistic = async (update: (list: DemandChecklistItem[]) => DemandChecklistItem[]) => {
    await qc.cancelQueries({ queryKey: key })
    const prev = qc.getQueryData<DemandChecklistItem[]>(key)
    if (prev) qc.setQueryData(key, update(prev))
    return { prev }
  }
  const rollback = (_e: unknown, _v: unknown, ctx: { prev?: DemandChecklistItem[] } | undefined) => {
    if (ctx?.prev) qc.setQueryData(key, ctx.prev)
  }

  const toggle = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) =>
      unwrap(
        await supabase.from('demand_checklist_items').update({ done }).eq('id', id).eq('organization_id', orgId).select('*').single(),
      ) as DemandChecklistItem,
    onMutate: ({ id, done }) =>
      optimistic((l) => l.map((i) => (i.id === id ? { ...i, done, done_at: done ? new Date().toISOString() : null } : i))),
    onError: rollback,
    onSettled: invalidate,
  })

  const add = useMutation({
    mutationFn: async (label: string) => {
      const list = qc.getQueryData<DemandChecklistItem[]>(key) ?? []
      const position = list.reduce((m, i) => Math.max(m, i.position + 1), 0)
      return unwrap(
        await supabase
          .from('demand_checklist_items')
          .insert({ organization_id: orgId, demand_id: demandId, label, position })
          .select('*')
          .single(),
      ) as DemandChecklistItem
    },
    onSuccess: (item) => qc.setQueryData<DemandChecklistItem[]>(key, (l) => [...(l ?? []), item]),
    onSettled: invalidate,
  })

  const rename = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) =>
      unwrap(
        await supabase.from('demand_checklist_items').update({ label }).eq('id', id).eq('organization_id', orgId).select('*').single(),
      ) as DemandChecklistItem,
    onMutate: ({ id, label }) => optimistic((l) => l.map((i) => (i.id === id ? { ...i, label } : i))),
    onError: rollback,
    onSettled: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await supabase.from('demand_checklist_items').delete().eq('id', id).eq('organization_id', orgId).select('id')
      const rows = unwrap(res) as { id: string }[]
      if (!rows.length) throw new Error('Você não tem permissão para excluir itens do checklist.')
    },
    onMutate: (id) => optimistic((l) => l.filter((i) => i.id !== id)),
    onError: rollback,
    onSettled: invalidate,
  })

  const reorder = useMutation({
    mutationFn: async (ids: string[]) => {
      unwrap(await supabase.rpc('reorder_checklist_items', { p_demand: demandId, p_ids: ids }))
    },
    onMutate: (ids) =>
      optimistic((l) =>
        ids.map((id, idx) => ({ ...(l.find((i) => i.id === id) as DemandChecklistItem), position: idx })).filter((i) => i.id),
      ),
    onError: rollback,
    onSettled: invalidate,
  })

  const apply = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('apply_checklist_template', { p_demand: demandId })) as number,
    onSettled: invalidate,
  })

  return { toggle, add, rename, remove, reorder, apply }
}

// ---------------------------------------------------------------------------
// Modelos por categoria
// ---------------------------------------------------------------------------
export function useChecklistTemplates() {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: checklistKeys.templates(orgId),
    queryFn: async () =>
      sortByPosition(
        unwrap(
          await supabase.from('checklist_templates').select('*').eq('organization_id', orgId).order('position'),
        ) as ChecklistTemplate[],
      ),
    staleTime: 60_000,
  })
}

export function useChecklistTemplateActions() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const key = checklistKeys.templates(orgId)
  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  const add = useMutation({
    mutationFn: async ({ categoryId, label }: { categoryId: string; label: string }) => {
      const list = (qc.getQueryData<ChecklistTemplate[]>(key) ?? []).filter((t) => t.category_id === categoryId)
      const position = list.reduce((m, t) => Math.max(m, t.position + 1), 0)
      return unwrap(
        await supabase
          .from('checklist_templates')
          .insert({ organization_id: orgId, category_id: categoryId, label, position })
          .select('*')
          .single(),
      ) as ChecklistTemplate
    },
    onSettled: invalidate,
  })

  const rename = useMutation({
    mutationFn: async ({ id, label }: { id: string; label: string }) => {
      unwrap(await supabase.from('checklist_templates').update({ label }).eq('id', id).eq('organization_id', orgId).select('id').single())
    },
    onSettled: invalidate,
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap(
        await supabase.from('checklist_templates').delete().eq('id', id).eq('organization_id', orgId).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('Você não tem permissão para editar os modelos.')
    },
    onSettled: invalidate,
  })

  const reorder = useMutation({
    mutationFn: async ({ categoryId, ids }: { categoryId: string; ids: string[] }) => {
      unwrap(await supabase.rpc('reorder_checklist_templates', { p_category: categoryId, p_ids: ids }))
    },
    onMutate: async ({ ids }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<ChecklistTemplate[]>(key)
      if (prev) {
        const pos = new Map(ids.map((id, i) => [id, i]))
        qc.setQueryData(
          key,
          sortByPosition(prev.map((t) => (pos.has(t.id) ? { ...t, position: pos.get(t.id)! } : t))),
        )
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
    },
    onSettled: invalidate,
  })

  return { add, rename, remove, reorder }
}
