import { describe, expect, it } from 'vitest'
import { mappingFromHeaders, mappingToHeaders } from './signature'

describe('mapeamento por nome de cabeçalho', () => {
  it('sobrevive à troca de ordem das colunas', () => {
    const saved = mappingToHeaders({ full_name: 0, phone: 1, category: 2 }, ['Nome', 'Telefone', 'Categoria'])
    expect(mappingFromHeaders(saved, ['categoria', '  NOME ', 'telefone'])).toEqual({ full_name: 1, phone: 2, category: 0 })
  })

  it('não reaproveita se faltar uma coluna', () => {
    const saved = mappingToHeaders({ full_name: 0, phone: 1 }, ['Nome', 'Telefone'])
    expect(mappingFromHeaders(saved, ['Nome', 'Celular'])).toBeNull()
  })

  it('ignora formato inválido', () => {
    expect(mappingFromHeaders({ full_name: 3 }, ['Nome'])).toBeNull()
    expect(mappingFromHeaders(null, ['Nome'])).toBeNull()
  })
})
