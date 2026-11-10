// Consultas compartilhadas entre módulos (membros, categorias/etapas, busca de clientes).
import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { escapeLike } from '@/lib/format'
import { useOrg } from '@/contexts/AuthContext'
import type { Client, DemandCategory, MemberWithProfile, WorkflowStage } from '@/types/database'

/** Chaves de cache padronizadas — sempre prefixadas pelo orgId. */
export const qk = {
  members: (org: string) => ['members', org] as const,
  categories: (org: string) => ['categories', org] as const,
  clients: (org: string, ...rest: unknown[]) => ['clients', org, ...rest] as const,
  client: (org: string, id: string) => ['client', org, id] as const,
  demands: (org: string, ...rest: unknown[]) => ['demands', org, ...rest] as const,
  demand: (org: string, id: string) => ['demand', org, id] as const,
  tasks: (org: string, ...rest: unknown[]) => ['tasks', org, ...rest] as const,
  contracts: (org: string, ...rest: unknown[]) => ['contracts', org, ...rest] as const,
  contract: (org: string, id: string) => ['contract', org, id] as const,
  dashboard: (org: string) => ['dashboard', org] as const,
  activity: (org: string, ...rest: unknown[]) => ['activity', org, ...rest] as const,
  ai: (org: string, ...rest: unknown[]) => ['ai', org, ...rest] as const,
}

export function useMembers() {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.members(orgId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('organization_members')
          .select('*, profile:profiles(id, full_name, email)')
          .eq('organization_id', orgId)
          .order('created_at'),
      ) as MemberWithProfile[],
    staleTime: 60_000,
  })
}

export function memberName(m: MemberWithProfile | undefined | null): string {
  if (!m?.profile) return '—'
  return m.profile.full_name || m.profile.email?.split('@')[0] || '—'
}

/** Mapa user_id → nome para exibir responsáveis */
export function useMemberNames() {
  const q = useMembers()
  const map = new Map<string, string>()
  q.data?.forEach((m) => map.set(m.user_id, memberName(m)))
  return { ...q, map, options: (q.data ?? []).filter((m) => m.active).map((m) => ({ value: m.user_id, label: memberName(m) })) }
}

export type CategoryWithStages = DemandCategory & { stages: WorkflowStage[] }

export function useCategories() {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.categories(orgId),
    queryFn: async () => {
      const data = unwrap(
        await supabase
          .from('demand_categories')
          .select('*, stages:workflow_stages(*)')
          .eq('organization_id', orgId)
          .order('sort_order')
          .order('name'),
      ) as CategoryWithStages[]
      data.forEach((c) => c.stages.sort((a, b) => a.position - b.position))
      return data
    },
    staleTime: 60_000,
  })
}

/** Busca leve de clientes para selects (nome/CPF), limitada a 20 resultados. */
export function useClientLookup(term: string) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.clients(orgId, 'lookup', term),
    queryFn: async () => {
      let q = supabase
        .from('clients')
        .select('id, full_name, cpf')
        .eq('organization_id', orgId)
        .is('anonymized_at', null)
        .order('full_name')
        .limit(20)
      const t = term.trim()
      if (t) {
        const digits = t.replace(/\D/g, '')
        q = digits.length >= 3 && digits.length === t.replace(/[.\-\s]/g, '').length
          ? q.like('cpf', `%${digits}%`)
          : q.ilike('full_name', `%${escapeLike(t)}%`)
      }
      return unwrap(await q) as Pick<Client, 'id' | 'full_name' | 'cpf'>[]
    },
    staleTime: 30_000,
  })
}
