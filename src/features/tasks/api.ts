// Acesso a dados de tarefas + atualização otimista compartilhada (página, lista compacta).
import { useMutation, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { qk } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { useToast } from '@/components/ui'
import type { Task, TaskStatus } from '@/types/database'

export type TaskRow = Task & {
  client: { id: string; full_name: string } | null
  demand: { id: string; title: string } | null
}

export const TASK_SELECT = '*, client:clients(id, full_name), demand:demands(id, title)'
export const OPEN_STATUSES: TaskStatus[] = ['pendente', 'em_andamento']

export function invalidateTaskData(qc: QueryClient, orgId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.tasks(orgId) }),
    // A ficha do cliente mostra tarefas atrasadas/abertas.
    qc.invalidateQueries({ queryKey: qk.clients(orgId) }),
    qc.invalidateQueries({ queryKey: qk.dashboard(orgId) }),
    qc.invalidateQueries({ queryKey: qk.activity(orgId) }),
  ])
}

function isTaskLike(v: unknown): v is { id: string } {
  return typeof v === 'object' && v !== null && 'id' in v
}

/** Aplica patch em qualquer formato de cache de tarefas (lista simples ou paginada). */
function patchCache(data: unknown, id: string, patch: Partial<Task>): unknown {
  if (Array.isArray(data)) return data.map((t) => (isTaskLike(t) && t.id === id ? { ...t, ...patch } : t))
  if (typeof data === 'object' && data !== null && 'pages' in data) {
    const d = data as { pages: unknown[]; pageParams: unknown[] }
    return { ...d, pages: d.pages.map((p) => patchCache(p, id, patch)) }
  }
  return data
}

function removeFromCache(data: unknown, id: string): unknown {
  if (Array.isArray(data)) return data.filter((t) => !(isTaskLike(t) && t.id === id))
  if (typeof data === 'object' && data !== null && 'pages' in data) {
    const d = data as { pages: unknown[]; pageParams: unknown[] }
    return { ...d, pages: d.pages.map((p) => removeFromCache(p, id)) }
  }
  return data
}

type Snapshot = [QueryKey, unknown][]

/** Concluir / reabrir tarefa com atualização otimista e rollback. */
export function useToggleTask() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation<void, Error, { id: string; done: boolean }, Snapshot>({
    mutationFn: async ({ id, done }) => {
      unwrap(
        await supabase
          .from('tasks')
          .update({ status: done ? 'concluida' : 'pendente' })
          .eq('id', id)
          .eq('organization_id', orgId)
          .select('id')
          .single(),
      )
    },
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: qk.tasks(orgId) })
      const snapshot = qc.getQueriesData({ queryKey: qk.tasks(orgId) })
      const patch: Partial<Task> = done
        ? { status: 'concluida', completed_at: new Date().toISOString() }
        : { status: 'pendente', completed_at: null }
      qc.setQueriesData({ queryKey: qk.tasks(orgId) }, (old: unknown) => patchCache(old, id, patch))
      return snapshot
    },
    onError: (e, _v, snapshot) => {
      snapshot?.forEach(([key, data]) => qc.setQueryData(key, data))
      toast.show(e.message, 'error')
    },
    onSuccess: (_d, { done }) => toast.show(done ? 'Tarefa concluída.' : 'Tarefa reaberta.'),
    onSettled: () => invalidateTaskData(qc, orgId),
  })
}

/** Exclusão (usada com ConfirmDialog — lança erro para o diálogo exibir). */
export function useDeleteTask() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return async (id: string) => {
    const rows = unwrap(await supabase.from('tasks').delete().eq('id', id).eq('organization_id', orgId).select('id'))
    if (!rows?.length) throw new Error('Não foi possível excluir: a tarefa não existe mais ou você não tem permissão.')
    qc.setQueriesData({ queryKey: qk.tasks(orgId) }, (old: unknown) => removeFromCache(old, id))
    await invalidateTaskData(qc, orgId)
  }
}

export type BulkTaskPatch = { status: TaskStatus } | { assignee_id: string | null } | { due_date: string | null }

/** Alteração em massa (RPC bulk_update_tasks). Devolve quantas tarefas foram atualizadas. */
export function useBulkUpdateTasks() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation<number, Error, { ids: string[]; patch: BulkTaskPatch }>({
    mutationFn: async ({ ids, patch }) =>
      Number(unwrap(await supabase.rpc('bulk_update_tasks', { p_org: orgId, p_ids: ids, p_patch: patch })) ?? 0),
    onSuccess: () => invalidateTaskData(qc, orgId),
  })
}

/** Exclusão em massa (usada com ConfirmDialog). Devolve quantas tarefas foram excluídas. */
export function useBulkDeleteTasks() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation<number, Error, string[]>({
    mutationFn: async (ids) => {
      const rows = unwrap(await supabase.from('tasks').delete().eq('organization_id', orgId).in('id', ids).select('id'))
      if (!rows?.length) throw new Error('Não foi possível excluir: as tarefas não existem mais ou você não tem permissão.')
      return rows.length
    },
    onSuccess: () => invalidateTaskData(qc, orgId),
  })
}
