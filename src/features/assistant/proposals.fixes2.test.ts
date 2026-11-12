import { describe, expect, it } from 'vitest'
import { matchByName } from './proposals'

function candidatesOf(result: ReturnType<typeof matchByName>) {
  if ('id' in result) throw new Error(`esperava candidatos, veio o id ${result.id}`)
  return result.candidates
}

describe('matchByName — correspondência parcial', () => {
  it('não escolhe sozinha quando é apenas parcial, mesmo com um único candidato', () => {
    const result = matchByName('silva', [{ id: 'cli-3', name: 'Joana Silva' }])
    expect(candidatesOf(result)).toEqual([{ id: 'cli-3', name: 'Joana Silva' }])
  })

  it('continua escolhendo sozinha apenas na igualdade exata única', () => {
    const opcoes = [
      { id: 'parcial', name: 'Aposentadoria por idade' },
      { id: 'exato', name: 'Aposentadoria' },
    ]
    expect(matchByName('aposentadoria', opcoes)).toEqual({ id: 'exato' })
  })
})
