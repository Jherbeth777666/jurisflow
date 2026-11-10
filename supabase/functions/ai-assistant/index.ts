// Edge Function `ai-assistant` (Deno). Camada fina: HTTP, autenticação e
// persistência. A lógica fica nos módulos puros (testados com vitest).
//
// Segurança:
//  * Exige JWT do usuário; TODAS as consultas usam um cliente Supabase com esse
//    JWT (anon key + Authorization) → RLS vale em tudo. Nenhuma service key.
//  * O modelo só chama ferramentas da whitelist (tools.ts); p_org = escritório da requisição.
//  * Dados enviados ao provedor: pergunta sem CPF/telefone/e-mail + nomes pseudonimizados.
//  * Chaves do provedor só em secrets do servidor.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { DeadlineError, TIMEOUT_MESSAGE, runAssistant, type HistoryMessage, type NameLookup } from './assistant.ts'
import { buildSystemPrompt } from './prompt.ts'
import { Pseudonymizer, nameCandidates } from './pseudonymize.ts'
import { consumeQuota, monthlyOrgLimitFromEnv } from './quota.ts'
import { createProviderFromEnv } from './providers/registry.ts'
import { redactPII } from './redact.ts'
import {
  MAX_BODY_BYTES,
  bearerToken,
  conversationTitle,
  corsHeaders,
  isOriginAllowed,
  parseAllowedOrigins,
  utf8ByteLength,
  validateBody,
} from './request.ts'
import { ProviderError, type RpcExecutor } from './types.ts'

const HISTORY_LIMIT = 12
const DICTIONARY_CLIENT_LIMIT = 3000
/** Máx. de clientes trazidos por busca de nomes citados (pergunta/histórico/resultados). */
const CITED_CLIENT_LIMIT = 300
const DEADLINE_MS = 45_000

const env = Deno.env.toObject()
const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS)
const rateLimitPerHour = Math.max(1, Number(env.AI_RATE_LIMIT_PER_HOUR) || 30)
const monthlyOrgLimit = monthlyOrgLimitFromEnv(env)

/** Padrão ILIKE que ignora acentos: vogais e "c" viram "_" (um caractere qualquer). */
const accentInsensitiveLike = (folded: string) => `%${folded.replace(/[aeiouc]/g, '_')}%`

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin, allowedOrigins)
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8' } })
  const fail = (status: number, code: string, error: string) => json(status, { error, code })

  if (!isOriginAllowed(origin, allowedOrigins)) return fail(403, 'origin_not_allowed', 'Origem não permitida.')
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Método não permitido.')

  // --- Autenticação -------------------------------------------------------
  const authHeader = req.headers.get('authorization')
  const token = bearerToken(authHeader)
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

  // --- Corpo ----------------------------------------------------------------
  const rawText = await req.text()
  if (utf8ByteLength(rawText) > MAX_BODY_BYTES) return fail(413, 'payload_too_large', 'Mensagem muito grande.')
  let raw: unknown
  try {
    raw = JSON.parse(rawText)
  } catch {
    return fail(400, 'invalid_body', 'Corpo da requisição inválido.')
  }
  const parsed = validateBody(raw)
  if (!parsed.ok) return fail(400, 'invalid_body', parsed.error)
  const { organizationId: orgId, message } = parsed.value
  let conversationId = parsed.value.conversationId

  // --- Provedor configurado? ------------------------------------------------
  const prov = createProviderFromEnv(env, undefined, (e) =>
    console.warn(`[ai-assistant] provedor principal falhou (${e.provider}, ${e.status ?? 'rede'}); usando reserva`),
  )
  if (!prov.ok) {
    console.warn(`[ai-assistant] ${prov.error}`)
    return fail(503, 'not_configured', 'Assistente não configurado — veja o README.')
  }
  prov.warnings.forEach((w) => console.warn(`[ai-assistant] ${w}`))

  // --- Membership e papel (sob RLS) ----------------------------------------
  const { data: member, error: memberError } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle()
  if (memberError) return fail(500, 'db_error', 'Não foi possível verificar o acesso.')
  const { data: isMember } = await supabase.rpc('is_org_member', { p_org: orgId })
  if (!member || isMember !== true) return fail(403, 'forbidden', 'Você não tem acesso a este escritório.')
  const role = member.role as string

  // --- Privacidade: remove CPF/telefone/e-mail da pergunta -------------------
  const redaction = redactPII(message)
  const safeMessage = redaction.text

  // --- Conversa ---------------------------------------------------------------
  let history: HistoryMessage[] = []
  if (conversationId) {
    const { data: conv } = await supabase
      .from('ai_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!conv) return fail(404, 'conversation_not_found', 'Conversa não encontrada.')
    const { data: msgs, error: histError } = await supabase
      .from('ai_messages')
      .select('role, content, tools_used')
      .eq('conversation_id', conversationId)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)
    if (histError) return fail(500, 'db_error', 'Não foi possível carregar o histórico.')
    history = ((msgs ?? []) as HistoryMessage[]).reverse()
  }

  // --- Rate limit — só depois de validar entrada e conversa (erros do cliente não gastam cota) (mensagens do usuário na última hora) ---------------------
  // Cota persistente (ai_usage): excluir conversas não zera a contagem. Inclui o teto mensal do escritório.
  const quota = await consumeQuota({
    rpc: async (fn, params) => {
      const { data, error } = await supabase.rpc(fn, params)
      return { data, error: error ? { message: error.message, code: error.code } : null }
    },
    countLastHour: async () => {
      const { count, error } = await supabase
        .from('ai_usage')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('kind', 'assistant')
        .gt('created_at', new Date(Date.now() - 3_600_000).toISOString())
      return error ? null : (count ?? 0)
    },
    orgId,
    kind: 'assistant',
    hourlyLimit: rateLimitPerHour,
    monthlyLimit: monthlyOrgLimit,
    hourlyMessage: `Limite de ${rateLimitPerHour} mensagens por hora atingido. Tente novamente mais tarde.`,
  })
  if (!quota.ok) return fail(quota.status, quota.code, quota.error)

  if (!conversationId) {
    const { data: conv, error: convError } = await supabase
      .from('ai_conversations')
      .insert({ organization_id: orgId, user_id: userId, title: conversationTitle(safeMessage) })
      .select('id')
      .single()
    if (convError || !conv) return fail(500, 'db_error', 'Não foi possível criar a conversa.')
    conversationId = conv.id as string
  }

  // Grava a pergunta antes de chamar o provedor (conta no rate limit mesmo se falhar).
  const { error: insUserError } = await supabase.from('ai_messages').insert({
    organization_id: orgId,
    conversation_id: conversationId,
    user_id: userId,
    role: 'user',
    content: safeMessage,
  })
  if (insUserError) return fail(500, 'db_error', 'Não foi possível salvar a mensagem.')

  // --- Dicionário de nomes para pseudonimizar histórico/pergunta -----------
  // Prioridade: clientes CITADOS (pergunta, histórico e resultados das ferramentas,
  // via lookupNames); os mais recentes entram como complemento.
  const [{ data: clientRows }, { data: memberRows }, { data: catRows }, { data: stageRows }] = await Promise.all([
    supabase
      .from('clients')
      .select('full_name')
      .eq('organization_id', orgId)
      .is('anonymized_at', null)
      .order('updated_at', { ascending: false })
      .limit(DICTIONARY_CLIENT_LIMIT),
    supabase.from('organization_members').select('profile:profiles(full_name)').eq('organization_id', orgId),
    supabase.from('demand_categories').select('name').eq('organization_id', orgId).limit(200),
    supabase.from('workflow_stages').select('name').eq('organization_id', orgId).limit(1000),
  ])
  const stopwords = [...((catRows ?? []) as { name: string }[]), ...((stageRows ?? []) as { name: string }[])].map((r) => r.name)
  const lookupNames: NameLookup = async (texts) => {
    const words = nameCandidates(texts, 12, stopwords)
    if (!words.length) return {}
    const { data, error } = await supabase
      .from('clients')
      .select('full_name')
      .eq('organization_id', orgId)
      .is('anonymized_at', null)
      .or(words.map((w) => `full_name.ilike.${accentInsensitiveLike(w)}`).join(','))
      .limit(CITED_CLIENT_LIMIT)
    if (error) return {}
    return { clients: ((data ?? []) as { full_name: string }[]).map((c) => c.full_name) }
  }
  const pseudonymizer = new Pseudonymizer({
    stopwords,
    clients: ((clientRows ?? []) as { full_name: string }[]).map((c) => c.full_name),
    members: ((memberRows ?? []) as unknown as { profile: { full_name: string } | null }[])
      .map((m) => m.profile?.full_name ?? '')
      .filter(Boolean),
  })

  const rpc: RpcExecutor = async (fn, params) => {
    const { data, error } = await supabase.rpc(fn, params)
    return { data, error: error ? { message: error.message, code: error.code } : null }
  }

  // --- LLM com ferramentas ---------------------------------------------------
  let result
  try {
    result = await runAssistant({
      provider: prov.provider,
      system: buildSystemPrompt({ now: new Date(), role }),
      history,
      userMessage: safeMessage,
      orgId,
      rpc,
      pseudonymizer,
      lookupNames,
      deadlineMs: DEADLINE_MS,
    })
  } catch (e) {
    // Registra uma resposta de erro: a pergunta não fica órfã no histórico.
    const saveError = (content: string) =>
      supabase.from('ai_messages').insert({
        organization_id: orgId,
        conversation_id: conversationId,
        user_id: userId,
        role: 'assistant',
        content,
        tools_used: [],
      })
    if (e instanceof DeadlineError) {
      console.warn('[ai-assistant] prazo total da requisição esgotado')
      await saveError(TIMEOUT_MESSAGE)
      await supabase.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)
      return json(200, { conversation_id: conversationId, message: TIMEOUT_MESSAGE, tools_used: [], redacted: redaction.removed, timeout: true })
    }
    await saveError('Não foi possível obter resposta do provedor de IA nesta mensagem.')
    const status = e instanceof ProviderError ? e.status : null
    console.error(`[ai-assistant] falha no provedor: ${e instanceof ProviderError ? `${e.provider} ${e.message}` : 'erro interno'}`)
    if (status === 429) {
      return fail(503, 'provider_busy', 'O provedor de IA está sobrecarregado. Tente novamente em instantes.')
    }
    return json(502, {
      error: 'Não foi possível obter resposta do provedor de IA. Tente novamente.',
      code: 'provider_error',
      conversation_id: conversationId,
    })
  }

  const { error: insAsstError } = await supabase.from('ai_messages').insert({
    organization_id: orgId,
    conversation_id: conversationId,
    user_id: userId,
    role: 'assistant',
    content: result.text,
    tools_used: result.toolsUsed,
  })
  if (insAsstError) console.error('[ai-assistant] falha ao salvar resposta')
  await supabase.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)

  return json(200, {
    conversation_id: conversationId,
    message: result.text,
    tools_used: result.toolsUsed,
    redacted: redaction.removed,
  })
})
