// Acesso a dados da importação: clientes existentes, IA de mapeamento e gravação em lotes.
// Toda escrita passa pela RLS do usuário (o banco valida tudo).
import { supabase, friendlyError, fetchAllRows, isRowConstraintError, unwrap } from '@/lib/supabase'
import type { AIImportRequest, ImportField } from './mapping'
import { demandTitle, effectiveMode, updatePatch, type ExistingClient, type ImportRow, type RowAction, type UpdateMode } from './rows'

export const BATCH_SIZE = 100

export async function fetchExistingClients(orgId: string): Promise<ExistingClient[]> {
  return fetchAllRows<ExistingClient>((from, to) =>
    supabase
      .from('clients')
      .select('id, full_name, cpf, phone, birth_date, email, address')
      .eq('organization_id', orgId)
      .is('anonymized_at', null)
      .order('created_at')
      .order('id')
      .range(from, to),
  )
}

// ---------------------------------------------------------------------------
// IA (Edge Function ai-import)
// ---------------------------------------------------------------------------

export interface AIImportResponse {
  mapping: Partial<Record<ImportField, number>>
  categories: Record<string, string>
  provider?: string
}

export class AIUnavailableError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'AIUnavailableError'
    this.status = status
  }
}

export async function mapWithAI(orgId: string, req: AIImportRequest): Promise<AIImportResponse> {
  const { data, error } = await supabase.functions.invoke<AIImportResponse>('ai-import', {
    body: { organization_id: orgId, columns: req.columns, categories: req.categories, category_values: req.category_values },
  })
  if (error) {
    let message = 'Mapeamento com IA indisponível no momento.'
    let status: number | null = null
    const ctx = (error as { context?: unknown }).context
    if (ctx instanceof Response) {
      status = ctx.status
      try {
        const body = (await ctx.json()) as { error?: unknown }
        if (typeof body.error === 'string') message = body.error
      } catch {
        /* corpo não-JSON: mantém a mensagem padrão */
      }
    }
    throw new AIUnavailableError(message, status)
  }
  if (!data || typeof data !== 'object' || !data.mapping) throw new AIUnavailableError('Resposta inesperada da IA.', null)
  return data
}

// ---------------------------------------------------------------------------
// Mapeamento lembrado (por assinatura dos cabeçalhos)
// ---------------------------------------------------------------------------

export interface SavedMapping {
  /** Campo → cabeçalho normalizado (ver signature.ts). */
  mapping: Record<string, string>
  category_map: Record<string, string>
}

export async function fetchSavedMapping(orgId: string, signature: string): Promise<SavedMapping | null> {
  const res = await supabase
    .from('import_mappings')
    .select('mapping, category_map')
    .eq('organization_id', orgId)
    .eq('signature', signature)
    .maybeSingle()
  return unwrap(res) as SavedMapping | null
}

/**
 * Atualiza o mapeamento salvo ou cria um novo. Não usa upsert: o UPDATE do upsert exigiria permissão em todas as
 * colunas (a tabela só libera mapping/category_map/updated_*).
 */
export async function saveMapping(orgId: string, userId: string, signature: string, mapping: Record<string, string>, categoryMap: Record<string, string>) {
  const fields = { mapping, category_map: categoryMap, updated_by: userId, updated_at: new Date().toISOString() }
  const upd = await supabase
    .from('import_mappings')
    .update(fields)
    .eq('organization_id', orgId)
    .eq('signature', signature)
    .select('signature')
  if (upd.error) throw new Error(friendlyError(upd.error))
  if (upd.data?.length) return
  const ins = await supabase.from('import_mappings').insert({ organization_id: orgId, signature, ...fields })
  if (ins.error) throw new Error(friendlyError(ins.error))
}

// ---------------------------------------------------------------------------
// Histórico e desfazer
// ---------------------------------------------------------------------------

export interface ImportBatch {
  id: string
  organization_id: string
  created_by: string
  created_at: string
  file_name: string | null
  created_clients: number
  updated_clients: number
  created_demands: number
  undone_at: string | null
  undone_by: string | null
}

export interface UndoResult {
  removed_clients: number
  removed_demands: number
  restored_clients: number
  skipped_clients: number
  skipped_demands: number
  skipped_fields: number
}

export const IMPORT_HISTORY_LIMIT = 10
export const UNDO_WINDOW_DAYS = 30

export async function fetchImportBatches(orgId: string): Promise<ImportBatch[]> {
  const res = await supabase
    .from('import_batches')
    .select('id, organization_id, created_by, created_at, file_name, created_clients, updated_clients, created_demands, undone_at, undone_by')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(IMPORT_HISTORY_LIMIT)
  return unwrap(res) as ImportBatch[]
}

export async function undoImportBatch(batchId: string): Promise<UndoResult> {
  const res = await supabase.rpc('undo_import_batch', { p_batch: batchId })
  return unwrap(res) as UndoResult
}

// ---------------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------------

export interface ImportPlanItem {
  row: ImportRow
  action: Exclude<RowAction, 'ignorar'>
  /** categoria para criar demanda (null = não criar) */
  categoryId: string | null
  categoryName: string | null
  /** só para 'atualizar': 'substituir' vale apenas com correspondência por CPF (senão vira 'completar') */
  mode?: UpdateMode
}

export interface ImportError {
  line: number
  name: string
  reason: string
}

export interface ImportReport {
  created: number
  updated: number
  unchanged: number
  ignored: number
  demands: number
  errors: ImportError[]
}

export interface ImportContext {
  orgId: string
  userId: string
  existing: Map<string, ExistingClient>
  ignored: number
  /** nome do arquivo, registrado no lote */
  fileName?: string | null
  onProgress: (done: number, total: number) => void
}

const chunk = <T>(arr: T[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size))

export async function insertWithFallback<T extends { id: string }>(
  table: 'clients' | 'demands',
  rows: T[],
  onRowError: (row: T, reason: string) => void,
): Promise<Set<string>> {
  const ok = new Set<string>()
  const res = await supabase.from(table).insert(rows)
  if (!res.error) {
    rows.forEach((r) => ok.add(r.id))
    return ok
  }
  // Erro que não é de uma linha específica (rede, permissão, servidor): repetir linha a linha
  // só multiplicaria requisições com o mesmo erro. Marca o lote inteiro com o motivo.
  if (!isRowConstraintError(res.error)) {
    const reason = friendlyError(res.error)
    rows.forEach((r) => onRowError(r, reason))
    return ok
  }
  // Lote falhou por uma linha (ex.: um CPF já existente) → isola linha a linha para saber qual.
  for (const r of rows) {
    const one = await supabase.from(table).insert(r)
    if (one.error) onRowError(r, friendlyError(one.error))
    else ok.add(r.id)
  }
  return ok
}

/** Executa o plano: cria clientes (lotes de 100), complementa existentes e cria demandas. */
export async function runImport(plan: ImportPlanItem[], ctx: ImportContext): Promise<ImportReport> {
  // O lote nasce antes de qualquer gravação: sem ele não há como desfazer, então a importação nem começa.
  const batchRes = await supabase
    .from('import_batches')
    .insert({ organization_id: ctx.orgId, created_by: ctx.userId, file_name: (ctx.fileName ?? '').slice(0, 200) || null })
    .select('id')
    .single()
  const batchId = (batchRes.data as { id?: string } | null)?.id
  if (batchRes.error || !batchId) {
    throw new Error(`Não foi possível registrar a importação. Nada foi gravado. ${batchRes.error ? friendlyError(batchRes.error) : ''}`.trim())
  }

  const report: ImportReport = { created: 0, updated: 0, unchanged: 0, ignored: ctx.ignored, demands: 0, errors: [] }
  const toCreate = plan.filter((p) => p.action === 'criar')
  const toUpdate = plan.filter((p) => p.action === 'atualizar')
  const withDemand = plan.filter((p) => p.categoryId)
  const total = toCreate.length + toUpdate.length + withDemand.length
  let done = 0
  const tick = (n: number) => {
    done += n
    ctx.onProgress(done, total)
  }
  ctx.onProgress(0, total)

  const clientIdByRow = new Map<string, string>()
  const failedRows = new Set<string>()
  const fail = (item: ImportPlanItem, reason: string) => {
    failedRows.add(item.row.id)
    report.errors.push({ line: item.row.line, name: item.row.values.full_name ?? '', reason })
  }

  // 1) Novos clientes
  for (const batch of chunk(toCreate, BATCH_SIZE)) {
    const payload = batch.map((p) => {
      const v = p.row.values
      return {
        id: crypto.randomUUID() as string,
        organization_id: ctx.orgId,
        full_name: v.full_name!,
        cpf: v.cpf,
        phone: v.phone,
        email: v.email,
        birth_date: v.birth_date,
        address: v.address,
        notes: v.notes,
        status: v.status ?? 'ativo',
        created_by: ctx.userId,
        import_batch_id: batchId,
      }
    })
    const byPayloadId = new Map(payload.map((p, i) => [p.id, batch[i]]))
    const ok = await insertWithFallback('clients', payload, (r, reason) => fail(byPayloadId.get(r.id)!, reason))
    ok.forEach((id) => clientIdByRow.set(byPayloadId.get(id)!.row.id, id))
    report.created += ok.size
    tick(batch.length)
  }

  // 2) Existentes: completa campos vazios ou substitui (só com CPF), concorrência 4
  const updateLog: { item: ImportPlanItem; previous: Record<string, string | null>; applied: Record<string, string> }[] = []
  for (const group of chunk(toUpdate, 4)) {
    await Promise.all(
      group.map(async (p) => {
        const target = p.row.match?.target === 'existing' ? ctx.existing.get(p.row.match.id) : undefined
        if (!target) return fail(p, 'Cliente existente não encontrado.')
        clientIdByRow.set(p.row.id, target.id)
        const patch = updatePatch(target, p.row.values, effectiveMode(p.row, p.mode))
        if (!Object.keys(patch).length) {
          report.unchanged++
          return
        }
        const res = await supabase.from('clients').update(patch).eq('organization_id', ctx.orgId).eq('id', target.id)
        if (res.error) fail(p, friendlyError(res.error))
        else {
          report.updated++
          const keys = Object.keys(patch) as (keyof typeof patch)[]
          updateLog.push({
            item: p,
            previous: Object.fromEntries(keys.map((k) => [k, target[k] ?? null])),
            applied: Object.fromEntries(keys.map((k) => [k, patch[k] as string])),
          })
        }
      }),
    )
    tick(group.length)
  }

  // 3) Demandas
  const demandItems = withDemand.filter((p) => clientIdByRow.has(p.row.id) && !failedRows.has(p.row.id))
  tick(withDemand.length - demandItems.length)
  for (const batch of chunk(demandItems, BATCH_SIZE)) {
    const payload = batch.map((p) => ({
      id: crypto.randomUUID() as string,
      organization_id: ctx.orgId,
      client_id: clientIdByRow.get(p.row.id)!,
      category_id: p.categoryId!,
      title: demandTitle(p.categoryName ?? 'Demanda', p.row.values.full_name ?? ''),
      created_by: ctx.userId,
      import_batch_id: batchId,
    }))
    const byPayloadId = new Map(payload.map((p, i) => [p.id, batch[i]]))
    const ok = await insertWithFallback('demands', payload, (r, reason) => {
      const item = byPayloadId.get(r.id)!
      report.errors.push({ line: item.row.line, name: item.row.values.full_name ?? '', reason: `Demanda não criada: ${reason}` })
    })
    report.demands += ok.size
    tick(batch.length)
  }

  // 4) Registro do que foi complementado (permite restaurar no desfazer) e contagens do lote
  for (const part of chunk(updateLog, BATCH_SIZE)) {
    const res = await supabase.from('import_batch_updates').insert(
      part.map((u) => ({
        organization_id: ctx.orgId,
        batch_id: batchId,
        client_id: clientIdByRow.get(u.item.row.id)!,
        previous: u.previous,
        applied: u.applied,
      })),
    )
    if (res.error) {
      const reason = `Atualizado, mas sem registro para desfazer: ${friendlyError(res.error)}`
      part.forEach((u) => report.errors.push({ line: u.item.row.line, name: u.item.row.values.full_name ?? '', reason }))
    }
  }
  const counts = await supabase
    .from('import_batches')
    .update({ created_clients: report.created, updated_clients: report.updated, created_demands: report.demands })
    .eq('id', batchId)
  if (counts.error) report.errors.push({ line: 0, name: '', reason: `Resumo da importação não gravado: ${friendlyError(counts.error)}` })
  return report
}
