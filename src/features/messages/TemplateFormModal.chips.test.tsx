import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui'
import { TemplateFormModal } from './TemplateFormModal'

const inserts = vi.hoisted(() => [] as Record<string, unknown>[])

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({ orgId: 'org-1', userId: 'user-1', role: 'advogado', can: () => true }),
}))

vi.mock('@/lib/supabase', () => {
  const chain = (row: Record<string, unknown>) => ({
    select: () => ({ single: async () => ({ data: { id: 'tpl-1', ...row }, error: null }) }),
    eq: () => chain(row),
  })
  return {
    supabase: {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserts.push(row)
          return chain(row)
        },
        update: (row: Record<string, unknown>) => {
          inserts.push(row)
          return chain(row)
        },
      }),
    },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) throw new Error(String(r.error))
      return r.data as T
    },
  }
})

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <TemplateFormModal open onClose={onClose} initial={null} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return onClose
}

describe('TemplateFormModal com etiquetas', () => {
  beforeEach(() => {
    inserts.length = 0
  })

  it('seletor mostra títulos dos grupos e botões com rótulos humanos', () => {
    renderModal()
    for (const t of ['Cliente', 'Demanda', 'Financeiro', 'Escritório']) {
      expect(screen.getByText(t)).toBeInTheDocument()
    }
    for (const l of ['Primeiro nome do cliente', 'Etapa atual da demanda', 'Valor da próxima parcela', 'Nome do escritório']) {
      expect(screen.getByRole('button', { name: l })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'primeiro_nome' })).not.toBeInTheDocument()
  })

  it('clicar num rótulo insere a variável e salvar envia {{primeiro_nome}} no body', async () => {
    const onClose = renderModal()
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: 'Boas-vindas' } })
    fireEvent.click(screen.getByRole('button', { name: 'Primeiro nome do cliente' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar modelo' }))
    await waitFor(() => expect(inserts).toHaveLength(1))
    expect(String(inserts[0].body)).toContain('{{primeiro_nome}}')
    expect(inserts[0].name).toBe('Boas-vindas')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
