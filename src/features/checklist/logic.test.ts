import { describe, expect, it } from 'vitest'
import { checklistProgress, moveItem, nextStageAfter, pendingLabels, validateLabel } from './logic'

describe('checklist', () => {
  it('progresso', () => {
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, percent: 0, complete: false })
    expect(checklistProgress([{ done: true }, { done: false }, { done: true }])).toEqual({
      done: 2,
      total: 3,
      percent: 67,
      complete: false,
    })
    expect(checklistProgress([{ done: true }]).complete).toBe(true)
  })
  it('valida rótulos (vazio, tamanho, duplicado sem diferenciar caixa/espaços)', () => {
    const ex = [{ id: '1', label: 'Extrato CNIS' }]
    expect(validateLabel('  ', ex).ok).toBe(false)
    expect(validateLabel('x'.repeat(161), ex).ok).toBe(false)
    expect(validateLabel(' extrato   cnis ', ex).ok).toBe(false)
    expect(validateLabel('Extrato CNIS atualizado', ex)).toEqual({ ok: true, label: 'Extrato CNIS atualizado' })
    expect(validateLabel('extrato cnis', ex, '1')).toEqual({ ok: true, label: 'extrato cnis' })
  })
  it('move itens', () => {
    const l = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(moveItem(l, 'b', -1)?.map((i) => i.id)).toEqual(['b', 'a', 'c'])
    expect(moveItem(l, 'b', 1)?.map((i) => i.id)).toEqual(['a', 'c', 'b'])
    expect(moveItem(l, 'a', -1)).toBeNull()
    expect(moveItem(l, 'c', 1)).toBeNull()
    expect(moveItem(l, 'z', 1)).toBeNull()
  })
  it('pendências ordenadas por posição', () => {
    expect(
      pendingLabels([
        { label: 'B', done: false, position: 2 },
        { label: 'A', done: false, position: 1 },
        { label: 'C', done: true, position: 0 },
      ]),
    ).toEqual(['A', 'B'])
  })
})

describe('nextStageAfter', () => {
  const stages = [
    { id: 'c', position: 3 },
    { id: 'a', position: 1 },
    { id: 'b', position: 2 },
  ]
  it('devolve a etapa de posição imediatamente maior, independente da ordem do array', () => {
    expect(nextStageAfter(stages, 'a')?.id).toBe('b')
    expect(nextStageAfter(stages, 'b')?.id).toBe('c')
  })
  it('na última etapa não há próxima (nunca retrocede)', () => {
    expect(nextStageAfter(stages, 'c')).toBeUndefined()
  })
  it('sem etapa atual conhecida não sugere nada', () => {
    expect(nextStageAfter(stages, null)).toBeUndefined()
    expect(nextStageAfter(stages, 'x')).toBeUndefined()
  })
})
