import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VariableEditor, type VariableEditorHandle } from './VariableEditor'

describe('VariableEditor', () => {
  it('mostra etiquetas com rótulo humano e sem "{{" visível', () => {
    const { container } = render(
      <VariableEditor value="Olá {{primeiro_nome}}, etapa {{etapa}}." onChange={() => {}} label="Texto" />,
    )
    const box = screen.getByRole('textbox', { name: 'Texto' })
    expect(box).toHaveAttribute('aria-multiline', 'true')
    expect(box.textContent).toContain('Primeiro nome do cliente')
    expect(box.textContent).toContain('Etapa atual da demanda')
    expect(box.textContent).not.toContain('{{')
    const tag = container.querySelector('[data-var="primeiro_nome"]')
    expect(tag).not.toBeNull()
    expect(tag).toHaveAttribute('contenteditable', 'false')
  })

  it('singleLine desliga aria-multiline e erro marca aria-invalid', () => {
    render(<VariableEditor value="" onChange={() => {}} label="Assunto" singleLine error="Algo errado" />)
    const box = screen.getByRole('textbox', { name: 'Assunto' })
    expect(box).toHaveAttribute('aria-multiline', 'false')
    expect(box).toHaveAttribute('aria-invalid', 'true')
  })

  it('variável desconhecida mostra "Variável desconhecida"', () => {
    render(<VariableEditor value="Oi {{xyz}}" onChange={() => {}} label="Texto" />)
    expect(screen.getByText(/Variável desconhecida/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Texto' }).textContent).not.toContain('{{')
  })

  it('ref.insertVariable adiciona o token e chama onChange', () => {
    const onChange = vi.fn()
    const ref = createRef<VariableEditorHandle>()
    render(<VariableEditor ref={ref} value="" onChange={onChange} label="Texto" />)
    ref.current!.insertVariable('etapa')
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('{{etapa}}'))
    expect(onChange.mock.calls.at(-1)![0]).toBe('{{etapa}}')
  })

  it('ref.insertVariable sem seleção insere no fim', () => {
    const onChange = vi.fn()
    const ref = createRef<VariableEditorHandle>()
    render(<VariableEditor ref={ref} value="Oi " onChange={onChange} label="Texto" />)
    ref.current!.insertVariable('etapa')
    expect(onChange.mock.calls.at(-1)![0]).toBe('Oi {{etapa}}')
  })

  it('"Ver como texto" mostra textarea com o texto bruto; editar chama onChange; volta com "Ver com etiquetas"', () => {
    const onChange = vi.fn()
    render(<VariableEditor value="Oi {{primeiro_nome}}" onChange={onChange} label="Texto" />)
    fireEvent.click(screen.getByRole('button', { name: 'Ver como texto' }))
    const ta = screen.getByRole('textbox', { name: 'Texto' }) as HTMLTextAreaElement
    expect(ta.tagName).toBe('TEXTAREA')
    expect(ta.value).toBe('Oi {{primeiro_nome}}')
    fireEvent.change(ta, { target: { value: 'Oi {{primeiro_nome}} tudo bem' } })
    expect(onChange).toHaveBeenCalledWith('Oi {{primeiro_nome}} tudo bem')
    fireEvent.click(screen.getByRole('button', { name: 'Ver com etiquetas' }))
    expect(screen.getByRole('textbox', { name: 'Texto' }).tagName).not.toBe('TEXTAREA')
  })

  it('mode compose: etiqueta "Falta: ..." abre o campo, Aplicar chama onChange com o valor no lugar do token', () => {
    const onChange = vi.fn()
    render(<VariableEditor mode="compose" value="Sua etapa é {{etapa}}." onChange={onChange} label="Mensagem" />)
    fireEvent.click(screen.getByRole('button', { name: 'Falta: Etapa atual da demanda' }))
    fireEvent.change(screen.getByLabelText('Preencher Etapa atual da demanda'), { target: { value: 'Perícia' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(onChange).toHaveBeenCalledWith('Sua etapa é Perícia.')
  })

  it('mode compose: valor com chaves não reintroduz variável', () => {
    const onChange = vi.fn()
    render(<VariableEditor mode="compose" value="{{etapa}}" onChange={onChange} label="Mensagem" />)
    fireEvent.click(screen.getByRole('button', { name: 'Falta: Etapa atual da demanda' }))
    fireEvent.change(screen.getByLabelText('Preencher Etapa atual da demanda'), { target: { value: '{{x}}ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }))
    expect(onChange.mock.calls.at(-1)![0]).not.toMatch(/[{}]/)
  })
})
