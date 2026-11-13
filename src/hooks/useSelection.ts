// Seleção múltipla de itens de lista (demandas, tarefas). A seleção é descartada quando a
// chave dos filtros muda, para nunca agir em itens que saíram da tela.
import { useCallback, useMemo, useState } from 'react'

const EMPTY: ReadonlySet<string> = new Set()

export function useSelection(resetKey: string) {
  const [state, setState] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: resetKey, ids: EMPTY })
  const ids = state.key === resetKey ? state.ids : EMPTY

  const update = useCallback(
    (fn: (current: ReadonlySet<string>) => ReadonlySet<string>) =>
      setState((prev) => ({ key: resetKey, ids: fn(prev.key === resetKey ? prev.ids : EMPTY) })),
    [resetKey],
  )

  const toggle = useCallback(
    (id: string) =>
      update((cur) => {
        const next = new Set(cur)
        if (!next.delete(id)) next.add(id)
        return next
      }),
    [update],
  )

  /** Marca todos os ids informados; se todos já estavam marcados, desmarca. */
  const toggleAll = useCallback(
    (all: string[]) =>
      update((cur) => {
        const next = new Set(cur)
        if (all.length > 0 && all.every((id) => cur.has(id))) all.forEach((id) => next.delete(id))
        else all.forEach((id) => next.add(id))
        return next
      }),
    [update],
  )

  const clear = useCallback(() => update(() => EMPTY), [update])
  const has = useCallback((id: string) => ids.has(id), [ids])

  return useMemo(
    () => ({ ids: [...ids], count: ids.size, has, toggle, toggleAll, clear }),
    [ids, has, toggle, toggleAll, clear],
  )
}
