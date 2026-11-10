import { describe, expect, it } from 'vitest'
import {
  buildServiceHistory,
  clientFormToPayload,
  emptyClientForm,
  parseClientSearch,
  validateClientField,
  validateClientForm,
  type ClientFormValues,
} from './logic'

const form = (patch: Partial<ClientFormValues> = {}): ClientFormValues => ({ ...emptyClientForm, full_name: 'Maria da Silva', ...patch })

describe('parseClientSearch', () => {
  it('vazio → null', () => {
    expect(parseClientSearch('   ')).toBeNull()
  })
  it('termo numérico/pontuado busca por dígitos do CPF', () => {
    expect(parseClientSearch('123.456')).toEqual({ kind: 'cpf', digits: '123456' })
    expect(parseClientSearch(' 529.982.247-25 ')).toEqual({ kind: 'cpf', digits: '52998224725' })
  })
  it('texto busca no nome com curingas escapados', () => {
    expect(parseClientSearch('Maria')).toEqual({ kind: 'name', pattern: '%Maria%' })
    expect(parseClientSearch('50%_x')).toEqual({ kind: 'name', pattern: '%50\\%\\_x%' })
    expect(parseClientSearch('Silva, (Ana)')).toEqual({ kind: 'name', pattern: '%Silva   Ana %' })
  })
  it('pontuação sem dígitos cai para nome', () => {
    expect(parseClientSearch('.-')?.kind).toBe('name')
  })
})

describe('validação do formulário de cliente', () => {
  const today = '2026-11-09'
  it('exige nome', () => {
    expect(validateClientForm(form({ full_name: ' ' }), today).full_name).toBeTruthy()
    expect(validateClientForm(form({ full_name: 'A' }), today).full_name).toBe('Nome muito curto.')
  })
  it('campos opcionais vazios são válidos', () => {
    expect(validateClientForm(form(), today)).toEqual({})
  })
  it('valida CPF, telefone e e-mail quando informados', () => {
    expect(validateClientField('cpf', form({ cpf: '11111111111' }), today)).toBeTruthy()
    expect(validateClientField('cpf', form({ cpf: '529.982.247-25' }), today)).toBeUndefined()
    expect(validateClientField('phone', form({ phone: '1199' }), today)).toBeTruthy()
    expect(validateClientField('phone', form({ phone: '(11) 98765-4321' }), today)).toBeUndefined()
    expect(validateClientField('email', form({ email: 'x@' }), today)).toBeTruthy()
  })
  it('nascimento não pode ser futuro nem anterior a 1900', () => {
    expect(validateClientField('birth_date', form({ birth_date: '2026-11-10' }), today)).toBeTruthy()
    expect(validateClientField('birth_date', form({ birth_date: '1899-12-31' }), today)).toBeTruthy()
    expect(validateClientField('birth_date', form({ birth_date: '1990-05-01' }), today)).toBeUndefined()
  })
})

describe('clientFormToPayload', () => {
  it('grava CPF/telefone só com dígitos e vazios como null', () => {
    const p = clientFormToPayload(form({ full_name: '  Maria   da  Silva ', cpf: '529.982.247-25', phone: '(11) 98765-4321', email: ' A@B.COM ' }))
    expect(p).toMatchObject({ full_name: 'Maria da Silva', cpf: '52998224725', phone: '11987654321', email: 'a@b.com' })
    expect(p.address).toBeNull()
    expect(p.notes).toBeNull()
    expect(p.birth_date).toBeNull()
  })
})

describe('buildServiceHistory', () => {
  it('lista aberturas e encerramentos do mais recente para o mais antigo', () => {
    const ev = buildServiceHistory([
      { id: 'a', title: 'A', opened_at: '2026-01-10', closed_at: '2026-03-01T12:00:00+00:00', status: 'concluida', created_at: '' },
      { id: 'b', title: 'B', opened_at: '2026-02-05', closed_at: null, status: 'em_andamento', created_at: '' },
      { id: 'c', title: 'C', opened_at: '2026-04-01', closed_at: '2026-04-02T10:00:00+00:00', status: 'cancelada', created_at: '' },
    ])
    expect(ev.map((e) => `${e.demandId}:${e.kind}`)).toEqual(['c:cancelled', 'c:opened', 'a:concluded', 'b:opened', 'a:opened'])
  })
  it('ignora closed_at de demanda reaberta', () => {
    const ev = buildServiceHistory([{ id: 'a', title: 'A', opened_at: '2026-01-10', closed_at: '2026-03-01T12:00:00Z', status: 'em_andamento', created_at: '' }])
    expect(ev).toHaveLength(1)
  })
})
