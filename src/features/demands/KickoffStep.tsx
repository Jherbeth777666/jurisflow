// Passo "Preparar a demanda": mostrado depois de criar a demanda, com checklist e tarefas sugeridos.
// As datas são lembretes internos; a pessoa confere, ajusta e confirma.
import { useState } from 'react'
import { Info } from 'lucide-react'
import { Button, Checkbox, InlineError, Modal, useToast } from '@/components/ui'
import { useMemberNames } from '@/hooks/useOrgData'
import { PRIORITY, toOptions } from '@/lib/constants'
import { TASK_TITLE_MAX, TASK_TITLE_MIN, useKickoffDemand } from '@/features/workflows/taskTemplatesApi'
import type { Demand, PriorityLevel } from '@/types/database'
import type { SuggestedTask } from './kickoff'

interface Row extends SuggestedTask {
  assignee_id: string
}

interface Props {
  demand: Demand
  checklistCount: number
  suggestions: SuggestedTask[]
  /** Chamado ao concluir ou pular; o pai fecha o modal. */
  onDone: () => void
}

export function KickoffStep({ demand, checklistCount, suggestions, onDone }: Props) {
  const toast = useToast()
  const members = useMemberNames()
  const kickoff = useKickoffDemand()
  const [applyChecklist, setApplyChecklist] = useState(checklistCount > 0)
  const [rows, setRows] = useState<Row[]>(() => suggestions.map((s) => ({ ...s, assignee_id: demand.responsible_id ?? '' })))
  const [error, setError] = useState<string | null>(null)

  const patch = (idx: number, change: Partial<Row>) => {
    setRows((list) => list.map((r, i) => (i === idx ? { ...r, ...change } : r)))
    setError(null)
  }

  const confirm = async () => {
    const chosen = rows.filter((r) => r.selected)
    const invalid = chosen.find((r) => r.title.trim().length < TASK_TITLE_MIN || r.title.trim().length > TASK_TITLE_MAX)
    if (invalid) return setError(`O título de cada tarefa deve ter entre ${TASK_TITLE_MIN} e ${TASK_TITLE_MAX} caracteres.`)
    try {
      const res = await kickoff.mutateAsync({
        demandId: demand.id,
        checklist: applyChecklist,
        tasks: chosen.map((r) => ({
          title: r.title.trim(),
          due_date: r.due_date || null,
          priority: r.priority,
          assignee_id: r.assignee_id || null,
        })),
      })
      toast.show(`Demanda preparada: ${res.checklist_items} itens de checklist e ${res.tasks_created} tarefas.`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível preparar a demanda.')
    }
  }

  const busy = kickoff.isPending

  return (
    <Modal
      open
      onClose={busy ? () => {} : onDone}
      title="Preparar a demanda"
      size="lg"
      footer={
        <>
          <Button onClick={onDone} disabled={busy}>
            Pular
          </Button>
          <Button variant="primary" onClick={confirm} loading={busy}>
            Criar e abrir demanda
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-ink-muted">
          A demanda “{demand.title}” foi criada. Confira o que o escritório costuma fazer neste tipo de caso.
        </p>

        {checklistCount > 0 && (
          <Checkbox
            checked={applyChecklist}
            onChange={(e) => setApplyChecklist(e.target.checked)}
            label={`Aplicar checklist da categoria (${checklistCount} ${checklistCount === 1 ? 'item' : 'itens'})`}
          />
        )}

        {rows.length > 0 && (
          <ul className="divide-y divide-line rounded-md border border-line">
            {rows.map((r, idx) => (
              <li key={idx} className="grid gap-2 p-3 sm:grid-cols-[auto_1fr_150px_160px_120px] sm:items-center">
                <input
                  type="checkbox"
                  checked={r.selected}
                  onChange={(e) => patch(idx, { selected: e.target.checked })}
                  aria-label={`Incluir tarefa ${idx + 1}`}
                  className="size-4 rounded border-line-strong accent-navy-900"
                />
                <input
                  value={r.title}
                  maxLength={TASK_TITLE_MAX}
                  onChange={(e) => patch(idx, { title: e.target.value })}
                  aria-label={`Título da tarefa ${idx + 1}`}
                  className="h-8 min-w-0 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100"
                />
                <input
                  type="date"
                  value={r.due_date ?? ''}
                  onChange={(e) => patch(idx, { due_date: e.target.value || null })}
                  aria-label={`Data da tarefa ${idx + 1}`}
                  className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100"
                />
                <select
                  value={r.assignee_id}
                  onChange={(e) => patch(idx, { assignee_id: e.target.value })}
                  aria-label={`Responsável pela tarefa ${idx + 1}`}
                  className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100"
                >
                  <option value="">Sem responsável</option>
                  {members.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={r.priority}
                  onChange={(e) => patch(idx, { priority: e.target.value as PriorityLevel })}
                  aria-label={`Prioridade da tarefa ${idx + 1}`}
                  className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100"
                >
                  {toOptions(PRIORITY).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}

        <p className="flex items-start gap-1.5 text-[12px] text-ink-subtle">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>Datas sugeridas para organização interna. Confira os prazos legais do caso.</span>
        </p>

        <InlineError message={error} />
      </div>
    </Modal>
  )
}
