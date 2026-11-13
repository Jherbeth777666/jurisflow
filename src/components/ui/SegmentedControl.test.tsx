import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SegmentedControl } from './SegmentedControl'

type Scope = 'mine' | 'all'

const items: { value: Scope; label: string }[] = [
  { value: 'mine', label: 'Minhas' },
  { value: 'all', label: 'Todos' },
]

describe('<SegmentedControl>', () => {
  it('expõe um grupo acessível e marca a opção ativa com aria-pressed', () => {
    render(<SegmentedControl<Scope> aria-label="Filtrar por responsável" value="mine" onChange={() => {}} items={items} />)

    expect(screen.getByRole('group', { name: 'Filtrar por responsável' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minhas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('chama onChange com o valor da opção clicada', () => {
    const onChange = vi.fn()
    render(<SegmentedControl<Scope> aria-label="Filtrar por responsável" value="mine" onChange={onChange} items={items} />)

    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('all')
  })

  it('cite uma opção com valor único sem quebrar', () => {
    const onChange = vi.fn()
    render(<SegmentedControl aria-label="Escopo" value="all" onChange={onChange} items={[{ value: 'all', label: 'Tudo' }]} />)

    expect(screen.getByRole('button', { name: 'Tudo' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Tudo' }))
    expect(onChange).toHaveBeenCalledWith('all')
  })
})
