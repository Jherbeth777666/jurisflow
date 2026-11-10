// Consultas e mutações do módulo de clientes.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { pageOrEmpty } from '@/lib/pagination'
import { PAGE_SIZE } from '@/lib/constants'
import { qk } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import type { Client, ClientStatus, Demand } from '@/types/database'
import { clientFormToPayload, parseClientSearch, type ClientFormValues } from './logic'

export type ClientRow = Client & { open_demands: number }

/** Filtro da lista: status do cliente, 'anonimizados' ou '' (todos os não anonimizados). */
export type ClientListStatus = ClientStatus | 'anonimizados' | ''

export function useClientsList(params: { term: string; status: ClientListStatus; page: number }) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.clients(orgId, 'list', params),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const from = params.page * PAGE_SIZE
      let q = supabase
        .from('clients')
        .select('*', { count: 'exact' })
        .eq('organization_id', orgId)
        .order('full_name')
        .range(from, from + PAGE_SIZE - 1)
      // Anonimizados ficam fora por padrão (LGPD); aparecem só no filtro próprio.
      if (params.status === 'anonimizados') q = q.not('anonymized_at', 'is', null)
      else {
        q = q.is('anonymized_at', null)
        if (params.status) q = q.eq('status', params.status)
      }
      const s = parseClientSearch(params.term)
      if (s?.kind === 'cpf') q = q.like('cpf', `%${s.digits}%`)
      if (s?.kind === 'name') q = q.ilike('full_name', s.pattern)
      const res = await q
      const outOfRange = pageOrEmpty(res, from)
      if (outOfRange) return outOfRange as { rows: ClientRow[]; total: number }
      const rows = unwrap(res) as Client[]

      // Demandas abertas por cliente da página (consulta leve, só client_id).
      const counts = new Map<string, number>()
      if (rows.length) {
        const open = unwrap(
          await supabase
            .from('demands')
            .select('client_id')
            .eq('organization_id', orgId)
            .in(
              'client_id',
              rows.map((r) => r.id),
            )
            .not('status', 'in', '(concluida,cancelada)'),
        ) as Pick<Demand, 'client_id'>[]
        open.forEach((d) => counts.set(d.client_id, (counts.get(d.client_id) ?? 0) + 1))
      }
      return {
        rows: rows.map((r) => ({ ...r, open_demands: counts.get(r.id) ?? 0 })) as ClientRow[],
        total: res.count ?? 0,
      }
    },
  })
}

export function useClient(id: string | undefined) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.client(orgId, id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from('clients').select('*').eq('organization_id', orgId).eq('id', id!).single()) as Client,
  })
}

export function useClientDemands(clientId: string | undefined) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.demands(orgId, 'by-client', clientId),
    enabled: !!clientId,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('demands')
          .select('*')
          .eq('organization_id', orgId)
          .eq('client_id', clientId!)
          .order('opened_at', { ascending: false })
          .order('created_at', { ascending: false }),
      ) as Demand[],
  })
}

/** Quantidade de contratos do cliente (para explicar por que não pode ser excluído). */
export function useClientContractsCount(clientId: string | undefined) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.contracts(orgId, 'count-by-client', clientId),
    enabled: !!clientId,
    queryFn: async () => {
      const res = await supabase
        .from('contract_overview')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('client_id', clientId!)
      if (res.error) unwrap(res)
      return res.count ?? 0
    },
  })
}

function useInvalidateClients() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: qk.clients(orgId) })
    if (id) qc.invalidateQueries({ queryKey: qk.client(orgId, id) })
    qc.invalidateQueries({ queryKey: qk.dashboard(orgId) })
    qc.invalidateQueries({ queryKey: qk.activity(orgId) })
    qc.invalidateQueries({ queryKey: ['client-name'] })
    // Telas que exibem dados do cliente (nome, telefone, CPF) a partir de outras consultas
    qc.invalidateQueries({ queryKey: ['compose-context', orgId] })
    qc.invalidateQueries({ queryKey: ['command-search', orgId] })
    qc.invalidateQueries({ queryKey: qk.demands(orgId) })
    qc.invalidateQueries({ queryKey: ['demand', orgId] })
    qc.invalidateQueries({ queryKey: qk.contracts(orgId) })
    qc.invalidateQueries({ queryKey: ['contract', orgId] })
    qc.invalidateQueries({ queryKey: qk.tasks(orgId) })
    qc.invalidateQueries({ queryKey: ['reports', orgId] })
  }
}

export function useSaveClient() {
  const { orgId } = useOrg()
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ClientFormValues }) => {
      const payload = clientFormToPayload(values)
      const res = id
        ? await supabase.from('clients').update(payload).eq('organization_id', orgId).eq('id', id).select('*').single()
        : await supabase
            .from('clients')
            .insert({ ...payload, organization_id: orgId })
            .select('*')
            .single()
      return unwrap(res) as Client
    },
    onSuccess: (c) => invalidate(c.id),
  })
}

export function useDeleteClient() {
  const { orgId } = useOrg()
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (id: string) => {
      const deleted = unwrap(await supabase.from('clients').delete().eq('organization_id', orgId).eq('id', id).select('id')) as { id: string }[]
      if (!deleted.length) throw new Error('Você não tem permissão para excluir este cliente.')
      return id
    },
    onSuccess: () => invalidate(),
  })
}

export function useAnonymizeClient() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await supabase.rpc('anonymize_client', { p_client: id }))
      return id
    },
    onSuccess: (id) => invalidate(id),
  })
}
