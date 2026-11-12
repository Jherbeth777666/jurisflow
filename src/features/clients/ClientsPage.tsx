import { useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Users } from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  StatusBadge,
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui'
import { CLIENT_STATUS, PAGE_SIZE, toOptions } from '@/lib/constants'
import { formatDate, formatPhone, maskCPF } from '@/lib/format'
import type { ClientStatus } from '@/types/database'
import { useClientsList } from './api'
import { ClientFormModal } from './ClientFormModal'
import { useOpenFromParam } from '@/hooks/useOpenFromParam'
import { ExportClients } from './ExportClients'

const STATUS_VALUES = Object.keys(CLIENT_STATUS) as ClientStatus[]

export function ClientsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const term = params.get('q') ?? ''
  const statusParam = params.get('status') ?? ''
  const status = (STATUS_VALUES as string[]).includes(statusParam) ? (statusParam as ClientStatus) : ''
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0)
  const [creating, setCreating] = useOpenFromParam('novo')

  const update = useCallback(
    (patch: Record<string, string>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)))
          if (!('page' in patch)) next.delete('page')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  const onSearch = useCallback((v: string) => update({ q: v }), [update])

  const q = useClientsList({ term, status, page })
  const filtered = !!term || !!status

  return (
    <div>
      <PageHeader
        title="Clientes"
        description="Cadastro e histórico de atendimento dos clientes do escritório."
        actions={
          <>
            <ExportClients />
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Novo cliente
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <SearchInput value={term} onChange={onSearch} placeholder="Buscar por nome ou CPF" className="sm:max-w-sm sm:flex-1" />
        <Select
          aria-label="Filtrar por status"
          options={toOptions(CLIENT_STATUS)}
          placeholder="Todos os status"
          value={status}
          onChange={(e) => update({ status: e.target.value })}
          wrapperClassName="sm:w-48"
        />
      </div>

      <Card className="overflow-hidden">
        {q.isLoading ? (
          <TableSkeleton cols={5} />
        ) : q.isError ? (
          <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        ) : !q.data?.rows.length ? (
          filtered ? (
            <EmptyState
              title="Nenhum cliente encontrado"
              description="Ajuste a busca ou o filtro de status."
              action={
                <Button size="sm" onClick={() => update({ q: '', status: '' })}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Users className="size-5" />}
              title="Nenhum cliente cadastrado"
              description="Cadastre o primeiro cliente para começar a registrar demandas."
              action={
                <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  Novo cliente
                </Button>
              }
            />
          )
        ) : (
          <>
            <ul className="divide-y divide-line sm:hidden">
              {q.data.rows.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <Link to={`/clientes/${c.id}`} className="block truncate py-1 font-medium text-ink hover:underline">
                    {c.full_name}
                  </Link>
                  {c.email && <p className="truncate text-[12px] text-ink-subtle">{c.email}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <StatusBadge value={c.status} map={CLIENT_STATUS} />
                    <span className="tabular text-[12px] text-ink-muted">{c.open_demands || 0} demanda(s) aberta(s)</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
                    <span className="tabular">{maskCPF(c.cpf)}</span>
                    {c.phone && <span className="tabular">{formatPhone(c.phone)}</span>}
                    <span className="tabular">Cadastro: {formatDate(c.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
            <Table label="Lista de clientes" className={q.isPlaceholderData ? 'opacity-60' : undefined}>
              <THead>
                <tr>
                  <TH>Nome</TH>
                  <TH>CPF</TH>
                  <TH className="hidden md:table-cell">Telefone</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Demandas abertas</TH>
                  <TH className="hidden lg:table-cell">Cadastro</TH>
                </tr>
              </THead>
              <TBody>
                {q.data.rows.map((c) => (
                  <TR key={c.id} onClick={() => navigate(`/clientes/${c.id}`)}>
                    <TD className="max-w-[260px]">
                      <Link
                        to={`/clientes/${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate py-1 font-medium text-ink hover:underline"
                      >
                        {c.full_name}
                      </Link>
                      {c.email && <span className="block truncate text-[12px] text-ink-subtle">{c.email}</span>}
                    </TD>
                    <TD className="tabular whitespace-nowrap text-ink-muted">{maskCPF(c.cpf)}</TD>
                    <TD className="tabular hidden whitespace-nowrap text-ink-muted md:table-cell">{c.phone ? formatPhone(c.phone) : '—'}</TD>
                    <TD>
                      <StatusBadge value={c.status} map={CLIENT_STATUS} />
                    </TD>
                    <TD className="tabular text-right">{c.open_demands || <span className="text-ink-subtle">0</span>}</TD>
                    <TD className="tabular hidden whitespace-nowrap text-ink-muted lg:table-cell">{formatDate(c.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onChange={(p) => update({ page: p ? String(p) : '' })} />
          </>
        )}
      </Card>

      <ClientFormModal open={creating} onClose={() => setCreating(false)} onSaved={(c) => navigate(`/clientes/${c.id}`)} />
    </div>
  )
}
