// Propostas da IA: tipos e regras puras usadas pelo cartão de confirmação (lote L4b).

export type ProposalKind = 'criar_tarefa' | 'definir_proxima_acao' | 'mover_etapa'
export type ProposalStatus = 'pendente' | 'confirmada' | 'descartada'

export interface Proposal {
  id: string
  kind: ProposalKind
  fields: Record<string, string>
  status: ProposalStatus
}

export interface NamedOption {
  id: string
  name: string
}

export type MatchResult = { id: string } | { candidates: NamedOption[] }

const MAX_CANDIDATES = 5

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve um nome citado pela IA em uma opção (cliente, demanda, etapa...).
 * Igualdade sem acento/caixa vence; sem igualdade, devolve os que contêm o texto
 * (até 5). Só escolhe sozinho quando existe um único candidato.
 */
export function matchByName(name: string, options: NamedOption[]): MatchResult {
  const needle = normalize(name)
  if (!needle) return { candidates: [] }

  const exact = options.find((option) => normalize(option.name) === needle)
  if (exact) return { id: exact.id }

  const candidates = options.filter((option) => normalize(option.name).includes(needle)).slice(0, MAX_CANDIDATES)
  if (candidates.length === 1) return { id: candidates[0].id }
  return { candidates }
}

function brDate(value: string | undefined): string | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null
}

function limit(text: string): string {
  return text.length <= 160 ? text : `${text.slice(0, 157)}…`
}

/** Frase curta que resume a proposta (usada no cartão e no status resolvido). */
export function proposalSummary(proposal: Proposal): string {
  const f = proposal.fields ?? {}
  switch (proposal.kind) {
    case 'criar_tarefa': {
      const title = f.title?.trim()
      const date = brDate(f.due_date)
      const base = title ? `Criar tarefa “${title}”` : 'Criar tarefa'
      return limit(date ? `${base} para ${date}` : base)
    }
    case 'definir_proxima_acao': {
      const action = f.next_action?.trim()
      const demand = f.demand_title?.trim()
      const date = brDate(f.next_action_date)
      let text = action ? `Definir próxima ação “${action}”` : 'Definir próxima ação'
      if (demand) text += ` em “${demand}”`
      if (date) text += ` para ${date}`
      return limit(text)
    }
    case 'mover_etapa': {
      const demand = f.demand_title?.trim()
      const stage = f.stage_name?.trim()
      if (demand && stage) return limit(`Mover “${demand}” para a etapa “${stage}”`)
      if (demand) return limit(`Mover etapa de “${demand}”`)
      return 'Mover etapa da demanda'
    }
  }
}
