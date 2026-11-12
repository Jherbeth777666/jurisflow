import { useState, type FormEvent } from 'react'
import { Info, MailPlus, UserCheck, UserX, Users, X } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableSkeleton,
  useToast,
  Avatar,
} from '@/components/ui'
import { useOrg } from '@/contexts/AuthContext'
import { memberName, useMembers } from '@/hooks/useOrgData'
import { ROLE_LABELS } from '@/lib/constants'
import { formatDate } from '@/lib/format'
import type { MemberRole, MemberWithProfile, OrganizationInvitation } from '@/types/database'
import { useCancelInvitation, useCreateInvitation, useInvitations, useUpdateMember } from './api'
import { ROLE_CAPABILITIES, sortMembers, validateInvitation, wouldRemoveLastAdmin } from './logic'

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as MemberRole[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))

type PendingChange = { member: MemberWithProfile; role?: MemberRole; active?: boolean }

export function TeamTab() {
  const { can } = useOrg()
  const canManage = can('members.manage')
  return (
    <div className="flex flex-col gap-4">
      <MembersCard canManage={canManage} />
      {canManage && <InvitationsCard />}
      <RolesCard />
    </div>
  )
}

function MembersCard({ canManage }: { canManage: boolean }) {
  const { userId } = useOrg()
  const members = useMembers()
  const update = useUpdateMember()
  const toast = useToast()
  const [pending, setPending] = useState<PendingChange | null>(null)

  const list = sortMembers(members.data ?? [])

  const describe = (p: PendingChange) => {
    const name = memberName(p.member)
    const self = p.member.user_id === userId
    if (p.role) {
      return `${self ? 'Você' : name} passará de ${ROLE_LABELS[p.member.role]} para ${ROLE_LABELS[p.role]}.${
        self && p.role !== 'admin' ? ' Você perderá o acesso à gestão da equipe.' : ''
      }`
    }
    return p.active
      ? `${name} voltará a acessar os dados do escritório com o papel ${ROLE_LABELS[p.member.role]}.`
      : `${self ? 'Você perderá' : `${name} perderá`} imediatamente o acesso a todos os dados do escritório. O histórico de atividades é mantido.`
  }

  const confirm = async () => {
    if (!pending) return
    if (wouldRemoveLastAdmin(list, pending.member, pending)) {
      throw new Error('O escritório precisa de pelo menos um administrador ativo. Promova outra pessoa antes.')
    }
    await update.mutateAsync({ id: pending.member.id, user_id: pending.member.user_id, role: pending.role, active: pending.active })
    toast.show(pending.role ? 'Papel alterado.' : pending.active ? 'Membro reativado.' : 'Membro desativado.')
  }

  return (
    <Card>
      <CardHeader
        title="Membros da equipe"
        description={canManage ? 'Altere papéis ou desative o acesso de quem saiu do escritório.' : 'Somente administradores podem gerenciar a equipe.'}
      />
      {members.isLoading ? (
        <TableSkeleton rows={3} cols={4} />
      ) : members.isError ? (
        <ErrorState message={(members.error as Error).message} onRetry={() => members.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title="Nenhum membro encontrado" />
      ) : (
        <Table label="Membros da equipe">
          <THead>
            <tr>
              <TH>Nome</TH>
              <TH>E-mail</TH>
              <TH>Papel</TH>
              <TH>Situação</TH>
              {canManage && <TH className="text-right">Ações</TH>}
            </tr>
          </THead>
          <TBody>
            {list.map((m) => {
              const self = m.user_id === userId
              return (
                <TR key={m.id} className={m.active ? undefined : 'opacity-70'}>
                  <TD>
                    <span className="flex items-center gap-2">
                      <Avatar name={memberName(m)} />
                      <span className="font-medium">{memberName(m)}</span>
                      {self && <Badge tone="gray">você</Badge>}
                    </span>
                  </TD>
                  <TD className="text-ink-muted">{m.profile?.email ?? '—'}</TD>
                  <TD>
                    {canManage && m.active ? (
                      <Select
                        aria-label={`Papel de ${memberName(m)}`}
                        options={ROLE_OPTIONS}
                        value={m.role}
                        onChange={(e) => {
                          const role = e.target.value as MemberRole
                          if (role !== m.role) setPending({ member: m, role })
                        }}
                        wrapperClassName="w-40"
                      />
                    ) : (
                      ROLE_LABELS[m.role]
                    )}
                  </TD>
                  <TD>
                    <Badge tone={m.active ? 'green' : 'gray'} dot>
                      {m.active ? 'Ativo' : 'Desativado'}
                    </Badge>
                  </TD>
                  {canManage && (
                    <TD className="text-right">
                      {m.active ? (
                        <Button size="sm" variant="ghost" icon={<UserX className="size-4" />} onClick={() => setPending({ member: m, active: false })}>
                          Desativar
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" icon={<UserCheck className="size-4" />} onClick={() => setPending({ member: m, active: true })}>
                          Reativar
                        </Button>
                      )}
                    </TD>
                  )}
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      <ConfirmDialog
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={confirm}
        title={pending?.role ? 'Alterar papel' : pending?.active ? 'Reativar membro' : 'Desativar membro'}
        description={pending ? describe(pending) : ''}
        confirmLabel={pending?.role ? 'Alterar papel' : pending?.active ? 'Reativar' : 'Desativar'}
        tone={pending?.active === false ? 'danger' : 'primary'}
      />
    </Card>
  )
}

function InvitationsCard() {
  const members = useMembers()
  const invitations = useInvitations(true)
  const create = useCreateInvitation()
  const cancel = useCancelInvitation()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('assistente')
  const [error, setError] = useState<string | null>(null)
  const [toCancel, setToCancel] = useState<OrganizationInvitation | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const err = validateInvitation(email, members.data ?? [], invitations.data ?? [])
    setError(err)
    if (err) return
    create.mutate(
      { email, role },
      {
        onSuccess: () => {
          setEmail('')
          toast.show('Convite registrado.')
        },
        onError: (er) => setError(er.message),
      },
    )
  }

  return (
    <Card>
      <CardHeader title="Convites" description="Adicione advogados e assistentes ao escritório." />
      <CardBody className="flex flex-col gap-4">
        <div role="note" className="flex items-start gap-2 rounded-md border border-accent-200 bg-accent-50 px-3 py-2 text-[13px] text-accent-700">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            A pessoa deve criar conta com este e-mail; o convite é aceito automaticamente no primeiro acesso. O sistema não envia
            e-mail de convite — avise a pessoa diretamente. O convite só é aceito depois que ela confirmar o e-mail da conta.
          </span>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-start" noValidate>
          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            placeholder="nome@escritorio.com.br"
            wrapperClassName="flex-1"
            autoComplete="off"
          />
          <Select label="Papel" options={ROLE_OPTIONS} value={role} onChange={(e) => setRole(e.target.value as MemberRole)} wrapperClassName="sm:w-44" />
          <Button type="submit" variant="primary" icon={<MailPlus className="size-4" />} loading={create.isPending} className="sm:mt-[25px]">
            Convidar
          </Button>
        </form>
      </CardBody>

      <div className="border-t border-line">
        {invitations.isLoading ? (
          <TableSkeleton rows={2} cols={3} />
        ) : invitations.isError ? (
          <ErrorState message={(invitations.error as Error).message} onRetry={() => invitations.refetch()} />
        ) : !invitations.data?.length ? (
          <p className="px-4 py-5 text-center text-[13px] text-ink-muted">Nenhum convite pendente.</p>
        ) : (
          <Table label="Convites pendentes">
            <THead>
              <tr>
                <TH>E-mail</TH>
                <TH>Papel</TH>
                <TH>Convidado em</TH>
                <TH className="text-right">Ações</TH>
              </tr>
            </THead>
            <TBody>
              {invitations.data.map((inv) => (
                <TR key={inv.id}>
                  <TD>{inv.email}</TD>
                  <TD>{ROLE_LABELS[inv.role]}</TD>
                  <TD className="text-ink-muted">{formatDate(inv.created_at)}</TD>
                  <TD className="text-right">
                    <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => setToCancel(inv)}>
                      Cancelar
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <ConfirmDialog
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        onConfirm={async () => {
          if (!toCancel) return
          await cancel.mutateAsync(toCancel.id)
          toast.show('Convite cancelado.')
        }}
        title="Cancelar convite"
        description={toCancel ? `${toCancel.email} não será mais adicionado(a) ao escritório ao criar a conta.` : ''}
        confirmLabel="Cancelar convite"
      />
    </Card>
  )
}

function RolesCard() {
  return (
    <Card>
      <CardHeader
        title="O que cada papel pode fazer"
        description="Estas regras são aplicadas pelo banco de dados (Row Level Security), não apenas pela interface."
      />
      <Table label="Permissões por papel">
        <THead>
          <tr>
            <TH>Recurso</TH>
            <TH>Administrador</TH>
            <TH>Advogado</TH>
            <TH>Assistente</TH>
          </tr>
        </THead>
        <TBody>
          {ROLE_CAPABILITIES.map((r) => (
            <TR key={r.resource}>
              <TD>{r.resource}</TD>
              <TD><Cap value={r.admin} /></TD>
              <TD><Cap value={r.advogado} /></TD>
              <TD><Cap value={r.assistente} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  )
}

function Cap({ value }: { value: string }) {
  const tone = value === 'Não' ? 'gray' : value === 'Sim' || value === 'Editar' ? 'green' : 'blue'
  return <Badge tone={tone}>{value}</Badge>
}
