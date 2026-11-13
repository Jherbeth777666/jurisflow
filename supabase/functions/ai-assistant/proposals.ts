// Ferramentas de PROPOSTA da IA (lote L4a). A IA só propõe: nada é gravado
// aqui nem no laço do assistente. A gravação acontece no navegador, quando o
// usuário confirma (RPC ai_proposal_done), pelas tabelas normais com RLS.
// Módulo puro: sem APIs do Deno, testável no Node/vitest.

import { ToolArgError, parseISODateArg } from './tools.ts'
import type { ToolSpec } from './types.ts'

export const MAX_PROPOSALS = 5

const PRIORITIES = ['baixa', 'media', 'alta', 'urgente'] as const

export type ProposalKind = 'criar_tarefa' | 'definir_proxima_acao' | 'mover_etapa'

export interface Proposal {
  id: string
  kind: ProposalKind
  fields: Record<string, string>
  status: 'pendente'
}

type Args = Record<string, unknown>

const DESCRIPTION_TAIL =
  'Não invente datas: só preencha datas que o usuário disse. Isto NÃO grava nada: o usuário confirma na tela.'

const PROPOSAL_SPECS_LIST: ToolSpec[] = [
  {
    name: 'propor_tarefa',
    description: `Propõe criar uma tarefa. Use só quando o usuário pedir explicitamente para criar uma tarefa. ${DESCRIPTION_TAIL}`,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Título da tarefa (3 a 160 caracteres)' },
        due_date: { type: 'string', description: 'Prazo, AAAA-MM-DD (só se o usuário informou)' },
        client: { type: 'string', description: 'Cliente, usando o código mostrado (ex.: "Cliente C1")' },
        demand_title: { type: 'string', description: 'Demanda relacionada (até 160 caracteres)' },
        assignee: { type: 'string', description: 'Responsável, usando o código mostrado (ex.: "Responsável R1")' },
        priority: { type: 'string', enum: [...PRIORITIES] },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'propor_proxima_acao',
    description: `Propõe definir a próxima ação de uma demanda. Use só quando o usuário pedir explicitamente para definir ou alterar a próxima ação. ${DESCRIPTION_TAIL}`,
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Cliente, usando o código mostrado (ex.: "Cliente C1")' },
        demand_title: { type: 'string', description: 'Demanda (até 160 caracteres)' },
        next_action: { type: 'string', description: 'Próxima ação (até 300 caracteres)' },
        next_action_date: { type: 'string', description: 'Data da próxima ação, AAAA-MM-DD (só se o usuário informou)' },
      },
      required: ['demand_title', 'next_action'],
      additionalProperties: false,
    },
  },
  {
    name: 'propor_mudanca_etapa',
    description: `Propõe mudar a etapa de uma demanda. Use só quando o usuário pedir explicitamente para mudar a etapa. ${DESCRIPTION_TAIL}`,
    parameters: {
      type: 'object',
      properties: {
        client: { type: 'string', description: 'Cliente, usando o código mostrado (ex.: "Cliente C1")' },
        demand_title: { type: 'string', description: 'Demanda (até 160 caracteres)' },
        stage_name: { type: 'string', description: 'Nome da etapa de destino (até 80 caracteres)' },
      },
      required: ['demand_title', 'stage_name'],
      additionalProperties: false,
    },
  },
]

export const PROPOSAL_SPECS: ToolSpec[] = PROPOSAL_SPECS_LIST

const PROPOSAL_NAMES = new Set(PROPOSAL_SPECS.map((s) => s.name))

export function isProposalTool(name: string): boolean {
  return PROPOSAL_NAMES.has(name)
}

// ---------------------------------------------------------------------------
// Validadores
// ---------------------------------------------------------------------------
function cleanText(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ToolArgError(`${field} deve ser texto`)
  // remove caracteres de controle; o texto livre nunca chega cru ao navegador
  return value.replace(/\p{Cc}/gu, ' ').trim()
}

function requiredText(value: unknown, field: string, min: number, max: number): string {
  if (value === undefined || value === null || value === '') throw new ToolArgError(`${field} é obrigatório`)
  const clean = cleanText(value, field)
  if (!clean) throw new ToolArgError(`${field} é obrigatório`)
  if (clean.length < min) throw new ToolArgError(`${field} deve ter pelo menos ${min} caracteres`)
  return clean.slice(0, max)
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null
  const clean = cleanText(value, field)
  return clean ? clean.slice(0, max) : null
}

function add(fields: Record<string, string>, key: string, value: string | null): void {
  if (value !== null) fields[key] = value
}

// ---------------------------------------------------------------------------
// Conversão das ferramentas propor_* em propostas
// ---------------------------------------------------------------------------
function buildFields(name: string, args: Args): { kind: ProposalKind; fields: Record<string, string> } {
  const fields: Record<string, string> = {}
  switch (name) {
    case 'propor_tarefa': {
      const priority = optionalText(args.priority, 'priority', 20)
      if (priority && !(PRIORITIES as readonly string[]).includes(priority)) {
        throw new ToolArgError(`priority inválido; use: ${PRIORITIES.join(', ')}`)
      }
      fields.title = requiredText(args.title, 'title', 3, 160)
      add(fields, 'due_date', parseISODateArg(args.due_date, 'due_date'))
      add(fields, 'client', optionalText(args.client, 'client', 160))
      add(fields, 'demand_title', optionalText(args.demand_title, 'demand_title', 160))
      add(fields, 'assignee', optionalText(args.assignee, 'assignee', 160))
      add(fields, 'priority', priority)
      return { kind: 'criar_tarefa', fields }
    }
    case 'propor_proxima_acao':
      return {
        kind: 'definir_proxima_acao',
        fields: compact({
          client: optionalText(args.client, 'client', 160),
          demand_title: requiredText(args.demand_title, 'demand_title', 1, 160),
          next_action: requiredText(args.next_action, 'next_action', 1, 300),
          next_action_date: parseISODateArg(args.next_action_date, 'next_action_date'),
        }),
      }
    case 'propor_mudanca_etapa':
      return {
        kind: 'mover_etapa',
        fields: compact({
          client: optionalText(args.client, 'client', 160),
          demand_title: requiredText(args.demand_title, 'demand_title', 1, 160),
          stage_name: requiredText(args.stage_name, 'stage_name', 1, 80),
        }),
      }
    default:
      throw new ToolArgError(`Ferramenta não permitida: ${String(name).slice(0, 60)}`)
  }
}

function compact(fields: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) if (v !== null) out[k] = v
  return out
}

function normalizeArgs(rawArgs: unknown): Args {
  if (typeof rawArgs === 'string') {
    try {
      const parsed = rawArgs.trim() ? JSON.parse(rawArgs) : {}
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Args) : {}
    } catch {
      throw new ToolArgError('Argumentos em JSON inválido')
    }
  }
  if (rawArgs === undefined || rawArgs === null) return {}
  if (typeof rawArgs === 'object' && !Array.isArray(rawArgs)) return rawArgs as Args
  throw new ToolArgError('Argumentos devem ser um objeto')
}

/**
 * Valida a chamada do modelo e devolve uma proposta pronta para o navegador,
 * com códigos ("Cliente C1") já restaurados para nomes reais. Nada é gravado.
 * Lança ToolArgError para ferramenta desconhecida ou argumentos inválidos.
 */
export function parseProposal(name: string, rawArgs: unknown, restore: (s: string) => string): Proposal {
  if (!isProposalTool(name)) throw new ToolArgError(`Ferramenta não permitida: ${String(name).slice(0, 60)}`)
  const { kind, fields } = buildFields(name, normalizeArgs(rawArgs))
  const restored: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) restored[key] = restore(value)
  return { id: crypto.randomUUID(), kind, fields: restored, status: 'pendente' }
}
