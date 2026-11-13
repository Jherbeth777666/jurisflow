// Filtros salvos (L13): combinações de filtros por tela, pessoais ou compartilhadas com o escritório.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { friendlyError, supabase, unwrap } from '@/lib/supabase'
import { qk } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'

export type ViewPage = 'demandas' | 'tarefas'

export interface SavedView {
  id: string
  organization_id: string
  user_id: string
  page: ViewPage
  name: string
  query: string
  shared: boolean
  created_at: string
}

export const DUPLICATE_VIEW_MESSAGE = 'Já existe um filtro com esse nome.'

export function useSavedViews(page: ViewPage) {
  const { orgId, userId } = useOrg()
  return useQuery({
    queryKey: qk.savedViews(orgId, page),
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from('saved_views')
          .select('*')
          .eq('organization_id', orgId)
          .eq('page', page)
          .order('name', { ascending: true }),
      ) as SavedView[]
      // A RLS já esconde os privados dos outros; o filtro aqui é só uma segunda barreira.
      return rows.filter((v) => v.user_id === userId || v.shared)
    },
  })
}

export function useSaveView() {
  const { orgId, userId } = useOrg()
  const qc = useQueryClient()
  return useMutation<void, Error, { page: ViewPage; name: string; query: string; shared: boolean }>({
    mutationFn: async ({ page, name, query, shared }) => {
      const res = await supabase
        .from('saved_views')
        .insert({ organization_id: orgId, user_id: userId, page, name, query, shared })
        .select('id')
        .single()
      if (res.error) {
        if ((res.error as { code?: string }).code === '23505') throw new Error(DUPLICATE_VIEW_MESSAGE)
        throw new Error(friendlyError(res.error))
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.savedViews(orgId) }),
  })
}

export function useDeleteView() {
  const { orgId } = useOrg()
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const rows = unwrap(
        await supabase.from('saved_views').delete().eq('id', id).eq('organization_id', orgId).select('id'),
      ) as { id: string }[] | null
      if (!rows?.length) throw new Error('Não foi possível excluir: o filtro não existe mais ou não é seu.')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.savedViews(orgId) }),
  })
}
