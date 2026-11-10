import { useEffect } from 'react'
import { clampPage } from '@/lib/pagination'

/** Se a página atual ficou vazia e há registros, vai para a última página válida. */
export function usePageClamp(
  page: number,
  pageSize: number,
  data: { rows: unknown[]; total: number } | undefined,
  isPlaceholder: boolean,
  goTo: (page: number) => void,
) {
  const target = data && !isPlaceholder ? clampPage(page, data.total, pageSize, data.rows.length) : null
  useEffect(() => {
    if (target !== null) goTo(target)
  }, [target, goTo])
}
