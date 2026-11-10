import { useCallback, useRef } from 'react'

/**
 * O Modal do kit refoca o primeiro campo sempre que `onClose` muda de referência.
 * Este hook devolve um callback estável que ignora o fechamento enquanto `busy`.
 */
export function useStableClose(onClose: () => void, busy = false) {
  const ref = useRef({ onClose, busy })
  ref.current = { onClose, busy }
  return useCallback(() => {
    if (!ref.current.busy) ref.current.onClose()
  }, [])
}
