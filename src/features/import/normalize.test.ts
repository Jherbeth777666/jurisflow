import {
  excelSerialToISO,
  nameKey,
  normalizeBirthDate,
  normalizeClientStatus,
  normalizeCPF,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseDateBR,
  toTitleCaseName,
} from './normalize'

const TODAY = '2026-11-09'

describe('nomes', () => {
  it('Title Case respeitando partículas', () => {
    expect(toTitleCaseName('MARIA DA SILVA E SOUZA')).toBe('Maria da Silva e Souza')
    expect(toTitleCaseName('  joão   dos santos  ')).toBe('João dos Santos')
    expect(toTitleCaseName('DE OLIVEIRA ANA')).toBe('De Oliveira Ana')
    expect(toTitleCaseName('ana-clara d’ávila')).toBe('Ana-Clara D’Ávila')
    expect(toTitleCaseName('ÉRICA DAS NEVES')).toBe('Érica das Neves')
  })
  it('normalizeName valida vazio, tamanho e números', () => {
    expect(normalizeName('ana paula').value).toBe('Ana Paula')
    expect(normalizeName('').error).toMatch(/branco/)
    expect(normalizeName('a').error).toMatch(/curto/)
    expect(normalizeName('123.456.789-09').error).toMatch(/números/)
    expect(normalizeName('x'.repeat(161)).error).toMatch(/160/)
  })
  it('nameKey remove acentos e pontuação', () => {
    expect(nameKey('  José  D’Ávila-Souza ')).toBe('jose d avila souza')
  })
})

describe('CPF', () => {
  it('aceita com ou sem pontuação e valida dígitos', () => {
    expect(normalizeCPF('529.982.247-25').value).toBe('52998224725')
    expect(normalizeCPF('52998224725').value).toBe('52998224725')
    expect(normalizeCPF('529.982.247-26').error).toMatch(/inválido/)
    expect(normalizeCPF('111.111.111-11').error).toMatch(/inválido/)
    expect(normalizeCPF('1234').error).toMatch(/4 dígitos/)
  })
  it('vazio é permitido', () => {
    expect(normalizeCPF('')).toEqual({ value: null })
    expect(normalizeCPF(null)).toEqual({ value: null })
  })
  it('recupera zeros à esquerda perdidos pelo Excel', () => {
    // 012.345.678-90 é válido; o Excel transforma em 1234567890
    expect(normalizeCPF(1234567890).value).toBe('01234567890')
    expect(normalizeCPF('1234567890').value).toBe('01234567890')
  })
})

describe('telefone', () => {
  it('aceita formatos comuns e remove +55 / 0 de operadora', () => {
    expect(normalizePhone('(11) 98765-4321').value).toBe('11987654321')
    expect(normalizePhone('+55 11 98765 4321').value).toBe('11987654321')
    expect(normalizePhone('5511987654321').value).toBe('11987654321')
    expect(normalizePhone('011 3333-4444').value).toBe('1133334444')
    expect(normalizePhone('(84) 3222.1111').value).toBe('8432221111')
    expect(normalizePhone(11987654321).value).toBe('11987654321')
  })
  it('usa o primeiro número quando a célula tem vários', () => {
    expect(normalizePhone('(11) 98765-4321 / (11) 3333-4444').value).toBe('11987654321')
  })
  it('erros: sem DDD, tamanho errado, celular sem 9', () => {
    expect(normalizePhone('98765-4321').error).toMatch(/DDD/)
    expect(normalizePhone('123').error).toMatch(/inválido/)
    expect(normalizePhone('11 8765-43210').error).toMatch(/9/)
    expect(normalizePhone('').value).toBeNull()
  })
})

describe('e-mail', () => {
  it('minúsculo, sem espaços e validado', () => {
    expect(normalizeEmail(' Ana.Silva@Exemplo.COM ').value).toBe('ana.silva@exemplo.com')
    expect(normalizeEmail('mailto:x@y.com').value).toBe('x@y.com')
    expect(normalizeEmail('ana@').error).toBeTruthy()
    expect(normalizeEmail('').value).toBeNull()
  })
})

describe('datas', () => {
  it('dd/mm/aaaa, d/m/aa, dd-mm-aaaa, dd.mm.aaaa', () => {
    expect(parseDateBR('31/12/1990', TODAY).value).toBe('1990-12-31')
    expect(parseDateBR('1/2/85', TODAY).value).toBe('1985-02-01')
    expect(parseDateBR('05-03-24', TODAY).value).toBe('2024-03-05')
    expect(parseDateBR('05.03.1970', TODAY).value).toBe('1970-03-05')
    expect(parseDateBR('31121990', TODAY).value).toBe('1990-12-31')
  })
  it('ano de 2 dígitos no futuro vai para o século anterior', () => {
    expect(parseDateBR('01/01/30', TODAY).value).toBe('1930-01-01')
    expect(parseDateBR('01/01/26', TODAY).value).toBe('2026-01-01')
  })
  it('ISO e ISO com horário', () => {
    expect(parseDateBR('1990-12-31', TODAY).value).toBe('1990-12-31')
    expect(parseDateBR('1990-12-31T00:00:00', TODAY).value).toBe('1990-12-31')
  })
  it('número serial do Excel (número ou texto)', () => {
    expect(excelSerialToISO(1)).toBe('1899-12-31')
    expect(excelSerialToISO(33238)).toBe('1990-12-31')
    expect(parseDateBR(45658, TODAY).value).toBe('2025-01-01')
    expect(parseDateBR('33238', TODAY).value).toBe('1990-12-31')
  })
  it('Date do .xlsx (UTC)', () => {
    expect(parseDateBR(new Date(Date.UTC(1990, 11, 31)), TODAY).value).toBe('1990-12-31')
  })
  it('rejeita datas inexistentes e formatos desconhecidos', () => {
    expect(parseDateBR('31/02/1990', TODAY).error).toMatch(/inexistente/)
    expect(parseDateBR('29/02/2023', TODAY).error).toMatch(/inexistente/)
    expect(parseDateBR('29/02/2024', TODAY).value).toBe('2024-02-29')
    expect(parseDateBR('ontem', TODAY).error).toMatch(/formato/)
    expect(parseDateBR('', TODAY).value).toBeNull()
  })
  it('nascimento: entre 1900 e hoje', () => {
    expect(normalizeBirthDate('10/10/2030', TODAY).error).toMatch(/futuro/)
    expect(normalizeBirthDate('01/01/1890', TODAY).error).toMatch(/antiga/)
    expect(normalizeBirthDate('10/10/1980', TODAY).value).toBe('1980-10-10')
  })
})

describe('status do cliente', () => {
  it('reconhece variações', () => {
    expect(normalizeClientStatus('ATIVA').value).toBe('ativo')
    expect(normalizeClientStatus('Inativo').value).toBe('inativo')
    expect(normalizeClientStatus('Prospect').value).toBe('prospecto')
    expect(normalizeClientStatus('Arquivado').value).toBe('arquivado')
    expect(normalizeClientStatus('???').value).toBeNull()
  })
})
