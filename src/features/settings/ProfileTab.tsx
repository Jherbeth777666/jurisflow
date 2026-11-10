import { useEffect, useState, type FormEvent } from 'react'
import { KeyRound, Save } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, InlineError, Input, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { ROLE_LABELS } from '@/lib/constants'
import { useChangePassword, useUpdateProfileName } from './api'
import { validateFullName, validatePassword } from './logic'

export function ProfileTab() {
  const { profile, session, role } = useOrg()
  const toast = useToast()
  const updateName = useUpdateProfileName()
  const changePassword = useChangePassword()

  const [name, setName] = useState(profile?.full_name ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  useEffect(() => setName(profile?.full_name ?? ''), [profile?.full_name])

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)

  const saveName = (e: FormEvent) => {
    e.preventDefault()
    const err = validateFullName(name)
    setNameError(err)
    if (err) return
    updateName.mutate(name, {
      onSuccess: () => toast.show('Nome atualizado.'),
      onError: (er) => setNameError(er.message),
    })
  }

  const savePassword = (e: FormEvent) => {
    e.preventDefault()
    const err = validatePassword(password, confirm)
    setPwError(err)
    if (err) return
    changePassword.mutate(password, {
      onSuccess: () => {
        setPassword('')
        setConfirm('')
        toast.show('Senha alterada.')
      },
      onError: (er) => setPwError(er.message),
    })
  }

  const email = session?.user.email ?? profile?.email ?? ''

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Dados pessoais" description={`Seu papel neste escritório: ${role ? ROLE_LABELS[role] : '—'}`} />
        <CardBody>
          <form onSubmit={saveName} className="flex flex-col gap-3" noValidate>
            <Input
              label="Nome completo"
              required
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              error={nameError}
              autoComplete="name"
            />
            <Input label="E-mail" value={email} readOnly disabled hint="O e-mail de acesso não pode ser alterado por aqui." />
            <div>
              <Button
                type="submit"
                variant="primary"
                icon={<Save className="size-4" />}
                loading={updateName.isPending}
                disabled={name.trim() === (profile?.full_name ?? '')}
              >
                Salvar nome
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Alterar senha" description="Mínimo de 8 caracteres, com letras e números." />
        <CardBody>
          <form onSubmit={savePassword} className="flex flex-col gap-3" noValidate>
            {/* campo oculto ajuda gerenciadores de senha a associar a conta */}
            <input type="email" autoComplete="username" value={email} readOnly hidden />
            <Input
              label="Nova senha"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Input
              label="Confirmar nova senha"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            <InlineError message={pwError} />
            <div>
              <Button
                type="submit"
                variant="primary"
                icon={<KeyRound className="size-4" />}
                loading={changePassword.isPending}
                disabled={!password || !confirm}
              >
                Alterar senha
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
