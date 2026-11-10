import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Upload } from 'lucide-react'
import { Badge, Button, Card, Checkbox, EmptyState, Pagination, Table, TBody, TD, TH, THead, TR, Tabs, type BadgeTone } from '@/components/ui'
import { formatCPF, formatDate, formatPhone } from '@/lib/format'
import { cn } from '@/lib/cn'
import { FIELD_LABELS, type ImportField, type Mapping } from './mapping'
import { allowedActions, effectiveAction, ROW_STATUS_LABEL, type ImportRow, type RowAction, type RowStatus, type RowSummary } from './rows'

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
        className="h-7 w-full rounded border border-red-300 bg-red-50/40 px-2 text-[12.5px] focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100"
      />
      <p className="mt-0.5 text-[11.5px] text-red-600">{error}</p>
    </div>
  )
}

interface Props {
  rows: ImportRow[]
  mapping: Mapping
  overrides: Record<string, RowAction | undefined>
  onOverride: (ids: string[], a: RowAction) => void
  onEdit: (id: string, f: ImportField, v: string) => void
  createDemands: boolean
  onCreateDemands: (v: boolean) => void
  canCreateDemands: boolean
  summary: RowSummary
  onBack: () => void
  onImport: () => void
}

export function ReviewStep(p: Props) {
  const [filter, setFilter] = useState<Filter>('todos')
  const [rawPage, setPage] = useState(0)
  // Se a lista visível encolheu (ex.: linhas desmarcadas/filtradas), fica na última página válida.
  const page = Math.min(rawPage, Math.max(0, Math.ceil(visible.length / PAGE) - 1))
  const fields = DISPLAY_FIELDS.filter((f) => p.mapping[f] !== undefined)
  const visible = useMemo(() => (filter === 'todos' ? p.rows : p.rows.filter((r) => r.status === filter)), [p.rows, filter])
  const pageRows = visible.slice(page * PAGE, (page + 1) * PAGE)
  const s = p.summary
  const toImport = s.criar + s.atualizar

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
        <Counter label="Serão atualizados" value={s.atualizar} tone="text-accent-700" hint="só completa campos vazios" />
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
          <Table>
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
                      {r.match && <p className="mt-1 max-w-[240px] truncate text-[11.5px] text-ink-subtle" title={r.match.label}>{r.match.label}</p>}
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
                        className="h-7 w-full rounded border border-line-strong bg-surface px-1.5 text-[12.5px] disabled:bg-canvas disabled:text-ink-subtle"
                      >
                        {allowed.map((a) => (
                          <option key={a} value={a}>
                            {ACTION_LABEL[a]}
                          </option>
                        ))}
                      </select>
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
          <p className="mt-1 pl-6 text-[12px] text-ink-subtle">
            {p.canCreateDemands
              ? `Título padrão “<Categoria> — <Nome>”, na 1ª etapa do fluxo. ${p.createDemands ? `${s.demandas} demanda(s).` : ''}`
              : 'Mapeie a coluna “Tipo de demanda” e associe categorias para usar esta opção.'}
          </p>
        </div>
        {s.byStatus.erro > 0 && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-amber-800">
            <AlertTriangle className="size-3.5" /> {s.byStatus.erro} linha(s) com erro serão ignoradas se não forem corrigidas.
          </p>
        )}
      </Card>

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
      <p className="text-[12px] font-medium text-ink-muted">{label}</p>
      <p className={cn('tabular mt-1 text-[20px] font-semibold tracking-[-0.02em]', tone)}>{value.toLocaleString('pt-BR')}</p>
      {hint && <p className="text-[11.5px] text-ink-subtle">{hint}</p>}
    </Card>
  )
}
