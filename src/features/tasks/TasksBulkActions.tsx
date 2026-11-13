// Ações em massa em Tarefas (L13): escolher o novo valor (quando houver), CONFIRMAR e só então aplicar.
import { useState } from 'react'
import { CalendarDays, CheckCheck, Trash2, UserRound } from 'lucide-react'
import { BulkBar, type BulkAction } from '@/components/BulkBar'
import { Button, ConfirmDialog, Input, Modal, Select, useToast, type SelectOption } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { useBulkDeleteTasks, useBulkUpdateTasks, type BulkTaskPatch } from './api'

type Kind = 'concluir' | 'responsavel' | 'prazo' | 'excluir'

const tarefas = (n: number) => `${n} ${n === 1 ? 'tarefa' : 'tarefas'}`

export function TasksBulkActions({
  ids,
  memberOptions,
  canDelete,
  onClear,
}: {
  ids: string[]
  memberOptions: SelectOption[]
  canDelete: boolean
  onClear: () => void
}) {
  const toast = useToast()
  const update = useBulkUpdateTasks()
  const remove = useBulkDeleteTasks()
  const [kind, setKind] = useState<Kind | null>(null)
  const [step, setStep] = useState<'choose' | 'confirm'>('choose')
  // Responsável: user_id | 'none'. Prazo: AAAA-MM-DD | '' (= remover o prazo).
  const [value, setValue] = useState('')

  const count = ids.length

  const start = (k: Kind) => {
    setKind(k)
    setStep(k === 'concluir' || k === 'excluir' ? 'confirm' : 'choose')
    setValue('')
  }
  const close = () => setKind(null)

  const actions: BulkAction[] = [
    { key: 'concluir', label: 'Concluir', icon: <CheckCheck className="size-4" />, onClick: () => start('concluir') },
    { key: 'responsavel', label: 'Responsável', icon: <UserRound className="size-4" />, onClick: () => start('responsavel') },
    { key: 'prazo', label: 'Prazo', icon: <CalendarDays className="size-4" />, onClick: () => start('prazo') },
  ]
  if (canDelete) {
    actions.push({ key: 'excluir', label: 'Excluir', icon: <Trash2 className="size-4" />, tone: 'danger', onClick: () => start('excluir') })
  }

  const responsibleOptions: SelectOption[] = [{ value: 'none', label: 'Sem responsável' }, ...memberOptions]
  const responsibleLabel = responsibleOptions.find((o) => o.value === value)?.label ?? ''

  const question = (() => {
    if (kind === 'concluir') return `Concluir ${tarefas(count)}?`
    if (kind === 'excluir') return `Excluir ${tarefas(count)}? Esta ação não pode ser desfeita.`
    if (kind === 'responsavel')
      return value === 'none'
        ? `Remover o responsável de ${tarefas(count)}?`
        : `Alterar o responsável de ${tarefas(count)} para ${responsibleLabel}?`
    return value ? `Alterar o prazo de ${tarefas(count)} para ${formatDate(value)}?` : `Remover o prazo de ${tarefas(count)}?`
  })()

  const patch = (): BulkTaskPatch => {
    if (kind === 'responsavel') return { assignee_id: value === 'none' ? null : value }
    if (kind === 'prazo') return { due_date: value || null }
    return { status: 'concluida' }
  }

  const apply = async () => {
    if (kind === 'excluir') {
      const n = await remove.mutateAsync(ids)
      toast.show(`${tarefas(n)} ${n === 1 ? 'excluída' : 'excluídas'}.`)
    } else {
      const n = await update.mutateAsync({ ids, patch: patch() })
      toast.show(`${tarefas(n)} ${n === 1 ? 'atualizada' : 'atualizadas'}.`)
    }
    onClear()
  }

  const deleting = kind === 'excluir'

  return (
    <>
      <BulkBar count={count} actions={actions} onClear={onClear} />

      <Modal
        open={(kind === 'responsavel' || kind === 'prazo') && step === 'choose'}
        onClose={close}
        title={kind === 'prazo' ? 'Alterar prazo' : 'Alterar responsável'}
        description={`Vale para ${tarefas(count)} selecionadas.`}
        size="sm"
        footer={
          <>
            <Button onClick={close}>Cancelar</Button>
            {kind === 'prazo' && (
              <Button
                onClick={() => {
                  setValue('')
                  setStep('confirm')
                }}
              >
                Remover prazo
              </Button>
            )}
            <Button variant="primary" disabled={!value} onClick={() => setStep('confirm')}>
              Continuar
            </Button>
          </>
        }
      >
        {kind === 'prazo' ? (
          <Input label="Prazo" type="date" value={value} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <Select
            label="Responsável"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            options={responsibleOptions}
            placeholder="Escolha…"
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!kind && step === 'confirm'}
        onClose={close}
        onConfirm={apply}
        title={deleting ? 'Excluir tarefas' : 'Confirmar alteração em massa'}
        description={question}
        confirmLabel={deleting ? 'Excluir' : 'Confirmar alteração'}
        tone={deleting ? 'danger' : 'primary'}
      />
    </>
  )
}
