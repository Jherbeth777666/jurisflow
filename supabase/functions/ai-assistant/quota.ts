// Cota de uso da IA (por usuário/hora e teto mensal por escritório), comum às
// três Edge Functions. Módulo puro: recebe executores de RPC/consulta.
//
// RPC: ai_consume_quota(p_org, p_kind, p_limit_per_hour, p_monthly_org_limit int default 3000)
// devolve true (uso registrado) ou false (limite por hora OU mensal atingido).
// Para dizer qual dos dois estourou, conta o uso do próprio usuário na última
// hora (ai_usage tem RLS: cada um lê só o seu).

export type QuotaKind = 'assistant' | 'import' | 'compose'

export const DEFAULT_MONTHLY_ORG_LIMIT = 3000
export const MONTHLY_LIMIT_MESSAGE =
  'Limite mensal de uso da IA do escritório atingido. Fale com o administrador do escritório.'

export function monthlyOrgLimitFromEnv(env: Record<string, string | undefined>): number {
  const n = Math.trunc(Number(env.AI_MONTHLY_ORG_LIMIT))
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MONTHLY_ORG_LIMIT
}

type RpcLike = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>

export type QuotaResult =
  | { ok: true }
  | { ok: false; status: 429; code: 'rate_limited' | 'monthly_limit'; error: string }
  | { ok: false; status: 500; code: 'db_error'; error: string }

export interface ConsumeQuotaInput {
  rpc: RpcLike
  /** Quantas vezes o usuário usou este tipo na última hora (null = não foi possível contar). */
  countLastHour: () => Promise<number | null>
  orgId: string
  kind: QuotaKind
  hourlyLimit: number
  monthlyLimit: number
  hourlyMessage: string
}

export async function consumeQuota(i: ConsumeQuotaInput): Promise<QuotaResult> {
  const params = { p_org: i.orgId, p_kind: i.kind, p_limit_per_hour: i.hourlyLimit }
  let { data, error } = await i.rpc('ai_consume_quota', { ...params, p_monthly_org_limit: i.monthlyLimit })
  // Banco ainda sem a migration do teto mensal: usa a assinatura antiga (3 argumentos).
  if (error && (error.code === 'PGRST202' || error.code === '42883')) {
    ;({ data, error } = await i.rpc('ai_consume_quota', params))
  }
  if (error) return { ok: false, status: 500, code: 'db_error', error: 'Não foi possível verificar o limite de uso.' }
  if (data === true) return { ok: true }
  let used: number | null = null
  try {
    used = await i.countLastHour()
  } catch {
    used = null
  }
  if (used !== null && used >= i.hourlyLimit) return { ok: false, status: 429, code: 'rate_limited', error: i.hourlyMessage }
  return { ok: false, status: 429, code: 'monthly_limit', error: MONTHLY_LIMIT_MESSAGE }
}
