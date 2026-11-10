import { initials } from '@/lib/format'
import { cn } from '@/lib/cn'

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span
      title={name ?? undefined}
      className={cn('inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-navy-100 text-[10.5px] font-semibold text-navy-700', className)}
    >
      {initials(name)}
    </span>
  )
}
