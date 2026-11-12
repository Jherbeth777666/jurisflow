import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { supabase, friendlyError } from '@/lib/supabase'
import { isValidEmail } from '@/lib/format'
import { ROLE_LABELS } from '@/lib/constants'
import { Button, Checkbox, Input, InlineError } from '@/components/ui'
import { AuthShell } from './AuthShell'

interface InvitePreview {
  organization_name?: string
  email?: string
  role?: string
  status: 'pendente' | 'aceito' | 'expirado' | 'invalido'
}

export function SignupPage() {
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('convite')
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [accept, setAccept] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [invite, setInvite] = useState<InvitePreview | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const inviteLocked = invite?.status === 'pendente'

  useEffect(() => {
    if (!inviteToken) return
    let active = true
    supabase
      .rpc('invitation_preview', { p_token: inviteToken })
      .then(({ data, error: previewError }) => {
        if (!active) return
        if (previewError) {
          setInviteError('Não foi possível verificar o convite.')
          return
        }
        const preview = data as InvitePreview
        setInvite(preview)
        if (preview.status === 'pendente' && preview.email) {
          setForm((f) => ({ ...f, email: preview.email ?? '' }))
        }
      })
    return () => {
      active = false
    }
  }, [inviteToken])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const validate = () => {
    if (form.name.trim().length < 2) return 'Informe seu nome.'
    if (!isValidEmail(form.email)) return 'Informe um e-mail válido.'
    if (form.password.length < 8) return 'A senha deve ter pelo menos 8 caracteres.'
    if (!/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) return 'Use letras e números na senha.'
    if (form.password !== form.confirm) return 'As senhas não coincidem.'
    if (!accept) return 'É preciso aceitar os termos de uso e a política de privacidade.'
    return null
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = validate()
    if (v) return setError(v)
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: { data: { full_name: form.name.trim() }, emailRedirectTo: `${window.location.origin}/` },
    })
    setLoading(false)
    if (error) return setError(friendlyError(error))
    if (!data.session) setDone(true) // confirmação de e-mail habilitada
  }

  if (done) {
    return (
      <AuthShell title="Confirme seu e-mail">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4">
          <MailCheck className="mt-0.5 size-5 text-accent-600" />
          <p className="text-body text-ink-muted">
            Enviamos um link de confirmação para <strong className="text-ink">{form.email}</strong>. Após confirmar, faça login para criar seu
            escritório ou entrar em um escritório que convidou você.
          </p>
        </div>
        <Link to="/login" className="mt-4 inline-block text-body-sm font-medium text-accent-700 hover:underline">
          Ir para o login
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Comece a organizar o seu escritório."
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/login" className="font-medium text-accent-700 hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {inviteError && <InlineError message={inviteError} />}
        {invite?.status === 'pendente' && (
          <div role="note" className="rounded-md border border-accent-200 bg-accent-50 px-3 py-2 text-body-sm text-accent-700">
            Convite para <strong>{invite.organization_name}</strong> (
            {invite.role ? (ROLE_LABELS[invite.role as keyof typeof ROLE_LABELS] ?? invite.role) : 'membro'}). Crie a conta com o
            e-mail convidado para entrar direto no escritório.
          </div>
        )}
        {invite?.status === 'expirado' && (
          <div role="note" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-body-sm text-amber-800">
            Este convite expirou. Peça um novo link ao administrador do escritório e crie sua conta normalmente.
          </div>
        )}
        {invite?.status === 'aceito' && (
          <div role="note" className="rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-ink-muted">
            Este convite já foi aceito. Entre com sua conta para acessar o escritório.
          </div>
        )}
        {invite?.status === 'invalido' && (
          <div role="note" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-body-sm text-red-700">
            Convite inválido. Verifique o link ou crie sua conta normalmente.
          </div>
        )}
        <Input label="Nome completo" autoComplete="name" required value={form.name} onChange={set('name')} />
        <Input
          label="E-mail"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={set('email')}
          readOnly={inviteLocked}
          hint={inviteLocked ? 'E-mail definido pelo convite.' : undefined}
        />
        <Input label="Senha" type="password" autoComplete="new-password" required hint="Mínimo de 8 caracteres, com letras e números." value={form.password} onChange={set('password')} />
        <Input label="Confirmar senha" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
        <Checkbox
          checked={accept}
          onChange={(e) => setAccept(e.target.checked)}
          label={<span className="text-label text-ink-muted">Li e aceito os termos de uso e a política de privacidade.</span>}
        />
        <InlineError message={error} />
        <Button type="submit" variant="primary" className="w-full justify-center" loading={loading}>
          Criar conta
        </Button>
      </form>
    </AuthShell>
  )
}
