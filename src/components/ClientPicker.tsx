import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useClientLookup } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { maskCPF } from '@/lib/format'
import { cn } from '@/lib/cn'
import { FieldWrapper } from '@/components/ui'

/** Seletor de cliente com busca por nome ou CPF. */
export function ClientPicker({
  value,
  onChange,
  label = 'Cliente',
  required,
  error,
  disabled,
}: {
  value: string | null
  onChange: (id: string | null, name?: string) => void
  label?: string
  required?: boolean
  error?: string | null
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 250)
    return () => clearTimeout(t)
  }, [term])
  const list = useClientLookup(debounced)
  const { orgId } = useOrg()
  const selected = useQuery({
    queryKey: ['client-name', orgId, value],
    enabled: !!value,
    queryFn: async () => (await supabase.from('clients').select('full_name').eq('id', value!).single()).data?.full_name ?? '',
    staleTime: 300_000,
  })

  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <FieldWrapper label={label} required={required} error={error}>
      {(id) => (
        <div className="relative" ref={ref}>
          <button
            id={id}
            type="button"
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-invalid={!!error || undefined}
            className="flex h-9 w-full items-center justify-between rounded-md border border-line-strong bg-surface px-3 text-left text-[13.5px] focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100 disabled:bg-canvas aria-[invalid=true]:border-red-400"
          >
            <span className={cn('truncate', !value && 'text-ink-subtle')}>{value ? selected.data || 'Carregando…' : 'Selecione um cliente'}</span>
            <ChevronsUpDown className="size-4 text-ink-subtle" />
          </button>
          {open && (
            <div className="absolute z-30 mt-1 w-full rounded-md bg-surface shadow-[var(--shadow-pop)]">
              <div className="relative border-b border-line">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
                <input
                  autoFocus
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Buscar por nome ou CPF"
                  className="h-9 w-full rounded-t-md pl-8 pr-3 text-[13.5px] focus:outline-none"
                />
              </div>
              <ul role="listbox" className="scrollbar-thin max-h-60 overflow-y-auto py-1">
                {list.isLoading && <li className="px-3 py-2 text-[13px] text-ink-muted">Buscando…</li>}
                {list.data?.length === 0 && <li className="px-3 py-2 text-[13px] text-ink-muted">Nenhum cliente encontrado.</li>}
                {list.data?.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={c.id === value}
                      onClick={() => {
                        onChange(c.id, c.full_name)
                        setOpen(false)
                      }}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] hover:bg-navy-50"
                    >
                      <span className="truncate">{c.full_name}</span>
                      <span className="flex items-center gap-2 text-[11.5px] text-ink-subtle tabular">
                        {c.cpf ? maskCPF(c.cpf) : ''}
                        {c.id === value && <Check className="size-3.5 text-accent-600" />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </FieldWrapper>
  )
}
