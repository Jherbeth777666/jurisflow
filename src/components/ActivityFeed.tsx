import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { formatRelative } from '@/lib/format'
import { useOrg } from '@/contexts/AuthContext'
import { qk, useCategories, useMemberNames } from '@/hooks/useOrgData'
import { Spinner, ErrorState, EmptyState } from '@/components/ui'
import { DEMAND_STATUS, TASK_STATUS, CONTRACT_STATUS, CLIENT_STATUS } from '@/lib/constants'
import type { ActivityLog } from '@/types/database'
import { History } from 'lucide-react'

const ENTITY: Record<string, string> = {
  clients: 'cliente',
  demands: 'demanda',
  tasks: 'tarefa',
  contracts: 'contrato',
  payments: 'pagamento',
  organization_members: 'membro',
  exports: 'exportação',
}

const FEMININE = new Set(['demanda', 'tarefa'])

const FIELD: Record<string, string> = {
  full_name: 'nome',
  cpf: 'CPF',
  phone: 'telefone',
  email: 'e-mail',
  birth_date: 'nascimento',
  address: 'endereço',
  notes: 'observações',
  status: 'status',
  title: 'título',
  description: 'descrição',
  priority: 'prioridade',
  responsible_id: 'responsável',
  assignee_id: 'responsável',
  due_date: 'vencimento',
  next_action: 'próxima atividade',
  next_action_date: 'data da próxima atividade',
  category_id: 'categoria',
  stage_id: 'etapa',
  total_amount: 'valor',
  installments_count: 'parcelas',
  role: 'perfil',
}

/** Linha do tempo de alterações — lê activity_logs (sem dados pessoais). */
export function ActivityFeed({ entityType, entityId, limit = 30 }: { entityType?: string; entityId?: string; limit?: number }) {
  const { orgId } = useOrg()
  const names = useMemberNames()
  const cats = useCategories()
  const stageName = new Map<string, string>()
  cats.data?.forEach((c) => c.stages.forEach((s) => stageName.set(s.id, s.name)))

  const q = useQuery({
    queryKey: qk.activity(orgId, entityType, entityId, limit),
    queryFn: async () => {
      let query = supabase.from('activity_logs').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(limit)
      if (entityType) query = query.eq('entity_type', entityType)
      if (entityId) query = query.eq('entity_id', entityId)
      return unwrap(await query) as ActivityLog[]
    },
  })

  if (q.isLoading) return <Spinner />
  if (q.isError) return <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
  if (!q.data?.length) return <EmptyState icon={<History className="size-5" />} title="Sem histórico ainda" />

  const describe = (log: ActivityLog) => {
    const ent = ENTITY[log.entity_type] ?? log.entity_type
    const ch = log.changes as Record<string, { from?: unknown; to?: unknown }>
    if (log.action === 'created') return log.entity_type === 'payments' ? 'registrou um pagamento' : `criou ${FEMININE.has(ent) ? 'uma' : 'um'} ${ent}`
    if (log.action === 'exported') {
      const c = log.changes as { resource?: string; rows?: number; sensitive?: boolean }
      return `exportou ${c.rows ?? 0} registro(s) de ${c.resource ?? 'dados'}${c.sensitive ? ' com dados pessoais' : ''}`
    }
    if (log.action === 'deleted') return `excluiu ${ent}`
    if (log.action === 'stage_changed' && ch.stage_id) {
      const to = stageName.get(String(ch.stage_id.to)) ?? 'outra etapa'
      return `moveu ${ent} para “${to}”`
    }
    if (log.action === 'status_changed' && ch.status) {
      const v = String(ch.status.to)
      const label =
        (DEMAND_STATUS as Record<string, { label: string }>)[v]?.label ??
        (TASK_STATUS as Record<string, { label: string }>)[v]?.label ??
        (CONTRACT_STATUS as Record<string, { label: string }>)[v]?.label ??
        (CLIENT_STATUS as Record<string, { label: string }>)[v]?.label ??
        v
      return `alterou o status de ${ent} para “${label}”`
    }
    const fields = Object.keys(ch).map((k) => FIELD[k] ?? k)
    return `atualizou ${ent}${fields.length ? ` (${fields.slice(0, 4).join(', ')})` : ''}`
  }

  return (
    <ol className="relative space-y-3 pl-4 before:absolute before:left-[3px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-line">
      {q.data.map((log) => (
        <li key={log.id} className="relative text-body-sm">
          <span className="absolute -left-4 top-1.5 size-[7px] rounded-full border border-surface bg-navy-300" />
          <span className="font-medium text-ink">{log.actor_id ? names.map.get(log.actor_id) ?? 'Usuário' : 'Sistema'}</span>{' '}
          <span className="text-ink-muted">{describe(log)}</span>
          <span className="ml-1.5 text-caption text-ink-subtle">· {formatRelative(log.created_at)}</span>
        </li>
      ))}
    </ol>
  )
}
