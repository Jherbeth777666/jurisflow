import { cn } from '@/lib/cn'

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-500 to-accent-700 text-white shadow-[var(--shadow-glow)]',
        className,
      )}
    >
      <svg viewBox="0 0 32 32" className="size-[55%]" aria-hidden>
        <path d="M8 7h16M16 7v18M10 25h12" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  )
}
