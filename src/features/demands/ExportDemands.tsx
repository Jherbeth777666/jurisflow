import { ExportButton, type ExportColumn } from '@/components/ExportButton'
import { useOrg } from '@/contexts/AuthContext'
import { useCategories, useMemberNames } from '@/hooks/useOrgData'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { DEMAND_STATUS, PRIORITY } from '@/lib/constants'
import { daysSince, formatDate } from '@/lib/format'
import type { Demand } from '@/types/database'

type Row = Pick<
  Demand,
  'title' | 'category_id' | 'stage_id' | 'responsible_id' | 'priority' | 'status' | 'opened_at' | 'next_action' | 'next_action_date' | 'stage_changed_at' | 'closed_at'
> & { client: { full_name: string } | null }

/** Exporta todas as demandas do escritório (sem dados pessoais além do nome do cliente). */
export function ExportDemands() {
  const { orgId } = useOrg()
  const cats = useCategories()
  const members = useMemberNames()

  const catName = new Map<string, string>()
  const stageName = new Map<string, string>()
  cats.data?.forEach((c) => {
    catName.set(c.id, c.name)
    c.stages.forEach((s) => stageName.set(s.id, s.name))
  })

  const columns: ExportColumn<Row>[] = [
    { key: 'title', header: 'Título' },
    { key: 'client', header: 'Cliente', value: (r) => r.client?.full_name ?? '' },
    { key: 'category_id', header: 'Categoria', value: (r) => catName.get(r.category_id) ?? '' },
    { key: 'stage_id', header: 'Etapa', value: (r) => (r.stage_id ? stageName.get(r.stage_id) ?? '' : '') },
    { key: 'status', header: 'Situação', value: (r) => DEMAND_STATUS[r.status]?.label ?? r.status },
    { key: 'priority', header: 'Prioridade', value: (r) => PRIORITY[r.priority]?.label ?? r.priority },
    { key: 'responsible_id', header: 'Responsável', value: (r) => (r.responsible_id ? members.map.get(r.responsible_id) ?? '' : '') },
    { key: 'opened_at', header: 'Abertura', value: (r) => formatDate(r.opened_at) },
    { key: 'stage_changed_at', header: 'Dias na etapa', value: (r) => (r.closed_at ? '' : daysSince(r.stage_changed_at)) },
    { key: 'next_action', header: 'Próxima atividade' },
    { key: 'next_action_date', header: 'Data da próxima atividade', value: (r) => (r.next_action_date ? formatDate(r.next_action_date) : '') },
    { key: 'closed_at', header: 'Encerrada em', value: (r) => (r.closed_at ? formatDate(r.closed_at) : '') },
  ]

  // Busca só ao confirmar: "exportar todas" não carrega a base ao montar a página.
  const loadRows = () =>
    fetchAllRows<Row>(
      (from, to) =>
        supabase
          .from('demands')
          .select('title, category_id, stage_id, responsible_id, priority, status, opened_at, next_action, next_action_date, stage_changed_at, closed_at, client:clients(full_name)')
          .eq('organization_id', orgId)
          .order('opened_at', { ascending: false })
          .order('id')
          .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: unknown }>,
    )

  return <ExportButton filename="demandas" resource="demands" loadRows={loadRows} columns={columns} label="Exportar" size="md" />
}
