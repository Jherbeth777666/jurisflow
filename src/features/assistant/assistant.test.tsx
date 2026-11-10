import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Markdown, parseInline, parseMarkdown } from './markdown'
import { mapAssistantError } from './api'
import { containsPersonalData } from './constants'

describe('parseMarkdown', () => {
  it('reconhece listas, tabelas, títulos e parágrafos com quebras', () => {
    const blocks = parseMarkdown(
      [
        '## Resumo',
        'Linha 1',
        'Linha 2',
        '',
        '- item **a**',
        '- item b',
        '',
        '1. primeiro',
        '2. segundo',
        '',
        '| Categoria | Qtd |',
        '|---|---:|',
        '| SM | 3 |',
        '| Aposentadoria | 1 |',
      ].join('\n'),
    )
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'ul', 'ol', 'table'])
    const table = blocks[4] as Extract<(typeof blocks)[number], { type: 'table' }>
    expect(table.rows).toHaveLength(2)
    expect(table.header[0][0].text).toBe('Categoria')
  })

  it('inline: negrito, itálico e código', () => {
    expect(parseInline('a **b** *c* `d` 2*3*4')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', text: 'b' },
      { type: 'text', text: ' ' },
      { type: 'italic', text: 'c' },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' 2*3*4' },
    ])
  })
})

describe('<Markdown>', () => {
  it('renderiza elementos React e nunca injeta HTML', () => {
    const { container } = render(
      <Markdown text={'**Total:** 3\n<img src=x onerror="alert(1)"><script>alert(1)</script>\n- [link](javascript:alert(1))'} />,
    )
    expect(screen.getByText('Total:').tagName).toBe('STRONG')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  it('renderiza tabela simples', () => {
    const { container } = render(<Markdown text={'| A | B |\n|---|---|\n| 1 | 2 |'} />)
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')).toHaveLength(2)
  })
})

describe('mapAssistantError', () => {
  it('503 → não configurado; 429 → limite; 502 mantém a conversa', () => {
    expect(mapAssistantError(503, { code: 'not_configured' }).kind).toBe('not_configured')
    expect(mapAssistantError(503, { code: 'not_configured' }).message).toBe('Assistente não configurado — veja o README.')
    expect(mapAssistantError(503, { code: 'provider_busy' }).kind).toBe('provider_busy')
    expect(mapAssistantError(429, { error: 'Limite de 30 mensagens' })).toMatchObject({ kind: 'rate_limited', message: 'Limite de 30 mensagens' })
    expect(mapAssistantError(502, { conversation_id: 'c1' })).toMatchObject({ kind: 'provider', conversationId: 'c1' })
    expect(mapAssistantError(401, null).kind).toBe('auth')
  })
})

describe('containsPersonalData', () => {
  it('detecta CPF, telefone e e-mail para avisar o usuário', () => {
    expect(containsPersonalData('cpf 529.982.247-25')).toBe(true)
    expect(containsPersonalData('tel (11) 98765-4321')).toBe(true)
    expect(containsPersonalData('a@b.com')).toBe(true)
    expect(containsPersonalData('Quantas demandas em 2026?')).toBe(false)
  })
})
