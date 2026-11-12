import { cn } from '@/lib/cn'

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-navy-900 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),var(--shadow-xs)]',
        className,
      )}
    >
      <svg viewBox="0 0 32 32" className="size-[55%]" aria-hidden>
        <path d="M8 7h16M16 7v18M10 25h12" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" fill="none" />
        <circle cx="25" cy="25" r="2.6" fill="var(--color-accent-500)" />
      </svg>
    </span>
  )
}
