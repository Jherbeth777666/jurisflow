// Regras por etapa: ao entrar numa etapa com tarefas-modelo, abre o StageTasksPrompt.
import { useCallback, useState, type ReactNode } from 'react'
import { useOrg } from '@/contexts/AuthContext'
import type { Demand, WorkflowStage } from '@/types/database'
import { StageTasksPrompt } from './StageTasksPrompt'
import { fetchStageTaskTemplates, type TaskTemplateRow } from './taskTemplatesApi'

type PromptDemand = Pick<Demand, 'id' | 'responsible_id'>
type PromptStage = Pick<WorkflowStage, 'id' | 'name' | 'is_final'>

interface PromptState {
  demand: PromptDemand
  stage: PromptStage
  templates: TaskTemplateRow[]
}

/**
 * `promptFor(demand, stage)` busca os modelos da etapa e, se houver, abre o prompt.
 * Não faz nada para etapa final, sem modelos ou se a busca falhar. Renderize `element`.
 */
export function useStageEntryPrompt() {
  const { orgId } = useOrg()
  const [prompt, setPrompt] = useState<PromptState | null>(null)

  const promptFor = useCallback(
    async (demand: PromptDemand, stage: PromptStage) => {
      if (stage.is_final) return
      try {
        const templates = await fetchStageTaskTemplates(orgId, stage.id)
        if (templates.length > 0) setPrompt({ demand, stage, templates })
      } catch {
        // Sugestão é opcional: falha na busca não atrapalha a movimentação.
      }
    },
    [orgId],
  )

  const element: ReactNode = prompt ? (
    <StageTasksPrompt demand={prompt.demand} stage={prompt.stage} templates={prompt.templates} onClose={() => setPrompt(null)} />
  ) : null

  return { prompt, promptFor, element }
}
