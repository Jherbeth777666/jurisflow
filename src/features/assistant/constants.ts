// Rótulos e sugestões do Assistente IA.

/** Rótulos amigáveis das ferramentas (nomes vêm de ai_messages.tools_used). */
export const TOOL_LABELS: Record<string, string> = {
  ai_stalled_demands: 'Demandas paradas',
  ai_waiting_documents: 'Aguardando documentação',
  ai_overdue_tasks: 'Tarefas atrasadas',
  ai_upcoming_tasks: 'Próximos prazos',
  ai_weekly_summary: 'Resumo semanal',
  ai_count_demands: 'Contagem de demandas',
  ai_clients_awaiting: 'Clientes aguardando',
  ai_financial_overview: 'Visão financeira',
  ai_office_overview: 'Visão geral do escritório',
}

export const toolLabel = (name: string) => TOOL_LABELS[name] ?? name

/** Perguntas de exemplo do requisito (seção 3.7). */
export const SUGGESTIONS = [
  'Quais demandas estão paradas há mais de 15 dias?',
  'Quantos clientes estão aguardando documentação?',
  'Quais atividades estão atrasadas?',
  'Faça um resumo gerencial desta semana.',
  'Quantas demandas de salário-maternidade foram abertas este mês?',
] as const

export const MAX_MESSAGE_CHARS = 2000

export const PRIVACY_NOTICE =
  'O assistente consulta apenas dados operacionais autorizados e não substitui a análise do advogado. Nomes são pseudonimizados antes do envio ao provedor de IA.'

// Detecção (apenas para avisar na UI) — a remoção real acontece no servidor.
const PII_HINTS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/,
  /(?<!\d)\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}(?!\d)/,
  /(?<!\d)(?:\+?55[\s-]?)?(?:\(\d{2}\)|\d{2})[\s-]?9?\d{4}[\s-]?\d{4}(?!\d)/,
]

export function containsPersonalData(text: string): boolean {
  return PII_HINTS.some((re) => re.test(text))
}
