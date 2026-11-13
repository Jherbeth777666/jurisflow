import { ArrowRight, History, Info, Sparkles } from 'lucide-react'
import { Badge, Button, Card, CardHeader, InlineError, Select } from '@/components/ui'
import { FIELD_HINTS, FIELD_LABELS, IMPORT_FIELDS, type ColumnInfo, type ImportField, type Mapping } from './mapping'

export type AIState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; provider?: string } | { kind: 'unavailable'; message: string }

interface Props {
  columns: ColumnInfo[]
  mapping: Mapping
  confidence: Partial<Record<ImportField, number>>
  onMappingChange: (m: Mapping) => void
  ai: AIState
  onAI: () => void
  categoryValues: string[]
  categoryMap: Record<string, string>
  onCategoryMapChange: (m: Record<string, string>) => void
  categories: { id: string; name: string }[]
  onBack: () => void
  onNext: () => void
  rowsCount: number
  /** o mapeamento veio da última importação desta planilha */
  remembered?: boolean
  onRedo?: () => void
}

export function MappingStep(p: Props) {
  const columnOptions = p.columns.map((c) => ({ value: String(c.index), label: c.header }))
  const setField = (field: ImportField, value: string) => {
    const next: Mapping = { ...p.mapping }
    // uma coluna serve a só um campo: remove de quem a usava
    if (value !== '') {
      const idx = Number(value)
      for (const f of IMPORT_FIELDS) if (next[f] === idx) delete next[f]
      next[field] = idx
    } else delete next[field]
    p.onMappingChange(next)
  }
  const samplesOf = (idx: number | undefined) => (idx === undefined ? [] : (p.columns.find((c) => c.index === idx)?.samples.slice(0, 3) ?? []))
  const missingName = p.mapping.full_name === undefined
  const unmapped = p.columns.filter((c) => !Object.values(p.mapping).includes(c.index))

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Ligue as colunas da planilha aos campos do sistema"
          description={`${p.rowsCount.toLocaleString('pt-BR')} linhas · ${p.columns.length} colunas. Ajuste o que for necessário.`}
          action={
            <Button
              size="sm"
              variant="subtle"
              icon={<Sparkles className="size-3.5" />}
              loading={p.ai.kind === 'loading'}
              onClick={p.onAI}
            >
              Mapear com IA
            </Button>
          }
        />
        <div className="px-4 pt-3">
          {p.remembered && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-accent-50 px-3 py-2">
              <p className="flex items-center gap-1.5 text-label text-accent-700">
                <History className="size-3.5 shrink-0" /> Usamos o mapeamento salvo da última importação desta planilha.
              </p>
              <Button size="sm" onClick={p.onRedo}>
                Refazer mapeamento
              </Button>
            </div>
          )}
          {p.ai.kind === 'done' && (
            <p className="flex items-center gap-1.5 text-label text-emerald-700">
              <Sparkles className="size-3.5" /> Sugestão da IA aplicada — confira antes de seguir.
            </p>
          )}
          {p.ai.kind === 'unavailable' && (
            <p className="flex items-start gap-1.5 text-label text-ink-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" /> {p.ai.message} O mapeamento automático continua funcionando.
            </p>
          )}
        </div>
        <div className="divide-y divide-line">
          {IMPORT_FIELDS.map((f) => {
            const idx = p.mapping[f]
            const conf = p.confidence[f]
            return (
              <div key={f} className="grid gap-2 px-4 py-3 sm:grid-cols-[200px_minmax(0,260px)_1fr] sm:items-center">
                <div>
                  <p className="text-body-sm font-medium text-ink">
                    {FIELD_LABELS[f]}
                    {f === 'full_name' && <span className="ml-0.5 text-red-500">*</span>}
                  </p>
                  {FIELD_HINTS[f] && <p className="text-caption text-ink-subtle">{FIELD_HINTS[f]}</p>}
                </div>
                <Select
                  aria-label={`Coluna para ${FIELD_LABELS[f]}`}
                  options={columnOptions}
                  placeholder="— Não importar —"
                  value={idx === undefined ? '' : String(idx)}
                  onChange={(e) => setField(f, e.target.value)}
                />
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {idx !== undefined && conf !== undefined && conf < 0.7 && <Badge tone="amber">Confira</Badge>}
                  {samplesOf(idx).map((s, i) => (
                    <span key={i} className="max-w-[180px] truncate rounded bg-canvas px-1.5 py-0.5 text-caption text-ink-muted ring-1 ring-line" title={s}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        {unmapped.length > 0 && (
          <p className="border-t border-line px-4 py-2.5 text-caption text-ink-subtle">
            Colunas que não serão importadas: {unmapped.map((c) => c.header).join(', ')}
          </p>
        )}
      </Card>

      {p.mapping.category !== undefined && p.categoryValues.length > 0 && (
        <Card>
          <CardHeader
            title="Tipos de demanda → categorias do escritório"
            description="Cada valor diferente da coluna vira uma categoria. Usado se você optar por criar demandas na revisão."
          />
          <div className="divide-y divide-line">
            {p.categoryValues.slice(0, 200).map((v) => (
              <div key={v} className="grid gap-2 px-4 py-2.5 sm:grid-cols-[1fr_260px] sm:items-center">
                <span className="truncate text-body-sm text-ink" title={v}>
                  {v}
                </span>
                <Select
                  aria-label={`Categoria para ${v}`}
                  options={p.categories.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="— Não criar demanda —"
                  value={p.categoryMap[v] ?? ''}
                  onChange={(e) => p.onCategoryMapChange({ ...p.categoryMap, [v]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      {missingName && <InlineError message="Escolha a coluna do nome completo para continuar." />}
      <div className="flex justify-between gap-2">
        <Button onClick={p.onBack}>Trocar arquivo</Button>
        <Button variant="primary" disabled={missingName} onClick={p.onNext}>
          Revisar dados <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
