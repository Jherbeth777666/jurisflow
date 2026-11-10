import { useState } from 'react'
import { Check, MailOpen, X } from 'lucide-react'
import { Button, useToast } from '@/components/ui'
import { useAuth, type PendingInvitation } from '@/contexts/AuthContext'
import { ROLE_LABELS } from '@/lib/constants'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/cn'

/**
 * Convites pendentes com aceite explícito. `variant="banner"` no topo do app;
 * `variant="card"` na tela de boas-vindas (sem escritório).
 * Ao aceitar sem escritório ativo (`switchOnAccept`), entra direto no escritório.
 */
export function PendingInvitations({ variant = 'banner', switchOnAccept = false }: { variant?: 'banner' | 'card'; switchOnAccept?: boolean }) {
  const { invitations } = useAuth()
  if (!invitations.length) return null
  return (
    <section
      aria-label="Convites pendentes"
      className={cn(
        variant === 'banner'
          ? 'border-b border-accent-200 bg-accent-50 px-4 py-2.5 sm:px-6 lg:px-8'
          : 'rounded-lg border border-accent-200 bg-accent-50 p-3',
      )}
    >
      <ul className="mx-auto flex max-w-[1400px] flex-col gap-2">
        {invitations.map((inv) => (
          <InvitationRow key={inv.id} inv={inv} switchOnAccept={switchOnAccept} compact={variant === 'banner'} />
        ))}
      </ul>
    </section>
  )
}

function InvitationRow({ inv, switchOnAccept, compact }: { inv: PendingInvitation; switchOnAccept: boolean; compact: boolean }) {
  const { acceptInvitation, declineInvitation, switchOrganization } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (kind: 'accept' | 'decline') => {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'accept') {
        const orgId = await acceptInvitation(inv.id)
        if (switchOnAccept && orgId) switchOrganization(orgId)
        else toast.show(`Você agora faz parte de “${inv.organization_name}”. Troque de escritório pelo menu lateral.`)
      } else {
        await declineInvitation(inv.id)
        toast.show('Convite recusado.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível responder ao convite.')
      setBusy(null)
    }
  }

  return (
    <li className={cn('flex flex-col gap-2 text-[13px] text-ink sm:flex-row sm:items-center sm:justify-between', !compact && 'sm:gap-3')}>
      <div className="flex min-w-0 items-start gap-2">
        <MailOpen className="mt-0.5 size-4 shrink-0 text-accent-700" aria-hidden />
        <p className="min-w-0">
          <strong className="font-semibold">{inv.invited_by_name ?? 'Um administrador'}</strong> convidou você para{' '}
          <strong className="font-semibold">{inv.organization_name}</strong> como <strong className="font-semibold">{ROLE_LABELS[inv.role]}</strong>.
          {inv.expires_at && <span className="text-ink-muted"> Válido até {formatDate(inv.expires_at)}.</span>}
          {error && (
            <span role="alert" className="block text-[12px] text-red-700">
              {error}
            </span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} loading={busy === 'decline'} disabled={!!busy} onClick={() => run('decline')}>
          Recusar
        </Button>
        <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} loading={busy === 'accept'} disabled={!!busy} onClick={() => run('accept')}>
          Aceitar
        </Button>
      </div>
    </li>
  )
}
