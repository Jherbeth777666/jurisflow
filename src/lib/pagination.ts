// Paginação: correção de página fora do intervalo (ex.: após excluir os últimos itens
// da última página, ou ao abrir um link antigo com ?page=N).

/**
 * Página para onde ir quando a atual ficou vazia mas ainda há registros; null quando a
 * página atual é válida (ou ainda não sabemos o total).
 */
export function clampPage(page: number, total: number, pageSize: number, rowsOnPage: number): number | null {
  if (page <= 0 || rowsOnPage > 0 || total <= 0) return null
  const last = Math.max(0, Math.ceil(total / pageSize) - 1)
  return page > last ? last : null
}

/** PostgREST responde 416 / PGRST103 quando o intervalo pedido passa do fim da lista. */
export function isRangeError(error: unknown): boolean {
  const e = error as { code?: string; status?: number } | null
  return !!e && (e.code === 'PGRST103' || e.status === 416)
}

/**
 * Resultado de página tolerante a intervalo fora do fim: em vez de erro, devolve lista
 * vazia com um total que faz `clampPage` voltar (count, se veio; senão o início da página).
 */
export function pageOrEmpty<T>(res: { data: T[] | null; error: unknown; count: number | null }, from: number): { rows: T[]; total: number } | null {
  if (!res.error || !isRangeError(res.error)) return null
  return { rows: [], total: res.count ?? from }
}
