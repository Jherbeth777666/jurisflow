// Edge Function `ai-compose` (Deno): ajusta o TOM de um modelo de mensagem.
//
// Segurança (mesmo padrão do ai-assistant):
//  * JWT obrigatório; cliente Supabase criado com o JWT do usuário (RLS vale);
//    o usuário precisa ser membro ativo do escritório (is_org_member).
//  * CORS restrito a ALLOWED_ORIGINS.
//  * O provedor recebe apenas o modelo com variáveis {{...}} NÃO substituídas
//    (sem nomes, valores ou datas reais). Modelos com CPF/telefone/e-mail
//    digitados são recusados.
//  * A resposta só é devolvida se preservar exatamente as mesmas variáveis.
//  * Nada é persistido.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createProviderFromEnv } from '../ai-assistant/providers/registry.ts'
import { redactPII } from '../ai-assistant/redact.ts'
import { bearerToken, corsHeaders, isOriginAllowed, parseAllowedOrigins } from '../ai-assistant/request.ts'
import { ProviderError, type ToolSpec } from '../ai-assistant/types.ts'
import {
  MAX_BODY_BYTES,
  buildComposeSystemPrompt,
  buildComposeUserMessage,
  checkRewrite,
  validateComposeBody,
} from './compose.ts'

const env = Deno.env.toObject()
const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS)
const limitPerHour = Math.max(1, Number(env.AI_COMPOSE_RATE_LIMIT_PER_HOUR) || 40)

// Alguns provedores exigem ao menos uma ferramenta declarada quando há tool_choice;
// com toolChoice 'none' ela nunca é chamada.
const NO_TOOLS: ToolSpec[] = [
  {
    name: 'sem_acao',
    description: 'Não utilize. Responda apenas com o texto reescrito.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
]

// Limite por instância (melhor esforço; sem persistência). userId → timestamps
const usage = new Map<string, number[]>()
function allow(userId: string): boolean {
  const now = Date.now()
  const recent = (usage.get(userId) ?? []).filter((t) => now - t < 3600_000)
  if (recent.length >= limitPerHour) {
    usage.set(userId, recent)
    return false
  }
  recent.push(now)
  usage.set(userId, recent)
  return true
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin, allowedOrigins)
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } })
  const fail = (status: number, code: string, error: string) => json(status, { error, code })

  if (!isOriginAllowed(origin, allowedOrigins)) return fail(403, 'origin_not_allowed', 'Origem não permitida.')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Método não permitido.')

  // --- Autenticação ---------------------------------------------------------
  const token = bearerToken(req.headers.get('authorization'))
  if (!token) return fail(401, 'unauthorized', 'Sessão expirada. Entre novamente.')
  const supabaseUrl = env.SUPABASE_URL
  const anonKey = env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) return fail(500, 'server_misconfigured', 'Servidor sem configuração do Supabase.')
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user) return fail(401, 'unauthorized', 'Sessão expirada. Entre novamente.')

  // --- Corpo ----------------------------------------------------------------
  const rawText = await req.text()
  if (rawText.length > MAX_BODY_BYTES) return fail(413, 'payload_too_large', 'Modelo muito grande.')
  let raw: unknown
  try {
    raw = JSON.parse(rawText)
  } catch {
    return fail(400, 'invalid_body', 'Corpo da requisição inválido.')
  }
  const parsed = validateComposeBody(raw)
  if (!parsed.ok) return fail(400, 'invalid_body', parsed.error)
  const { organizationId, template, tone } = parsed.value

  // Modelos não devem conter dados pessoais digitados — use variáveis.
  if (redactPII(template).removed.length) {
    return fail(
      400,
      'pii_in_template',
      'O modelo contém CPF, telefone ou e-mail digitados. Remova esses dados (use variáveis) antes de ajustar com IA.',
    )
  }

  // --- Provedor configurado? ------------------------------------------------
  const prov = createProviderFromEnv(env)
  if (!prov.ok) return fail(503, 'not_configured', 'Ajuste com IA não configurado — veja o README.')

  // --- Membership -----------------------------------------------------------
  const { data: isMember, error: memberError } = await supabase.rpc('is_org_member', { p_org: organizationId })
  if (memberError) return fail(500, 'db_error', 'Não foi possível verificar o acesso.')
  if (isMember !== true) return fail(403, 'forbidden', 'Você não tem acesso a este escritório.')

  if (!allow(userData.user.id)) {
    return fail(429, 'rate_limited', `Limite de ${limitPerHour} ajustes por hora atingido. Tente novamente mais tarde.`)
  }
  // Cota persistente no banco (vale entre instâncias da função)
  const { data: quotaOk, error: quotaError } = await supabase.rpc('ai_consume_quota', {
    p_org: organizationId,
    p_kind: 'compose',
    p_limit_per_hour: limitPerHour,
  })
  if (quotaError) return fail(500, 'db_error', 'Não foi possível verificar o limite de uso.')
  if (quotaOk !== true) {
    return fail(429, 'rate_limited', `Limite de ${limitPerHour} ajustes por hora atingido. Tente novamente mais tarde.`)
  }

  // --- Chamada ao provedor (até 2 tentativas se a validação falhar) ----------
  let lastError = 'A IA não preservou as variáveis do modelo.'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await prov.provider.complete({
        system: buildComposeSystemPrompt(),
        messages: [{ role: 'user', content: buildComposeUserMessage(template, tone) }],
        tools: NO_TOOLS,
        toolChoice: 'none',
        maxTokens: 1200,
      })
      const check = checkRewrite(template, res.text)
      if (check.ok) return json(200, { text: check.text, tone })
      lastError = check.error
    } catch (e) {
      console.error(`[ai-compose] falha no provedor: ${e instanceof ProviderError ? `${e.provider} ${e.status ?? 'rede'}` : 'erro interno'}`)
      if (e instanceof ProviderError && e.status === 429) {
        return fail(503, 'provider_busy', 'O provedor de IA está sobrecarregado. Tente novamente em instantes.')
      }
      return fail(502, 'provider_error', 'Não foi possível obter resposta do provedor de IA. Tente novamente.')
    }
  }
  return fail(422, 'rewrite_rejected', `${lastError} O texto original foi mantido.`)
})
