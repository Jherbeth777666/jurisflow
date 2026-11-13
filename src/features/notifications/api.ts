// Avisos dentro do app: lista curta, contador e marcação de leitura.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import { qk } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import type { Notification } from '@/types/database'

const REFETCH_INTERVAL = 5 * 60_000

export function useNotifications() {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.notifications(orgId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('notifications')
          .select('*')
          .eq('organization_id', orgId)
          .order('read_at', { ascending: true, nullsFirst: true })
          .order('created_at', { ascending: false })
          .limit(30),
      ) as Notification[],
    refetchInterval: REFETCH_INTERVAL,
    refetchOnWindowFocus: true,
  })
}

/** Quantidade total de não lidas do escritório (não limitada às 30 carregadas). */
export function useUnreadCount() {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: [...qk.notifications(orgId), 'unread'] as const,
    queryFn: async () => {
      const res = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .is('read_at', null)
      if (res.error) throw new Error(friendlyError(res.error))
      return res.count ?? res.data?.length ?? 0
    },
    refetchInterval: REFETCH_INTERVAL,
    refetchOnWindowFocus: true,
  })
}

export function useMarkRead() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await supabase.rpc('mark_notifications_read', { p_ids: [id] }))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications(orgId) }),
  })
}

export function useMarkAllRead() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      unwrap(await supabase.rpc('mark_all_notifications_read', { p_org: orgId }))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications(orgId) }),
  })
}
