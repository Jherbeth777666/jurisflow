import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Suspense } from 'react'
import App from '@/App'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    session: { user: { id: 'user-1' } },
    loading: false,
    organization: { id: 'org-1', name: 'Escritório Teste', is_demo: false },
    memberships: [{ organization: { id: 'org-1', name: 'Escritório Teste' }, role: 'advogado' }],
    profile: { id: 'user-1', full_name: 'Ana Advogada', email: 'ana@teste.com' },
    role: 'advogado',
    error: null,
    refresh: () => {},
    switchOrganization: () => {},
    signOut: () => {},
  }),
  useOrg: () => ({
    orgId: 'org-1',
    userId: 'user-1',
    role: 'advogado',
    profile: { id: 'user-1', full_name: 'Ana Advogada', email: 'ana@teste.com' },
    organization: { id: 'org-1', name: 'Escritório Teste' },
    can: () => true,
  }),
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }) },
  unwrap: <T,>(r: { data: T | null }) => r.data as T,
}))

vi.mock('@/features/command/CommandPalette', () => ({
  CommandPalette: () => null,
  CommandTrigger: () => null,
}))

vi.mock('@/features/notifications/NotificationBell', () => ({
  NotificationBell: () => null,
}))

vi.mock('@/features/dashboard/DashboardPage', () => ({
  DashboardPage: () => <p>Painel</p>,
}))

vi.mock('@/features/agenda/AgendaPage', () => ({
  AgendaPage: () => <h1>Agenda unificada</h1>,
}))

describe('navegação da agenda', () => {
  it('a rota /agenda renderiza a página e o menu tem "Agenda" logo depois de "Tarefas"', async () => {
    render(
      <MemoryRouter initialEntries={['/agenda']}>
        <Suspense fallback={<p>Carregando…</p>}>
          <App />
        </Suspense>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Agenda unificada')).toBeInTheDocument()

    const agenda = screen.getByRole('link', { name: 'Agenda' })
    expect(agenda).toHaveAttribute('href', '/agenda')

    const tarefas = screen.getByRole('link', { name: 'Tarefas' })
    expect(tarefas.compareDocumentPosition(agenda) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
