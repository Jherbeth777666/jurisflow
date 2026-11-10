// Whitelist de ferramentas expostas ao modelo. Cada ferramenta mapeia para UMA
// função SQL (migration 004) e define como validar/limitar os argumentos.
// Regras de segurança:
//   * Nome fora da whitelist → rejeitado (nada é executado).
//   * O escritório (p_org) vem SEMPRE da requisição autenticada; qualquer
//     p_org/organization_id enviado pelo modelo é ignorado.
//   * Argumentos desconhecidos são descartados; numéricos são limitados.
// Módulo puro.

import type { RpcExecutor, ToolSpec } from './types.ts'

export class ToolArgError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolArgError'
  }
}

type Args = Record<string, unknown>

interface ToolDef {
  spec: ToolSpec
  rpc: string
  /** Converte argumentos do modelo em parâmetros da RPC (sem p_org). */
  build(args: Args): Record<string, unknown>
}

const DEMAND_STATUSES = ['em_andamento', 'aguardando_cliente', 'suspensa', 'concluida', 'cancelada'] as const

// ---------------------------------------------------------------------------
// Validadores
// ---------------------------------------------------------------------------
export function clampInt(value: unknown, def: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

/** 'YYYY-MM-DD' válido ou null (ausente). Formato inválido → ToolArgError. */
export function parseISODateArg(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ToolArgError(`${field} deve estar no formato AAAA-MM-DD`)
  }
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) {
    throw new ToolArgError(`${field} não é uma data válida`)
  }
  return value
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new ToolArgError(`${field} deve ser texto`)
  // remove caracteres de controle; o SQL ainda escapa curingas do LIKE
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
  return clean || null
}

// ---------------------------------------------------------------------------
// Definições
// ---------------------------------------------------------------------------
const noParams: ToolSpec['parameters'] = { type: 'object', properties: {}, additionalProperties: false }

const TOOLS: ToolDef[] = [
  {
    rpc: 'ai_stalled_demands',
    spec: {
      name: 'ai_stalled_demands',
      description:
        'Lista demandas abertas sem mudança de etapa há pelo menos N dias (demandas "paradas"). Retorna título, cliente, categoria, etapa, dias parada e responsável (máx. 50 itens; "total" traz a contagem real).',
      parameters: {
        type: 'object',
        properties: { days: { type: 'integer', minimum: 1, maximum: 365, description: 'Dias mínimos sem mudança de etapa (padrão 15)' } },
        additionalProperties: false,
      },
    },
    build: (a) => ({ p_days: clampInt(a.days, 15, 1, 365) }),
  },
  {
    rpc: 'ai_waiting_documents',
    spec: {
      name: 'ai_waiting_documents',
      description:
        'Demandas abertas em etapa de "aguardando documentação", com total de demandas e número de clientes distintos.',
      parameters: noParams,
    },
    build: () => ({}),
  },
  {
    rpc: 'ai_overdue_tasks',
    spec: {
      name: 'ai_overdue_tasks',
      description: 'Tarefas/atividades pendentes com prazo vencido (atrasadas), com dias de atraso, prioridade, responsável, cliente e demanda.',
      parameters: noParams,
    },
    build: () => ({}),
  },
  {
    rpc: 'ai_upcoming_tasks',
    spec: {
      name: 'ai_upcoming_tasks',
      description: 'Tarefas pendentes com prazo nos próximos N dias (inclui hoje).',
      parameters: {
        type: 'object',
        properties: { days: { type: 'integer', minimum: 1, maximum: 60, description: 'Janela em dias (padrão 7)' } },
        additionalProperties: false,
      },
    },
    build: (a) => ({ p_days: clampInt(a.days, 7, 1, 60) }),
  },
  {
    rpc: 'ai_weekly_summary',
    spec: {
      name: 'ai_weekly_summary',
      description:
        'Resumo de uma semana (segunda a domingo): demandas abertas/concluídas, mudanças de etapa, tarefas criadas/concluídas/vencidas, novos clientes, pagamentos recebidos (só para admin/advogado) e quebra por categoria.',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Qualquer data da semana desejada, AAAA-MM-DD. Omitir = semana atual.' },
        },
        additionalProperties: false,
      },
    },
    build: (a) => {
      const d = parseISODateArg(a.start_date, 'start_date')
      return d ? { p_start: d } : {}
    },
  },
  {
    rpc: 'ai_count_demands',
    spec: {
      name: 'ai_count_demands',
      description:
        'Conta demandas por categoria/status, com filtro opcional por nome da categoria (busca parcial, sem acento), período de ABERTURA e status. Ex.: "quantas demandas de salário-maternidade foram abertas este mês".',
      parameters: {
        type: 'object',
        properties: {
          category_name: { type: 'string', description: 'Parte do nome da categoria, ex.: "salário-maternidade"' },
          from_date: { type: 'string', description: 'Data inicial de abertura, AAAA-MM-DD' },
          to_date: { type: 'string', description: 'Data final de abertura, AAAA-MM-DD' },
          status: { type: 'string', enum: [...DEMAND_STATUSES] },
        },
        additionalProperties: false,
      },
    },
    build: (a) => {
      const params: Record<string, unknown> = {}
      const cat = optionalText(a.category_name, 'category_name', 80)
      const from = parseISODateArg(a.from_date, 'from_date')
      const to = parseISODateArg(a.to_date, 'to_date')
      if (from && to && from > to) throw new ToolArgError('from_date não pode ser maior que to_date')
      const status = optionalText(a.status, 'status', 30)
      if (status && !(DEMAND_STATUSES as readonly string[]).includes(status)) {
        throw new ToolArgError(`status inválido; use: ${DEMAND_STATUSES.join(', ')}`)
      }
      if (cat) params.p_category_name = cat
      if (from) params.p_from = from
      if (to) params.p_to = to
      if (status) params.p_status = status
      return params
    },
  },
  {
    rpc: 'ai_clients_awaiting',
    spec: {
      name: 'ai_clients_awaiting',
      description:
        'Clientes aguardando algo: demandas com status "aguardando cliente", em etapa de aguardando documentação ou em primeiro atendimento. Agrupado por cliente.',
      parameters: noParams,
    },
    build: () => ({}),
  },
  {
    rpc: 'ai_financial_overview',
    spec: {
      name: 'ai_financial_overview',
      description:
        'Visão financeira de honorários: previstos, recebidos, saldo, parcelas vencidas (quantidade e valor) e a vencer nos próximos 30 dias. Disponível apenas para administradores e advogados.',
      parameters: noParams,
    },
    build: () => ({}),
  },
  {
    rpc: 'ai_office_overview',
    spec: {
      name: 'ai_office_overview',
      description:
        'Visão geral operacional do escritório: clientes ativos, demandas em andamento/aguardando/paradas, tarefas pendentes/atrasadas/próximas e demandas abertas por categoria e status.',
      parameters: noParams,
    },
    build: () => ({}),
  },
]

const BY_NAME = new Map(TOOLS.map((t) => [t.spec.name, t]))

export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => t.spec)
export const TOOL_NAMES: string[] = TOOLS.map((t) => t.spec.name)

export function isAllowedTool(name: string): boolean {
  return BY_NAME.has(name)
}

/**
 * Valida a chamada do modelo e devolve { rpc, params } com p_org da requisição.
 * Lança ToolArgError para ferramenta desconhecida ou argumentos inválidos.
 */
export function buildToolInvocation(name: string, rawArgs: unknown, orgId: string): { rpc: string; params: Record<string, unknown> } {
  const def = BY_NAME.get(name)
  if (!def) throw new ToolArgError(`Ferramenta não permitida: ${String(name).slice(0, 60)}`)
  let args: Args = {}
  if (typeof rawArgs === 'string') {
    try {
      args = rawArgs.trim() ? JSON.parse(rawArgs) : {}
    } catch {
      throw new ToolArgError('Argumentos em JSON inválido')
    }
  } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    args = rawArgs as Args
  } else if (rawArgs !== undefined && rawArgs !== null) {
    throw new ToolArgError('Argumentos devem ser um objeto')
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new ToolArgError('Argumentos devem ser um objeto')
  // build() só lê as chaves conhecidas; p_org é sobrescrito por último.
  return { rpc: def.rpc, params: { ...def.build(args), p_org: orgId } }
}

export type ToolOutcome =
  | { ok: true; name: string; data: unknown }
  | { ok: false; name: string; error: string; allowed: boolean }

/** Executa uma chamada de ferramenta via RPC (com o JWT do usuário → RLS). */
export async function executeTool(name: string, rawArgs: unknown, orgId: string, rpc: RpcExecutor): Promise<ToolOutcome> {
  let inv: { rpc: string; params: Record<string, unknown> }
  try {
    inv = buildToolInvocation(name, rawArgs, orgId)
  } catch (e) {
    return { ok: false, name, error: e instanceof Error ? e.message : 'Argumentos inválidos', allowed: isAllowedTool(name) }
  }
  try {
    const { data, error } = await rpc(inv.rpc, inv.params)
    if (error) {
      if (error.code === '42501') {
        return {
          ok: false,
          name,
          allowed: true,
          error:
            name === 'ai_financial_overview'
              ? 'Permissão negada: o perfil do usuário (assistente) não pode consultar dados financeiros.'
              : 'Permissão negada para esta consulta.',
        }
      }
      if (error.code === '22023') return { ok: false, name, allowed: true, error: `Parâmetro inválido: ${error.message}` }
      return { ok: false, name, allowed: true, error: 'Falha ao consultar os dados.' }
    }
    return { ok: true, name, data }
  } catch {
    return { ok: false, name, allowed: true, error: 'Falha ao consultar os dados.' }
  }
}
