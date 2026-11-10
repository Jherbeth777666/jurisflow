import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Tabs } from './Tabs'
import { tabPanelProps } from './tabIds'

function Demo() {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a')
  return (
    <>
      <Tabs value={v} onChange={setV} idPrefix="t" items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]} />
      <div {...tabPanelProps('t', v)}>painel {v}</div>
    </>
  )
}

describe('Tabs', () => {
  it('setas, Home e End mudam a aba e o foco; aria-controls aponta para o painel', () => {
    render(<Demo />)
    const a = screen.getByRole('tab', { name: 'A' })
    expect(a).toHaveAttribute('aria-controls', 't-panel-a')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 't-tab-a')
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'B' }))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'C' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('tabindex', '-1')
  })
})
