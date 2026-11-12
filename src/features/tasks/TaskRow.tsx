// Linha de tarefa compartilhada entre TasksPage e TaskList.
import { Link } from 'react-router-dom'
import { Briefcase, Pencil, Trash2, User } from 'lucide-react'
import { Avatar, Badge, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { PRIORITY } from '@/lib/constants'
import { dueBucket, dueLabel, isOpenStatus } from './dueBuckets'
import type { TaskRow as TaskRowData } from './api'

const dueTone: Record<string, string> = {
  overdue: 'text-red-700 font-medium',
  today: 'text-amber-800 font-medium',
  tomorrow: 'text-ink',
  week: 'text-ink-muted',
  later: 'text-ink-muted',
  none: 'text-ink-subtle',
  done: 'text-ink-subtle',
}

export function TaskRowItem({
  task,
  assigneeName,
  onToggle,
  onEdit,
  onDelete,
  compact,
  showLinks = true,
  today,
}: {
  task: TaskRowData
  assigneeName: string | null
  onToggle: (done: boolean) => void
  onEdit: () => void
  onDelete?: () => void
  compact?: boolean
  showLinks?: boolean
  today: string
}) {
  const open = isOpenStatus(task.status)
  const done = task.status === 'concluida'
  const bucket = dueBucket(task.due_date, task.status, today)
  return (
    <li className={cn('group flex items-start gap-3 px-4', compact ? 'py-2.5' : 'py-3')}>
      <label className="touch-target mt-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          checked={done}
          disabled={task.status === 'cancelada'}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={done ? `Reabrir tarefa: ${task.title}` : `Concluir tarefa: ${task.title}`}
          className="size-4 cursor-pointer rounded border-line-strong accent-navy-900 disabled:cursor-not-allowed"
        />
      </label>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onEdit}
          className={cn(
            'block max-w-full truncate text-left text-body font-medium text-ink hover:underline',
            !open && 'text-ink-muted line-through decoration-ink-subtle',
          )}
        >
          {task.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted">
          <span className={cn('tabular', dueTone[bucket])}>{open ? dueLabel(task.due_date, today) : task.status === 'cancelada' ? 'Cancelada' : 'Concluída'}</span>
          {(task.priority === 'alta' || task.priority === 'urgente') && (
            <Badge tone={PRIORITY[task.priority].tone}>{PRIORITY[task.priority].label}</Badge>
          )}
          {showLinks && task.client && (
            <Link to={`/clientes/${task.client.id}`} className="inline-flex min-h-6 max-w-[220px] items-center gap-1 truncate hover:text-ink hover:underline">
              <User className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{task.client.full_name}</span>
            </Link>
          )}
          {showLinks && task.demand && (
            <Link to={`/demandas/${task.demand.id}`} className="inline-flex min-h-6 max-w-[260px] items-center gap-1 truncate hover:text-ink hover:underline">
              <Briefcase className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{task.demand.title}</span>
            </Link>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {assigneeName ? <Avatar name={assigneeName} /> : <span className="text-caption text-ink-subtle">Sem resp.</span>}
        {!compact && (
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Editar tarefa: ${task.title}`}>
            <Pencil className="size-4" />
          </Button>
        )}
        {onDelete && (
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label={`Excluir tarefa: ${task.title}`} className="hover:text-red-600">
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </li>
  )
}
