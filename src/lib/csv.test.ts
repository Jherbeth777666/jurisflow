import { csvFilename, decodeText, detectDelimiter, escapeCSVValue, parseCSV, toCSV } from './csv'

describe('detectDelimiter', () => {
  it('detecta ponto e vírgula, vírgula e tab', () => {
    expect(detectDelimiter('nome;cpf\nAna;123')).toBe(';')
    expect(detectDelimiter('nome,cpf\nAna,123')).toBe(',')
    expect(detectDelimiter('nome\tcpf\nAna\t123')).toBe('\t')
  })
  it('ignora separadores dentro de aspas', () => {
    expect(detectDelimiter('nome;obs\n"Silva, Ana";"a, b, c"\nJoão;x')).toBe(';')
  })
  it('prefere o separador consistente quando vírgula aparece em valores decimais', () => {
    expect(detectDelimiter('nome;valor;obs\nAna;1,50;x\nBia;2,00;y')).toBe(';')
  })
})

describe('parseCSV', () => {
  it('lê campos simples e remove BOM', () => {
    const r = parseCSV('﻿nome;cpf\nAna;123\n')
    expect(r.rows).toEqual([
      ['nome', 'cpf'],
      ['Ana', '123'],
    ])
    expect(r.delimiter).toBe(';')
  })
  it('trata aspas, aspas escapadas e quebras de linha dentro do campo', () => {
    const r = parseCSV('nome,obs\r\n"Silva, Ana","linha 1\nlinha 2 com ""aspas"""\r\nBia,ok')
    expect(r.rows).toEqual([
      ['nome', 'obs'],
      ['Silva, Ana', 'linha 1\nlinha 2 com "aspas"'],
      ['Bia', 'ok'],
    ])
  })
  it('descarta linhas vazias e mantém campos vazios', () => {
    const r = parseCSV('a;b;c\n\n1;;3\n;;\n')
    expect(r.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ])
  })
  it('respeita separador forçado e tab', () => {
    expect(parseCSV('a\tb\n1\t2').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCSV('a;b,c', { delimiter: ',' }).rows).toEqual([['a;b', 'c']])
  })
  it('decodifica UTF-8 com BOM a partir de bytes', () => {
    const bytes = new TextEncoder().encode('﻿nome;cidade\nJoão;São Paulo')
    const r = parseCSV(bytes)
    expect(r.encoding).toBe('utf-8')
    expect(r.rows[1]).toEqual(['João', 'São Paulo'])
  })
  it('cai para Windows-1252 quando os bytes não são UTF-8 (Excel antigo)', () => {
    // "João;Conceição" em Latin-1
    const bytes = new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f, 0x3b, 0x43, 0x6f, 0x6e, 0x63, 0x65, 0x69, 0xe7, 0xe3, 0x6f])
    const r = parseCSV(bytes.buffer)
    expect(r.encoding).toBe('windows-1252')
    expect(r.rows).toEqual([['João', 'Conceição']])
  })
  it('aceita arquivo sem quebra final e com CRLF', () => {
    expect(parseCSV('a;b\r\n1;2').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('decodeText', () => {
  it('Windows-1252 cobre aspas tipográficas (0x93/0x94)', () => {
    const r = decodeText(new Uint8Array([0x93, 0x41, 0x94]))
    expect(r.text).toBe('“A”')
  })
})

describe('escapeCSVValue / toCSV', () => {
  it('neutraliza fórmulas com apóstrofo', () => {
    expect(escapeCSVValue('=SOMA(A1)')).toBe("'=SOMA(A1)")
    expect(escapeCSVValue('+5511999')).toBe("'+5511999")
    expect(escapeCSVValue('-2+3')).toBe("'-2+3")
    expect(escapeCSVValue('@cmd')).toBe("'@cmd")
  })
  it('não altera números negativos de verdade nem texto comum', () => {
    expect(escapeCSVValue(-10.5)).toBe('-10,5')
    expect(escapeCSVValue('Ana')).toBe('Ana')
    expect(escapeCSVValue(null)).toBe('')
    expect(escapeCSVValue(true)).toBe('Sim')
  })
  it('coloca aspas quando há separador, aspas, quebra de linha ou espaço nas bordas', () => {
    expect(escapeCSVValue('a;b')).toBe('"a;b"')
    expect(escapeCSVValue('diz "oi"')).toBe('"diz ""oi"""')
    expect(escapeCSVValue('l1\nl2')).toBe('"l1\nl2"')
    expect(escapeCSVValue(' x')).toBe('" x"')
    expect(escapeCSVValue('=a;b')).toBe(`"'=a;b"`)
  })
  it('gera BOM, ponto e vírgula e CRLF', () => {
    const csv = toCSV([
      ['Nome', 'Obs'],
      ['Ana', 'a;b'],
    ])
    expect(csv).toBe('﻿Nome;Obs\r\nAna;"a;b"\r\n')
    expect(toCSV([['x']], { bom: false })).toBe('x\r\n')
  })
  it('ida e volta: toCSV → parseCSV preserva os valores', () => {
    const data = [
      ['Nome', 'Obs'],
      ['Silva; Ana', 'linha 1\nlinha 2 "x"'],
    ]
    expect(parseCSV(toCSV(data)).rows).toEqual(data)
  })
})

describe('csvFilename', () => {
  it('remove acentos/espaços e garante .csv', () => {
    expect(csvFilename('Clientes Inválidos 2026')).toBe('clientes-invalidos-2026.csv')
    expect(csvFilename('x.csv')).toBe('x.csv')
    expect(csvFilename('///')).toBe('exportacao.csv')
  })
})
