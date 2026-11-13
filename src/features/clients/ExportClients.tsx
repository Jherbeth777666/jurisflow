import { ExportButton, type ExportColumn } from '@/components/ExportButton'
import { useOrg } from '@/contexts/AuthContext'
import { supabase, fetchAllRows } from '@/lib/supabase'
import { CLIENT_STATUS } from '@/lib/constants'
import { formatCPF, formatDate, formatPhone } from '@/lib/format'
import type { Client } from '@/types/database'

type Row = Pick<Client, 'full_name' | 'cpf' | 'phone' | 'email' | 'birth_date' | 'address' | 'status' | 'created_at'>

const COLUMNS: ExportColumn<Row>[] = [
  { key: 'full_name', header: 'Nome' },
  { key: 'status', header: 'Status', value: (r) => CLIENT_STATUS[r.status]?.label ?? r.status },
  { key: 'created_at', header: 'Cadastrado em', value: (r) => formatDate(r.created_at) },
  { key: 'cpf', header: 'CPF', value: (r) => (r.cpf ? formatCPF(r.cpf) : '') },
  { key: 'phone', header: 'Telefone', value: (r) => (r.phone ? formatPhone(r.phone) : '') },
  { key: 'email', header: 'E-mail' },
  { key: 'birth_date', header: 'Nascimento', value: (r) => (r.birth_date ? formatDate(r.birth_date) : '') },
  { key: 'address', header: 'Endereço' },
]

/** Exporta todos os clientes não anonimizados (dados pessoais só para admin, com confirmação). */
export function ExportClients() {
  const { orgId, role } = useOrg()
  // Busca só ao confirmar: "exportar todos" não carrega a base ao montar a página.
  const loadRows = () =>
    fetchAllRows<Row>((from, to) =>
      supabase
        .from('clients')
        .select('full_name, cpf, phone, email, birth_date, address, status, created_at')
        .eq('organization_id', orgId)
        .is('anonymized_at', null)
        .order('full_name')
        .order('id')
        .range(from, to),
    )
  return (
    <ExportButton
      filename="clientes"
      resource="clients"
      loadRows={loadRows}
      columns={COLUMNS}
      allowSensitive={role === 'admin'}
      label="Exportar"
      size="md"
    />
  )
}
