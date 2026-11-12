import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Info } from 'lucide-react'
import { ErrorState, PageHeader, Skeleton, Tabs } from '@/components/ui'
import { useCategories } from '@/hooks/useOrgData'
import { useOrg } from '@/contexts/AuthContext'
import { KanbanBoard } from './KanbanBoard'
import { StageSettings } from './StageSettings'
import { TaskTemplatesEditor } from './TaskTemplatesEditor'
import { ChecklistTemplatesEditor } from '@/features/checklist/ChecklistTemplatesEditor'

type Tab = 'quadro' | 'etapas'

const storageKey = (orgId: string) => `jurisflow.workflows.category.${orgId}`

function readStored(orgId: string): string | null {
  try {
    return localStorage.getItem(storageKey(orgId))
  } catch {
    return null
  }
}

export function WorkflowsPage() {
  const { orgId, can } = useOrg()
  const categories = useCategories()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('aba') === 'etapas' ? 'etapas' : 'quadro'
  const [categoryId, setCategoryId] = useState<string | null>(() => readStored(orgId))

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    if (t === 'etapas') next.set('aba', 'etapas')
    else next.delete('aba')
    setParams(next, { replace: true })
  }

  const changeCategory = useCallback(
    (id: string) => {
      setCategoryId(id)
      try {
        localStorage.setItem(storageKey(orgId), id)
      } catch {
        /* armazenamento indisponível: mantém só em memória */
      }
    },
    [orgId],
  )

  return (
    <div>
      <PageHeader title="Fluxos de trabalho" description="Acompanhe as demandas por etapa e personalize os fluxos de cada categoria." />
      <p className="-mt-2 mb-4 flex items-start gap-1.5 text-[12.5px] text-ink-muted">
        <Info className="mt-0.5 size-3.5 shrink-0 text-ink-subtle" aria-hidden />
        Fluxos são controles administrativos do escritório, não determinações jurídicas.
      </p>

      <Tabs<Tab>
        className="mb-4"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'quadro', label: 'Quadro' },
          { value: 'etapas', label: can('workflows.manage') ? 'Configurar etapas' : 'Etapas' },
        ]}
      />

      {categories.isLoading ? (
        <div className="flex gap-3 overflow-hidden" aria-busy="true" aria-label="Carregando">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-[272px] shrink-0" />
          ))}
        </div>
      ) : categories.isError ? (
        <ErrorState message={categories.error.message} onRetry={() => categories.refetch()} />
      ) : tab === 'quadro' ? (
        <KanbanBoard
          categories={categories.data ?? []}
          categoryId={categoryId}
          onCategoryChange={changeCategory}
          onConfigure={() => setTab('etapas')}
        />
      ) : (
        <div className="space-y-6">
          <StageSettings categories={categories.data ?? []} categoryId={categoryId} onCategoryChange={changeCategory} />
          <ChecklistTemplatesEditor initialCategoryId={categoryId ?? undefined} />
          <TaskTemplatesEditor initialCategoryId={categoryId ?? undefined} />
        </div>
      )}
    </div>
  )
}
