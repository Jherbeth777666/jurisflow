import { describe, expect, it } from 'vitest'
import { assistantPath, cpfDigitsFromQuery, loadRecents, matchesQuery, normalizeText, recentKey, saveRecent, type StorageLike } from './logic'

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
  it('salva sem duplicar, mais recente primeiro, com limite', () => {
    const s = memory()
    for (let i = 0; i < 8; i++) saveRecent('org', { kind: 'cliente', id: `c${i}`, label: `Cliente ${i}`, path: `/clientes/c${i}` }, s)
    saveRecent('org', { kind: 'cliente', id: 'c3', label: 'Cliente 3', path: '/clientes/c3' }, s)
    const list = loadRecents('org', s)
    expect(list).toHaveLength(6)
    expect(list[0].id).toBe('c3')
    expect(list.filter((r) => r.id === 'c3')).toHaveLength(1)
  })
  it('isola por escritório e nunca guarda CPF', () => {
    const s = memory()
    saveRecent('a', { kind: 'cliente', id: '1', label: 'Maria 529.982.247-25', path: '/clientes/1' }, s)
    expect(loadRecents('b', s)).toEqual([])
    expect(s.data.get(recentKey('a'))).not.toMatch(/529/)
    expect(loadRecents('a', s)[0].label).toBe('Maria')
  })
  it('tolera dados corrompidos e armazenamento indisponível', () => {
    const s = memory()
    s.setItem(recentKey('x'), '{lixo')
    expect(loadRecents('x', s)).toEqual([])
    s.setItem(recentKey('x'), JSON.stringify([{ kind: 'cliente', id: 1 }, { kind: 'pagina', id: 'p', label: 'P', path: 'http://mal' }]))
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
    expect(saveRecent('x', { kind: 'pagina', id: '/', label: 'Início', path: '/' }, throwing)).toHaveLength(1)
  })
})
