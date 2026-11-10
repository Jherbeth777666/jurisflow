import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { CommandPalette, CommandTrigger } from './CommandPalette'

vi.mock('@/contexts/AuthContext', () => ({ useOrg: () => ({ orgId: 'org-teste' }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
  unwrap: <T,>(r: { data: T }) => r.data,
}))

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <CommandTrigger />
        <CommandPalette />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CommandPalette', () => {
  it('abre com Ctrl+K, tem aria de combobox e navega com setas/Enter', () => {
    setup()
    expect(screen.queryByRole('combobox')).toBeNull()
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-controls')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.change(input, { target: { value: 'nova tarefa' } })
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Nova tarefa')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('where')).toHaveTextContent('/tarefas?nova=1')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('botão abre; Esc fecha; oferece perguntar ao assistente', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /buscar ou executar comando/i }))
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'xyz qualquer' } })
    const ai = screen.getAllByRole('option').find((o) => o.textContent?.includes('Perguntar ao assistente'))
    expect(ai).toBeDefined()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})
