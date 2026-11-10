import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Estado de modal que também abre via URL (?novo=1, ?nova=1) — usado pelos atalhos do
 * dashboard e da busca global. O parâmetro é removido ao abrir, para não reabrir ao voltar.
 */
export function useOpenFromParam(key: string) {
  const [params, setParams] = useSearchParams()
  const [open, setOpen] = useState(false)
  const flag = params.get(key)
  useEffect(() => {
    if (flag === '1') {
      setOpen(true)
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete(key)
          return next
        },
        { replace: true },
      )
    }
  }, [flag, key, setParams])
  return [open, setOpen] as const
}
