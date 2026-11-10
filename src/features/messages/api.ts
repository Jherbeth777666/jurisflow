// Dados da central de mensagens: modelos do escritório, contexto para preencher
// variáveis e ajuste de tom com IA (Edge Function ai-compose).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/AuthContext'
import type { Client, Demand, InstallmentOverview, Task } from '@/types/database'
import type { ComposeTone, MessageTemplateRow } from './types'

export const messageKeys = {
  templates: (org: string) => ['message-templates', org] as const,
  compose: (org: string, clientId: string) => ['compose-context', org, clientId] as const,
  nextTask: (org: string, demandId: string) => ['compose-next-task', org, demandId] as const,
}

export function useMessageTemplates() {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: messageKeys.templates(orgId),
    queryFn: async () =>
      unwrap(
        await supabase.from('message_templates').select('*').eq('organization_id', orgId).order('name'),
      ) as MessageTemplateRow[],
    staleTime: 60_000,
  })
}

export interface TemplateInput {
  id?: string
  name: string
  subject: string | null
  body: string
}

export function useSaveMessageTemplate() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: TemplateInput) => {
      if (id) {
        return unwrap(
          await supabase.from('message_templates').update(input).eq('id', id).eq('organization_id', orgId).select('*').single(),
        ) as MessageTemplateRow
      }
      return unwrap(
        await supabase.from('message_templates').insert({ ...input, organization_id: orgId }).select('*').single(),
      ) as MessageTemplateRow
    },
    onSettled: () => qc.invalidateQueries({ queryKey: messageKeys.templates(orgId) }),
  })
}

export function useDeleteMessageTemplate() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap(
        await supabase.from('message_templates').delete().eq('id', id).eq('organization_id', orgId).select('id'),
      ) as { id: string }[]
      if (!rows.length) throw new Error('Você não tem permissão para excluir este modelo.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: messageKeys.templates(orgId) }),
  })
}

// ---------------------------------------------------------------------------
// Contexto do cliente para preencher variáveis
// ---------------------------------------------------------------------------
export type ComposeDemand = Pick<
  Demand,
  'id' | 'title' | 'category_id' | 'stage_id' | 'next_action' | 'next_action_date' | 'responsible_id' | 'status' | 'updated_at'
>

export interface ComposeContext {
  client: Pick<Client, 'id' | 'full_name' | 'phone' | 'email' | 'anonymized_at'>
  demands: ComposeDemand[]
  nextInstallment: Pick<InstallmentOverview, 'id' | 'due_date' | 'remaining_amount' | 'amount' | 'status' | 'contract_id'> | null
}

export function useComposeContext(clientId: string | null, enabled = true) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: messageKeys.compose(orgId, clientId ?? ''),
    enabled: enabled && !!clientId,
    queryFn: async (): Promise<ComposeContext> => {
      const [client, demands, inst] = await Promise.all([
        supabase
          .from('clients')
          .select('id, full_name, phone, email, anonymized_at')
          .eq('organization_id', orgId)
          .eq('id', clientId!)
          .single(),
        supabase
          .from('demands')
          .select('id, title, category_id, stage_id, next_action, next_action_date, responsible_id, status, updated_at')
          .eq('organization_id', orgId)
          .eq('client_id', clientId!)
          .order('updated_at', { ascending: false })
          .limit(30),
        supabase
          .from('installment_overview')
          .select('id, due_date, remaining_amount, amount, status, contract_id')
          .eq('organization_id', orgId)
          .eq('client_id', clientId!)
          .in('status', ['vencida', 'parcial', 'a_vencer'])
          .order('due_date')
          .limit(1),
      ])
      const insts = unwrap(inst) as ComposeContext['nextInstallment'][]
      return {
        client: unwrap(client) as ComposeContext['client'],
        demands: unwrap(demands) as ComposeDemand[],
        nextInstallment: insts[0] ?? null,
      }
    },
    staleTime: 30_000,
  })
}

/** Próxima tarefa aberta da demanda (fallback para "próxima atividade"). */
export function useNextDemandTask(demandId: string | null) {
  const { orgId } = useOrg()
  return useQuery({
    queryKey: messageKeys.nextTask(orgId, demandId ?? ''),
    enabled: !!demandId,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from('tasks')
          .select('id, title, due_date')
          .eq('organization_id', orgId)
          .eq('demand_id', demandId!)
          .in('status', ['pendente', 'em_andamento'])
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(1),
      ) as Pick<Task, 'id' | 'title' | 'due_date'>[]
      return rows[0] ?? null
    },
    staleTime: 30_000,
  })
}

// ---------------------------------------------------------------------------
// Ajuste de tom com IA
// ---------------------------------------------------------------------------
export class ComposeError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'ComposeError'
    this.code = code
  }
}

const AI_UNAVAILABLE_KEY = 'jurisflow.aiCompose.unavailable'

export function isAiComposeMarkedUnavailable(): boolean {
  try {
    return sessionStorage.getItem(AI_UNAVAILABLE_KEY) === '1'
  } catch {
    return false
  }
}

function markAiComposeUnavailable() {
  try {
    sessionStorage.setItem(AI_UNAVAILABLE_KEY, '1')
  } catch {
    /* sem armazenamento: só nesta tela */
  }
}

/**
 * Envia SOMENTE o modelo com variáveis não substituídas + o tom.
 * Nenhum nome, valor ou data real sai do navegador.
 */
export async function adjustTemplateTone(orgId: string, template: string, tone: ComposeTone): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ai-compose', {
    body: { organization_id: orgId, template, tone },
  })
  if (error) {
    let message = 'Não foi possível ajustar o texto agora. Tente novamente.'
    let code = 'unknown'
    const ctx = (error as { context?: unknown }).context
    if (ctx instanceof Response) {
      try {
        const body = (await ctx.json()) as { error?: string; code?: string }
        if (body.error) message = body.error
        if (body.code) code = body.code
      } catch {
        /* resposta sem JSON */
      }
      if (ctx.status === 503 && code === 'not_configured') markAiComposeUnavailable()
    } else if (/fetch|network/i.test(error.message)) {
      message = 'Não foi possível conectar ao servidor. Verifique sua internet.'
    }
    throw new ComposeError(message, code)
  }
  const text = (data as { text?: unknown } | null)?.text
  if (typeof text !== 'string' || !text.trim()) throw new ComposeError('A IA não devolveu texto.', 'empty')
  return text
}
