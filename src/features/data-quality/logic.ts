// "Saúde do cadastro": diagnóstico da base do escritório. Funções puras.
//
// Pontuação 0–100 = soma ponderada de 6 indicadores (cada um entre 0 e 1;
// sem registros no denominador → 1, pois não há problema a apontar):
//
//   Indicador                                   Peso  Cálculo
//   Sem duplicados                               25   1 − clientes em pares de possível duplicado / clientes
//   Cadastros completos                          25   1 − clientes sem CPF, sem telefone ou com CPF inválido / clientes
//   Demandas abertas com responsável             15   1 − abertas sem responsável / abertas
//   Demandas abertas com próxima atividade       15   1 − abertas sem próxima atividade nem tarefa aberta / abertas
//   Tarefas em dia                               10   1 − tarefas abertas vencidas há > 7 dias / tarefas abertas
//   Clientes ativos com movimento                10   1 − ativos sem demanda aberta e sem movimento há > 90 dias / ativos
import { diffInDays, isValidCPF } from '@/lib/format'
import type { Client, Demand, DemandStatus, Task } from '@/types/database'
import { findDuplicatePairs, type DuplicatePair } from '@/features/import/dedupe'

export const STALE_CLIENT_DAYS = 90
export const OVERDUE_TASK_DAYS = 7

export const WEIGHTS = {
  duplicates: 25,
  completeness: 25,
  responsible: 15,
  nextAction: 15,
  tasks: 10,
  staleClients: 10,
} as const
export type Indicator = keyof typeof WEIGHTS

export const INDICATOR_LABEL: Record<Indicator, string> = {
  duplicates: 'Sem duplicados',
  completeness: 'Cadastros completos',
  responsible: 'Demandas com responsável',
  nextAction: 'Demandas com próxima atividade',
  tasks: 'Tarefas em dia',
  staleClients: 'Clientes ativos com movimento',
}

export type QClient = Pick<Client, 'id' | 'full_name' | 'cpf' | 'phone' | 'birth_date' | 'status' | 'created_at'>
export type QDemand = Pick<Demand, 'id' | 'title' | 'client_id' | 'status' | 'responsible_id' | 'next_action' | 'updated_at' | 'closed_at'>
export type QTask = Pick<Task, 'id' | 'title' | 'demand_id' | 'client_id' | 'due_date' | 'status'>

const CLOSED: DemandStatus[] = ['concluida', 'cancelada']
const isOpenDemand = (d: QDemand) => !CLOSED.includes(d.status)
const isOpenTask = (t: QTask) => t.status === 'pendente' || t.status === 'em_andamento'

export type IncompleteIssue = 'sem_cpf' | 'cpf_invalido' | 'sem_telefone'
export const ISSUE_LABEL: Record<IncompleteIssue, string> = {
  sem_cpf: 'Sem CPF',
  cpf_invalido: 'CPF inválido',
  sem_telefone: 'Sem telefone',
}

export interface QualityReport {
  score: number
  indicators: Record<Indicator, { value: number; points: number; problems: number; total: number }>
  duplicates: (DuplicatePair & { aName: string; bName: string })[]
  incomplete: { client: QClient; issues: IncompleteIssue[] }[]
  staleClients: { client: QClient; lastActivity: string; days: number }[]
  noResponsible: QDemand[]
  noNextAction: QDemand[]
  overdueTasks: (QTask & { daysLate: number })[]
  totals: { clients: number; activeClients: number; openDemands: number; openTasks: number }
}

const ratioOk = (problems: number, total: number) => (total ? Math.max(0, 1 - problems / total) : 1)

export function analyzeBase(input: { clients: QClient[]; demands: QDemand[]; tasks: QTask[] }, today: string): QualityReport {
  const clients = input.clients
  const nameById = new Map(clients.map((c) => [c.id, c.full_name]))

  // Duplicados
  const pairs = findDuplicatePairs(
    clients.map((c) => ({ id: c.id, name: c.full_name, cpf: c.cpf, phone: c.phone, birthDate: c.birth_date })),
  ).map((p) => ({ ...p, aName: nameById.get(p.a) ?? '', bName: nameById.get(p.b) ?? '' }))
  pairs.sort((x, y) => Number(y.certain) - Number(x.certain) || y.score - x.score)
  const inPairs = new Set(pairs.flatMap((p) => [p.a, p.b]))

  // Incompletos (arquivados não contam)
  const considered = clients.filter((c) => c.status !== 'arquivado')
  const incomplete = considered
    .map((client) => {
      const issues: IncompleteIssue[] = []
      if (!client.cpf) issues.push('sem_cpf')
      else if (!isValidCPF(client.cpf)) issues.push('cpf_invalido')
      if (!client.phone) issues.push('sem_telefone')
      return { client, issues }
    })
    .filter((x) => x.issues.length)

  // Demandas / tarefas
  const openDemands = input.demands.filter(isOpenDemand)
  const openTasks = input.tasks.filter(isOpenTask)
  const demandsWithTask = new Set(openTasks.map((t) => t.demand_id).filter(Boolean) as string[])
  const noResponsible = openDemands.filter((d) => !d.responsible_id)
  const noNextAction = openDemands.filter((d) => !d.next_action?.trim() && !demandsWithTask.has(d.id))
  const overdueTasks = openTasks
    .filter((t) => t.due_date && diffInDays(t.due_date, today) > OVERDUE_TASK_DAYS)
    .map((t) => ({ ...t, daysLate: diffInDays(t.due_date!, today) }))
    .sort((a, b) => b.daysLate - a.daysLate)

  // Clientes ativos parados
  const lastByClient = new Map<string, string>()
  const withOpen = new Set<string>()
  for (const d of input.demands) {
    if (isOpenDemand(d)) withOpen.add(d.client_id)
    const last = [d.updated_at, d.closed_at].filter(Boolean).map((s) => s!.slice(0, 10)).sort().pop()
    if (last && (lastByClient.get(d.client_id) ?? '') < last) lastByClient.set(d.client_id, last)
  }
  const active = clients.filter((c) => c.status === 'ativo')
  const staleClients = active
    .filter((c) => !withOpen.has(c.id))
    .map((client) => {
      const created = client.created_at.slice(0, 10)
      const d = lastByClient.get(client.id)
      const lastActivity = d && d > created ? d : created
      return { client, lastActivity, days: diffInDays(lastActivity, today) }
    })
    .filter((x) => x.days > STALE_CLIENT_DAYS)
    .sort((a, b) => b.days - a.days)

  const raw: Record<Indicator, [number, number]> = {
    duplicates: [inPairs.size, clients.length],
    completeness: [incomplete.length, considered.length],
    responsible: [noResponsible.length, openDemands.length],
    nextAction: [noNextAction.length, openDemands.length],
    tasks: [overdueTasks.length, openTasks.length],
    staleClients: [staleClients.length, active.length],
  }
  const indicators = {} as QualityReport['indicators']
  let score = 0
  for (const k of Object.keys(WEIGHTS) as Indicator[]) {
    const [problems, total] = raw[k]
    const value = ratioOk(problems, total)
    const points = value * WEIGHTS[k]
    score += points
    indicators[k] = { value, points, problems, total }
  }

  return {
    score: Math.round(score),
    indicators,
    duplicates: pairs,
    incomplete,
    staleClients,
    noResponsible,
    noNextAction,
    overdueTasks,
    totals: { clients: clients.length, activeClients: active.length, openDemands: openDemands.length, openTasks: openTasks.length },
  }
}

export function scoreLabel(score: number): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (score >= 85) return { label: 'Ótima', tone: 'success' }
  if (score >= 65) return { label: 'Boa, com pontos de atenção', tone: 'warning' }
  return { label: 'Precisa de cuidado', tone: 'danger' }
}
