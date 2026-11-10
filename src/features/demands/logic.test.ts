import { describe, expect, it } from 'vitest'
import {
  OPEN_STATUSES,
  demandFormToPayload,
  hasActiveFilters,
  statusConstraint,
  isNextActionOverdue,
  parseDemandFilters,
  patchDemandFilters,
  serializeDemandFilters,
  stalledCutoff,
  validateDemandForm,
  type DemandFormValues,
} from './logic'

const parse = (qs: string) => parseDemandFilters(new URLSearchParams(qs))

describe('filtros de demandas (URL)', () => {
  it('padrão: abertas, sem filtros', () => {
    const f = parse('')
    expect(f.status).toBe('abertas')
    expect(hasActiveFilters(f)).toBe(false)
    expect(serializeDemandFilters(f).toString()).toBe('')
  })
  it('suporta links do dashboard', () => {
    expect(parse('status=concluida').status).toBe('concluida')
    expect(parse('status=todas').status).toBe('todas')
    expect(parse('status=xyz').status).toBe('abertas')
    expect(parse('waiting_docs=1').waitingDocs).toBe(true)
    expect(parse('stalled=15').stalled).toBe(15)
    expect(parse('stalled=-3').stalled).toBe(0)
    expect(parse('stalled=abc').stalled).toBe(0)
  })
  it('ignora etapa sem categoria e prioridade inválida', () => {
    expect(parse('stage=s1').stage).toBe('')
    expect(parse('category=c1&stage=s1').stage).toBe('s1')
    expect(parse('priority=altissima').priority).toBe('')
  })
  it('ida e volta preserva os filtros', () => {
    const qs = 'q=inss&category=c1&stage=s1&responsible=u1&priority=alta&status=todas&waiting_docs=1&stalled=20&page=2'
    expect(parse(serializeDemandFilters(parse(qs)).toString())).toEqual(parse(qs))
  })
  it('trocar categoria limpa a etapa; qualquer filtro volta à página 0', () => {
    const f = parse('category=c1&stage=s1&page=3')
    const next = patchDemandFilters(f, { category: 'c2' })
    expect(next.stage).toBe('')
    expect(next.page).toBe(0)
    expect(patchDemandFilters(f, { page: 4 }).page).toBe(4)
    expect(patchDemandFilters(f, { priority: 'alta' }).stage).toBe('s1')
  })
})

describe('regras de exibição', () => {
  it('status abertos excluem concluída/cancelada', () => {
    expect(OPEN_STATUSES).toEqual(['em_andamento', 'aguardando_cliente', 'suspensa'])
  })
  it('próxima atividade vencida só para demandas abertas', () => {
    expect(isNextActionOverdue({ next_action_date: '2026-11-08', status: 'em_andamento' }, '2026-11-09')).toBe(true)
    expect(isNextActionOverdue({ next_action_date: '2026-11-09', status: 'em_andamento' }, '2026-11-09')).toBe(false)
    expect(isNextActionOverdue({ next_action_date: '2026-11-08', status: 'concluida' }, '2026-11-09')).toBe(false)
    expect(isNextActionOverdue({ next_action_date: null, status: 'em_andamento' }, '2026-11-09')).toBe(false)
  })
  it('stalledCutoff: meia-noite local de (hoje - N + 1) — dias de calendário', () => {
    expect(stalledCutoff(15, new Date(2026, 10, 20, 8, 30))).toBe(new Date(2026, 10, 6).toISOString())
  })
})

describe('formulário de demanda', () => {
  const base: DemandFormValues = {
    client_id: 'c',
    category_id: 'k',
    stage_id: '',
    title: 'Aposentadoria por idade',
    description: '',
    responsible_id: '',
    opened_at: '2026-11-01',
    priority: 'media',
    status: 'em_andamento',
    next_action: '',
    next_action_date: '',
    notes: '',
  }
  it('valida obrigatórios', () => {
    expect(validateDemandForm(base, '2026-11-09')).toEqual({})
    const e = validateDemandForm({ ...base, client_id: '', category_id: '', title: ' ' }, '2026-11-09')
    expect(Object.keys(e).sort()).toEqual(['category_id', 'client_id', 'title'])
  })
  it('abertura futura e data de atividade sem descrição são inválidas', () => {
    expect(validateDemandForm({ ...base, opened_at: '2026-12-01' }, '2026-11-09').opened_at).toBeTruthy()
    expect(validateDemandForm({ ...base, next_action_date: '2026-11-20' }, '2026-11-09').next_action).toBeTruthy()
  })
  it('payload: vazios viram null e etapa vazia deixa o banco escolher a 1ª', () => {
    const p = demandFormToPayload({ ...base, title: '  X Y  ' })
    expect(p).toMatchObject({ stage_id: null, responsible_id: null, description: null, next_action_date: null, title: 'X Y' })
  })
})

describe('statusConstraint', () => {
  const base = parseDemandFilters(new URLSearchParams(''))
  it('status específico tem prioridade sobre os recortes de abertas', () => {
    expect(statusConstraint({ ...base, stalled: 15, status: 'concluida' })).toEqual({ eq: 'concluida', excludeClosed: false })
    expect(statusConstraint({ ...base, waitingDocs: true, status: 'cancelada' })).toEqual({ eq: 'cancelada', excludeClosed: false })
  })
  it('abertas/todas com atalhos excluem os status fechados', () => {
    expect(statusConstraint(base)).toEqual({ eq: null, excludeClosed: true })
    expect(statusConstraint({ ...base, status: 'todas' })).toEqual({ eq: null, excludeClosed: false })
    expect(statusConstraint({ ...base, status: 'todas', stalled: 15 })).toEqual({ eq: null, excludeClosed: true })
  })
  it('stalled + troca para Concluídas deixa de ser contraditória', () => {
    const f = patchDemandFilters({ ...base, stalled: 15 }, { status: 'concluida' })
    expect(statusConstraint(f)).toEqual({ eq: 'concluida', excludeClosed: false })
  })
})
