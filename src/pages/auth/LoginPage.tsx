import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase, friendlyError } from '@/lib/supabase'
import { Button, Input, InlineError } from '@/components/ui'
import { AuthShell } from './AuthShell'

export function LoginPage() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (error) return setError(friendlyError(error))
    nav('/', { replace: true })
  }

  return (
    <AuthShell
      title="Entrar"
      subtitle="Acesse o painel do seu escritório."
      footer={
        <>
          Ainda não tem conta?{' '}
          <Link to="/cadastro" className="font-medium text-accent-700 hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Input label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex justify-end">
          <Link to="/recuperar-senha" className="text-[12.5px] text-accent-700 hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <InlineError message={error} />
        <Button type="submit" variant="primary" className="w-full justify-center" loading={loading} disabled={!email || !password}>
          Entrar
        </Button>
      </form>
    </AuthShell>
  )
}
