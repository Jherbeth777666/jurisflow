import { describe, expect, it } from 'vitest'
import {
  assistantPath,
  cpfDigitsFromQuery,
  loadRecents,
  matchesQuery,
  normalizeText,
  recentIdsByKind,
  recentKey,
  recentPath,
  saveRecent,
  type StorageLike,
} from './logic'

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('busca local', () => {
  it('normaliza acentos e caixa', () => {
    expect(normalizeText('  Salário-Maternidade ')).toBe('salario-maternidade')
  })
  it('todas as palavras precisam aparecer', () => {
    expect(matchesQuery('nova dem', 'Nova demanda')).toBe(true)
    expect(matchesQuery('relat', 'Ir para', 'Relatórios')).toBe(true)
    expect(matchesQuery('nova cliente', 'Nova demanda')).toBe(false)
    expect(matchesQuery('', 'qualquer')).toBe(true)
  })
  it('detecta consulta de CPF', () => {
    expect(cpfDigitsFromQuery('529.982')).toBe('529982')
    expect(cpfDigitsFromQuery('52998224725')).toBe('52998224725')
    expect(cpfDigitsFromQuery('12')).toBeNull()
    expect(cpfDigitsFromQuery('Maria 123')).toBeNull()
  })
  it('caminho do assistente codificado', () => {
    expect(assistantPath(' demandas paradas & tarefas ')).toBe('/assistente?q=demandas%20paradas%20%26%20tarefas')
  })
})

describe('recentes', () => {
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
  it('salva sem duplicar, mais recente primeiro, com limite', () => {
    const s = memory()
    for (let i = 0; i < 8; i++) saveRecent('org', { kind: 'cliente', id: id(i) }, s)
    saveRecent('org', { kind: 'cliente', id: id(3) }, s)
    const list = loadRecents('org', s)
    expect(list).toHaveLength(6)
    expect(list[0].id).toBe(id(3))
    expect(list.filter((r) => r.id === id(3))).toHaveLength(1)
  })
  it('guarda SÓ tipo + id (nunca nome de cliente) e isola por escritório', () => {
    const s = memory()
    saveRecent('a', { kind: 'cliente', id: id(1), label: 'Maria da Silva 529.982.247-25' } as never, s)
    expect(loadRecents('b', s)).toEqual([])
    const raw = s.data.get(recentKey('a'))!
    expect(raw).not.toMatch(/Maria|529/)
    expect(JSON.parse(raw)).toEqual([{ kind: 'cliente', id: id(1) }])
  })
  it('limpa recentes antigos que tinham rótulo (migração)', () => {
    const s = memory()
    s.setItem(recentKey('a'), JSON.stringify([{ kind: 'demanda', id: id(2), label: 'Ação de João', path: `/demandas/${id(2)}` }]))
    expect(loadRecents('a', s)).toEqual([{ kind: 'demanda', id: id(2) }])
    expect(s.data.get(recentKey('a'))).not.toMatch(/João/)
  })
  it('caminhos e agrupamento por tipo', () => {
    expect(recentPath({ kind: 'cliente', id: id(1) })).toBe(`/clientes/${id(1)}`)
    expect(recentPath({ kind: 'tarefa', id: id(2) })).toBe(`/tarefas?tarefa=${id(2)}`)
    expect(recentPath({ kind: 'pagina', id: '/relatorios' })).toBe('/relatorios')
    expect(recentIdsByKind([{ kind: 'cliente', id: id(1) }, { kind: 'pagina', id: '/' }, { kind: 'tarefa', id: id(2) }])).toEqual({
      cliente: [id(1)],
      demanda: [],
      tarefa: [id(2)],
    })
  })
  it('tolera dados corrompidos e armazenamento indisponível', () => {
    const s = memory()
    s.setItem(recentKey('x'), '{lixo')
    expect(loadRecents('x', s)).toEqual([])
    s.setItem(recentKey('x'), JSON.stringify([{ kind: 'cliente', id: 1 }, { kind: 'pagina', id: 'http://mal' }, { kind: 'cliente', id: '../x' }]))
    expect(loadRecents('x', s)).toEqual([])
    expect(loadRecents('x', null)).toEqual([])
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
    }
    expect(saveRecent('x', { kind: 'pagina', id: '/' }, throwing)).toHaveLength(1)
  })
})
