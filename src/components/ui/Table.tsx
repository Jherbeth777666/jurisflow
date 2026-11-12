import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

export function Table({ className, label = 'Tabela de dados', ...props }: HTMLAttributes<HTMLTableElement> & { label?: string }) {
  return (
    <div className="scrollbar-thin overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className={cn('w-full border-collapse text-left text-[13px]', className)} {...props} />
    </div>
  )
}
export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="border-b border-line bg-canvas/70" {...props} />
}
export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('px-4 py-2.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-subtle whitespace-nowrap', className)} {...props} />
}
export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="divide-y divide-line" {...props} />
}
export function TR({ className, onClick, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors', onClick && 'cursor-pointer hover:bg-navy-50/60', className)} onClick={onClick} {...props} />
}
export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle text-ink', className)} {...props} />
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[12.5px] text-ink-muted">
      <span className="tabular">
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-1">
        <Button size="icon" variant="ghost" disabled={page === 0} onClick={() => onChange(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="tabular px-1">
          {page + 1} / {pages}
        </span>
        <Button size="icon" variant="ghost" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)} aria-label="Próxima página">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
