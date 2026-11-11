import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '@/components/ui'
import { ExportButton, type ExportColumn } from './ExportButton'

// rpc do Supabase e downloadBlob são mockados; o ExportButton deve chamar
// downloadBlob (via downloadCSV) apenas quando a exportação é confirmada.
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  downloadBlob: vi.fn(),
}))

vi.mock('@/contexts/AuthContext', () => ({ useOrg: () => ({ role: 'advogado', orgId: 'org' }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@/lib/download', () => ({ downloadBlob: mocks.downloadBlob }))

interface Row {
  id: string
  name: string
}

const columns: ExportColumn<Row>[] = [{ key: 'name', header: 'Nome' }]

function renderWithLoader(loadRows: () => Promise<Row[]>) {
  return render(
    <ToastProvider>
      <ExportButton<Row> filename="clientes" resource="clients" columns={columns} loadRows={loadRows} />
    </ToastProvider>,
  )
}

function renderWithRows(rows: Row[]) {
  return render(
    <ToastProvider>
      <ExportButton<Row> filename="clientes" resource="clients" columns={columns} rows={rows} />
    </ToastProvider>,
  )
}

async function openAndConfirm() {
  fireEvent.click(screen.getByRole('button', { name: /exportar/i }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /exportar csv/i }))
}

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ error: null })
  mocks.downloadBlob.mockReset()
})

describe('ExportButton com loadRows', () => {
  it('só carrega ao confirmar, baixa o CSV com as linhas e registra o total real', async () => {
    // 2 linhas carregadas: Ana + Bia → p_row_count = 2.
    const rows: Row[] = [
      { id: '1', name: 'Ana' },
      { id: '2', name: 'Bia' },
    ]
    const loadRows = vi.fn().mockResolvedValue(rows)
    renderWithLoader(loadRows)

    // Renderizar não busca dados; o botão fica habilitado independentemente da contagem.
    expect(loadRows).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /exportar/i })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: /exportar/i }))
    const item = await screen.findByRole('menuitem', { name: /exportar csv/i })
    // Sem contagem de linhas no item do menu no modo sob demanda.
    expect(item).not.toHaveTextContent(/linha/i)
    fireEvent.click(item)

    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledTimes(1))
    expect(loadRows).toHaveBeenCalledTimes(1)

    const [fileName, content, mime] = mocks.downloadBlob.mock.calls[0]
    expect(fileName).toBe('clientes.csv')
    expect(mime).toBe('text/csv;charset=utf-8')
    const text = await new Blob([content]).text()
    expect(text).toContain('Nome')
    expect(text).toContain('Ana')
    expect(text).toContain('Bia')

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'log_export',
        expect.objectContaining({ p_org: 'org', p_resource: 'clients', p_row_count: 2 }),
      ),
    )
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })

  it('enquanto a busca não resolve, o botão fica desabilitado e com aria-busy', async () => {
    let resolver!: (rows: Row[]) => void
    const loadRows = vi.fn(
      () =>
        new Promise<Row[]>((resolve) => {
          resolver = resolve
        }),
    )
    renderWithLoader(loadRows)

    await openAndConfirm()

    const busy = await screen.findByRole('button', { name: /preparando/i })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(mocks.downloadBlob).not.toHaveBeenCalled()

    resolver([{ id: '1', name: 'Ana' }])
    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledTimes(1))
  })

  it('lista vazia não baixa arquivo e avisa "Nada para exportar."', async () => {
    const loadRows = vi.fn().mockResolvedValue([])
    renderWithLoader(loadRows)

    await openAndConfirm()

    expect(await screen.findByText('Nada para exportar.')).toBeInTheDocument()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })

  it('erro ao carregar não baixa arquivo e mostra a mensagem do erro', async () => {
    const loadRows = vi.fn().mockRejectedValue(new Error('Falha ao carregar dados'))
    renderWithLoader(loadRows)

    await openAndConfirm()

    expect(await screen.findByText('Falha ao carregar dados')).toBeInTheDocument()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })
})

describe('ExportButton com rows (modo antigo)', () => {
  it('baixa direto com as linhas recebidas e registra rows.length', async () => {
    // 3 linhas: Ana + Bia + Caio → p_row_count = 3.
    const rows: Row[] = [
      { id: '1', name: 'Ana' },
      { id: '2', name: 'Bia' },
      { id: '3', name: 'Caio' },
    ]
    renderWithRows(rows)

    fireEvent.click(screen.getByRole('button', { name: /exportar/i }))
    const item = await screen.findByRole('menuitem', { name: /exportar csv/i })
    expect(item).toHaveTextContent('3 linha(s)')
    fireEvent.click(item)

    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledTimes(1))

    const text = await new Blob([mocks.downloadBlob.mock.calls[0][1]]).text()
    expect(text).toContain('Ana')
    expect(text).toContain('Bia')
    expect(text).toContain('Caio')

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith(
        'log_export',
        expect.objectContaining({ p_org: 'org', p_resource: 'clients', p_row_count: 3 }),
      ),
    )
  })
})
