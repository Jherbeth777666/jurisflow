import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type Size = 'sm' | 'md' | 'icon'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

const variants: Record<Variant, string> = {
  primary: 'bg-navy-900 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.1),var(--shadow-xs)] hover:bg-navy-800',
  secondary: 'bg-surface text-ink border border-line-strong shadow-[var(--shadow-xs)] hover:border-ink-subtle/40 hover:bg-surface-muted',
  ghost: 'text-ink-muted hover:text-ink hover:bg-ink/[0.05]',
  subtle: 'bg-accent-50 text-accent-700 hover:bg-accent-100',
  danger: 'bg-red-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),var(--shadow-xs)] hover:bg-red-700',
}

const sizes: Record<Size, string> = {
  sm: 'touch-target h-8 px-2.5 text-body-sm gap-1.5',
  md: 'h-9 px-3.5 text-body gap-2',
  icon: 'touch-target h-8 w-8 justify-center',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center rounded-[var(--radius-control)] font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.97]',
        'disabled:opacity-50 disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})
