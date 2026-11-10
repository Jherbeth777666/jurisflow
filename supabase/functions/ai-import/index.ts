// Edge Function `ai-import` (Deno): sugere o mapeamento de colunas de uma planilha
// e a categoria do escritório para cada "tipo de demanda" distinto.
//
// Segurança (mesma postura do ai-assistant):
//  * JWT obrigatório; cliente Supabase com o JWT do usuário (RLS); is_org_member checado.
//  * CORS restrito a ALLOWED_ORIGINS.
//  * Entrada só com estrutura: títulos + exemplos mascarados + valores sem dígitos/@
//    (validate.ts rejeita qualquer coisa que pareça dado real).
//  * Resposta do modelo validada contra o que foi enviado (validate.ts).
//  * Nada é persistido; nenhuma chave de serviço é usada.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createProviderFromEnv } from '../ai-assistant/providers/registry.ts'
import { bearerToken, corsHeaders, isOriginAllowed, parseAllowedOrigins } from '../ai-assistant/request.ts'
import { ProviderError, type ToolSpec } from '../ai-assistant/types.ts'
import { buildImportSystemPrompt, buildImportUserMessage } from './prompt.ts'
import { LIMITS, validateAIResponse, validateInput } from './validate.ts'

const env = Deno.env.toObject()
const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS)
const RATE_PER_HOUR = Math.max(1, Number(env.AI_IMPORT_RATE_LIMIT_PER_HOUR) || 20)

// Alguns provedores exigem ao menos uma ferramenta quando há tool_choice; com 'none' ela nunca é chamada.
const NO_TOOLS: ToolSpec[] = [
  {
    name: 'sem_acao',
    description: 'Não utilize. Responda apenas com o JSON pedido.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
]

// Limite por instância (melhor esforço, sem persistência). userId → timestamps
const usage = new Map<string, number[]>()
function allow(userId: string): boolean {
  const now = Date.now()
  const recent = (usage.get(userId) ?? []).filter((t) => now - t < 3600_000)
  if (recent.length >= RATE_PER_HOUR) {
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

  // --- Autenticação -----------------------------------------------------------
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
  const userId = userData.user.id

  // --- Corpo ------------------------------------------------------------------
  const rawText = await req.text()
  if (rawText.length > LIMITS.bodyBytes) return fail(413, 'payload_too_large', 'Requisição muito grande.')
  let raw: unknown
  try {
    raw = JSON.parse(rawText)
  } catch {
    return fail(400, 'invalid_body', 'Corpo da requisição inválido.')
  }
  const parsed = validateInput(raw)
  if (!parsed.ok) return fail(400, 'invalid_body', parsed.error)
  const input = parsed.value

  // --- Acesso ao escritório ---------------------------------------------------
  const { data: isMember, error: memberError } = await supabase.rpc('is_org_member', { p_org: input.organizationId })
  if (memberError) return fail(500, 'db_error', 'Não foi possível verificar o acesso.')
  if (isMember !== true) return fail(403, 'forbidden', 'Você não tem acesso a este escritório.')

  // --- Provedor ---------------------------------------------------------------
  const prov = createProviderFromEnv(env, undefined, (e) =>
    console.warn(`[ai-import] provedor principal falhou (${e.provider}, ${e.status ?? 'rede'}); usando reserva`),
  )
  if (!prov.ok) {
    return fail(503, 'not_configured', 'Mapeamento com IA indisponível (provedor não configurado). Use o mapeamento automático e ajuste manualmente.')
  }
  if (!allow(userId)) return fail(429, 'rate_limited', `Limite de ${RATE_PER_HOUR} mapeamentos por hora atingido.`)
  // Cota persistente no banco (vale entre instâncias da função)
  const { data: quotaOk, error: quotaError } = await supabase.rpc('ai_consume_quota', {
    p_org: input.organizationId,
    p_kind: 'import',
    p_limit_per_hour: RATE_PER_HOUR,
  })
  if (quotaError) return fail(500, 'db_error', 'Não foi possível verificar o limite de uso.')
  if (quotaOk !== true) return fail(429, 'rate_limited', `Limite de ${RATE_PER_HOUR} mapeamentos por hora atingido.`)

  // --- LLM (até 2 tentativas se o JSON vier inválido) --------------------------
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await prov.provider.complete({
        system: buildImportSystemPrompt(),
        messages: [{ role: 'user', content: buildImportUserMessage(input) }],
        tools: NO_TOOLS,
        toolChoice: 'none',
        maxTokens: 1500,
      })
      const result = validateAIResponse(res.text, input)
      if (result) return json(200, { ...result, provider: prov.primary.id })
    } catch (e) {
      console.error(`[ai-import] falha no provedor: ${e instanceof ProviderError ? `${e.provider} ${e.status ?? 'rede'}` : 'erro interno'}`)
      if (e instanceof ProviderError && e.status === 429) {
        return fail(503, 'provider_busy', 'O provedor de IA está sobrecarregado. Tente novamente em instantes.')
      }
      return fail(502, 'provider_error', 'Não foi possível obter resposta do provedor de IA.')
    }
  }
  return fail(502, 'invalid_response', 'A IA não devolveu um mapeamento válido. Ajuste as colunas manualmente.')
})
