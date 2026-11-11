import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

interface FakeMembership {
  role: string
  organization: { id: string; name: string }
}

const mocks = vi.hoisted(() => {
  const state: {
    session: { user: { id: string } } | null
    profile: { id: string; full_name: string; email: string } | null
    memberships: FakeMembership[]
  } = {
    session: { user: { id: 'user-1' } },
    profile: { id: 'user-1', full_name: 'Ana', email: 'ana@example.com' },
    memberships: [],
  }

  const subscription = { unsubscribe: vi.fn() }

  const auth = {
    getSession: vi.fn(async () => ({ data: { session: state.session } })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription } })),
    signOut: vi.fn(async () => ({ error: null })),
  }

  function builderFor(table: string) {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      single: vi.fn(async () => ({ data: state.profile, error: null })),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(
          table === 'profiles' ? { data: state.profile, error: null } : { data: state.memberships, error: null },
        ).then(resolve, reject),
    }
    return builder
  }

  const from = vi.fn((table: string) => builderFor(table))
  const rpc = vi.fn(async () => ({ data: null, error: null }))

  return { state, subscription, auth, from, rpc }
})

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: mocks.auth, from: mocks.from, rpc: mocks.rpc },
  friendlyError: (e: unknown) => (e as { message?: string })?.message ?? String(e),
}))

const { AuthProvider, useAuth } = await import('./AuthContext')

const membership = (id: string): FakeMembership => ({ role: 'advogado', organization: { id, name: `Escritório ${id}` } })

function Probe() {
  const auth = useAuth()
  return (
    <div>
      <span data-testid="org">{auth.organization?.id ?? 'nenhum'}</span>
      <span data-testid="members">{auth.memberships.map((m) => m.organization.id).join(',')}</span>
    </div>
  )
}

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const clear = vi.spyOn(qc, 'clear')
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { qc, clear }
}

describe('AuthContext — acesso revogado com a sessão aberta (1.5)', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.state.session = { user: { id: 'user-1' } }
    mocks.state.profile = { id: 'user-1', full_name: 'Ana', email: 'ana@example.com' }
    mocks.state.memberships = []
  })

  it('ao perder a única membership, limpa o cache e fica sem escritório', async () => {
    mocks.state.memberships = [membership('org-a')]
    localStorage.setItem('jurisflow.currentOrg', 'org-a')
    const { clear } = setup()
    await waitFor(() => expect(screen.getByTestId('org')).toHaveTextContent('org-a'))
    clear.mockClear()

    mocks.state.memberships = []
    await act(async () => {
      window.dispatchEvent(new CustomEvent('jurisflow:access-denied'))
    })

    await waitFor(() => expect(screen.getByTestId('org')).toHaveTextContent('nenhum'))
    expect(clear).toHaveBeenCalled()
  })

  it('ao perder o escritório atual, limpa o cache e cai no primeiro escritório restante', async () => {
    mocks.state.memberships = [membership('org-a'), membership('org-b')]
    localStorage.setItem('jurisflow.currentOrg', 'org-a')
    const { clear } = setup()
    await waitFor(() => expect(screen.getByTestId('org')).toHaveTextContent('org-a'))
    clear.mockClear()

    mocks.state.memberships = [membership('org-b')]
    await act(async () => {
      window.dispatchEvent(new CustomEvent('jurisflow:access-denied'))
    })

    await waitFor(() => expect(screen.getByTestId('org')).toHaveTextContent('org-b'))
    expect(screen.getByTestId('members')).toHaveTextContent('org-b')
    expect(clear).toHaveBeenCalled()
  })
})
