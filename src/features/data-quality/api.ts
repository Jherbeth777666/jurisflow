// Consultas do painel de qualidade (dados reais do escritório, sob RLS).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { todayISO } from '@/lib/format'
import { qk } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { fetchAll } from '@/features/import/api'
import { analyzeBase, type QClient, type QDemand, type QTask } from './logic'

export function useQualityReport() {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.clients(orgId, 'quality'),
    queryFn: async () => {
      const [clients, demands, tasks] = await Promise.all([
        fetchAll<QClient>((from, to) =>
          supabase
            .from('clients')
            .select('id, full_name, cpf, phone, birth_date, status, created_at')
            .eq('organization_id', orgId)
            .is('anonymized_at', null)
            .order('created_at')
            .range(from, to),
        ),
        fetchAll<QDemand>((from, to) =>
          supabase
            .from('demands')
            .select('id, title, client_id, status, responsible_id, next_action, updated_at, closed_at')
            .eq('organization_id', orgId)
            .order('created_at')
            .range(from, to),
        ),
        fetchAll<QTask>((from, to) =>
          supabase
            .from('tasks')
            .select('id, title, demand_id, client_id, due_date, status')
            .eq('organization_id', orgId)
            .in('status', ['pendente', 'em_andamento'])
            .order('created_at')
            .range(from, to),
        ),
      ])
      return analyzeBase({ clients, demands, tasks }, todayISO())
    },
    staleTime: 30_000,
  })
}

/** Inativa clientes em lote (lotes de 100 ids). */
export function useInactivateClients() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      for (let i = 0; i < ids.length; i += 100) {
        unwrap(
          await supabase
            .from('clients')
            .update({ status: 'inativo' })
            .eq('organization_id', orgId)
            .in('id', ids.slice(i, i + 100))
            .select('id'),
        )
      }
      return ids.length
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.clients(orgId) })
      qc.invalidateQueries({ queryKey: qk.dashboard(orgId) })
      qc.invalidateQueries({ queryKey: qk.activity(orgId) })
    },
  })
}
