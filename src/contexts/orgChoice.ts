// Escolha do escritório atual (lógica pura, testável).

export interface PendingInvitation {
  id: string
  organization_id?: string
  organization_name: string
  role: 'admin' | 'advogado' | 'assistente'
  invited_by_name: string | null
  created_at: string
  expires_at: string
}

/**
 * Escritório atual: o salvo (se o usuário ainda for membro); senão o único que houver.
 * Com mais de um e nenhum salvo válido → null: a UI mostra o seletor em vez de escolher
 * arbitrariamente (ex.: o primeiro em ordem alfabética).
 */
export function pickCurrentOrg<M extends { organization: { id: string } }>(memberships: M[], storedId: string | null): M | null {
  if (storedId) {
    const saved = memberships.find((m) => m.organization.id === storedId)
    if (saved) return saved
  }
  return memberships.length === 1 ? memberships[0] : null
}

/** Normaliza o retorno de my_pending_invitations (tolerante a campos ausentes). */
export function normalizeInvitations(rows: unknown): PendingInvitation[] {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string')
    .map((r) => ({
      id: r.id as string,
      organization_id: typeof r.organization_id === 'string' ? r.organization_id : undefined,
      organization_name: typeof r.organization_name === 'string' && r.organization_name ? r.organization_name : 'Escritório',
      role: (['admin', 'advogado', 'assistente'] as const).find((x) => x === r.role) ?? 'assistente',
      invited_by_name: typeof r.invited_by_name === 'string' ? r.invited_by_name : null,
      created_at: String(r.created_at ?? ''),
      expires_at: String(r.expires_at ?? ''),
    }))
}

/** Mensagem amigável para falha ao sair do escritório (último administrador). */
export function leaveErrorMessage(message: string): string {
  if (/pelo menos um administrador/i.test(message))
    return 'Você é o último administrador deste escritório. Promova outro membro a administrador (Configurações › Equipe) antes de sair.'
  return message
}
