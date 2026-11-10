// Consultas e mutações do módulo de contratos/honorários.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { addDaysISO, escapeLike, todayISO } from '@/lib/format'
import { PAGE_SIZE } from '@/lib/constants'
import { useOrg } from '@/contexts/AuthContext'
import { qk } from '@/hooks/useOrgData'
import type { Contract, ContractOverview, ContractStatus, InstallmentOverview, Payment, PaymentMethod } from '@/types/database'

const num = (v: unknown) => Number(v ?? 0)

/** Postgres numeric pode chegar como string — normaliza. */
export function normalizeContract<T extends ContractOverview>(c: T): T {
  return {
    ...c,
    total_amount: num(c.total_amount),
    received_amount: num(c.received_amount),
    balance_amount: num(c.balance_amount),
    overdue_count: num(c.overdue_count),
  }
}
export function normalizeInstallment(i: InstallmentOverview): InstallmentOverview {
  return { ...i, amount: num(i.amount), paid_amount: num(i.paid_amount), remaining_amount: num(i.remaining_amount) }
}

/** Busca todas as linhas (paginando de 1000 em 1000, limite padrão do PostgREST). */
export async function fetchAllRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  const step = 1000
  for (let from = 0; ; from += step) {
    const rows = unwrap(await build(from, from + step - 1)) ?? []
    out.push(...rows)
    if (rows.length < step) break
  }
  return out
}

/** Mapa id → nome dos clientes informados (somente nome; sem dados pessoais). */
export async function fetchClientNames(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))]
  const map = new Map<string, string>()
  for (let i = 0; i < uniq.length; i += 200) {
    const rows = unwrap(
      await supabase.from('clients').select('id, full_name').eq('organization_id', orgId).in('id', uniq.slice(i, i + 200)),
    ) as { id: string; full_name: string }[]
    rows.forEach((r) => map.set(r.id, r.full_name))
  }
  return map
}

// ---------------------------------------------------------------------------
// Resumo financeiro do escritório
// ---------------------------------------------------------------------------
export interface FinanceSummary {
  /** Honorários contratados: ativos + quitados (mesma definição do dashboard). */
  contractedTotal: number
  contractedCount: number
  activeTotal: number
  received: number
  balance: number
  overdue: number
  overdueCount: number
  activeCount: number
}

export function useFinanceSummary() {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.contracts(orgId, 'summary'),
    queryFn: async (): Promise<FinanceSummary> => {
      const [contracts, overdue] = await Promise.all([
        fetchAllRows<Pick<ContractOverview, 'id' | 'status' | 'total_amount' | 'received_amount' | 'balance_amount'>>((f, t) =>
          supabase
            .from('contract_overview')
            .select('id, status, total_amount, received_amount, balance_amount')
            .eq('organization_id', orgId)
            .neq('status', 'cancelado')
            .order('id')
            .range(f, t),
        ),
        fetchAllRows<Pick<InstallmentOverview, 'contract_id' | 'remaining_amount'>>((f, t) =>
          supabase
            .from('installment_overview')
            .select('contract_id, remaining_amount')
            .eq('organization_id', orgId)
            .eq('status', 'vencida')
            .order('id')
            .range(f, t),
        ),
      ])
      // Parcelas de rascunhos não são cobradas — ficam fora do valor vencido
      const billable = new Set(contracts.filter((c) => c.status !== 'rascunho').map((c) => c.id))
      const overdueBillable = overdue.filter((i) => billable.has(i.contract_id))
      const s: FinanceSummary = { contractedTotal: 0, contractedCount: 0, activeTotal: 0, received: 0, balance: 0, overdue: 0, overdueCount: overdueBillable.length, activeCount: 0 }
      for (const c of contracts) {
        if (c.status === 'rascunho') continue
        s.received += num(c.received_amount)
        if (c.status === 'ativo' || c.status === 'quitado') {
          s.contractedTotal += num(c.total_amount)
          s.contractedCount++
        }
        if (c.status === 'ativo') {
          s.activeTotal += num(c.total_amount)
          s.balance += num(c.balance_amount)
          s.activeCount++
        }
      }
      overdueBillable.forEach((i) => (s.overdue += num(i.remaining_amount)))
      return s
    },
  })
}

// ---------------------------------------------------------------------------
// Lista paginada de contratos
// ---------------------------------------------------------------------------
export type ContractRow = ContractOverview & { client_name: string }

export function useContractList(params: { status: ContractStatus | ''; search: string; page: number }) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.contracts(orgId, 'list', params),
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<{ rows: ContractRow[]; total: number }> => {
      let clientIds: string[] | null = null
      const term = params.search.trim()
      if (term) {
        const found = unwrap(
          await supabase
            .from('clients')
            .select('id')
            .eq('organization_id', orgId)
            .ilike('full_name', `%${escapeLike(term)}%`)
            .limit(300),
        ) as { id: string }[]
        clientIds = found.map((c) => c.id)
        if (!clientIds.length) return { rows: [], total: 0 }
      }
      let q = supabase
        .from('contract_overview')
        .select('*', { count: 'exact' })
        .eq('organization_id', orgId)
        .order('signed_at', { ascending: false })
        .order('created_at', { ascending: false })
        .range(params.page * PAGE_SIZE, params.page * PAGE_SIZE + PAGE_SIZE - 1)
      if (params.status) q = q.eq('status', params.status)
      if (clientIds) q = q.in('client_id', clientIds)
      const res = await q
      const data = (unwrap(res) as ContractOverview[]).map(normalizeContract)
      const names = await fetchClientNames(orgId, data.map((c) => c.client_id))
      return {
        rows: data.map((c) => ({ ...c, client_name: names.get(c.client_id) ?? '—' })),
        total: res.count ?? data.length,
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Recebimentos: parcelas vencidas + a vencer nos próximos 30 dias
// ---------------------------------------------------------------------------
export type ReceivableRow = InstallmentOverview & {
  client_name: string
  installments_count: number
  contract_type: Contract['contract_type']
}

export function useReceivables(days = 30) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.contracts(orgId, 'receivables', days),
    queryFn: async (): Promise<ReceivableRow[]> => {
      const limitDate = addDaysISO(todayISO(), days)
      const rows = (
        unwrap(
          await supabase
            .from('installment_overview')
            .select('*')
            .eq('organization_id', orgId)
            .in('status', ['vencida', 'a_vencer', 'parcial'])
            .lte('due_date', limitDate)
            .order('due_date')
            .limit(500),
        ) as InstallmentOverview[]
      ).map(normalizeInstallment)
      const contractIds = [...new Set(rows.map((r) => r.contract_id))]
      const contracts = new Map<string, Pick<Contract, 'id' | 'installments_count' | 'contract_type' | 'status'>>()
      for (let i = 0; i < contractIds.length; i += 200) {
        const cs = unwrap(
          await supabase
            .from('contracts')
            .select('id, installments_count, contract_type, status')
            .eq('organization_id', orgId)
            .in('id', contractIds.slice(i, i + 200)),
        ) as Pick<Contract, 'id' | 'installments_count' | 'contract_type' | 'status'>[]
        cs.forEach((c) => contracts.set(c.id, c))
      }
      const names = await fetchClientNames(orgId, rows.map((r) => r.client_id))
      return rows
        .filter((r) => contracts.get(r.contract_id)?.status !== 'rascunho')
        .map((r) => ({
          ...r,
          client_name: names.get(r.client_id) ?? '—',
          installments_count: contracts.get(r.contract_id)?.installments_count ?? 0,
          contract_type: contracts.get(r.contract_id)?.contract_type ?? 'outro',
        }))
    },
  })
}

// ---------------------------------------------------------------------------
// Detalhe do contrato
// ---------------------------------------------------------------------------
export interface ContractDetail {
  contract: ContractOverview
  clientName: string
  demand: { id: string; title: string } | null
}

export function useContractDetail(id: string) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: qk.contract(orgId, id),
    queryFn: async (): Promise<ContractDetail> => {
      const contract = normalizeContract(
        unwrap(await supabase.from('contract_overview').select('*').eq('organization_id', orgId).eq('id', id).single()) as ContractOverview,
      )
      const [client, demand] = await Promise.all([
        supabase.from('clients').select('full_name').eq('organization_id', orgId).eq('id', contract.client_id).maybeSingle(),
        contract.demand_id
          ? supabase.from('demands').select('id, title').eq('organization_id', orgId).eq('id', contract.demand_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])
      return {
        contract,
        clientName: (unwrap(client) as { full_name: string } | null)?.full_name ?? '—',
        demand: unwrap(demand) as { id: string; title: string } | null,
      }
    },
  })
}

export function useInstallments(contractId: string | null | undefined) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: [...qk.contract(orgId, contractId ?? ''), 'installments'],
    enabled: !!contractId,
    queryFn: async () =>
      (
        unwrap(
          await supabase
            .from('installment_overview')
            .select('*')
            .eq('organization_id', orgId)
            .eq('contract_id', contractId!)
            .order('number'),
        ) as InstallmentOverview[]
      ).map(normalizeInstallment),
  })
}

export function usePayments(contractId: string) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: [...qk.contract(orgId, contractId), 'payments'],
    queryFn: async () =>
      (
        unwrap(
          await supabase
            .from('payments')
            .select('*')
            .eq('organization_id', orgId)
            .eq('contract_id', contractId)
            .order('paid_at', { ascending: false })
            .order('created_at', { ascending: false }),
        ) as Payment[]
      ).map((p) => ({ ...p, amount: num(p.amount) })),
  })
}

/** Quantidade de pagamentos de um contrato (para travar campos na edição). */
export function usePaymentCount(contractId: string | null | undefined) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: [...qk.contract(orgId, contractId ?? ''), 'payment-count'],
    enabled: !!contractId,
    queryFn: async () => {
      const res = await supabase
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('contract_id', contractId!)
      if (res.error) unwrap(res)
      return res.count ?? 0
    },
  })
}

// ---------------------------------------------------------------------------
// Mutações
// ---------------------------------------------------------------------------
export function useInvalidateFinance() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return (contractId?: string) => {
    qc.invalidateQueries({ queryKey: qk.contracts(orgId) })
    if (contractId) qc.invalidateQueries({ queryKey: qk.contract(orgId, contractId) })
    qc.invalidateQueries({ queryKey: qk.dashboard(orgId) })
    qc.invalidateQueries({ queryKey: qk.activity(orgId) })
    // Fichas de cliente/demanda podem exibir contratos
    qc.invalidateQueries({ queryKey: ['client', orgId] })
    qc.invalidateQueries({ queryKey: ['reports', orgId] })
  }
}

export interface PaymentInput {
  contract_id: string
  installment_id: string
  amount: number
  paid_at: string
  method: PaymentMethod
  notes: string | null
}

export function useCreatePayment() {
  const { orgId, userId } = useOrg()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async (input: PaymentInput) =>
      unwrap(
        await supabase
          .from('payments')
          .insert({ ...input, organization_id: orgId, created_by: userId })
          .select()
          .single(),
      ) as Payment,
    onSuccess: (p) => invalidate(p.contract_id),
  })
}

export function useDeletePayment() {
  const { orgId } = useOrg()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async (p: Pick<Payment, 'id' | 'contract_id'>) => {
      const rows = unwrap(
        await supabase.from('payments').delete().eq('organization_id', orgId).eq('id', p.id).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('Você não tem permissão para estornar este pagamento.')
      return p
    },
    onSuccess: (p) => invalidate(p.contract_id),
  })
}

export function useUpdateContractStatus() {
  const { orgId } = useOrg()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ContractStatus }) => {
      const rows = unwrap(
        await supabase.from('contracts').update({ status }).eq('organization_id', orgId).eq('id', id).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('Você não tem permissão para alterar este contrato.')
      return id
    },
    onSuccess: (id) => invalidate(id),
  })
}

export function useDeleteContract() {
  const { orgId } = useOrg()
  const invalidate = useInvalidateFinance()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap(
        await supabase.from('contracts').delete().eq('organization_id', orgId).eq('id', id).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('Você não tem permissão para excluir este contrato.')
      return id
    },
    onSuccess: () => invalidate(),
  })
}
