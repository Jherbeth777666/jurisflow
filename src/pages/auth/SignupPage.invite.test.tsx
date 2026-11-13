import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SignupPage } from './SignupPage'

const TOKEN = '11111111-1111-4111-8111-111111111111'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  signUp: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: { signUp: mocks.signUp },
  },
  friendlyError: (e: unknown) => (e as { message?: string })?.message ?? String(e),
}))

function renderPage(path = '/cadastro') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SignupPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.rpc.mockReset()
  mocks.signUp.mockReset()
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: null })
})

describe('<SignupPage> com convite', () => {
  it('convite pendente mostra o escritório/papel, preenche e trava o e-mail', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        organization_name: 'Silva Advocacia',
        email: 'ana@silva.com',
        role: 'advogado',
        status: 'pendente',
      },
      error: null,
    })

    renderPage(`/cadastro?convite=${TOKEN}`)

    expect(await screen.findByText(/Silva Advocacia/)).toBeInTheDocument()
    expect(screen.getByText(/advogado/i)).toBeInTheDocument()

    const email = screen.getByLabelText(/e-mail/i)
    expect(email).toHaveValue('ana@silva.com')
    // "somente leitura": aceita readOnly ou disabled, mas não pode ser editável.
    expect(email.matches('[readonly], [disabled]')).toBe(true)

    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('invitation_preview', { p_token: TOKEN })
  })

  it('convite expirado mostra aviso claro e mantém o cadastro normal', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        organization_name: 'Silva Advocacia',
        email: 'ana@silva.com',
        role: 'advogado',
        status: 'expirado',
      },
      error: null,
    })

    renderPage(`/cadastro?convite=${TOKEN}`)

    expect(await screen.findByText(/expir/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /criar conta/i })).toBeInTheDocument()

    const email = screen.getByLabelText(/e-mail/i)
    expect(email.matches('[readonly], [disabled]')).toBe(false)
  })

  it('sem o parâmetro convite não chama a prévia do convite', async () => {
    renderPage('/cadastro')

    expect(await screen.findByRole('heading', { name: 'Criar conta' })).toBeInTheDocument()
    await waitFor(() => expect(mocks.rpc).not.toHaveBeenCalled())
  })

  it('token inválido mostra aviso e não trava o e-mail', async () => {
    mocks.rpc.mockResolvedValue({ data: { status: 'invalido' }, error: null })

    renderPage(`/cadastro?convite=${TOKEN}`)

    expect(await screen.findByText(/inv[áa]lido/i)).toBeInTheDocument()

    const email = screen.getByLabelText(/e-mail/i)
    expect(email.matches('[readonly], [disabled]')).toBe(false)
  })
})
