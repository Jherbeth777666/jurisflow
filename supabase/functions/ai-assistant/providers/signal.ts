// Combina sinais de cancelamento (timeout do provedor + prazo total da requisição).
export function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => !!s)
  if (list.length === 1) return list[0]
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (anyFn) return anyFn(list)
  const c = new AbortController()
  for (const s of list) {
    if (s.aborted) {
      c.abort(s.reason)
      break
    }
    s.addEventListener('abort', () => c.abort(s.reason), { once: true })
  }
  return c.signal
}
