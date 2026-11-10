// Acesso a dados da importação: clientes existentes, IA de mapeamento e gravação em lotes.
// Toda escrita passa pela RLS do usuário (o banco valida tudo).
import { supabase, friendlyError, unwrap } from '@/lib/supabase'
import type { AIImportRequest, ImportField } from './mapping'
import { demandTitle, updatePatch, type ExistingClient, type ImportRow, type RowAction } from './rows'

export const BATCH_SIZE = 100

/** Lê todas as linhas de uma consulta paginando de 1000 em 1000 (limite do PostgREST). */
export async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const rows = unwrap(await build(from, from + page - 1)) as T[]
    out.push(...rows)
    if (rows.length < page) break
  }
  return out
}

export async function fetchExistingClients(orgId: string): Promise<ExistingClient[]> {
  return fetchAll<ExistingClient>((from, to) =>
    supabase
      .from('clients')
      .select('id, full_name, cpf, phone, birth_date, email, address')
      .eq('organization_id', orgId)
      .is('anonymized_at', null)
      .order('created_at')
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
// Gravação
// ---------------------------------------------------------------------------

export interface ImportPlanItem {
  row: ImportRow
  action: Exclude<RowAction, 'ignorar'>
  /** categoria para criar demanda (null = não criar) */
  categoryId: string | null
  categoryName: string | null
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
  onProgress: (done: number, total: number) => void
}

const chunk = <T>(arr: T[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size))

async function insertWithFallback<T extends { id: string }>(
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
  // Lote falhou (ex.: um CPF já existente) → isola linha a linha para saber qual.
  for (const r of rows) {
    const one = await supabase.from(table).insert(r)
    if (one.error) onRowError(r, friendlyError(one.error))
    else ok.add(r.id)
  }
  return ok
}

/** Executa o plano: cria clientes (lotes de 100), complementa existentes e cria demandas. */
export async function runImport(plan: ImportPlanItem[], ctx: ImportContext): Promise<ImportReport> {
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
      }
    })
    const byPayloadId = new Map(payload.map((p, i) => [p.id, batch[i]]))
    const ok = await insertWithFallback('clients', payload, (r, reason) => fail(byPayloadId.get(r.id)!, reason))
    ok.forEach((id) => clientIdByRow.set(byPayloadId.get(id)!.row.id, id))
    report.created += ok.size
    tick(batch.length)
  }

  // 2) Existentes: só completa campos vazios (concorrência 4)
  for (const group of chunk(toUpdate, 4)) {
    await Promise.all(
      group.map(async (p) => {
        const target = p.row.match?.target === 'existing' ? ctx.existing.get(p.row.match.id) : undefined
        if (!target) return fail(p, 'Cliente existente não encontrado.')
        clientIdByRow.set(p.row.id, target.id)
        const patch = updatePatch(target, p.row.values)
        if (!Object.keys(patch).length) {
          report.unchanged++
          return
        }
        const res = await supabase.from('clients').update(patch).eq('organization_id', ctx.orgId).eq('id', target.id)
        if (res.error) fail(p, friendlyError(res.error))
        else report.updated++
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
    }))
    const byPayloadId = new Map(payload.map((p, i) => [p.id, batch[i]]))
    const ok = await insertWithFallback('demands', payload, (r, reason) => {
      const item = byPayloadId.get(r.id)!
      report.errors.push({ line: item.row.line, name: item.row.values.full_name ?? '', reason: `Demanda não criada: ${reason}` })
    })
    report.demands += ok.size
    tick(batch.length)
  }
  return report
}
