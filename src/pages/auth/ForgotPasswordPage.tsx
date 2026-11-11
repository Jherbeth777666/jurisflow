import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase, friendlyError } from '@/lib/supabase'
import { Button, Input, InlineError } from '@/components/ui'
import { validatePassword } from '@/features/settings/logic'
import { AuthShell } from './AuthShell'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/redefinir-senha` })
    setLoading(false)
    if (error) return setError(friendlyError(error))
    setSent(true)
  }

  return (
    <AuthShell title="Recuperar senha" subtitle="Enviaremos um link para redefinir sua senha." footer={<Link to="/login" className="text-accent-700 hover:underline">Voltar ao login</Link>}>
      {sent ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-[13.5px] text-ink-muted">
          Se existir uma conta com este e-mail, você receberá o link em instantes.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Input label="E-mail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <InlineError message={error} />
          <Button type="submit" variant="primary" className="w-full justify-center" loading={loading} disabled={!email}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const invalid = validatePassword(password, confirm)
    if (invalid) return setError(invalid)
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) return setError(friendlyError(error))
    setOk(true)
  }

  return (
    <AuthShell title="Definir nova senha">
      {ok ? (
        <p className="text-[13.5px] text-ink-muted">
          Senha alterada. <Link to="/" className="text-accent-700 hover:underline">Ir para o painel</Link>
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Input label="Nova senha" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input label="Confirmar nova senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <InlineError message={error} />
          <Button type="submit" variant="primary" className="w-full justify-center" loading={loading}>
            Salvar senha
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
