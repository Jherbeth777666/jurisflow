// Consultas dos relatórios — sempre filtradas por organização e período; agregação em ./aggregate.
import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/AuthContext'
import { fetchAllRows, fetchClientNames } from '@/features/contracts/api'
import type { Contract } from '@/types/database'
import { periodBounds, type DemandLite, type OverdueLite, type PaymentLite, type Period, type TaskLite } from './aggregate'

export const reportsKey = (orgId: string, ...rest: unknown[]) => ['reports', orgId, ...rest] as const

export function useReportData(period: Period) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: reportsKey(orgId, 'period', period.from, period.to),
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { start, end } = periodBounds(period)
      const [demands, tasks, payments] = await Promise.all([
        fetchAllRows<DemandLite>((f, t) =>
          supabase
            .from('demands')
            .select('id, category_id, responsible_id, opened_at, closed_at, status')
            .eq('organization_id', orgId)
            .or(`and(opened_at.gte.${period.from},opened_at.lte.${period.to}),and(closed_at.gte."${start}",closed_at.lt."${end}")`)
            .order('id')
            .range(f, t),
        ),
        fetchAllRows<TaskLite>((f, t) =>
          supabase
            .from('tasks')
            .select('assignee_id, due_date, completed_at')
            .eq('organization_id', orgId)
            .eq('status', 'concluida')
            .gte('completed_at', start)
            .lt('completed_at', end)
            .order('id')
            .range(f, t),
        ),
        fetchAllRows<PaymentLite>((f, t) =>
          supabase
            .from('payments')
            .select('amount, method, paid_at')
            .eq('organization_id', orgId)
            .gte('paid_at', period.from)
            .lte('paid_at', period.to)
            .order('id')
            .range(f, t),
        ),
      ])
      return { demands, tasks, payments }
    },
  })
}

export type OverdueRow = OverdueLite & { client_name: string; contract_type: Contract['contract_type'] | null; installments_count: number | null }

/** Parcelas vencidas hoje (situação atual, independe do período). */
export function useOverdueInstallments() {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: reportsKey(orgId, 'overdue'),
    queryFn: async (): Promise<OverdueRow[]> => {
      const rows = await fetchAllRows<OverdueLite>((f, t) =>
        supabase
          .from('installment_overview')
          .select('id, contract_id, client_id, number, due_date, remaining_amount, status')
          .eq('organization_id', orgId)
          .eq('status', 'vencida')
          .order('due_date')
          .order('id')
          .range(f, t),
      )
      const ids = [...new Set(rows.map((r) => r.contract_id))]
      const contracts = new Map<string, Pick<Contract, 'id' | 'contract_type' | 'installments_count' | 'status'>>()
      for (let i = 0; i < ids.length; i += 200) {
        const cs = unwrap(
          await supabase
            .from('contracts')
            .select('id, contract_type, installments_count, status')
            .eq('organization_id', orgId)
            .in('id', ids.slice(i, i + 200)),
        ) as Pick<Contract, 'id' | 'contract_type' | 'installments_count' | 'status'>[]
        cs.forEach((c) => contracts.set(c.id, c))
      }
      const names = await fetchClientNames(orgId, rows.map((r) => r.client_id))
      return rows
        .filter((r) => contracts.get(r.contract_id)?.status !== 'rascunho')
        .map((r) => ({
          ...r,
          client_name: names.get(r.client_id) ?? '—',
          contract_type: contracts.get(r.contract_id)?.contract_type ?? null,
          installments_count: contracts.get(r.contract_id)?.installments_count ?? null,
        }))
    },
  })
}
