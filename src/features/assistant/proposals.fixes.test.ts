import { describe, expect, it } from 'vitest'
import { matchByName } from './proposals'

describe('matchByName — homônimos', () => {
  it('devolve candidatos quando há mais de uma igualdade exata', () => {
    const opcoes = [
      { id: 'cli-1', name: 'José Silva' },
      { id: 'cli-2', name: 'JOSE SILVA' },
      { id: 'cli-3', name: 'José Silva Filho' },
    ]

    const result = matchByName('josé silva', opcoes)

    if ('id' in result) throw new Error(`esperava candidatos, veio o id ${result.id}`)
    expect(result.candidates.map((c) => c.id).sort()).toEqual(['cli-1', 'cli-2'])
  })

  it('continua escolhendo sozinho quando a igualdade exata é única', () => {
    const opcoes = [
      { id: 'parcial', name: 'José Silva Filho' },
      { id: 'exato', name: 'José Silva' },
    ]

    expect(matchByName('jose silva', opcoes)).toEqual({ id: 'exato' })
  })
})
