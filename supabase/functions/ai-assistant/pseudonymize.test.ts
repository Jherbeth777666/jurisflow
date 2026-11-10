// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Pseudonymizer, nameCandidates } from './pseudonymize.ts'

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

describe('Pseudonymizer — acentos, primeiros nomes e limites de palavra', () => {
  it('"João" e "Joao" (e caixa diferente) são o mesmo nome, nas duas pontas', () => {
    const p = new Pseudonymizer({ clients: ['João Pedro Alves'] })
    expect(p.pseudonymizeText('fale do Joao Pedro Alves e do JOÃO PEDRO ALVES')).toBe('fale do Cliente C1 e do Cliente C1')
    const q = new Pseudonymizer({ clients: ['Joao Pedro Alves'] })
    expect(q.pseudonymizeText('e o João Pedro Alves?')).toBe('e o Cliente C1?')
    expect(q.restore('Cliente C1')).toBe('Joao Pedro Alves')
  })

  it('texto com acentos decompostos (NFD) também é reconhecido', () => {
    const p = new Pseudonymizer({ clients: ['José Souza'] })
    expect(p.pseudonymizeText('cliente José Souza ligou')).toBe('cliente Cliente C1 ligou')
  })

  it('só o primeiro nome (único) recebe o mesmo token do nome completo', () => {
    const p = new Pseudonymizer({ clients: ['Joana Segredo', 'João Pedro Alves'] })
    const out = p.pseudonymizeText('A Joana ligou; o joao também. Joana Segredo confirmou.')
    expect(out).toBe('A Cliente C1 ligou; o Cliente C2 também. Cliente C1 confirmou.')
    expect(p.restore(out)).toBe('A Joana Segredo ligou; o João Pedro Alves também. Joana Segredo confirmou.')
  })

  it('primeiro nome ambíguo ganha token próprio e é restaurado como o primeiro nome', () => {
    const p = new Pseudonymizer({ clients: ['Maria Souza', 'Maria Lima'] })
    const out = p.pseudonymizeText('A Maria pediu prazo')
    expect(out).toBe('A Cliente C1 pediu prazo')
    expect(p.restore(out)).toBe('A Maria pediu prazo')
    expect(p.pseudonymizeText('Maria Lima')).toBe('Cliente C2')
  })

  it('nomes prefixo de outros: "Ana" não casa dentro de "Mariana"', () => {
    const p = new Pseudonymizer({ clients: ['Ana Costa', 'Mariana Dias'] })
    expect(p.pseudonymizeText('Mariana e Ana vieram; Anabela não')).toBe('Cliente C1 e Cliente C2 vieram; Anabela não')
    expect(p.restore('Cliente C1 e Cliente C2')).toBe('Mariana Dias e Ana Costa')
  })

  it('palavras da stoplist e nomes de categoria/etapa não viram apelido', () => {
    const p = new Pseudonymizer({
      clients: ['Rosa Andrade', 'Cliente Teste Silva', 'Aposentadoria Fulano'],
      members: ['Dra. Paula Reis'],
      stopwords: ['Perícia agendada', 'Revisão'],
    })
    expect(p.pseudonymizeText('rosa, cliente, aposentadoria, perícia agendada')).toBe('rosa, cliente, aposentadoria, perícia agendada')
    expect(p.pseudonymizeText('fale com a Paula')).toBe('fale com a Responsável R1')
    expect(p.restore('Responsável R1')).toBe('Dra. Paula Reis')
  })

  it('nome fora do dicionário inicial é coberto quando registrado depois (busca de citados)', () => {
    const p = new Pseudonymizer({ clients: Array.from({ length: 3000 }, (_, i) => `Pessoa Recente ${i}`) })
    expect(p.pseudonymizeText('Cadê a Zuleica Prado?')).toBe('Cadê a Zuleica Prado?')
    p.register('Zuleica Prado', 'client')
    expect(p.pseudonymizeText('Cadê a Zuleica Prado? E a zuleica?')).toBe('Cadê a Cliente C1? E a Cliente C1?')
  })
})

describe('nameCandidates', () => {
  it('extrai palavras candidatas sem acento, priorizando capitalizadas e sem stoplist', () => {
    expect(nameCandidates(['quais demandas da Joana e do joão estão paradas?'])).toEqual(['joana', 'joao', 'estao', 'paradas'])
  })
})
