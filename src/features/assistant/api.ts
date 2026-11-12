import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { supabase, unwrap } from '@/lib/supabase'
import type { AiConversation, AiMessage } from '@/types/database'
import type { Proposal } from './proposals'

export type ConversationSummary = Pick<AiConversation, 'id' | 'title' | 'updated_at' | 'created_at'>
export type ChatMessageRow = Pick<AiMessage, 'id' | 'role' | 'content' | 'tools_used' | 'created_at'> & {
  proposals?: Proposal[] | null
}

export interface AssistantReply {
  conversation_id: string
  message: string
  tools_used: string[]
  /** Id da mensagem do assistente salva no histórico (para as propostas). */
  message_id?: string | null
  /** Ações propostas pela IA, pendentes de confirmação do usuário. */
  proposals?: Proposal[]
  /** Tipos de dado removidos da pergunta antes do envio (cpf, telefone, email, cnpj) */
  redacted?: string[]
}

export type AssistantErrorKind =
  | 'not_configured'
  | 'rate_limited'
  | 'provider_busy'
  | 'provider'
  | 'network'
  | 'auth'
  | 'forbidden'
  | 'invalid'
  | 'unknown'

export class AssistantError extends Error {
  readonly kind: AssistantErrorKind
  readonly conversationId: string | null
  constructor(kind: AssistantErrorKind, message: string, conversationId: string | null = null) {
    super(message)
    this.name = 'AssistantError'
    this.kind = kind
    this.conversationId = conversationId
  }
}

/** Converte status HTTP + corpo da Edge Function em erro amigável. */
export function mapAssistantError(status: number, body: unknown): AssistantError {
  const b = (body && typeof body === 'object' ? body : {}) as { error?: unknown; code?: unknown; conversation_id?: unknown }
  const serverMsg = typeof b.error === 'string' ? b.error : null
  const convId = typeof b.conversation_id === 'string' ? b.conversation_id : null
  if (status === 503 && b.code === 'provider_busy') {
    return new AssistantError('provider_busy', serverMsg ?? 'O provedor de IA está sobrecarregado. Tente novamente em instantes.')
  }
  switch (status) {
    case 503:
      return new AssistantError('not_configured', 'Assistente não configurado — veja o README.')
    case 429:
      return new AssistantError('rate_limited', serverMsg ?? 'Limite de mensagens por hora atingido. Tente novamente mais tarde.')
    case 401:
      return new AssistantError('auth', 'Sua sessão expirou. Entre novamente.')
    case 403:
      return new AssistantError('forbidden', serverMsg ?? 'Você não tem acesso a este escritório.')
    case 400:
    case 404:
    case 413:
      return new AssistantError('invalid', serverMsg ?? 'Requisição inválida.')
    case 502:
      return new AssistantError('provider', serverMsg ?? 'Não foi possível obter resposta do provedor de IA.', convId)
    default:
      return new AssistantError('unknown', serverMsg ?? 'Ocorreu um erro inesperado no assistente.', convId)
  }
}

export async function sendAssistantMessage(input: {
  organization_id: string
  conversation_id: string | null
  message: string
}): Promise<AssistantReply> {
  const { data, error } = await supabase.functions.invoke<AssistantReply>('ai-assistant', { body: input })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response
      const body = await res
        .clone()
        .json()
        .catch(() => null)
      throw mapAssistantError(res.status, body)
    }
    if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
      throw new AssistantError('network', 'Não foi possível conectar ao assistente. Verifique sua internet e tente novamente.')
    }
    throw new AssistantError('unknown', 'Ocorreu um erro inesperado no assistente.')
  }
  if (!data || typeof data.message !== 'string') throw new AssistantError('unknown', 'Resposta inválida do assistente.')
  return data
}

// Histórico: leitura direta das tabelas (a RLS garante que são só do usuário).
export async function listConversations(orgId: string, userId: string): Promise<ConversationSummary[]> {
  return unwrap(
    await supabase
      .from('ai_conversations')
      .select('id, title, updated_at, created_at')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(100),
  ) as ConversationSummary[]
}

export const MESSAGES_LIMIT = 300

/** As MESSAGES_LIMIT mensagens mais recentes da conversa, em ordem cronológica. */
export async function listMessages(orgId: string, conversationId: string): Promise<ChatMessageRow[]> {
  const rows = unwrap(
    await supabase
      .from('ai_messages')
      .select('id, role, content, tools_used, created_at, proposals')
      .eq('organization_id', orgId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(MESSAGES_LIMIT),
  ) as ChatMessageRow[]
  // Pergunta e resposta podem ter o mesmo created_at (mesma transação): no empate, a do usuário vem antes.
  const rank = (r: ChatMessageRow) => (r.role === 'user' ? 0 : 1)
  return rows.reverse().sort((a, b) => a.created_at.localeCompare(b.created_at) || rank(a) - rank(b))
}

export async function renameConversation(orgId: string, id: string, title: string): Promise<void> {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!clean) throw new Error('Informe um título.')
  unwrap(await supabase.from('ai_conversations').update({ title: clean }).eq('organization_id', orgId).eq('id', id).select('id').single())
}

export async function deleteConversation(orgId: string, id: string): Promise<void> {
  const rows = unwrap(
    await supabase.from('ai_conversations').delete().eq('organization_id', orgId).eq('id', id).select('id'),
  ) as { id: string }[]
  // Sem linha afetada = conversa inexistente ou exclusão barrada pela RLS: não reportar sucesso.
  if (!rows?.length) throw new Error('Conversa não encontrada ou sem permissão para excluir.')
}
