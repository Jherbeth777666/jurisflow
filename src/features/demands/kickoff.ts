// Lógica pura do passo "Preparar a demanda": sugere tarefas a partir dos modelos da categoria.
// As datas são lembretes internos de organização, nunca prazos jurídicos.
import { addDaysISO, parseISODate } from '@/lib/format'
import type { ISODate, PriorityLevel, UUID } from '@/types/database'

export interface TaskTemplate {
  id?: UUID
  title: string
  offset_days: number | null
  priority: PriorityLevel
  position: number
}

export interface SuggestedTask {
  title: string
  due_date: ISODate | null
  priority: PriorityLevel
  selected: boolean
}

/** Sábado/domingo seguem para a segunda-feira seguinte. */
function nextBusinessDay(iso: string): string {
  const dow = parseISODate(iso).getDay()
  if (dow === 6) return addDaysISO(iso, 2)
  if (dow === 0) return addDaysISO(iso, 1)
  return iso
}

export function suggestTasks(templates: TaskTemplate[], today: string): SuggestedTask[] {
  return templates
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((t) => ({
      title: t.title,
      due_date: t.offset_days == null ? null : nextBusinessDay(addDaysISO(today, t.offset_days)),
      priority: t.priority,
      selected: true,
    }))
}
