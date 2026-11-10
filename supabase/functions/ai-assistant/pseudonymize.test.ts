// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Pseudonymizer } from './pseudonymize.ts'

describe('Pseudonymizer', () => {
  it('troca nomes de clientes e responsáveis por tokens e restaura', () => {
    const p = new Pseudonymizer()
    const out = p.pseudonymizeValue({
      items: [
        { title: 'Benefício', client: 'Maria Souza', responsible: 'Bruno Lima' },
        { title: 'Aposentadoria', client: 'José Santos', responsible: 'Bruno Lima' },
      ],
    })
    expect(out.items[0]).toEqual({ title: 'Benefício', client: 'Cliente C1', responsible: 'Responsável R1' })
    expect(out.items[1]).toEqual({ title: 'Aposentadoria', client: 'Cliente C2', responsible: 'Responsável R1' })
    expect(JSON.stringify(out)).not.toMatch(/Maria|José|Bruno/)
    expect(p.restore('Cliente C1 e Cliente C2 estão com Responsável R1.')).toBe(
      'Maria Souza e José Santos estão com Bruno Lima.',
    )
  })

  it('nomes repetidos (com caixa/espaços diferentes) recebem o mesmo token', () => {
    const p = new Pseudonymizer()
    const out = p.pseudonymizeValue([{ client: 'Maria Souza' }, { client: ' maria  souza ' }, { client: 'MARIA SOUZA' }])
    expect(out.map((x) => x.client)).toEqual(['Cliente C1', 'Cliente C1', 'Cliente C1'])
    expect(p.tokenCount).toBe(1)
  })

  it('nome que é prefixo de outro não quebra a substituição', () => {
    const p = new Pseudonymizer({ clients: ['Ana', 'Ana Maria Costa'] })
    const text = p.pseudonymizeText('Ana Maria Costa ligou; Ana também. Anabela não é cliente.')
    expect(text).toBe('Cliente C1 ligou; Cliente C2 também. Anabela não é cliente.')
    expect(p.restore(text)).toBe('Ana Maria Costa ligou; Ana também. Anabela não é cliente.')
  })

  it('substitui nomes dentro de textos livres dos resultados (ex.: título da demanda)', () => {
    const p = new Pseudonymizer()
    const out = p.pseudonymizeValue({
      items: [
        { title: 'Salário-maternidade de Maria Souza', client: 'Maria Souza' },
        { demand: 'Revisão (Maria Souza)', assignee: 'Carla Dias' },
      ],
    })
    expect(JSON.stringify(out)).not.toContain('Maria')
    expect(out.items[0].title).toBe('Salário-maternidade de Cliente C1')
    expect(out.items[1].demand).toBe('Revisão (Cliente C1)')
  })

  it('tokens C1 e C10 são restaurados sem confusão', () => {
    const p = new Pseudonymizer()
    const names = Array.from({ length: 10 }, (_, i) => ({ client: `Cliente Real ${String.fromCharCode(65 + i)}xx` }))
    p.pseudonymizeValue(names)
    expect(p.restore('Cliente C1 e Cliente C10')).toBe('Cliente Real Axx e Cliente Real Jxx')
  })

  it('remove chaves sensíveis e ids antes do envio', () => {
    const p = new Pseudonymizer()
    const out = p.pseudonymizeValue({ id: 'x', cpf: '1', phone: '2', email: '3', notes: 'n', address: 'a', birth_date: 'b', total: 1 })
    expect(out).toEqual({ total: 1 })
  })

  it('pseudonimiza histórico com o dicionário (membros e clientes) e é case-insensitive', () => {
    const p = new Pseudonymizer({ clients: ['João Pereira'], members: ['Bruno Lima'] })
    expect(p.pseudonymizeText('o JOÃO PEREIRA falou com bruno lima')).toBe('o Cliente C1 falou com Responsável R1')
  })

  it('não altera tokens desconhecidos nem textos sem nomes', () => {
    const p = new Pseudonymizer({ clients: ['Maria Souza'] })
    expect(p.pseudonymizeText('Nada aqui')).toBe('Nada aqui')
    expect(p.restore('Cliente C99 não existe')).toBe('Cliente C99 não existe')
  })

  it('escapa caracteres especiais de regex nos nomes', () => {
    const p = new Pseudonymizer({ clients: ['M. (Teste) Silva*'] })
    expect(p.pseudonymizeText('cliente M. (Teste) Silva* chegou')).toBe('cliente Cliente C1 chegou')
  })
})
