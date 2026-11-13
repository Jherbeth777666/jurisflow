import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Briefcase, Plus, X } from 'lucide-react'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CategoryTag,
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
import { useCategories, useMemberNames } from '@/hooks/useOrgData'
import { DEMAND_STATUS, PAGE_SIZE, PRIORITY, toOptions } from '@/lib/constants'
import { daysSince, formatDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import type { PriorityLevel } from '@/types/database'
import { useDemandsList } from './api'
import { DemandFormModal } from './DemandFormModal'
import { useOpenFromParam } from '@/hooks/useOpenFromParam'
import { useSelection } from '@/hooks/useSelection'
import { SavedViewsMenu } from '@/features/views/SavedViewsMenu'
import { DemandsBulkActions } from './DemandsBulkActions'
import { ExportDemands } from './ExportDemands'
import {
  STALLED_DAYS,
  formatDaysStalled,
  hasActiveFilters,
  isNextActionOverdue,
  isOpenStatus,
  parseDemandFilters,
  patchDemandFilters,
  serializeDemandFilters,
  type DemandFilters,
  type DemandStatusFilter,
} from './logic'

const STATUS_FILTER_OPTIONS = [
  { value: 'abertas', label: 'Abertas' },
  { value: 'todas', label: 'Todas' },
  ...toOptions(DEMAND_STATUS),
]

export function DemandsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => parseDemandFilters(params), [params])
  const [creating, setCreating] = useOpenFromParam('nova')

  const cats = useCategories()
  const members = useMemberNames()

  const catById = useMemo(() => new Map((cats.data ?? []).map((c) => [c.id, c])), [cats.data])
  const stageById = useMemo(() => {
    const m = new Map<string, { name: string; is_waiting_docs: boolean }>()
    cats.data?.forEach((c) => c.stages.forEach((s) => m.set(s.id, s)))
    return m
  }, [cats.data])
  const waitingStageIds = useMemo(
    () => (cats.data ? cats.data.flatMap((c) => c.stages.filter((s) => s.is_waiting_docs).map((s) => s.id)) : null),
    [cats.data],
  )

  const q = useDemandsList(filters, waitingStageIds)

  // Seleção em massa: some ao mudar filtros/página (a chave é a própria URL).
  const selection = useSelection(params.toString())
  const pageRows = q.data?.rows ?? []
  const pageIds = pageRows.map((d) => d.id)
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selection.has(id))
  const selectedRows = pageRows.filter((d) => selection.has(d.id))

  const apply = useCallback(
    (patch: Partial<DemandFilters>) => setParams(serializeDemandFilters(patchDemandFilters(parseDemandFilters(params), patch)), { replace: true }),
    [params, setParams],
  )
  const onSearch = useCallback((v: string) => apply({ q: v }), [apply])

  const categoryOptions = (cats.data ?? []).map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (inativa)` }))
  const stageOptions = (catById.get(filters.category)?.stages ?? []).map((s) => ({ value: s.id, label: s.name }))
  const responsibleOptions = [{ value: 'none', label: 'Sem responsável' }, ...members.options]

  const active = hasActiveFilters(filters)
  const [showFilters, setShowFilters] = useState(false)
  const activeFilterCount = [
    filters.category,
    filters.stage,
    filters.responsible,
    filters.priority,
    filters.status !== 'abertas' ? filters.status : '',
    filters.waitingDocs ? 'docs' : '',
    filters.stalled > 0 ? String(filters.stalled) : '',
  ].filter(Boolean).length

  const filterSelects = () => (
    <>
      <Select
        aria-label="Categoria"
        options={categoryOptions}
        placeholder="Todas as categorias"
        value={filters.category}
        onChange={(e) => apply({ category: e.target.value })}
      />
      <Select
        aria-label="Etapa"
        options={stageOptions}
        placeholder={filters.category ? 'Todas as etapas' : 'Etapa (escolha a categoria)'}
        disabled={!filters.category}
        value={filters.stage}
        onChange={(e) => apply({ stage: e.target.value })}
      />
      <Select
        aria-label="Responsável"
        options={responsibleOptions}
        placeholder="Todos os responsáveis"
        value={filters.responsible}
        onChange={(e) => apply({ responsible: e.target.value })}
      />
      <Select
        aria-label="Prioridade"
        options={toOptions(PRIORITY)}
        placeholder="Todas as prioridades"
        value={filters.priority}
        onChange={(e) => apply({ priority: e.target.value as PriorityLevel | '' })}
      />
      <Select
        aria-label="Status"
        options={STATUS_FILTER_OPTIONS}
        value={filters.status}
        onChange={(e) => apply({ status: e.target.value as DemandStatusFilter })}
      />
    </>
  )

  return (
    <div>
      <PageHeader
        title="Demandas"
        description="Acompanhe os casos do escritório por categoria, etapa e responsável."
        actions={
          <>
            <SavedViewsMenu page="demandas" />
            <ExportDemands />
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nova demanda
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:hidden">
        <div className="flex items-center gap-2">
          <SearchInput value={filters.q} onChange={onSearch} placeholder="Buscar por título" className="min-w-0 flex-1" />
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((s) => !s)}
            className="shrink-0"
          >
            Filtros ({activeFilterCount})
          </Button>
        </div>
        {showFilters && <div className="grid grid-cols-1 gap-2">{filterSelects()}</div>}
      </div>

      <div className="mb-3 hidden gap-2 sm:grid sm:grid-cols-2 lg:grid-cols-[minmax(200px,1.4fr)_repeat(5,minmax(0,1fr))]">
        <SearchInput value={filters.q} onChange={onSearch} placeholder="Buscar por título" />
        {filterSelects()}
      </div>

      {(filters.waitingDocs || filters.stalled > 0 || active) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-label">
          {filters.waitingDocs && (
            <FilterChip onRemove={() => apply({ waitingDocs: false })}>Aguardando documentação</FilterChip>
          )}
          {filters.stalled > 0 && (
            <FilterChip onRemove={() => apply({ stalled: 0 })}>{`Paradas há ${filters.stalled}+ dias`}</FilterChip>
          )}
          {active && (
            <button className="text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Limpar filtros
            </button>
          )}
          {q.data && <span className="tabular ml-auto text-ink-subtle">{q.data.total} demanda(s)</span>}
        </div>
      )}

      <Card className="overflow-hidden">
        {q.isLoading || (q.isPending && cats.isLoading) ? (
          <TableSkeleton cols={6} />
        ) : q.isError ? (
          <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
        ) : cats.isError ? (
          <ErrorState message={(cats.error as Error).message} onRetry={() => cats.refetch()} />
        ) : !q.data?.rows.length ? (
          active ? (
            <EmptyState
              title="Nenhuma demanda encontrada"
              description="Nenhuma demanda corresponde aos filtros aplicados."
              action={
                <Button size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Briefcase className="size-5" />}
              title="Nenhuma demanda aberta"
              description="Cadastre uma demanda para começar a acompanhar o fluxo de trabalho."
              action={
                <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  Nova demanda
                </Button>
              }
            />
          )
        ) : (
          <>
            <label className="flex items-center gap-2.5 border-b border-line bg-surface-muted px-4 py-2 text-label text-ink-muted sm:hidden">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => selection.toggleAll(pageIds)}
                aria-label="Selecionar todas desta página"
                className="size-4 cursor-pointer rounded border-line-strong accent-navy-900"
              />
              Selecionar todas desta página
            </label>
            <ul className="divide-y divide-line sm:hidden">
              {q.data.rows.map((d) => {
                const cat = catById.get(d.category_id)
                const stage = d.stage_id ? stageById.get(d.stage_id) : undefined
                const open = isOpenStatus(d.status)
                const days = daysSince(d.stage_changed_at)
                const overdue = isNextActionOverdue(d)
                const responsible = d.responsible_id ? members.map.get(d.responsible_id) : null
                return (
                  <li key={d.id} className="flex items-start gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selection.has(d.id)}
                      onChange={() => selection.toggle(d.id)}
                      aria-label={`Selecionar ${d.title}`}
                      className="mt-2 size-4 shrink-0 cursor-pointer rounded border-line-strong accent-navy-900"
                    />
                    <div className="min-w-0 flex-1">
                    <Link to={`/demandas/${d.id}`} className="block truncate py-1 font-medium text-ink hover:underline">
                      {d.title}
                    </Link>
                    <p className="truncate text-caption text-ink-subtle">{d.client?.full_name ?? '—'}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <StatusBadge value={d.priority} map={PRIORITY} />
                      {d.status !== 'em_andamento' && <StatusBadge value={d.status} map={DEMAND_STATUS} />}
                      {stage && <span className="text-caption text-ink-muted">{stage.name}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted">
                      {cat && <CategoryTag name={cat.name} color={cat.color} />}
                      {responsible && (
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar name={responsible} />
                          <span>{responsible}</span>
                        </span>
                      )}
                      {open && (
                        <span className={cn(days >= STALLED_DAYS ? 'font-medium text-amber-700' : 'text-ink-muted')}>
                          {formatDaysStalled(days)} na etapa
                        </span>
                      )}
                      {(d.next_action || d.next_action_date) && (
                        <span className={cn('tabular', overdue ? 'font-medium text-red-600' : 'text-ink-muted')}>
                          {d.next_action && <span className="text-ink-muted">{d.next_action} · </span>}
                          {d.next_action_date ? formatDate(d.next_action_date) : 'Sem data'}
                          {overdue && ' · vencida'}
                        </span>
                      )}
                    </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            <div className="hidden sm:block">
            <Table label="Lista de demandas" className={q.isPlaceholderData ? 'opacity-60' : undefined}>
              <THead>
                <tr>
                  <TH className="w-10 pr-0">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => selection.toggleAll(pageIds)}
                      aria-label="Selecionar todas desta página"
                      className="size-4 cursor-pointer rounded border-line-strong accent-navy-900"
                    />
                  </TH>
                  <TH>Demanda</TH>
                  <TH>Categoria</TH>
                  <TH>Etapa</TH>
                  <TH className="hidden md:table-cell">Responsável</TH>
                  <TH>Prioridade</TH>
                  <TH className="hidden sm:table-cell">Na etapa</TH>
                  <TH>Próxima atividade</TH>
                </tr>
              </THead>
              <TBody>
                {q.data.rows.map((d) => {
                  const cat = catById.get(d.category_id)
                  const stage = d.stage_id ? stageById.get(d.stage_id) : undefined
                  const open = isOpenStatus(d.status)
                  const days = daysSince(d.stage_changed_at)
                  const overdue = isNextActionOverdue(d)
                  const responsible = d.responsible_id ? members.map.get(d.responsible_id) : null
                  return (
                    <TR key={d.id} onClick={() => navigate(`/demandas/${d.id}`)}>
                      <TD className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selection.has(d.id)}
                          onChange={() => selection.toggle(d.id)}
                          aria-label={`Selecionar ${d.title}`}
                          className="size-4 cursor-pointer rounded border-line-strong accent-navy-900"
                        />
                      </TD>
                      <TD className="max-w-[280px]">
                        <Link
                          to={`/demandas/${d.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate py-1 font-medium text-ink hover:underline"
                        >
                          {d.title}
                        </Link>
                        <span className="block truncate text-caption text-ink-subtle">{d.client?.full_name ?? '—'}</span>
                      </TD>
                      <TD>{cat ? <CategoryTag name={cat.name} color={cat.color} /> : '—'}</TD>
                      <TD>
                        <div className="flex flex-col items-start gap-1">
                          <span className="whitespace-nowrap text-ink-muted">{stage?.name ?? '—'}</span>
                          {d.status !== 'em_andamento' && <StatusBadge value={d.status} map={DEMAND_STATUS} />}
                        </div>
                      </TD>
                      <TD className="hidden md:table-cell">
                        {responsible ? (
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <Avatar name={responsible} />
                            <span className="text-ink-muted">{responsible}</span>
                          </span>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </TD>
                      <TD>
                        <StatusBadge value={d.priority} map={PRIORITY} />
                      </TD>
                      <TD className="tabular hidden whitespace-nowrap sm:table-cell">
                        {open ? (
                          <span className={cn(days >= STALLED_DAYS ? 'font-medium text-amber-700' : 'text-ink-muted')}>
                            {formatDaysStalled(days)}
                          </span>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </TD>
                      <TD className="max-w-[220px]">
                        {d.next_action || d.next_action_date ? (
                          <>
                            <span className={cn('tabular block whitespace-nowrap', overdue ? 'font-medium text-red-600' : 'text-ink-muted')}>
                              {d.next_action_date ? formatDate(d.next_action_date) : 'Sem data'}
                              {overdue && ' · vencida'}
                            </span>
                            {d.next_action && <span className="block truncate text-caption text-ink-subtle">{d.next_action}</span>}
                          </>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
            </div>
            <Pagination page={filters.page} pageSize={PAGE_SIZE} total={q.data.total} onChange={(p) => apply({ page: p })} />
          </>
        )}
      </Card>

      <DemandsBulkActions
        selected={selectedRows}
        categories={cats.data ?? []}
        memberOptions={members.options}
        onClear={selection.clear}
      />

      <DemandFormModal open={creating} onClose={() => setCreating(false)} onSaved={(d) => navigate(`/demandas/${d.id}`)} />
    </div>
  )
}

function FilterChip({ children, onRemove }: { children: string; onRemove: () => void }) {
  return (
    <Badge tone="amber" className="gap-1 pr-1">
      {children}
      <button onClick={onRemove} aria-label={`Remover filtro ${children}`} className="rounded-full p-0.5 hover:bg-amber-100">
        <X className="size-3" />
      </button>
    </Badge>
  )
}
