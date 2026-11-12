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
  primary:
    'bg-gradient-to-b from-navy-800 to-navy-900 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(11_27_54/0.3)] hover:from-navy-700 hover:to-navy-800',
  secondary:
    'bg-surface text-ink border border-line-strong hover:border-navy-200 hover:bg-navy-50/60 shadow-[0_1px_2px_rgb(15_23_42/0.05)]',
  ghost: 'text-ink-muted hover:text-ink hover:bg-navy-50',
  subtle: 'bg-accent-50 text-accent-700 hover:bg-accent-100',
  danger:
    'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(127_29_29/0.3)] hover:from-red-600 hover:to-red-700',
}

const sizes: Record<Size, string> = {
  sm: 'touch-target h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-[13.5px] gap-2',
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
        'inline-flex items-center rounded-lg font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.98]',
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
