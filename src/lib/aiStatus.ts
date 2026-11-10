// Mensagens para quando o provedor de IA não está configurado (Edge Function → 503
// 'not_configured'). Só o administrador pode resolver; os demais apenas avisam.

export function aiNotConfiguredMessage(isAdmin: boolean, feature = 'Assistente'): string {
  return isAdmin
    ? `${feature} não configurado: defina a chave do provedor de IA (rode CONFIGURAR-IA.bat ou veja a seção de IA do README).`
    : `${feature} indisponível no momento. Avise o administrador do escritório.`
}
