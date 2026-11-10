import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Campo de busca com debounce (300ms). */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar…',
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  useEffect(() => {
    const t = setTimeout(() => local !== value && onChange(local), 300)
    return () => clearTimeout(t)
  }, [local, value, onChange])
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
      <input
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-md border border-line-strong bg-surface pl-8 pr-8 text-[13.5px] placeholder:text-ink-subtle focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100 [&::-webkit-search-cancel-button]:hidden"
      />
      {local && (
        <button
          onClick={() => {
            setLocal('')
            onChange('')
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
          aria-label="Limpar busca"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
