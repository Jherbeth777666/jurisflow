// Ações em massa em Demandas (L13): escolher o novo valor, CONFIRMAR e só então aplicar.
// Não dispara o prompt de tarefas por etapa (L11) — isso continua sendo individual.
import { useState } from 'react'
import { ArrowRightLeft, Flag, UserRound } from 'lucide-react'
import { BulkBar, type BulkAction } from '@/components/BulkBar'
import { Button, ConfirmDialog, Modal, Select, useToast, type SelectOption } from '@/components/ui'
import { PRIORITY, toOptions } from '@/lib/constants'
import type { CategoryWithStages } from '@/hooks/useOrgData'
import type { PriorityLevel } from '@/types/database'
import { useBulkUpdateDemands, type BulkDemandPatch, type DemandWithClient } from './api'

type Kind = 'responsavel' | 'prioridade' | 'etapa'

const KIND_LABEL: Record<Kind, string> = { responsavel: 'Responsável', prioridade: 'Prioridade', etapa: 'Etapa' }
const ONE_CATEGORY_HINT = 'Selecione demandas de uma só categoria'

const demandas = (n: number) => `${n} ${n === 1 ? 'demanda' : 'demandas'}`

export function DemandsBulkActions({
  selected,
  categories,
  memberOptions,
  onClear,
}: {
  selected: DemandWithClient[]
  categories: CategoryWithStages[]
  memberOptions: SelectOption[]
  onClear: () => void
}) {
  const toast = useToast()
  const bulk = useBulkUpdateDemands()
  const [kind, setKind] = useState<Kind | null>(null)
  const [step, setStep] = useState<'choose' | 'confirm'>('choose')
  const [value, setValue] = useState('')

  const count = selected.length
  const categoryIds = new Set(selected.map((d) => d.category_id))
  const singleCategory = categoryIds.size === 1 ? [...categoryIds][0] : null
  const stages = categories.find((c) => c.id === singleCategory)?.stages ?? []

  const start = (k: Kind) => {
    setKind(k)
    setStep('choose')
    setValue('')
  }
  const close = () => setKind(null)

  const actions: BulkAction[] = [
    { key: 'responsavel', label: 'Responsável', icon: <UserRound className="size-4" />, onClick: () => start('responsavel') },
    { key: 'prioridade', label: 'Prioridade', icon: <Flag className="size-4" />, onClick: () => start('prioridade') },
    {
      key: 'etapa',
      label: 'Etapa',
      icon: <ArrowRightLeft className="size-4" />,
      onClick: () => start('etapa'),
      disabled: !singleCategory,
      hint: ONE_CATEGORY_HINT,
    },
  ]

  const options: SelectOption[] =
    kind === 'responsavel'
      ? [{ value: 'none', label: 'Sem responsável' }, ...memberOptions]
      : kind === 'prioridade'
        ? toOptions(PRIORITY)
        : stages.map((s) => ({ value: s.id, label: s.name }))
  const chosenLabel = options.find((o) => o.value === value)?.label ?? ''

  const question = (() => {
    if (kind === 'prioridade') return `Alterar a prioridade de ${demandas(count)} para ${chosenLabel}?`
    if (kind === 'responsavel')
      return value === 'none'
        ? `Remover o responsável de ${demandas(count)}?`
        : `Alterar o responsável de ${demandas(count)} para ${chosenLabel}?`
    const final = stages.find((s) => s.id === value)?.is_final
    return `Mover ${demandas(count)} para a etapa ${chosenLabel}?${final ? ' As demandas serão marcadas como concluídas.' : ''}`
  })()

  const patch = (): BulkDemandPatch => {
    if (kind === 'prioridade') return { priority: value as PriorityLevel }
    if (kind === 'responsavel') return { responsible_id: value === 'none' ? null : value }
    return { stage_id: value }
  }

  const apply = async () => {
    const n = await bulk.mutateAsync({ ids: selected.map((d) => d.id), patch: patch() })
    toast.show(`${demandas(n)} ${n === 1 ? 'atualizada' : 'atualizadas'}.`)
    onClear()
  }

  return (
    <>
      <BulkBar count={count} actions={actions} onClear={onClear} />

      <Modal
        open={!!kind && step === 'choose'}
        onClose={close}
        title={kind ? `Alterar ${KIND_LABEL[kind].toLowerCase()}` : ''}
        description={`Vale para ${demandas(count)} selecionadas.`}
        size="sm"
        footer={
          <>
            <Button onClick={close}>Cancelar</Button>
            <Button variant="primary" disabled={!value} onClick={() => setStep('confirm')}>
              Continuar
            </Button>
          </>
        }
      >
        {kind && (
          <Select
            label={KIND_LABEL[kind]}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            options={options}
            placeholder="Escolha…"
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!kind && step === 'confirm'}
        onClose={close}
        onConfirm={apply}
        title="Confirmar alteração em massa"
        description={question}
        confirmLabel="Confirmar alteração"
        tone="primary"
      />
    </>
  )
}
