import { describe, expect, it } from 'vitest'
import { applyStageMove, filterBoard, groupByStage, moveInArray, type BoardDemand } from './board'

const base: BoardDemand = {
  id: 'd1',
  title: 'Aposentadoria por idade',
  client_id: 'c1',
  category_id: 'cat',
  stage_id: 's1',
  responsible_id: 'u1',
  priority: 'media',
  status: 'em_andamento',
  next_action: null,
  next_action_date: null,
  stage_changed_at: '2026-11-01T10:00:00Z',
  closed_at: null,
  client: { full_name: 'Maria José' },
}
const NOW = '2026-11-09T12:00:00Z'

describe('applyStageMove', () => {
  it('não altera se a etapa é a mesma', () => {
    expect(applyStageMove(base, { id: 's1', is_final: false }, NOW)).toBe(base)
  })
  it('atualiza etapa e data de mudança', () => {
    const r = applyStageMove(base, { id: 's2', is_final: false }, NOW)
    expect(r).toMatchObject({ stage_id: 's2', stage_changed_at: NOW, status: 'em_andamento' })
  })
  it('etapa final conclui a demanda', () => {
    const r = applyStageMove(base, { id: 'sf', is_final: true }, NOW)
    expect(r).toMatchObject({ status: 'concluida', closed_at: NOW })
  })
  it('sair da etapa final reabre', () => {
    const done = { ...base, stage_id: 'sf', status: 'concluida' as const, closed_at: NOW }
    expect(applyStageMove(done, { id: 's1', is_final: false }, NOW)).toMatchObject({ status: 'em_andamento', closed_at: null })
  })
  it('mantém status aguardando cliente fora da etapa final', () => {
    const w = { ...base, status: 'aguardando_cliente' as const }
    expect(applyStageMove(w, { id: 's2', is_final: false }, NOW).status).toBe('aguardando_cliente')
  })
})

describe('groupByStage', () => {
  it('ordena por prioridade, tempo parado e põe concluídas no fim', () => {
    const items: BoardDemand[] = [
      { ...base, id: 'a', priority: 'baixa' },
      { ...base, id: 'b', priority: 'urgente' },
      { ...base, id: 'c', priority: 'baixa', stage_changed_at: '2026-10-01T00:00:00Z' },
      { ...base, id: 'd', status: 'concluida', closed_at: NOW, priority: 'urgente' },
      { ...base, id: 'e', stage_id: null },
      { ...base, id: 'f', stage_id: 'outra' },
    ]
    const g = groupByStage(items, [{ id: 's1' }, { id: 's2' }])
    expect(g.get('s1')!.map((d) => d.id)).toEqual(['b', 'e', 'f', 'c', 'a', 'd'])
    expect(g.get('s2')).toEqual([])
  })
})

describe('filterBoard', () => {
  const items: BoardDemand[] = [
    base,
    { ...base, id: 'd2', responsible_id: null, priority: 'alta', title: 'Revisão', client: { full_name: 'João' } },
  ]
  it('filtra por responsável, prioridade e busca sem acento', () => {
    expect(filterBoard(items, { responsible: 'u1', priority: '', search: '' }).map((d) => d.id)).toEqual(['d1'])
    expect(filterBoard(items, { responsible: 'none', priority: '', search: '' }).map((d) => d.id)).toEqual(['d2'])
    expect(filterBoard(items, { responsible: '', priority: 'alta', search: '' }).map((d) => d.id)).toEqual(['d2'])
    expect(filterBoard(items, { responsible: '', priority: '', search: 'maria jose' }).map((d) => d.id)).toEqual(['d1'])
    expect(filterBoard(items, { responsible: '', priority: '', search: 'REVISAO' }).map((d) => d.id)).toEqual(['d2'])
  })
})

describe('moveInArray', () => {
  it('move itens e ignora índices inválidos', () => {
    expect(moveInArray(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveInArray(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    const arr = ['a']
    expect(moveInArray(arr, 0, 1)).toBe(arr)
  })
})
