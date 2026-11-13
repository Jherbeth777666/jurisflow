import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Pencil, Upload } from 'lucide-react'
import { Badge, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Modal, Pagination, Select, Table, TBody, TD, TH, THead, TR, Tabs, type BadgeTone } from '@/components/ui'
import { formatCPF, formatDate, formatPhone } from '@/lib/format'
import { cn } from '@/lib/cn'
import { FIELD_LABELS, IMPORT_FIELDS, type ImportField, type Mapping } from './mapping'
import {
  allowedActions,
  canReplace,
  effectiveAction,
  effectiveMode,
  ROW_STATUS_LABEL,
  updateDiff,
  type ExistingClient,
  type ImportRow,
  type RowAction,
  type RowStatus,
  type RowSummary,
  type UpdateMode,
} from './rows'

const PAGE = 50
const TONE: Record<RowStatus, BadgeTone> = { novo: 'green', atualizar: 'blue', possivel: 'amber', duplicado: 'gray', erro: 'red' }
const ACTION_LABEL: Record<RowAction, string> = { criar: 'Criar', atualizar: 'Atualizar', ignorar: 'Ignorar' }
type Filter = 'todos' | RowStatus

const DISPLAY_FIELDS: ImportField[] = ['full_name', 'cpf', 'phone', 'email', 'birth_date', 'category']

function display(row: ImportRow, f: ImportField): string {
  const v = row.values
  switch (f) {
    case 'cpf':
      return v.cpf ? formatCPF(v.cpf) : ''
    case 'phone':
      return v.phone ? formatPhone(v.phone) : ''
    case 'birth_date':
      return v.birth_date ? formatDate(v.birth_date) : ''
    case 'category':
      return v.category ?? ''
    case 'email':
      return v.email ?? ''
    default:
      return v.full_name ?? ''
  }
}

function EditableCell({ row, field, onEdit }: { row: ImportRow; field: ImportField; onEdit: (id: string, f: ImportField, v: string) => void }) {
  const [val, setVal] = useState(row.raw[field] ?? '')
  const error = row.errors[field]
  if (!error) return <span className="block max-w-[220px] truncate">{display(row, field) || <span className="text-ink-subtle">—</span>}</span>
  const commit = () => {
    if (val !== (row.raw[field] ?? '')) onEdit(row.id, field, val)
  }
  return (
    <div className="min-w-[150px]">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-label={`${FIELD_LABELS[field]} da linha ${row.line}`}
        aria-invalid
        className="h-7 w-full rounded border border-red-300 bg-red-50/40 px-2 text-label focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
      />
      <p className="mt-0.5 text-caption text-red-600">{error}</p>
    </div>
  )
}

const MODE_OPTIONS = [
  { value: 'completar', label: 'Completar vazios' },
  { value: 'substituir', label: 'Substituir pelos dados da planilha' },
]

function showValue(field: string, v: string | null): string {
  if (!v) return '—'
  if (field === 'cpf') return formatCPF(v)
  if (field === 'phone') return formatPhone(v)
  if (field === 'birth_date') return formatDate(v)
  return v
}

/** Seletor de modo (só com correspondência por CPF) e lista do que muda no cadastro. */
function UpdateDetails({
  row,
  mode,
  existing,
  onMode,
}: {
  row: ImportRow
  mode: UpdateMode
  existing: ExistingClient | undefined
  onMode: (m: UpdateMode) => void
}) {
  const diff = existing ? updateDiff(existing, row.values, mode) : []
  return (
    <div className="mt-1.5 max-w-[260px]">
      {canReplace(row) && (
        <Select
          aria-label={`Modo de atualização da linha ${row.line}`}
          options={MODE_OPTIONS}
          value={mode}
          onChange={(e) => onMode(e.target.value as UpdateMode)}
        />
      )}
      {diff.length > 0 ? (
        <ul className="mt-1 space-y-0.5 text-caption text-ink-muted">
          {diff.map((d) => (
            <li key={d.field}>
              {d.label}: {showValue(d.field, d.from)} → {showValue(d.field, d.to)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-caption text-ink-subtle">Nada a alterar neste cadastro.</p>
      )}
    </div>
  )
}

/** Corrigir a linha inteira: um campo por coluna mapeada (valor bruto da planilha). */
function FixRowModal({
  row,
  mapping,
  onSave,
  onClose,
}: {
  row: ImportRow
  mapping: Mapping
  onSave: (values: Partial<Record<ImportField, string>>) => void
  onClose: () => void
}) {
  const fields = IMPORT_FIELDS.filter((f) => mapping[f] !== undefined)
  const [vals, setVals] = useState<Partial<Record<ImportField, string>>>(() => Object.fromEntries(fields.map((f) => [f, row.raw[f] ?? ''])))
  return (
    <Modal
      open
      onClose={onClose}
      title={`Corrigir linha ${row.line}`}
      description="Ajuste os valores como estão na planilha. A linha é verificada de novo ao salvar."
      footer={
        <>
          <Button variant="primary" onClick={() => onSave(vals)}>
            Salvar correção
          </Button>
          <Button onClick={onClose}>Cancelar</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <Input
            key={f}
            label={FIELD_LABELS[f]}
            value={vals[f] ?? ''}
            error={row.errors[f]}
            onChange={(e) => setVals((cur) => ({ ...cur, [f]: e.target.value }))}
          />
        ))}
      </div>
    </Modal>
  )
}

interface Props {
  rows: ImportRow[]
  mapping: Mapping
  overrides: Record<string, RowAction | undefined>
  onOverride: (ids: string[], a: RowAction) => void
  onEdit: (id: string, f: ImportField, v: string) => void
  modes: Record<string, UpdateMode | undefined>
  onMode: (ids: string[], m: UpdateMode) => void
  existingById: Map<string, ExistingClient>
  createDemands: boolean
  onCreateDemands: (v: boolean) => void
  canCreateDemands: boolean
  summary: RowSummary
  onBack: () => void
  onImport: () => void
}

export function ReviewStep(p: Props) {
  const [filter, setFilter] = useState<Filter>('todos')
  const [page, setPage] = useState(0)
  const [fixing, setFixing] = useState<ImportRow | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)
  const fields = DISPLAY_FIELDS.filter((f) => p.mapping[f] !== undefined)
  const visible = useMemo(() => (filter === 'todos' ? p.rows : p.rows.filter((r) => r.status === filter)), [p.rows, filter])
  const pageRows = visible.slice(page * PAGE, (page + 1) * PAGE)
  const s = p.summary
  const toImport = s.criar + s.atualizar
  // linhas que atualizam um cliente por CPF (as únicas que aceitam "substituir")
  const byCpf = useMemo(() => p.rows.filter((r) => effectiveAction(r, p.overrides) === 'atualizar' && canReplace(r)), [p.rows, p.overrides])

  const tabs: { value: Filter; label: string; count: number }[] = [
    { value: 'todos', label: 'Todas', count: s.total },
    ...(['novo', 'atualizar', 'possivel', 'duplicado', 'erro'] as RowStatus[]).map((st) => ({
      value: st as Filter,
      label: st === 'duplicado' ? 'Duplicados' : st === 'possivel' ? 'Possíveis duplicados' : ROW_STATUS_LABEL[st],
      count: s.byStatus[st],
    })),
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Counter label="Serão criados" value={s.criar} tone="text-emerald-700" />
        <Counter label="Serão atualizados" value={s.atualizar} tone="text-accent-700" hint="completa vazios (ou substitui, se você escolher)" />
        <Counter label="Ignorados" value={s.ignorar} tone="text-ink-muted" />
        <Counter label="Com erro" value={s.byStatus.erro} tone={s.byStatus.erro ? 'text-red-600' : 'text-ink-muted'} hint={s.byStatus.erro ? 'corrija na tabela' : undefined} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-4 pt-3 lg:flex-row lg:items-end lg:justify-between">
          <Tabs
            value={filter}
            onChange={(v) => {
              setFilter(v)
              setPage(0)
            }}
            items={tabs}
            className="scrollbar-thin -mb-px overflow-x-auto border-b-0"
          />
          {byCpf.length > 0 && (
            <div className="flex gap-2 pb-2.5">
              <Button size="sm" onClick={() => setConfirmAll(true)}>
                Substituir em todas por CPF
              </Button>
            </div>
          )}
          {filter === 'possivel' && s.byStatus.possivel > 0 && (
            <div className="flex gap-2 pb-2.5">
              <Button size="sm" onClick={() => p.onOverride(visible.map((r) => r.id), 'ignorar')}>
                Ignorar todos
              </Button>
              <Button size="sm" onClick={() => p.onOverride(visible.map((r) => r.id), 'criar')}>
                Criar todos
              </Button>
            </div>
          )}
        </div>
        {!pageRows.length ? (
          <EmptyState title="Nenhuma linha neste filtro" />
        ) : (
          <Table label="Revisão da importação">
            <THead>
              <tr>
                <TH className="w-14">Linha</TH>
                <TH>Situação</TH>
                {fields.map((f) => (
                  <TH key={f}>{FIELD_LABELS[f]}</TH>
                ))}
                <TH className="w-32">Ação</TH>
              </tr>
            </THead>
            <TBody>
              {pageRows.map((r) => {
                const action = effectiveAction(r, p.overrides)
                const allowed = allowedActions(r.status).filter((a) => a !== 'atualizar' || r.match?.target === 'existing')
                return (
                  <TR key={r.id} className={cn(action === 'ignorar' && 'bg-canvas/60 text-ink-muted')}>
                    <TD className="tabular text-ink-subtle">{r.line}</TD>
                    <TD>
                      <Badge tone={TONE[r.status]} dot>
                        {r.status === 'erro' ? `Erro: ${Object.values(r.errors)[0]}` : ROW_STATUS_LABEL[r.status]}
                      </Badge>
                      {r.match && <p className="mt-1 max-w-[240px] truncate text-caption text-ink-subtle" title={r.match.label}>{r.match.label}</p>}
                      {action === 'atualizar' && r.match?.target === 'existing' && (
                        <UpdateDetails
                          row={r}
                          mode={effectiveMode(r, p.modes[r.id])}
                          existing={p.existingById.get(r.match.id)}
                          onMode={(m) => p.onMode([r.id], m)}
                        />
                      )}
                    </TD>
                    {fields.map((f) => (
                      <TD key={f} className="align-top">
                        <EditableCell key={`${r.id}-${f}-${r.raw[f] ?? ''}`} row={r} field={f} onEdit={p.onEdit} />
                      </TD>
                    ))}
                    <TD>
                      <select
                        aria-label={`Ação para a linha ${r.line}`}
                        value={action}
                        disabled={allowed.length < 2}
                        onChange={(e) => p.onOverride([r.id], e.target.value as RowAction)}
                        className="h-7 w-full rounded border border-line-strong bg-surface px-1.5 text-label disabled:bg-canvas disabled:text-ink-subtle"
                      >
                        {allowed.map((a) => (
                          <option key={a} value={a}>
                            {ACTION_LABEL[a]}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="ghost" className="mt-1" icon={<Pencil className="size-3.5" />} onClick={() => setFixing(r)}>
                        Corrigir
                      </Button>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={PAGE} total={visible.length} onChange={setPage} />
      </Card>

      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Checkbox
            checked={p.createDemands}
            disabled={!p.canCreateDemands}
            onChange={(e) => p.onCreateDemands(e.target.checked)}
            label="Criar uma demanda para cada linha com categoria"
          />
          <p className="mt-1 pl-6 text-caption text-ink-subtle">
            {p.canCreateDemands
              ? `Título padrão “<Categoria> — <Nome>”, na 1ª etapa do fluxo. ${p.createDemands ? `${s.demandas} demanda(s).` : ''}`
              : 'Mapeie a coluna “Tipo de demanda” e associe categorias para usar esta opção.'}
          </p>
        </div>
        {s.byStatus.erro > 0 && (
          <p className="flex items-center gap-1.5 text-label text-amber-800">
            <AlertTriangle className="size-3.5" /> {s.byStatus.erro} linha(s) com erro serão ignoradas se não forem corrigidas.
          </p>
        )}
      </Card>

      {fixing && (
        <FixRowModal
          key={fixing.id}
          row={fixing}
          mapping={p.mapping}
          onClose={() => setFixing(null)}
          onSave={(vals) => {
            for (const [f, v] of Object.entries(vals) as [ImportField, string][]) if (v !== (fixing.raw[f] ?? '')) p.onEdit(fixing.id, f, v)
            setFixing(null)
          }}
        />
      )}
      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        tone="primary"
        title={`Substituir dados de ${byCpf.length.toLocaleString('pt-BR')} cliente${byCpf.length === 1 ? '' : 's'}?`}
        description="Nos clientes encontrados pelo CPF, os dados do cadastro serão trocados pelos da planilha. Células vazias na planilha não apagam nada. Você ainda pode desfazer a importação depois."
        confirmLabel="Substituir"
        onConfirm={() => p.onMode(byCpf.map((r) => r.id), 'substituir')}
      />
      <div className="flex justify-between gap-2">
        <Button icon={<ArrowLeft className="size-4" />} onClick={p.onBack}>
          Voltar ao mapeamento
        </Button>
        <Button variant="primary" icon={<Upload className="size-4" />} disabled={!toImport} onClick={p.onImport}>
          Importar {toImport.toLocaleString('pt-BR')} registro{toImport === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  )
}

function Counter({ label, value, tone, hint }: { label: string; value: number; tone: string; hint?: string }) {
  return (
    <Card className="p-3.5">
      <p className="text-caption font-medium text-ink-muted">{label}</p>
      <p className={cn('tabular mt-1 text-heading font-semibold tracking-[-0.02em]', tone)}>{value.toLocaleString('pt-BR')}</p>
      {hint && <p className="text-caption text-ink-subtle">{hint}</p>}
    </Card>
  )
}
