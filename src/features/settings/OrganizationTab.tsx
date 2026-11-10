import { useEffect, useState, type FormEvent } from 'react'
import { FlaskConical, Save } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, Input, useToast } from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { formatDate } from '@/lib/format'
import { useUpdateOrganizationName } from './api'
import { validateOrgName } from './logic'

export function OrganizationTab() {
  const { organization, can } = useOrg()
  const canManage = can('organization.manage')
  const toast = useToast()
  const update = useUpdateOrganizationName()
  const [name, setName] = useState(organization.name)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setName(organization.name), [organization.name])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const err = validateOrgName(name)
    setError(err)
    if (err) return
    update.mutate(name, {
      onSuccess: () => toast.show('Dados do escritório atualizados.'),
      onError: (er) => setError(er.message),
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Escritório"
          description={canManage ? 'Somente administradores podem alterar estes dados.' : 'Apenas administradores podem alterar estes dados.'}
          action={organization.is_demo ? <Badge tone="violet">Demonstração</Badge> : undefined}
        />
        <CardBody>
          <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
            <Input
              label="Nome do escritório"
              required
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              error={error}
              readOnly={!canManage}
              disabled={!canManage}
            />
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <dt className="text-[12px] text-ink-subtle">Criado em</dt>
                <dd className="text-ink">{formatDate(organization.created_at)}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-subtle">Tipo</dt>
                <dd className="text-ink">{organization.is_demo ? 'Demonstração' : 'Produção'}</dd>
              </div>
            </dl>
            {canManage && (
              <div>
                <Button
                  type="submit"
                  variant="primary"
                  icon={<Save className="size-4" />}
                  loading={update.isPending}
                  disabled={name.trim() === organization.name}
                >
                  Salvar
                </Button>
              </div>
            )}
          </form>
        </CardBody>
      </Card>

      {organization.is_demo && (
        <Card>
          <CardHeader title="Ambiente de demonstração" />
          <CardBody className="flex gap-3 text-[13px] text-ink-muted">
            <FlaskConical className="mt-0.5 size-4 shrink-0 text-violet-600" />
            <p>
              Este escritório está marcado como <strong className="text-ink">demonstração</strong>: os clientes, demandas, tarefas e
              contratos foram gerados com dados fictícios (por exemplo, “Cliente Demonstração 01”) e não representam pessoas reais.
              Não cadastre dados de clientes reais aqui — crie um escritório próprio para uso em produção.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  )
}
