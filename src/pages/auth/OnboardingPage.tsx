import { useState, type FormEvent } from 'react'
import { supabase, friendlyError } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Button, Input, InlineError } from '@/components/ui'
import { AuthShell } from './AuthShell'

/** Usuário autenticado sem escritório: cria um novo (vira administrador). */
export function OnboardingPage() {
  const { refresh, signOut, profile, switchOrganization } = useAuth()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (name.trim().length < 2) return setError('Informe o nome do escritório.')
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.rpc('create_organization', { p_name: name.trim() })
    if (error) {
      setLoading(false)
      return setError(friendlyError(error))
    }
    switchOrganization(data as string)
    await refresh()
    setLoading(false)
  }

  return (
    <AuthShell
      title={`Bem-vindo${profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}`}
      subtitle="Crie o espaço do seu escritório. Você será o administrador e poderá convidar a equipe depois."
      footer={
        <button onClick={signOut} className="text-accent-700 hover:underline">
          Sair
        </button>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Input label="Nome do escritório" placeholder="Ex.: Silva & Souza Advocacia" value={name} onChange={(e) => setName(e.target.value)} required />
        <p className="text-label text-ink-muted">
          Criaremos categorias e fluxos de trabalho iniciais (salário-maternidade, aposentadoria, incapacidade, pesca, trabalhista, contratos e outros). Você pode personalizar tudo.
        </p>
        <p className="text-label text-ink-muted">Foi convidado por um escritório? Peça ao administrador para enviar o convite para este e-mail e entre novamente.</p>
        <InlineError message={error} />
        <Button type="submit" variant="primary" className="w-full justify-center" loading={loading}>
          Criar escritório
        </Button>
      </form>
    </AuthShell>
  )
}
