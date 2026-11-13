import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui'
import { TeamTab } from './TeamTab'

interface InvitationRow {
  id: string
  organization_id: string
  email: string
  role: 'admin' | 'advogado' | 'assistente'
  invited_by: string | null
  accepted_at: string | null
  created_at: string
  updated_at: string
  token: string
  expires_at: string
}

const mockDb = vi.hoisted(() => ({
  invitations: [] as InvitationRow[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
}))

const writeText = vi.fn()

vi.mock('@/contexts/AuthContext', () => ({
  useOrg: () => ({
    orgId: 'org-1',
    userId: 'user-1',
    role: 'admin',
    profile: { id: 'user-1', full_name: 'Ana Admin', email: 'ana@silva.com' },
    organization: { id: 'org-1', name: 'Silva Advocacia' },
    can: () => true,
  }),
}))

vi.mock('@/lib/supabase', () => {
  type Row = Record<string, unknown>
  interface Filter {
    column: string
    op: 'eq' | 'is'
    value: unknown
  }
  interface Sort {
    column: string
    ascending: boolean
    nullsFirst: boolean
  }
  interface MockQuery {
    select(columns?: string, options?: unknown): MockQuery
    eq(column: string, value: unknown): MockQuery
    is(column: string, value: unknown): MockQuery
    order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): MockQuery
    delete(): MockQuery
    insert(patch: Row): MockQuery
    update(patch: Row): MockQuery
    maybeSingle(): Promise<{ data: unknown; error: null }>
    then<TResult1 = { data: unknown[]; error: null; count: number }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown[]; error: null; count: number }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2>
  }

  function rowsOf(table: string): Row[] {
    if (table === 'organization_invitations') return mockDb.invitations as unknown as Row[]
    if (table === 'organization_members') return []
    throw new Error(`consulta inesperada à tabela "${table}"`)
  }

  function matches(entry: unknown, filters: Filter[]) {
    const row = entry as Row
    return filters.every((f) => {
      const v = row[f.column]
      if (f.op === 'eq') return v === f.value
      return v == null ? f.value == null : v === f.value
    })
  }

  function builder(table: string): MockQuery {
    const filters: Filter[] = []
    const sorts: Sort[] = []

    const apply = () => {
      let rows = rowsOf(table).filter((r) => matches(r, filters))
      if (sorts.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const s of sorts) {
            const av = a[s.column]
            const bv = b[s.column]
            if (av == null || bv == null) {
              if (av == null && bv == null) continue
              return av == null ? (s.nullsFirst ? -1 : 1) : s.nullsFirst ? 1 : -1
            }
            if (String(av) < String(bv)) return s.ascending ? -1 : 1
            if (String(av) > String(bv)) return s.ascending ? 1 : -1
          }
          return 0
        })
      }
      return rows
    }

    const q: MockQuery = {
      select: () => q,
      eq: (column, value) => {
        filters.push({ column, op: 'eq', value })
        return q
      },
      is: (column, value) => {
        filters.push({ column, op: 'is', value })
        return q
      },
      order: (column, options) => {
        sorts.push({ column, ascending: options?.ascending !== false, nullsFirst: options?.nullsFirst === true })
        return q
      },
      delete: () => q,
      insert: (patch) => {
        rowsOf(table).push(patch)
        return q
      },
      update: (patch) => {
        for (const row of apply()) Object.assign(row, patch)
        return q
      },
      maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
      then: (onfulfilled, onrejected) => {
        const rows = apply()
        return Promise.resolve({ data: rows, error: null, count: rows.length }).then(onfulfilled, onrejected)
      },
    }
    return q
  }

  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        mockDb.rpcCalls.push({ fn, args })
        return { data: null, error: null }
      },
    },
    unwrap: <T,>(r: { data: T | null; error: unknown }): T => {
      if (r?.error) throw new Error(String(r.error))
      return r.data as T
    },
    fetchAllRows: async () => [],
  }
})

const DAY = 24 * 60 * 60 * 1000

function makeInvitation(over: Partial<InvitationRow>): InvitationRow {
  const now = Date.now()
  return {
    id: 'inv-1',
    organization_id: 'org-1',
    email: 'ana@silva.com',
    role: 'advogado',
    invited_by: 'user-1',
    accepted_at: null,
    created_at: new Date(now - DAY).toISOString(),
    updated_at: new Date(now - DAY).toISOString(),
    token: '11111111-1111-4111-8111-111111111111',
    expires_at: new Date(now + 14 * DAY).toISOString(),
    ...over,
  }
}

function renderTeamTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <TeamTab />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockDb.invitations.length = 0
  mockDb.rpcCalls.length = 0
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('<TeamTab> com link de convite', () => {
  it('copiar link usa o token do convite pendente e avisa no toast', async () => {
    const invitation = makeInvitation({ id: 'inv-1' })
    mockDb.invitations.push(invitation)

    renderTeamTab()

    expect(await screen.findByText('ana@silva.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /copiar link/i }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/cadastro?convite=${invitation.token}`,
      ),
    )
    expect(await screen.findByText('Link copiado')).toBeInTheDocument()
  })

  it('enviar no WhatsApp abre o wa.me com o texto do convite e o link', async () => {
    const invitation = makeInvitation({ id: 'inv-1' })
    mockDb.invitations.push(invitation)
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    renderTeamTab()

    expect(await screen.findByText('ana@silva.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /whatsapp/i }))

    await waitFor(() => expect(openSpy).toHaveBeenCalled())
    const url = new URL(String(openSpy.mock.calls[0][0]))
    expect(`${url.origin}${url.pathname}`).toBe('https://wa.me/')
    const text = url.searchParams.get('text') ?? ''
    expect(text).toContain('Silva Advocacia')
    expect(text).toContain(`${window.location.origin}/cadastro?convite=${invitation.token}`)
  })

  it('convite expirado mostra o selo Expirado e o botão Renovar chama a RPC', async () => {
    // Expirado há 1 dia: a validade era 14 dias após a criação.
    mockDb.invitations.push(
      makeInvitation({ id: 'inv-exp', expires_at: new Date(Date.now() - DAY).toISOString() }),
    )

    renderTeamTab()

    expect(await screen.findByText('ana@silva.com')).toBeInTheDocument()
    expect(screen.getByText('Expirado')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /renovar/i }))

    await waitFor(() =>
      expect(mockDb.rpcCalls).toContainEqual({
        fn: 'renew_invitation',
        args: { p_invitation: 'inv-exp' },
      }),
    )
  })
})
