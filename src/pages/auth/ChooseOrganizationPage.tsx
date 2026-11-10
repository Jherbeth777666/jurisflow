import { Building2, ChevronRight } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { ROLE_LABELS } from '@/lib/constants'
import { PendingInvitations } from '@/components/PendingInvitations'
import { AuthShell } from './AuthShell'

/** Usuário com mais de um escritório e nenhum escolhido neste navegador. */
export function ChooseOrganizationPage() {
  const { memberships, switchOrganization, signOut } = useAuth()
  return (
    <AuthShell
      title="Escolha o escritório"
      subtitle="Você participa de mais de um escritório. Escolha com qual deseja trabalhar agora — dá para trocar depois pelo menu lateral."
      footer={
        <button onClick={signOut} className="text-accent-700 hover:underline">
          Sair
        </button>
      }
    >
      <div className="space-y-3">
        <PendingInvitations variant="card" />
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {memberships.map((m) => (
            <li key={m.organization.id}>
              <button
                type="button"
                onClick={() => switchOrganization(m.organization.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-50"
              >
                <Building2 className="size-4 shrink-0 text-ink-subtle" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">{m.organization.name}</span>
                  <span className="block text-[12px] text-ink-muted">{ROLE_LABELS[m.role]}</span>
                </span>
                <ChevronRight className="size-4 text-ink-subtle" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </AuthShell>
  )
}
