import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ResetPasswordPage } from './ForgotPasswordPage'

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { updateUser: mocks.updateUser } },
  friendlyError: (e: unknown) => (e as { message?: string })?.message ?? String(e),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  )
}

function change(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /salvar senha/i }))
}

beforeEach(() => {
  mocks.updateUser.mockReset()
  mocks.updateUser.mockResolvedValue({ error: null })
})

describe('ResetPasswordPage', () => {
  it('senha só com letras mostra erro de composição e não chama updateUser', async () => {
    renderPage()
    // 13 caracteres (>= 8), porém sem nenhum dígito → validatePassword devolve "Use letras e números na senha."
    change(/^nova senha/i, 'somenteletras')
    const confirm = screen.queryByLabelText(/confirmar nova senha/i)
    if (confirm) fireEvent.change(confirm, { target: { value: 'somenteletras' } })
    submit()

    expect(await screen.findByText('Use letras e números na senha.')).toBeInTheDocument()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('confirmação diferente mostra "As senhas não conferem." e não chama updateUser', async () => {
    renderPage()
    // 8 caracteres, letras e números; confirmação difere só no último dígito (4 → 5).
    change(/^nova senha/i, 'abcd1234')
    change(/confirmar nova senha/i, 'abcd1235')
    submit()

    expect(await screen.findByText('As senhas não conferem.')).toBeInTheDocument()
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('senha válida e confirmação igual chama updateUser uma vez e mostra "Senha alterada"', async () => {
    renderPage()
    // 8 caracteres (mínimo permitido), com letras e números.
    change(/^nova senha/i, 'abcd1234')
    const confirm = screen.getByLabelText(/confirmar nova senha/i)
    expect(confirm).toHaveAttribute('autocomplete', 'new-password')
    fireEvent.change(confirm, { target: { value: 'abcd1234' } })
    submit()

    await waitFor(() => expect(mocks.updateUser).toHaveBeenCalledTimes(1))
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'abcd1234' })
    expect(await screen.findByText(/Senha alterada/)).toBeInTheDocument()
  })
})
