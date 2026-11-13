import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TaskRowItem } from './TaskRow'
import type { TaskRow } from './api'

const task = (status: string) =>
  ({ id: 't1', title: 'Preparar procuração', status, priority: 'media', due_date: null, client: null, demand: null }) as unknown as TaskRow

function setup(status: string) {
  const onToggle = vi.fn()
  render(
    <MemoryRouter>
      <ul>
        <TaskRowItem task={task(status)} assigneeName={null} onToggle={onToggle} onEdit={() => {}} today="2026-11-13" />
      </ul>
    </MemoryRouter>,
  )
  return onToggle
}

describe('TaskRowItem — concluir pede confirmação', () => {
  it('marcar a caixa abre a confirmação e só conclui ao confirmar', async () => {
    const onToggle = setup('pendente')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Concluir tarefa: Preparar procuração' }))
    expect(onToggle).not.toHaveBeenCalled()
    expect(screen.getByText('Concluir esta tarefa?')).toBeInTheDocument()
    // O botão de confirmar vem antes do Cancelar
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons.indexOf('Concluir')).toBeLessThan(buttons.indexOf('Cancelar'))
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    await vi.waitFor(() => expect(onToggle).toHaveBeenCalledWith(true))
  })

  it('cancelar não muda a tarefa', () => {
    const onToggle = setup('pendente')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Concluir tarefa: Preparar procuração' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onToggle).not.toHaveBeenCalled()
    expect(screen.queryByText('Concluir esta tarefa?')).not.toBeInTheDocument()
  })

  it('tarefa concluída pede confirmação para reabrir', async () => {
    const onToggle = setup('concluida')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reabrir tarefa: Preparar procuração' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }))
    await vi.waitFor(() => expect(onToggle).toHaveBeenCalledWith(false))
  })
})
