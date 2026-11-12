// Ao entrar numa etapa com tarefas-modelo, sugere as tarefas. As datas são lembretes internos;
// a pessoa confere, ajusta e confirma. Nada é criado sem confirmação.
import { useState } from 'react'
import { Info } from 'lucide-react'
import { Button, InlineError, Modal, useToast } from '@/components/ui'
import { useMemberNames } from '@/hooks/useOrgData'
import { todayISO } from '@/lib/format'
import { suggestTasks, type SuggestedTask } from '@/features/demands/kickoff'
import type { Demand, WorkflowStage } from '@/types/database'
import { TASK_TITLE_MAX, TASK_TITLE_MIN, useKickoffDemand, type TaskTemplateRow } from './taskTemplatesApi'

interface Row extends SuggestedTask {
  assignee_id: string
  /** título original do modelo, usado no rótulo da caixa */
  label: string
}

interface Props {
  demand: Pick<Demand, 'id' | 'responsible_id'>
  stage: Pick<WorkflowStage, 'id' | 'name'>
  templates: TaskTemplateRow[]
  onClose: () => void
}

const controlCls =
  'h-8 rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 text-body-sm focus:border-accent-500 focus:outline-none focus:ring-3 focus:ring-accent-100'

export function StageTasksPrompt({ demand, stage, templates, onClose }: Props) {
  const toast = useToast()
  const members = useMemberNames()
  const kickoff = useKickoffDemand()
  const [rows, setRows] = useState<Row[]>(() =>
    suggestTasks(templates, todayISO()).map((s) => ({ ...s, label: s.title, assignee_id: demand.responsible_id ?? '' })),
  )
  const [error, setError] = useState<string | null>(null)

  const patch = (idx: number, change: Partial<Row>) => {
    setRows((list) => list.map((r, i) => (i === idx ? { ...r, ...change } : r)))
    setError(null)
  }

  const confirm = async () => {
    const chosen = rows.filter((r) => r.selected)
    if (chosen.length === 0) return onClose()
    const invalid = chosen.find((r) => r.title.trim().length < TASK_TITLE_MIN || r.title.trim().length > TASK_TITLE_MAX)
    if (invalid) return setError(`O título de cada tarefa deve ter entre ${TASK_TITLE_MIN} e ${TASK_TITLE_MAX} caracteres.`)
    try {
      const res = await kickoff.mutateAsync({
        demandId: demand.id,
        checklist: false,
        tasks: chosen.map((r) => ({
          title: r.title.trim(),
          due_date: r.due_date || null,
          priority: r.priority,
          assignee_id: r.assignee_id || null,
        })),
      })
      toast.show(`${res.tasks_created} tarefa(s) criada(s).`)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar as tarefas.')
    }
  }

  const busy = kickoff.isPending

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title={`Etapa “${stage.name}”: criar tarefas sugeridas?`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Agora não
          </Button>
          <Button variant="primary" onClick={confirm} loading={busy}>
            Criar tarefas
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-line">
          {rows.map((r, idx) => (
            <li key={idx} className="grid gap-2 p-3 sm:grid-cols-[auto_1fr_150px_160px] sm:items-center">
              <input
                type="checkbox"
                checked={r.selected}
                onChange={(e) => patch(idx, { selected: e.target.checked })}
                aria-label={`Incluir ${r.label}`}
                className="size-4 rounded border-line-strong accent-navy-900"
              />
              <input
                value={r.title}
                maxLength={TASK_TITLE_MAX}
                onChange={(e) => patch(idx, { title: e.target.value })}
                aria-label={`Título da tarefa ${idx + 1}`}
                className={`${controlCls} min-w-0`}
              />
              <input
                type="date"
                value={r.due_date ?? ''}
                onChange={(e) => patch(idx, { due_date: e.target.value || null })}
                aria-label={`Data da tarefa ${idx + 1}`}
                className={controlCls}
              />
              <select
                value={r.assignee_id}
                onChange={(e) => patch(idx, { assignee_id: e.target.value })}
                aria-label={`Responsável da tarefa ${idx + 1}`}
                className={controlCls}
              >
                <option value="">Sem responsável</option>
                {members.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>

        <p className="flex items-start gap-1.5 text-caption text-ink-subtle">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>Datas sugeridas para organização interna. Confira os prazos legais do caso.</span>
        </p>

        <InlineError message={error} />
      </div>
    </Modal>
  )
}
