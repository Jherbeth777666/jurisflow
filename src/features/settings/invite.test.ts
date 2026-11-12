import { describe, expect, it } from 'vitest'
import { inviteLink, inviteStatusLabel, whatsappInviteText } from './invite'

const TOKEN = '11111111-1111-4111-8111-111111111111'

describe('inviteLink', () => {
  it('monta o link de cadastro com o token do convite', () => {
    expect(inviteLink('https://app.jurisflow.com.br', TOKEN)).toBe(
      `https://app.jurisflow.com.br/cadastro?convite=${TOKEN}`,
    )
  })

  it('preserva a origem recebida (inclusive porta)', () => {
    expect(inviteLink('http://localhost:5173', TOKEN)).toBe(
      `http://localhost:5173/cadastro?convite=${TOKEN}`,
    )
  })
})

describe('whatsappInviteText', () => {
  it('escreve o texto curto com o nome do escritório e o link', () => {
    const link = 'https://app.jurisflow.com.br/cadastro?convite=abc'
    expect(whatsappInviteText('Silva Advocacia', link)).toBe(
      'Você foi convidado(a) para o escritório Silva Advocacia no JurisFlow. Crie sua conta com este e-mail: https://app.jurisflow.com.br/cadastro?convite=abc',
    )
  })
})

describe('inviteStatusLabel', () => {
  // Contas à mão:
  //   referência: 12/11/2026 12:00 UTC
  //   validade de 14 dias: 12/11 + 14 = 26/11/2026 12:00 UTC
  //   regra do banco é expires_at > now(), então exatamente no instante
  //   de expiração (26/11 12:00) o convite já está expirado.
  const now = '2026-11-12T12:00:00.000Z'
  const in14Days = '2026-11-26T12:00:00.000Z'

  it('convite dentro do prazo é Pendente', () => {
    expect(inviteStatusLabel(in14Days, null, now)).toBe('Pendente')
  })

  it('um segundo antes do vencimento ainda é Pendente', () => {
    expect(inviteStatusLabel('2026-11-26T11:59:59.000Z', null, now)).toBe('Pendente')
  })

  it('exatamente no instante do vencimento é Expirado', () => {
    expect(inviteStatusLabel(in14Days, null, in14Days)).toBe('Expirado')
  })

  it('depois do vencimento é Expirado', () => {
    expect(inviteStatusLabel('2026-11-26T12:00:01.000Z', null, in14Days)).toBe('Expirado')
  })

  it('convite aceito é Aceito mesmo que a data de validade já tenha passado', () => {
    // Aceito em 13/11; validade era 26/11; consulta em 01/12 (depois da validade).
    expect(inviteStatusLabel(in14Days, '2026-11-13T09:00:00.000Z', '2026-12-01T12:00:00.000Z')).toBe('Aceito')
  })

  it('convite aceito dentro do prazo é Aceito', () => {
    expect(inviteStatusLabel(in14Days, '2026-11-13T09:00:00.000Z', now)).toBe('Aceito')
  })
})
