// Consultas e mutações do módulo de configurações.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { qk } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import type {
  Client,
  Contract,
  Demand,
  Installment,
  MemberRole,
  OrganizationInvitation,
  Payment,
  Task,
} from '@/types/database'
import { buildClientExport, normalizeEmail } from './logic'

const invitationsKey = (org: string) => ['invitations', org] as const

export function useUpdateProfileName() {
  const { userId, refresh } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (fullName: string) => {
      const rows = unwrap(
        await supabase.from('profiles').update({ full_name: fullName.trim() }).eq('id', userId).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('Não foi possível atualizar o perfil.')
    },
    onSuccess: async () => {
      await refresh()
      qc.invalidateQueries({ queryKey: ['members'] })
    },
  })
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (password: string) => {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        if (/different from the old/i.test(error.message)) throw new Error('A nova senha deve ser diferente da atual.')
        if (/reauthentication|recent login/i.test(error.message))
          throw new Error('Por segurança, saia e entre novamente antes de alterar a senha.')
        if (/weak|Password should/i.test(error.message)) throw new Error('Senha fraca. Use pelo menos 8 caracteres com letras e números.')
        throw new Error(error.message)
      }
    },
  })
}

export function useUpdateOrganizationName() {
  const { orgId, refresh } = useOrg()
  return useMutation({
    mutationFn: async (name: string) => {
      const rows = unwrap(
        await supabase.from('organizations').update({ name: name.trim() }).eq('id', orgId).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('Você não tem permissão para alterar o escritório.')
    },
    onSuccess: () => refresh(),
  })
}

export function useUpdateMember() {
  const { orgId, userId, refresh } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; user_id: string; role?: MemberRole; active?: boolean }) => {
      const patch: { role?: MemberRole; active?: boolean } = {}
      if (v.role !== undefined) patch.role = v.role
      if (v.active !== undefined) patch.active = v.active
      const rows = unwrap(
        await supabase.from('organization_members').update(patch).eq('id', v.id).eq('organization_id', orgId).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('Você não tem permissão para alterar membros da equipe.')
      return v
    },
    onSuccess: async (v) => {
      qc.invalidateQueries({ queryKey: qk.members(orgId) })
      qc.invalidateQueries({ queryKey: qk.dashboard(orgId) })
      if (v.user_id === userId) await refresh() // alterou o próprio papel
    },
  })
}

export function useInvitations(enabled: boolean) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: invitationsKey(orgId),
    enabled,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('organization_invitations')
          .select('*')
          .eq('organization_id', orgId)
          .is('accepted_at', null)
          .order('created_at', { ascending: false }),
      ) as OrganizationInvitation[],
  })
}

export function useCreateInvitation() {
  const { orgId, userId } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { email: string; role: MemberRole }) => {
      unwrap(
        await supabase
          .from('organization_invitations')
          .insert({ organization_id: orgId, email: normalizeEmail(v.email), role: v.role, invited_by: userId }),
      )
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: invitationsKey(orgId) }),
  })
}

export function useCancelInvitation() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap(
        await supabase.from('organization_invitations').delete().eq('id', id).eq('organization_id', orgId).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('Convite não encontrado ou já aceito.')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: invitationsKey(orgId) }),
  })
}

/** Busca tudo o que está vinculado ao cliente e monta o JSON de portabilidade. */
export async function fetchClientExport(orgId: string, organizationName: string, clientId: string) {
  const client = unwrap(
    await supabase.from('clients').select('*').eq('organization_id', orgId).eq('id', clientId).single(),
  ) as Client
  const [demands, tasksByClient, contracts] = await Promise.all([
    supabase.from('demands').select('*').eq('organization_id', orgId).eq('client_id', clientId).order('opened_at'),
    supabase.from('tasks').select('*').eq('organization_id', orgId).eq('client_id', clientId).order('created_at'),
    supabase.from('contracts').select('*').eq('organization_id', orgId).eq('client_id', clientId).order('signed_at'),
  ])
  const demandRows = unwrap(demands) as Demand[]
  const contractRows = unwrap(contracts) as Contract[]
  let taskRows = unwrap(tasksByClient) as Task[]

  const demandIds = demandRows.map((d) => d.id)
  const contractIds = contractRows.map((c) => c.id)
  const [tasksByDemand, installments, payments] = await Promise.all([
    demandIds.length
      ? supabase.from('tasks').select('*').eq('organization_id', orgId).in('demand_id', demandIds)
      : Promise.resolve({ data: [] as Task[], error: null }),
    contractIds.length
      ? supabase.from('installments').select('*').eq('organization_id', orgId).in('contract_id', contractIds)
      : Promise.resolve({ data: [] as Installment[], error: null }),
    contractIds.length
      ? supabase.from('payments').select('*').eq('organization_id', orgId).in('contract_id', contractIds).order('paid_at')
      : Promise.resolve({ data: [] as Payment[], error: null }),
  ])
  const seen = new Set(taskRows.map((t) => t.id))
  taskRows = taskRows.concat((unwrap(tasksByDemand) as Task[]).filter((t) => !seen.has(t.id)))

  return buildClientExport({
    organizationName,
    client,
    demands: demandRows,
    tasks: taskRows,
    contracts: contractRows,
    installments: unwrap(installments) as Installment[],
    payments: unwrap(payments) as Payment[],
  })
}

export function downloadJSON(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
