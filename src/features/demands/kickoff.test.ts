import { describe, expect, it } from 'vitest'
import type { PriorityLevel } from '@/types/database'
import { suggestTasks } from './kickoff'

// Datas calculadas à mão (calendário de 2026):
// - 09/11/2026 é uma SEGUNDA-feira.
// - 13/11/2026 é uma SEXTA-feira.
// - 31/12/2026 é uma QUINTA-feira (2026 não é bissexto).
// Regra: fim de semana (sábado/domingo) desloca para a segunda seguinte.

type TemplatesArg = Parameters<typeof suggestTasks>[0]

interface Suggestion {
  title: string
  due_date: string | null
  priority: PriorityLevel
  selected: boolean
}

function templates(list: {
  title: string
  offset_days: number | null
  priority: PriorityLevel
  position: number
}[]): TemplatesArg {
  return list.map((t) => ({
    title: t.title,
    offset_days: t.offset_days,
    priority: t.priority,
    position: t.position,
  })) as unknown as TemplatesArg
}

function runSuggest(list: TemplatesArg, today: string): Suggestion[] {
  return suggestTasks(list, today) as unknown as Suggestion[]
}

describe('suggestTasks', () => {
  it('soma o offset à data base, marca todas como selecionadas e respeita a ordem de position', () => {
    const out = suggestTasks(
      templates([
        { title: 'Sem data', offset_days: null, priority: 'baixa', position: 2 },
        { title: 'No dia', offset_days: 0, priority: 'media', position: 0 },
        { title: 'Dois dias', offset_days: 2, priority: 'alta', position: 1 },
        { title: 'Sete dias', offset_days: 7, priority: 'media', position: 3 },
      ]),
      '2026-11-09',
    )

    // 09/11 (seg) + 0 = 09/11 (seg)
    // 09/11 (seg) + 2 = 11/11 (qua)
    // sem offset = sem data
    // 09/11 (seg) + 7 = 16/11 (seg)
    expect(out.map((t) => t.title)).toEqual(['No dia', 'Dois dias', 'Sem data', 'Sete dias'])
    expect(out.map((t) => t.due_date)).toEqual(['2026-11-09', '2026-11-11', null, '2026-11-16'])
    expect(out.map((t) => t.priority)).toEqual(['media', 'alta', 'baixa', 'media'])
    expect(out.every((t) => t.selected)).toBe(true)
  })

  it('move sábado e domingo para a segunda seguinte', () => {
    // Base: 13/11/2026 (sexta).
    // +1 = 14/11 (sábado) → 16/11 (segunda)
    // +2 = 15/11 (domingo) → 16/11 (segunda)
    // +3 = 16/11 (segunda) → 16/11
    // +4 = 17/11 (terça) → 17/11
    const out = suggestTasks(
      templates([
        { title: 'Sábado', offset_days: 1, priority: 'media', position: 0 },
        { title: 'Domingo', offset_days: 2, priority: 'media', position: 1 },
        { title: 'Segunda', offset_days: 3, priority: 'media', position: 2 },
        { title: 'Terça', offset_days: 4, priority: 'media', position: 3 },
      ]),
      '2026-11-13',
    )

    expect(out.map((t) => t.due_date)).toEqual(['2026-11-16', '2026-11-16', '2026-11-16', '2026-11-17'])
  })

  it('mantém sem data quando offset_days é null, sem deslocamento', () => {
    const out = suggestTasks(
      templates([{ title: 'Lembrete sem prazo', offset_days: null, priority: 'urgente', position: 0 }]),
      '2026-11-09',
    )

    expect(out).toHaveLength(1)
    expect(out[0].due_date).toBeNull()
    expect(out[0].selected).toBe(true)
  })

  it('atravessa a virada do ano e desloca domingo para a segunda', () => {
    // Base: 31/12/2026 (quinta).
    // +1 = 01/01/2027 (sexta)
    // +3 = 03/01/2027 (domingo) → 04/01/2027 (segunda)
    const out = suggestTasks(
      templates([
        { title: 'Ano novo', offset_days: 1, priority: 'media', position: 0 },
        { title: 'Domingo de janeiro', offset_days: 3, priority: 'media', position: 1 },
      ]),
      '2026-12-31',
    )

    expect(out.map((t) => t.due_date)).toEqual(['2027-01-01', '2027-01-04'])
  })
})
