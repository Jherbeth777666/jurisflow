import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

const control =
  'w-full rounded-md border border-line-strong bg-surface px-3 text-[13.5px] text-ink placeholder:text-ink-subtle ' +
  'transition-colors focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100 ' +
  'disabled:bg-canvas disabled:text-ink-muted aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus:ring-red-100'

interface FieldWrapperProps {
  label?: string
  hint?: string
  error?: string | null
  required?: boolean
  className?: string
  children: (id: string, describedBy?: string) => ReactNode
}

export function FieldWrapper({ label, hint, error, required, className, children }: FieldWrapperProps) {
  const id = useId()
  const descId = error || hint ? `${id}-desc` : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-[12.5px] font-medium text-ink">
          {label}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </label>
      )}
      {children(id, descId)}
      {(error || hint) && (
        <p id={descId} className={cn('text-[12px]', error ? 'text-red-600' : 'text-ink-subtle')}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

type Common = { label?: string; hint?: string; error?: string | null; wrapperClassName?: string }

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Common & { leading?: ReactNode }>(
  function Input({ label, hint, error, wrapperClassName, className, required, leading, ...props }, ref) {
    return (
      <FieldWrapper label={label} hint={hint} error={error} required={required} className={wrapperClassName}>
        {(id, desc) => (
          <div className="relative">
            {leading && (
              <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-ink-subtle">{leading}</span>
            )}
            <input
              ref={ref}
              id={id}
              required={required}
              aria-invalid={!!error || undefined}
              aria-describedby={desc}
              className={cn(control, 'h-9', leading && 'pl-8', className)}
              {...props}
            />
          </div>
        )}
      </FieldWrapper>
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Common>(
  function Textarea({ label, hint, error, wrapperClassName, className, required, rows = 3, ...props }, ref) {
    return (
      <FieldWrapper label={label} hint={hint} error={error} required={required} className={wrapperClassName}>
        {(id, desc) => (
          <textarea
            ref={ref}
            id={id}
            rows={rows}
            required={required}
            aria-invalid={!!error || undefined}
            aria-describedby={desc}
            className={cn(control, 'py-2 leading-relaxed resize-y', className)}
            {...props}
          />
        )}
      </FieldWrapper>
    )
  },
)

export interface SelectOption {
  value: string
  label: string
}

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & Common & { options: SelectOption[]; placeholder?: string }
>(function Select({ label, hint, error, wrapperClassName, className, required, options, placeholder, ...props }, ref) {
  return (
    <FieldWrapper label={label} hint={hint} error={error} required={required} className={wrapperClassName}>
      {(id, desc) => (
        <div className="relative">
          <select
            ref={ref}
            id={id}
            required={required}
            aria-invalid={!!error || undefined}
            aria-describedby={desc}
            className={cn(control, 'h-9 appearance-none pr-8', className)}
            {...props}
          >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
        </div>
      )}
    </FieldWrapper>
  )
})

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink">
      <input type="checkbox" className="size-4 rounded border-line-strong accent-navy-900" {...props} />
      {label}
    </label>
  )
}
