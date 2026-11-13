// CONTRATO DE INTERFACE (implementação pelo agente de fluxos/tarefas).
// Lista compacta de tarefas filtrada por demanda ou cliente, com ação de concluir e criar.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckSquare, Plus } from 'lucide-react'
import { Button, EmptyState, ErrorState, TableSkeleton } from '@/components/ui'
import { qk, useMemberNames } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { supabase, unwrap } from '@/lib/supabase'
import { PRIORITY_ORDER } from '@/lib/constants'
import { todayISO } from '@/lib/format'
import type { Task } from '@/types/database'
import { TASK_SELECT, useToggleTask, type TaskRow } from './api'
import { isOpenStatus } from './dueBuckets'
import { TaskFormModal } from './TaskFormModal'
import { TaskRowItem } from './TaskRow'

export interface TaskListProps {
  demandId?: string
  clientId?: string
  /** Mostra botão "Nova tarefa" pré-preenchido */
  allowCreate?: boolean
}

function sortOpen(a: TaskRow, b: TaskRow) {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date < b.due_date ? -1 : 1
  }
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
}

export function TaskList({ demandId, clientId, allowCreate }: TaskListProps) {
  const { orgId } = useOrg()
  const members = useMemberNames()
  const toggle = useToggleTask()
  const [showClosed, setShowClosed] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)

  const q = useQuery({
    queryKey: qk.tasks(orgId, 'list', { demandId: demandId ?? null, clientId: clientId ?? null }),
    enabled: !!(demandId || clientId),
    queryFn: async () => {
      let query = supabase.from('tasks').select(TASK_SELECT).eq('organization_id', orgId).order('due_date', { ascending: true, nullsFirst: false }).limit(200)
      if (demandId) query = query.eq('demand_id', demandId)
      if (clientId) query = query.eq('client_id', clientId)
      return unwrap(await query) as unknown as TaskRow[]
    },
  })

  const today = todayISO()
  const all = q.data ?? []
  const open = all.filter((t) => isOpenStatus(t.status)).sort(sortOpen)
  const closed = all
    .filter((t) => !isOpenStatus(t.status))
    .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at))

  const renderRow = (t: TaskRow) => (
    <TaskRowItem
      key={t.id}
      task={t}
      compact
      showLinks={!demandId}
      today={today}
      assigneeName={t.assignee_id ? (members.map.get(t.assignee_id) ?? null) : null}
      onToggle={(done) => toggle.mutate({ id: t.id, done })}
      onEdit={() => setEditing(t)}
    />
  )

  const createButton = allowCreate && (
    <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCreating(true)}>
      Nova tarefa
    </Button>
  )

  let body
  if (!demandId && !clientId) body = null
  else if (q.isLoading) body = <TableSkeleton rows={3} cols={2} />
  else if (q.isError) body = <ErrorState message={q.error.message} onRetry={() => q.refetch()} className="py-8" />
  else if (all.length === 0)
    body = (
      <EmptyState
        className="py-8"
        icon={<CheckSquare className="size-5" />}
        title="Nenhuma tarefa"
        description={allowCreate ? 'Crie tarefas para organizar os próximos passos.' : undefined}
        action={createButton || undefined}
      />
    )
  else
    body = (
      <>
        {open.length > 0 ? (
          <ul className="divide-y divide-line">{open.map(renderRow)}</ul>
        ) : (
          <p className="px-4 py-3 text-body-sm text-ink-muted">Nenhuma tarefa em aberto.</p>
        )}
        {closed.length > 0 && (
          <div className="border-t border-line">
            <button
              type="button"
              onClick={() => setShowClosed((s) => !s)}
              aria-expanded={showClosed}
              className="w-full px-4 py-2 text-left text-label text-ink-muted hover:text-ink"
            >
              {showClosed ? 'Ocultar' : 'Mostrar'} concluídas/canceladas ({closed.length})
            </button>
            {showClosed && <ul className="divide-y divide-line border-t border-line">{closed.map(renderRow)}</ul>}
          </div>
        )}
      </>
    )

  return (
    <div>
      {allowCreate && all.length > 0 && <div className="flex justify-end px-4 pt-3">{createButton}</div>}
      {body}
      <TaskFormModal
        open={creating}
        onClose={() => setCreating(false)}
        defaults={{ demand_id: demandId ?? null, client_id: clientId ?? null }}
      />
      <TaskFormModal open={!!editing} onClose={() => setEditing(null)} task={editing} />
    </div>
  )
}
