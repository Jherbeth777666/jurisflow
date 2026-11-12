// Assistente de importação de planilha (/importar): upload → mapeamento → revisão → importação.
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, FileSpreadsheet, RotateCcw } from 'lucide-react'
import { Button, Card, CardHeader, ErrorState, PageHeader, Spinner, StatCard, Table, TBody, TD, TH, THead, TR, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { qk, useCategories } from '@/hooks/useOrgData'
import { downloadCSV } from '@/lib/csv'
import { AIUnavailableError, fetchExistingClients, mapWithAI, runImport, type ImportPlanItem, type ImportReport } from './api'
import { buildAIRequest, columnsOf, distinctValues, guessCategory, suggestMapping, type ImportField, type Mapping } from './mapping'
import { MappingStep, type AIState } from './MappingStep'
import { cellToString, nameKey } from './normalize'
import { readSpreadsheet, SheetReadError, type LoadedSheet } from './readFile'
import { ReviewStep } from './ReviewStep'
import { classifyRows, draftsFromTable, effectiveAction, rowErrorText, summarize, type DraftRow, type ImportRow, type RowAction } from './rows'
import { Stepper, UploadStep } from './UploadStep'

const STEPS = ['Enviar planilha', 'Mapear colunas', 'Revisar', 'Importar']
type Step = 0 | 1 | 2 | 3

export function ImportPage() {
  const { orgId, userId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  const cats = useCategories()
  const categories = useMemo(() => (cats.data ?? []).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })), [cats.data])

  const [step, setStep] = useState<Step>(0)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<LoadedSheet | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [confidence, setConfidence] = useState<Partial<Record<ImportField, number>>>({})
  const [ai, setAI] = useState<AIState>({ kind: 'idle' })
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [overrides, setOverrides] = useState<Record<string, RowAction | undefined>>({})
  const [createDemands, setCreateDemands] = useState(true)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const existing = useQuery({
    queryKey: qk.clients(orgId, 'import-existing'),
    queryFn: () => fetchExistingClients(orgId),
    enabled: step >= 1 && step <= 2,
    staleTime: 30_000,
  })
  const existingById = useMemo(() => new Map((existing.data ?? []).map((c) => [c.id, c])), [existing.data])

  const columns = useMemo(() => (sheet ? columnsOf(sheet.table) : []), [sheet])
  const categoryValues = useMemo(
    () => (sheet && mapping.category !== undefined ? distinctValues(sheet.table.rows, mapping.category) : []),
    [sheet, mapping.category],
  )
  const firstLine = sheet?.table.hasHeader ? 2 : 1

  // Palpite local para valores ainda sem categoria
  const withLocalGuesses = useCallback(
    (values: string[], current: Record<string, string>) => {
      const next = { ...current }
      for (const v of values) if (next[v] === undefined) next[v] = guessCategory(v, categories) ?? ''
      return next
    },
    [categories],
  )

  const runAI = useCallback(
    async (s: LoadedSheet, m: Mapping, auto: boolean) => {
      setAI({ kind: 'loading' })
      try {
        const cols = columnsOf(s.table)
        const values = m.category !== undefined ? distinctValues(s.table.rows, m.category) : []
        const res = await mapWithAI(orgId, buildAIRequest(cols, categories.map((c) => c.name), values))
        if (res.mapping.full_name === undefined && m.full_name !== undefined) res.mapping.full_name = m.full_name
        setMapping(res.mapping)
        setConfidence(Object.fromEntries(Object.keys(res.mapping).map((k) => [k, 0.9])))
        const byName = new Map(categories.map((c) => [nameKey(c.name), c.id]))
        const newValues = res.mapping.category !== undefined ? distinctValues(s.table.rows, res.mapping.category) : []
        const fromAI: Record<string, string> = {}
        for (const [v, cat] of Object.entries(res.categories)) fromAI[v] = byName.get(nameKey(cat)) ?? ''
        setCategoryMap((cur) => withLocalGuesses(newValues, { ...cur, ...fromAI }))
        setAI({ kind: 'done', provider: res.provider })
      } catch (e) {
        const msg = e instanceof AIUnavailableError ? e.message : 'Mapeamento com IA indisponível no momento.'
        setAI({ kind: 'unavailable', message: msg })
        if (!auto) toast.show(msg, 'error')
      }
    },
    [orgId, categories, toast, withLocalGuesses],
  )

  const onFile = async (file: File) => {
    setReading(true)
    setReadError(null)
    try {
      const s = await readSpreadsheet(file)
      const sug = suggestMapping(columnsOf(s.table))
      setSheet(s)
      setMapping(sug.mapping)
      setConfidence(sug.confidence)
      setAI({ kind: 'idle' })
      setOverrides({})
      setReport(null)
      setCategoryMap(withLocalGuesses(sug.mapping.category !== undefined ? distinctValues(s.table.rows, sug.mapping.category) : [], {}))
      setStep(1)
      if (sug.lowConfidence) void runAI(s, sug.mapping, true)
    } catch (e) {
      setReadError(e instanceof SheetReadError ? e.message : 'Não foi possível ler o arquivo.')
    } finally {
      setReading(false)
    }
  }

  const onMappingChange = (m: Mapping) => {
    setMapping(m)
    if (sheet && m.category !== undefined && m.category !== mapping.category) {
      setCategoryMap((cur) => withLocalGuesses(distinctValues(sheet.table.rows, m.category!), cur))
    }
  }

  const goReview = () => {
    if (!sheet) return
    setDrafts(draftsFromTable(sheet.table.rows, mapping, firstLine))
    setOverrides({})
    setStep(2)
  }

  const rows = useMemo(() => (step >= 2 ? classifyRows(drafts, existing.data ?? []) : []), [drafts, existing.data, step])
  const categoryFor = useCallback(
    (r: ImportRow) => {
      if (!r.values.category) return null
      const key = Object.keys(categoryMap).find((k) => nameKey(k) === nameKey(r.values.category!))
      const id = key ? categoryMap[key] : ''
      return id ? (categories.find((c) => c.id === id) ?? null) : null
    },
    [categoryMap, categories],
  )
  const canCreateDemands = mapping.category !== undefined && Object.values(categoryMap).some(Boolean)
  const demandsOn = createDemands && canCreateDemands
  const summary = useMemo(() => summarize(rows, overrides, (r) => demandsOn && !!categoryFor(r)), [rows, overrides, demandsOn, categoryFor])

  const onEdit = (id: string, f: ImportField, v: string) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, raw: { ...d.raw, [f]: v } } : d)))
  const onOverride = (ids: string[], a: RowAction) =>
    setOverrides((o) => {
      const next = { ...o }
      ids.forEach((id) => (next[id] = a))
      return next
    })

  const startImport = async () => {
    const plan: ImportPlanItem[] = []
    let ignored = 0
    for (const r of rows) {
      const action = effectiveAction(r, overrides)
      if (action === 'ignorar') {
        ignored++
        continue
      }
      const cat = demandsOn ? categoryFor(r) : null
      plan.push({ row: r, action, categoryId: cat?.id ?? null, categoryName: cat?.name ?? null })
    }
    setStep(3)
    setImportError(null)
    setProgress({ done: 0, total: plan.length })
    try {
      const rep = await runImport(plan, {
        orgId,
        userId,
        existing: existingById,
        ignored,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setReport(rep)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'A importação foi interrompida.')
    } finally {
      qc.invalidateQueries({ queryKey: qk.clients(orgId) })
      qc.invalidateQueries({ queryKey: qk.demands(orgId) })
      qc.invalidateQueries({ queryKey: qk.dashboard(orgId) })
      qc.invalidateQueries({ queryKey: qk.activity(orgId) })
    }
  }

  const downloadErrors = () => {
    if (!sheet) return
    const reasons = new Map<number, string[]>()
    const add = (line: number, reason: string) => reasons.set(line, [...(reasons.get(line) ?? []), reason])
    rows.filter((r) => r.status === 'erro').forEach((r) => add(r.line, rowErrorText(r)))
    report?.errors.forEach((e) => add(e.line, e.reason))
    const lines = [...reasons.keys()].sort((a, b) => a - b)
    downloadCSV('linhas-com-erro', [
      ['Linha', ...sheet.table.headers, 'Motivo'],
      ...lines.map((l) => [String(l), ...(sheet.table.rows[l - firstLine] ?? []).map(cellToString), reasons.get(l)!.join(' · ')]),
    ])
  }

  const reset = () => {
    setSheet(null)
    setStep(0)
    setReport(null)
    setProgress(null)
    setDrafts([])
    setImportError(null)
  }

  return (
    <div>
      <PageHeader
        title="Importar planilha"
        description="Traga seus clientes do Excel em minutos: o sistema organiza, corrige formatos e evita duplicados."
      />
      <Stepper steps={STEPS} current={step} />
      {sheet && step > 0 && step < 3 && (
        <p className="-mt-2 mb-4 flex items-center gap-1.5 text-label text-ink-muted">
          <FileSpreadsheet className="size-3.5" /> {sheet.fileName}
          {sheet.sheetName && ` · aba “${sheet.sheetName}”`} · lido apenas no seu navegador
        </p>
      )}

      {step === 0 && <UploadStep onFile={onFile} loading={reading} error={readError} />}

      {step === 1 && sheet && (
        <MappingStep
          columns={columns}
          mapping={mapping}
          confidence={confidence}
          onMappingChange={onMappingChange}
          ai={ai}
          onAI={() => void runAI(sheet, mapping, false)}
          categoryValues={categoryValues}
          categoryMap={categoryMap}
          onCategoryMapChange={setCategoryMap}
          categories={categories}
          onBack={reset}
          onNext={goReview}
          rowsCount={sheet.table.rows.length}
        />
      )}

      {step === 2 &&
        (existing.isLoading ? (
          <Card>
            <Spinner label="Comparando com os clientes já cadastrados…" />
          </Card>
        ) : existing.isError ? (
          <Card>
            <ErrorState message={(existing.error as Error).message} onRetry={() => existing.refetch()} />
          </Card>
        ) : (
          <ReviewStep
            rows={rows}
            mapping={mapping}
            overrides={overrides}
            onOverride={onOverride}
            onEdit={onEdit}
            createDemands={demandsOn}
            onCreateDemands={setCreateDemands}
            canCreateDemands={canCreateDemands}
            summary={summary}
            onBack={() => setStep(1)}
            onImport={startImport}
          />
        ))}

      {step === 3 && (
        <ResultView
          progress={progress}
          report={report}
          error={importError}
          validationErrors={rows.filter((r) => r.status === 'erro' && effectiveAction(r, overrides) === 'ignorar').length}
          onDownloadErrors={downloadErrors}
          onReset={reset}
        />
      )}
    </div>
  )
}

function ResultView({
  progress,
  report,
  error,
  validationErrors,
  onDownloadErrors,
  onReset,
}: {
  progress: { done: number; total: number } | null
  report: ImportReport | null
  error: string | null
  validationErrors: number
  onDownloadErrors: () => void
  onReset: () => void
}) {
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  if (!report && !error) {
    return (
      <Card className="p-6">
        <p className="text-body-lg font-medium text-ink">Importando…</p>
        <p className="mt-1 text-body-sm text-ink-muted">Não feche esta página. Os registros são gravados em lotes de 100.</p>
        <div
          className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Progresso da importação"
        >
          <div className="h-full rounded-full bg-navy-900 transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p className="tabular mt-2 text-label text-ink-muted">
          {progress?.done ?? 0} de {progress?.total ?? 0} operações · {pct}%
        </p>
      </Card>
    )
  }
  const errCount = (report?.errors.length ?? 0) + validationErrors
  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Card>
          <ErrorState message={`${error} Parte dos registros pode ter sido gravada — confira a lista de clientes.`} />
        </Card>
      ) : (
        <Card className="flex items-start gap-3 p-5">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div>
            <p className="text-body-lg font-medium text-ink">Importação concluída</p>
            <p className="mt-0.5 text-body-sm text-ink-muted">Seu cadastro já está organizado no JurisFlow. Os indicadores do painel foram atualizados.</p>
          </div>
        </Card>
      )}
      {report && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Clientes criados" value={report.created} tone="success" />
          <StatCard label="Atualizados" value={report.updated} hint={report.unchanged ? `${report.unchanged} sem alterações` : undefined} />
          <StatCard label="Demandas criadas" value={report.demands} />
          <StatCard label="Ignorados" value={report.ignored} />
          <StatCard label="Erros" value={errCount} tone={errCount ? 'danger' : 'default'} />
        </div>
      )}
      {report && report.errors.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Registros não gravados" description="Corrija na planilha e importe só estas linhas novamente." />
          <Table label="Registros não gravados">
            <THead>
              <tr>
                <TH className="w-16">Linha</TH>
                <TH>Nome</TH>
                <TH>Motivo</TH>
              </tr>
            </THead>
            <TBody>
              {report.errors.slice(0, 100).map((e, i) => (
                <TR key={i}>
                  <TD className="tabular text-ink-subtle">{e.line}</TD>
                  <TD>{e.name || '—'}</TD>
                  <TD className="text-red-700">{e.reason}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {errCount > 0 && (
          <Button icon={<Download className="size-4" />} onClick={onDownloadErrors}>
            Baixar linhas com erro (CSV)
          </Button>
        )}
        <Button icon={<RotateCcw className="size-4" />} onClick={onReset}>
          Importar outra planilha
        </Button>
        <Link
          to="/clientes"
          className="inline-flex h-9 items-center rounded-md bg-navy-900 px-3.5 text-body font-medium text-white shadow-sm hover:bg-navy-800"
        >
          Ver clientes
        </Link>
      </div>
    </div>
  )
}
