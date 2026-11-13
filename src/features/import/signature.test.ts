import { headerSignature } from './signature'

// L14 — assinatura estável dos cabeçalhos para lembrar o mapeamento da planilha.
describe('headerSignature', () => {
  const base = ['Nome', 'CPF', 'Telefone', 'Tipo de ação']

  it('devolve 16 caracteres hexadecimais', () => {
    expect(headerSignature(base)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('é determinística', () => {
    expect(headerSignature(base)).toBe(headerSignature([...base]))
  })

  it('não depende da ordem das colunas', () => {
    expect(headerSignature(['Telefone', 'Tipo de ação', 'Nome', 'CPF'])).toBe(headerSignature(base))
  })

  it('ignora caixa, acentos, espaços nas pontas e espaços repetidos', () => {
    expect(headerSignature(['  NOME ', 'cpf', 'TELEFONE', 'tipo   de  AÇÃO'])).toBe(headerSignature(base))
  })

  it('ignora cabeçalhos vazios ou só com espaços', () => {
    expect(headerSignature([...base, '', '   '])).toBe(headerSignature(base))
  })

  it('cabeçalhos diferentes geram assinaturas diferentes', () => {
    expect(headerSignature(['Nome', 'CPF', 'E-mail'])).not.toBe(headerSignature(['Nome', 'CPF', 'Telefone']))
    expect(headerSignature(['Nome', 'CPF'])).not.toBe(headerSignature(['Nome', 'CPF', 'Telefone']))
  })

  it('o separador evita colisão trivial entre nomes colados', () => {
    expect(headerSignature(['ab', 'c'])).not.toBe(headerSignature(['a', 'bc']))
  })

  it('lista vazia continua gerando 16 caracteres hexadecimais', () => {
    expect(headerSignature([])).toMatch(/^[0-9a-f]{16}$/)
  })
})
