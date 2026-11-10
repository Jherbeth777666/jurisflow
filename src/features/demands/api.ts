// Consultas e mutações do módulo de demandas.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { escapeLike } from '@/lib/format'
import { PAGE_SIZE } from '@/lib/constants'
import { qk } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import type { Client, ContractOverview, Demand, DemandStatus } from '@/types/database'
import { CLOSED_STATUSES, demandFormToPayload, stalledCutoff, statusConstraint, type DemandFilters, type DemandFormValues } from './logic'

export type DemandWithClient = Demand & { client: Pick<Client, 'id' | 'full_name' | 'anonymized_at'> | null }

const DEMAND_SELECT = '*, client:clients(id, full_name, anonymized_at)'
const closedList = `(${CLOSED_STATUSES.join(',')})`

/**
 * Lista paginada. `waitingStageIds` são as etapas marcadas como "aguardando documentação"
 * (calculadas a partir de useCategories); só é usado quando filters.waitingDocs = true.
 */
export function useDemandsList(filters: DemandFilters, waitingStageIds: string[] | null) {
  const { orgId } = useOrg()
  const needsStages = filters.waitingDocs
  return useQuery({
    queryKey: qk.demands(orgId, 'list', filters, needsStages ? waitingStageIds : null),
    enabled: !needsStages || waitingStageIds !== null,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (needsStages && !waitingStageIds?.length) return { rows: [] as DemandWithClient[], total: 0 }
      const from = filters.page * PAGE_SIZE
      let q = supabase.from('demands').select(DEMAND_SELECT, { count: 'exact' }).eq('organization_id', orgId)

      const status = statusConstraint(filters)
      if (status.eq) q = q.eq('status', status.eq)
      if (status.excludeClosed) q = q.not('status', 'in', closedList)
      if (filters.category) q = q.eq('category_id', filters.category)
      if (filters.stage) q = q.eq('stage_id', filters.stage)
      if (filters.responsible === 'none') q = q.is('responsible_id', null)
      else if (filters.responsible) q = q.eq('responsible_id', filters.responsible)
      if (filters.priority) q = q.eq('priority', filters.priority)
      if (filters.q.trim()) q = q.ilike('title', `%${escapeLike(filters.q.trim())}%`)
      if (needsStages && waitingStageIds) q = q.in('stage_id', waitingStageIds)
      if (filters.stalled > 0) q = q.lte('stage_changed_at', stalledCutoff(filters.stalled))

      q = filters.stalled > 0
        ? q.order('stage_changed_at', { ascending: true })
        : q.order('opened_at', { ascending: false }).order('created_at', { ascending: false })

      const res = await q.range(from, from + PAGE_SIZE - 1)
      return { rows: unwrap(res) as DemandWithClient[], total: res.count ?? 0 }
    },
  })
}

export function useDemand(id: string | undefined) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.demand(orgId, id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      unwrap(await supabase.from('demands').select(DEMAND_SELECT).eq('organization_id', orgId).eq('id', id!).single()) as DemandWithClient,
  })
}

export type DemandContract = Pick<
  ContractOverview,
  'id' | 'contract_type' | 'description' | 'total_amount' | 'received_amount' | 'balance_amount' | 'status' | 'signed_at' | 'overdue_count'
>

export function useDemandContracts(demandId: string | undefined) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.contracts(orgId, 'by-demand', demandId),
    enabled: !!demandId,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('contract_overview')
          .select('id, contract_type, description, total_amount, received_amount, balance_amount, status, signed_at, overdue_count')
          .eq('organization_id', orgId)
          .eq('demand_id', demandId!)
          .order('signed_at', { ascending: false }),
      ) as DemandContract[],
  })
}

export function useInvalidateDemands() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return (d?: Pick<Demand, 'id' | 'client_id'>) => {
    qc.invalidateQueries({ queryKey: qk.demands(orgId) })
    if (d) qc.invalidateQueries({ queryKey: qk.demand(orgId, d.id) })
    // a lista de clientes mostra contagem de demandas abertas
    qc.invalidateQueries({ queryKey: qk.clients(orgId) })
    if (d) qc.invalidateQueries({ queryKey: qk.client(orgId, d.client_id) })
    qc.invalidateQueries({ queryKey: qk.dashboard(orgId) })
    qc.invalidateQueries({ queryKey: qk.activity(orgId) })
  }
}

export function useSaveDemand() {
  const { orgId } = useOrg()
  const invalidate = useInvalidateDemands()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: DemandFormValues }) => {
      const payload = demandFormToPayload(values)
      const res = id
        ? await supabase.from('demands').update(payload).eq('organization_id', orgId).eq('id', id).select('*').single()
        : await supabase
            .from('demands')
            .insert({ ...payload, organization_id: orgId })
            .select('*')
            .single()
      return unwrap(res) as Demand
    },
    onSuccess: (d) => invalidate(d),
  })
}

/** Alteração rápida de etapa ou status (detalhe da demanda). */
export function usePatchDemand() {
  const { orgId } = useOrg()
  const invalidate = useInvalidateDemands()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { stage_id?: string; status?: DemandStatus } }) =>
      unwrap(await supabase.from('demands').update(patch).eq('organization_id', orgId).eq('id', id).select('*').single()) as Demand,
    onSuccess: (d) => invalidate(d),
  })
}

export function useDeleteDemand() {
  const { orgId } = useOrg()
  const invalidate = useInvalidateDemands()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (d: Pick<Demand, 'id' | 'client_id'>) => {
      const deleted = unwrap(await supabase.from('demands').delete().eq('organization_id', orgId).eq('id', d.id).select('id')) as { id: string }[]
      if (!deleted.length) throw new Error('Você não tem permissão para excluir esta demanda.')
      return d
    },
    onSuccess: (d) => {
      qc.removeQueries({ queryKey: qk.demand(orgId, d.id) })
      invalidate()
      qc.invalidateQueries({ queryKey: qk.client(orgId, d.client_id) })
      // tarefas vinculadas são excluídas em cascata e contratos perdem o vínculo
      qc.invalidateQueries({ queryKey: qk.tasks(orgId) })
      qc.invalidateQueries({ queryKey: qk.contracts(orgId) })
    },
  })
}
