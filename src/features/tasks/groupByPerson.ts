// Agrupa tarefas por responsável, mantendo a ordem original (vencimento) dentro de cada grupo.

export interface PersonGroup<T> {
  /** user_id do responsável ou 'none' (sem responsável) */
  key: string
  name: string
  items: T[]
  overdue: number
}

export function groupByPerson<T extends { assignee_id: string | null; due_date: string | null; status: string }>(
  rows: T[],
  names: Map<string, string>,
  today: string,
): PersonGroup<T>[] {
  const groups = new Map<string, PersonGroup<T>>()
  for (const row of rows) {
    const key = row.assignee_id ?? 'none'
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        name: key === 'none' ? 'Sem responsável' : (names.get(key) ?? 'Pessoa removida da equipe'),
        items: [],
        overdue: 0,
      }
      groups.set(key, group)
    }
    group.items.push(row)
    const open = row.status !== 'concluida' && row.status !== 'cancelada'
    if (open && row.due_date && row.due_date < today) group.overdue += 1
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === 'none') return 1
    if (b.key === 'none') return -1
    return a.name.localeCompare(b.name, 'pt-BR')
  })
}
