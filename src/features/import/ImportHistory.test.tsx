import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui'
import { ImportHistory } from './ImportHistory'

// L14 — histórico "Importações recentes" com Desfazer.
// Contas à mão (hoje = Date.now()):
//   b1 clientes-novembro.xlsx  — do usuário u1, há 2 dias, 3 clientes + 1 atualizado + 3 demandas  → pode desfazer
//   b2 do-colega.xlsx          — de u2, há 3 dias                                                   → só admin desfaz
//   b3 ja-desfeita.xlsx        — de u1, desfeita                                                    → ninguém desfaz
//   b4 muito-antiga.xlsx       — de u1, há 31 dias                                                  → ninguém desfaz
//   advogado u1: 1 botão "Desfazer" (b1); admin: 2 botões (b1 e b2).
const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const mock = vi.hoisted(() => ({
  role: 'advogado' as 'admin' | 'advogado',
  batches: [] as Record<string, unknown>[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({
    orgId: 'org-1',
    userId: 'u1',
    role: mock.role,
    profile: { id: 'u1', full_name: 'Ana', email: 'ana@teste.local' },
    organization: { id: 'org-1', name: 'Escritório Teste' },
    can: () => true,
  }),
}))

vi.mock('@/lib/supabase', () => {
  function builder(table: string) {
    const data = table === 'import_batches' ? mock.batches : []
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'range', 'gte', 'lte']) q[m] = () => q
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null, count: data.length }).then(ok, ko)
    return q
  }
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        mock.rpcCalls.push({ fn, args })
        return mock.rpcResult
      },
    },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) throw new Error(String((r.error as { message?: string }).message ?? r.error))
      return r.data as T
    },
    friendlyError: (error: unknown) => String((error as { message?: string })?.message ?? error),
    fetchAllRows: async () => mock.batches,
  }
})

const batch = (over: Record<string, unknown>) => ({
  organization_id: 'org-1',
  created_clients: 3,
  updated_clients: 0,
  created_demands: 3,
  undone_at: null,
  undone_by: null,
  undo_result: null,
  ...over,
})

function renderHistory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ImportHistory />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mock.role = 'advogado'
  mock.rpcCalls = []
  mock.rpcResult = {
    data: { removed_clients: 3, removed_demands: 3, restored_clients: 0, skipped_clients: 1, skipped_demands: 0, skipped_fields: 0 },
    error: null,
  }
  mock.batches = [
    batch({ id: 'b1', created_by: 'u1', created_at: ago(2), file_name: 'clientes-novembro.xlsx', updated_clients: 1 }),
    batch({ id: 'b2', created_by: 'u2', created_at: ago(3), file_name: 'do-colega.xlsx' }),
    batch({ id: 'b3', created_by: 'u1', created_at: ago(4), file_name: 'ja-desfeita.xlsx', undone_at: ago(1), undone_by: 'u1' }),
    batch({ id: 'b4', created_by: 'u1', created_at: ago(31), file_name: 'muito-antiga.xlsx' }),
  ]
})

describe('ImportHistory', () => {
  it('mostra o título e lista os arquivos com contagens', async () => {
    renderHistory()
    expect(await screen.findByText(/Importações recentes/i)).toBeInTheDocument()
    for (const f of ['clientes-novembro.xlsx', 'do-colega.xlsx', 'ja-desfeita.xlsx', 'muito-antiga.xlsx']) {
      expect(await screen.findByText(f)).toBeInTheDocument()
    }
  })

  it('marca a importação já desfeita', async () => {
    renderHistory()
    await screen.findByText('ja-desfeita.xlsx')
    expect(screen.getByText(/Desfeita em/i)).toBeInTheDocument()
  })

  it('criador não-admin só pode desfazer a própria importação recente e não desfeita', async () => {
    renderHistory()
    await screen.findByText('clientes-novembro.xlsx')
    expect(screen.getAllByRole('button', { name: 'Desfazer' })).toHaveLength(1)
  })

  it('admin pode desfazer também a de colega (mas não a desfeita nem a de mais de 30 dias)', async () => {
    mock.role = 'admin'
    renderHistory()
    await screen.findByText('clientes-novembro.xlsx')
    expect(screen.getAllByRole('button', { name: 'Desfazer' })).toHaveLength(2)
  })

  it('Desfazer abre a confirmação com título e aviso, sem chamar o banco ainda', async () => {
    renderHistory()
    await screen.findByText('clientes-novembro.xlsx')
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Desfazer a importação de clientes-novembro.xlsx?')).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        'Clientes e demandas criados por ela e ainda sem uso serão removidos. Dados complementados voltam ao valor anterior quando não foram alterados depois.',
      ),
    ).toBeInTheDocument()
    expect(mock.rpcCalls).toHaveLength(0)
  })

  it('Cancelar não chama o banco', async () => {
    renderHistory()
    await screen.findByText('clientes-novembro.xlsx')
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }))
    expect(mock.rpcCalls).toHaveLength(0)
  })

  it('confirmar chama undo_import_batch e mostra o resultado em um aviso', async () => {
    renderHistory()
    await screen.findByText('clientes-novembro.xlsx')
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    const dialog = await screen.findByRole('dialog')
    // padrão do produto: a ação de confirmar é o primeiro botão do rodapé
    fireEvent.click(within(dialog).getAllByRole('button')[0] as HTMLElement)
    await waitFor(() => expect(mock.rpcCalls).toEqual([{ fn: 'undo_import_batch', args: { p_batch: 'b1' } }]))
    expect(await screen.findByText('3 clientes e 3 demandas removidos; 1 mantido por já estar em uso.')).toBeInTheDocument()
  })

  it('erro do banco (ex.: já desfeita) aparece na confirmação e não mostra aviso de sucesso', async () => {
    mock.rpcResult = { data: null, error: { code: '22023', message: 'Esta importação já foi desfeita.' } }
    renderHistory()
    await screen.findByText('clientes-novembro.xlsx')
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getAllByRole('button')[0] as HTMLElement)
    expect(await within(dialog).findByText(/Esta importação já foi desfeita\./)).toBeInTheDocument()
    expect(screen.queryByText(/removidos/)).not.toBeInTheDocument()
  })

  it('sem importações, mostra estado vazio sem botões', async () => {
    mock.batches = []
    renderHistory()
    expect(await screen.findByText(/Importações recentes/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desfazer' })).not.toBeInTheDocument()
  })
})
