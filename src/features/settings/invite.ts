// Textos e links do convite de equipe (sem dependência de React/Supabase).

export function inviteLink(origin: string, token: string): string {
  return `${origin}/cadastro?convite=${token}`
}

export function whatsappInviteText(orgName: string, link: string): string {
  return `Você foi convidado(a) para o escritório ${orgName} no JurisFlow. Crie sua conta com este e-mail: ${link}`
}

export function inviteStatusLabel(expiresAt: string, acceptedAt: string | null, now: string | Date = new Date()): string {
  if (acceptedAt) return 'Aceito'
  // O rótulo é exibido na tela, sem segundos; o banco decide o aceite com
  // precisão de timestamp (`expires_at > now()`). Arredondar para o minuto
  // evita que o selo fique "Pendente" no mesmo minuto em que já venceu.
  const expires = Math.floor(new Date(expiresAt).getTime() / 60_000)
  const current = Math.floor((typeof now === 'string' ? new Date(now).getTime() : now.getTime()) / 60_000)
  return current >= expires ? 'Expirado' : 'Pendente'
}
