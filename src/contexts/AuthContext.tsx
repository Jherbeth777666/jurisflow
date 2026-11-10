import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, friendlyError } from '@/lib/supabase'
import { can, type Permission } from '@/lib/permissions'
import type { MemberRole, Organization, Profile } from '@/types/database'

export interface Membership {
  role: MemberRole
  organization: Organization
}

interface AuthState {
  session: Session | null
  loading: boolean
  profile: Profile | null
  memberships: Membership[]
  /** Escritório atual (sempre definido dentro das rotas protegidas) */
  organization: Organization | null
  role: MemberRole | null
  userId: string | null
  can: (p: Permission) => boolean
  switchOrganization: (id: string) => void
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  error: string | null
}

const AuthContext = createContext<AuthState | null>(null)
const ORG_KEY = 'jurisflow.currentOrg'

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ORG_KEY)
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadUserData = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null)
      setMemberships([])
      return
    }
    try {
      // Aceita convites pendentes para o e-mail confirmado do usuário.
      await supabase.rpc('accept_pending_invitations')
      const [p, m] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', s.user.id).single(),
        supabase
          .from('organization_members')
          .select('role, organization:organizations(*)')
          .eq('user_id', s.user.id)
          .eq('active', true),
      ])
      if (p.error) throw p.error
      if (m.error) throw m.error
      setProfile(p.data as Profile)
      const list = ((m.data ?? []) as unknown as Membership[]).filter((x) => x.organization)
      list.sort((a, b) => a.organization.name.localeCompare(b.organization.name))
      setMemberships(list)
      setError(null)
    } catch (e) {
      setError(friendlyError(e))
    }
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadUserData(data.session)
      if (active) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // setTimeout evita deadlock conhecido do supabase-js ao chamar a API dentro do callback
        setTimeout(() => {
          loadUserData(s).finally(() => setLoading(false))
        }, 0)
      }
      if (event === 'SIGNED_OUT') qc.clear()
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadUserData, qc])

  const current = useMemo(
    () => memberships.find((m) => m.organization.id === currentOrgId) ?? memberships[0] ?? null,
    [memberships, currentOrgId],
  )

  const switchOrganization = useCallback(
    (id: string) => {
      setCurrentOrgId(id)
      try {
        localStorage.setItem(ORG_KEY, id)
      } catch {
        /* armazenamento indisponível: segue só em memória */
      }
      qc.clear()
    },
    [qc],
  )

  const value: AuthState = {
    session,
    loading,
    profile,
    memberships,
    organization: current?.organization ?? null,
    role: current?.role ?? null,
    userId: session?.user.id ?? null,
    can: (p) => can(current?.role, p),
    switchOrganization,
    refresh: () => loadUserData(session),
    signOut: async () => {
      await supabase.auth.signOut()
    },
    error,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}

/** Use dentro das rotas protegidas: garante organização e usuário definidos. */
export function useOrg() {
  const a = useAuth()
  if (!a.organization || !a.userId) throw new Error('useOrg chamado sem organização ativa')
  return { ...a, organization: a.organization, orgId: a.organization.id, userId: a.userId, role: a.role! }
}
