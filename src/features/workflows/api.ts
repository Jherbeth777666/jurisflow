// Dados do quadro Kanban e da configuração de etapas/categorias.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { qk, type CategoryWithStages } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { useToast } from '@/components/ui'
import type { DemandCategory, WorkflowStage } from '@/types/database'
import { applyStageMove, BOARD_SELECT, DONE_LIMIT, DONE_WINDOW_DAYS, type BoardDemand } from './board'

export function invalidateWorkflow(qc: QueryClient, orgId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.categories(orgId) }),
    qc.invalidateQueries({ queryKey: qk.demands(orgId) }),
    qc.invalidateQueries({ queryKey: qk.dashboard(orgId) }),
  ])
}

export const boardKey = (orgId: string, categoryId: string) => qk.demands(orgId, 'board', categoryId)

/** Demandas abertas da categoria + concluídas recentes (para a coluna final). */
export function useBoardDemands(categoryId: string | null) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: boardKey(orgId, categoryId ?? 'none'),
    enabled: !!categoryId,
    queryFn: async () => {
      const since = new Date(Date.now() - DONE_WINDOW_DAYS * 86_400_000).toISOString()
      const [open, done] = await Promise.all([
        supabase
          .from('demands')
          .select(BOARD_SELECT)
          .eq('organization_id', orgId)
          .eq('category_id', categoryId!)
          .not('status', 'in', '(concluida,cancelada)')
          .order('stage_changed_at')
          .limit(1000),
        supabase
          .from('demands')
          .select(BOARD_SELECT)
          .eq('organization_id', orgId)
          .eq('category_id', categoryId!)
          .eq('status', 'concluida')
          .gte('closed_at', since)
          .order('closed_at', { ascending: false })
          .limit(DONE_LIMIT),
      ])
      return [...(unwrap(open) as unknown as BoardDemand[]), ...(unwrap(done) as unknown as BoardDemand[])]
    },
  })
}

/** Move a demanda de etapa com atualização otimista e rollback. */
export function useMoveDemand(categoryId: string | null, stages: WorkflowStage[]) {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const key = boardKey(orgId, categoryId ?? 'none')
  return useMutation<void, Error, { demandId: string; stageId: string }, { prev?: BoardDemand[] }>({
    mutationFn: async ({ demandId, stageId }) => {
      unwrap(
        await supabase
          .from('demands')
          .update({ stage_id: stageId })
          .eq('id', demandId)
          .eq('organization_id', orgId)
          .select('id')
          .single(),
      )
    },
    onMutate: async ({ demandId, stageId }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<BoardDemand[]>(key)
      const to = stages.find((s) => s.id === stageId)
      if (prev && to) {
        const now = new Date().toISOString()
        qc.setQueryData<BoardDemand[]>(key, prev.map((d) => (d.id === demandId ? applyStageMove(d, to, now) : d)))
      }
      return { prev }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev)
      toast.show(`Não foi possível mover a demanda: ${e.message}`, 'error')
    },
    onSuccess: (_d, { stageId }) => {
      const to = stages.find((s) => s.id === stageId)
      toast.show(to?.is_final ? `Demanda concluída (movida para "${to.name}").` : `Demanda movida para "${to?.name ?? 'etapa'}".`)
    },
    onSettled: (_d, _e, { demandId }) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.demands(orgId) }),
        qc.invalidateQueries({ queryKey: qk.demand(orgId, demandId) }),
        qc.invalidateQueries({ queryKey: qk.dashboard(orgId) }),
        qc.invalidateQueries({ queryKey: qk.activity(orgId) }),
      ]),
  })
}

// ---------------------------------------------------------------------------
// Configuração de etapas
// ---------------------------------------------------------------------------

export function useReorderStages() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation<void, Error, { categoryId: string; ids: string[] }, { prev?: CategoryWithStages[] }>({
    mutationFn: async ({ categoryId, ids }) => {
      unwrap(await supabase.rpc('reorder_workflow_stages', { p_category: categoryId, p_stage_ids: ids }))
    },
    onMutate: async ({ categoryId, ids }) => {
      await qc.cancelQueries({ queryKey: qk.categories(orgId) })
      const prev = qc.getQueryData<CategoryWithStages[]>(qk.categories(orgId))
      if (prev) {
        qc.setQueryData<CategoryWithStages[]>(
          qk.categories(orgId),
          prev.map((c) => {
            if (c.id !== categoryId) return c
            const byId = new Map(c.stages.map((s) => [s.id, s]))
            const stages = ids.map((id) => byId.get(id)).filter((s): s is WorkflowStage => !!s)
            return { ...c, stages: stages.map((s, i) => ({ ...s, position: i })) }
          }),
        )
      }
      return { prev }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.categories(orgId), ctx.prev)
      toast.show(e.message, 'error')
    },
    onSettled: () => invalidateWorkflow(qc, orgId),
  })
}

export async function createStage(
  orgId: string,
  categoryId: string,
  input: { name: string; is_final: boolean; is_waiting_docs: boolean },
  position: number,
) {
  return unwrap(
    await supabase
      .from('workflow_stages')
      .insert({ organization_id: orgId, category_id: categoryId, position, ...input })
      .select('*')
      .single(),
  ) as WorkflowStage
}

export async function updateStage(orgId: string, id: string, patch: Partial<Pick<WorkflowStage, 'name' | 'is_final' | 'is_waiting_docs'>>) {
  return unwrap(
    await supabase.from('workflow_stages').update(patch).eq('id', id).eq('organization_id', orgId).select('*').single(),
  ) as WorkflowStage
}

export async function countDemandsInStage(orgId: string, stageId: string) {
  const res = await supabase.from('demands').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('stage_id', stageId)
  unwrap(res)
  return res.count ?? 0
}

export async function deleteStage(stageId: string, moveTo: string | null) {
  unwrap(await supabase.rpc('delete_workflow_stage', { p_stage: stageId, p_move_to: moveTo }))
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

/** Paleta discreta para categorias (hex aceito pelo check do banco). */
export const CATEGORY_COLORS = ['#2563eb', '#0891b2', '#059669', '#65a30d', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#475569', '#64748b']

export const DEFAULT_STAGES: { name: string; is_final: boolean; is_waiting_docs: boolean }[] = [
  { name: 'A fazer', is_final: false, is_waiting_docs: false },
  { name: 'Em andamento', is_final: false, is_waiting_docs: false },
  { name: 'Concluído', is_final: true, is_waiting_docs: false },
]

function categoryError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e)
  return new Error(msg === 'Registro duplicado.' ? 'Já existe uma categoria com esse nome.' : msg)
}

export async function createCategory(orgId: string, input: { name: string; color: string }, sortOrder: number) {
  try {
    const cat = unwrap(
      await supabase
        .from('demand_categories')
        .insert({ organization_id: orgId, name: input.name, color: input.color, sort_order: sortOrder })
        .select('*')
        .single(),
    ) as DemandCategory
    unwrap(
      await supabase
        .from('workflow_stages')
        .insert(DEFAULT_STAGES.map((s, i) => ({ ...s, organization_id: orgId, category_id: cat.id, position: i }))),
    )
    return cat
  } catch (e) {
    throw categoryError(e)
  }
}

export async function updateCategory(orgId: string, id: string, patch: Partial<Pick<DemandCategory, 'name' | 'color' | 'active'>>) {
  try {
    return unwrap(
      await supabase.from('demand_categories').update(patch).eq('id', id).eq('organization_id', orgId).select('*').single(),
    ) as DemandCategory
  } catch (e) {
    throw categoryError(e)
  }
}
