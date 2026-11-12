// Aba "Quadro": Kanban por categoria com arrastar e soltar (dnd-kit) e menu "Mover para…".
import { useCallback, useMemo, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import { ArrowRightLeft, CheckCircle2, Clock, FileClock, GripVertical, KanbanSquare, Plus, Settings2 } from 'lucide-react'
import { Avatar, Badge, Button, EmptyState, ErrorState, Modal, SearchInput, Select, Skeleton } from '@/components/ui'
import { DemandFormModal } from '@/features/demands/DemandFormModal'
import { useMemberNames, type CategoryWithStages } from '@/hooks/useOrgData'
import { useQueryClient } from '@tanstack/react-query'
import { useOrg } from '@/contexts/AuthContext'
import { cn } from '@/lib/cn'
import { PRIORITY, toOptions } from '@/lib/constants'
import { daysSince, formatDate, todayISO } from '@/lib/format'
import type { PriorityLevel, WorkflowStage } from '@/types/database'
import { boardKey, invalidateWorkflow, useBoardDemands, useMoveDemand } from './api'
import { filterBoard, groupByStage, isClosed, STALE_DAYS, type BoardDemand, type BoardFilters } from './board'

/** Teclado: setas ←/→ saltam para a coluna vizinha. */
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return undefined
  event.preventDefault()
  const { active, collisionRect, droppableRects, droppableContainers } = context
  if (!active || !collisionRect) return undefined
  const cols = droppableContainers
    .getEnabled()
    .map((c) => ({ id: c.id, rect: droppableRects.get(c.id) }))
    .filter((c): c is { id: typeof c.id; rect: NonNullable<typeof c.rect> } => !!c.rect)
    .sort((a, b) => a.rect.left - b.rect.left)
  if (!cols.length) return undefined
  const cx = collisionRect.left + collisionRect.width / 2
  let idx = cols.findIndex((c) => cx >= c.rect.left && cx <= c.rect.left + c.rect.width)
  if (idx === -1) idx = cols.reduce((best, c, i) => (Math.abs(c.rect.left - cx) < Math.abs(cols[best].rect.left - cx) ? i : best), 0)
  const target = cols[idx + (event.code === 'ArrowRight' ? 1 : -1)]
  if (!target) return undefined
  return { x: target.rect.left + 8, y: target.rect.top + 44 }
}

/** Ponteiro quando houver; senão interseção de retângulos (teclado). */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : rectIntersection(args)
}

export function KanbanBoard({
  categories,
  categoryId,
  onCategoryChange,
  onConfigure,
}: {
  categories: CategoryWithStages[]
  categoryId: string | null
  onCategoryChange: (id: string) => void
  onConfigure?: () => void
}) {
  const { orgId, userId } = useOrg()
  const qc = useQueryClient()
  const members = useMemberNames()

  const active = categories.filter((c) => c.active)
  const category = active.find((c) => c.id === categoryId) ?? active[0] ?? null
  const stages = useMemo(() => category?.stages ?? [], [category])

  const [filters, setFilters] = useState<BoardFilters>({ responsible: '', priority: '', search: '' })
  const [createIn, setCreateIn] = useState<WorkflowStage | null>(null)
  const [moving, setMoving] = useState<BoardDemand | null>(null)
  const [dragging, setDragging] = useState<BoardDemand | null>(null)
  const closeCreate = useCallback(() => setCreateIn(null), [])
  const closeMove = useCallback(() => setMoving(null), [])

  const board = useBoardDemands(category?.id ?? null)
  const move = useMoveDemand(category?.id ?? null, stages)

  const visible = useMemo(() => filterBoard(board.data ?? [], filters), [board.data, filters])
  const columns = useMemo(() => groupByStage(visible, stages), [visible, stages])
  const openTotal = visible.filter((d) => !isClosed(d)).length

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: columnKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  )

  const findDemand = useCallback((id: string | number) => board.data?.find((d) => d.id === id), [board.data])
  const stageName = useCallback((id: string | number | undefined) => stages.find((s) => s.id === id)?.name ?? 'etapa', [stages])

  const announcements: Announcements = {
    onDragStart: ({ active: a }) =>
      `Demanda "${findDemand(a.id)?.title ?? ''}" selecionada. Use as setas para a esquerda e para a direita para escolher a etapa e espaço para soltar.`,
    onDragOver: ({ over }) => (over ? `Sobre a etapa ${stageName(over.id)}.` : 'Fora das etapas.'),
    onDragEnd: ({ over }) => (over ? `Demanda solta na etapa ${stageName(over.id)}.` : 'Movimento cancelado.'),
    onDragCancel: () => 'Movimento cancelado.',
  }

  const onDragStart = (e: DragStartEvent) => setDragging(findDemand(e.active.id) ?? null)
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const d = findDemand(e.active.id)
    const to = e.over?.id
    if (d && typeof to === 'string' && to !== d.stage_id) move.mutate({ demandId: d.id, stageId: to })
  }

  if (!active.length) {
    return (
      <EmptyState
        icon={<KanbanSquare className="size-5" />}
        title="Nenhuma categoria ativa"
        description="Crie ou ative uma categoria de demanda para visualizar o quadro."
        action={
          onConfigure && (
            <Button size="sm" icon={<Settings2 className="size-3.5" />} onClick={onConfigure}>
              Configurar etapas
            </Button>
          )
        }
      />
    )
  }

  const responsibleOptions = [
    ...(members.options.some((o) => o.value === userId) ? [{ value: userId, label: 'Minhas demandas' }] : []),
    { value: 'none', label: 'Sem responsável' },
    ...members.options.filter((o) => o.value !== userId),
  ]

  return (
    <div>
      {/* Barra de controles */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2 sm:w-64">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: category?.color }} aria-hidden />
          <Select
            aria-label="Categoria"
            value={category?.id ?? ''}
            onChange={(e) => onCategoryChange(e.target.value)}
            options={active.map((c) => ({ value: c.id, label: c.name }))}
            wrapperClassName="flex-1"
          />
        </div>
        <SearchInput
          value={filters.search}
          onChange={(v) => setFilters((f) => ({ ...f, search: v }))}
          placeholder="Buscar demanda ou cliente…"
          className="sm:w-60"
        />
        <Select
          aria-label="Responsável"
          value={filters.responsible}
          onChange={(e) => setFilters((f) => ({ ...f, responsible: e.target.value }))}
          options={responsibleOptions}
          placeholder="Todos os responsáveis"
          wrapperClassName="sm:w-48"
        />
        <Select
          aria-label="Prioridade"
          value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value as '' | PriorityLevel }))}
          options={toOptions(PRIORITY)}
          placeholder="Todas as prioridades"
          wrapperClassName="sm:w-44"
        />
        {(filters.responsible || filters.priority || filters.search) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({ responsible: '', priority: '', search: '' })}>
            Limpar filtros
          </Button>
        )}
        <span className="tabular text-[12.5px] text-ink-muted sm:ml-auto">
          {board.isSuccess ? `${openTotal} ${openTotal === 1 ? 'demanda aberta' : 'demandas abertas'}` : ''}
        </span>
      </div>

      {stages.length === 0 ? (
        <EmptyState
          icon={<KanbanSquare className="size-5" />}
          title="Esta categoria ainda não tem etapas"
          description="Cadastre as etapas do fluxo para usar o quadro."
          action={onConfigure && <Button size="sm" onClick={onConfigure}>Configurar etapas</Button>}
        />
      ) : board.isError ? (
        <ErrorState message={board.error.message} onRetry={() => board.refetch()} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                'Para mover a demanda, pressione espaço. Use as setas para a esquerda e para a direita para escolher a etapa e pressione espaço novamente para soltar. Esc cancela.',
            },
          }}
        >
          <div className="scrollbar-thin -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
            {stages.map((stage) => (
              <Column
                key={stage.id}
                stage={stage}
                items={columns.get(stage.id) ?? []}
                loading={board.isLoading}
                onCreate={() => setCreateIn(stage)}
              >
                {(d) => (
                  <DraggableCard
                    key={d.id}
                    demand={d}
                    responsible={d.responsible_id ? (members.map.get(d.responsible_id) ?? null) : null}
                    onMove={() => setMoving(d)}
                  />
                )}
              </Column>
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {dragging && (
              <CardBody
                demand={dragging}
                responsible={dragging.responsible_id ? (members.map.get(dragging.responsible_id) ?? null) : null}
                className="rotate-[1.5deg] shadow-[var(--shadow-pop)]"
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      <MoveToModal
        demand={moving}
        stages={stages}
        onClose={closeMove}
        onSelect={(stageId) => {
          if (moving) move.mutate({ demandId: moving.id, stageId })
          setMoving(null)
        }}
      />

      {category && (
        <DemandFormModal
          open={!!createIn}
          onClose={closeCreate}
          defaults={{ category_id: category.id, stage_id: createIn?.id ?? null }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: boardKey(orgId, category.id) })
            invalidateWorkflow(qc, orgId)
          }}
        />
      )}
    </div>
  )
}

function Column({
  stage,
  items,
  loading,
  onCreate,
  children,
}: {
  stage: WorkflowStage
  items: BoardDemand[]
  loading: boolean
  onCreate: () => void
  children: (d: BoardDemand) => ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const open = items.filter((d) => !isClosed(d))
  const closed = items.filter(isClosed)
  return (
    <section
      aria-label={`Etapa ${stage.name}`}
      className="flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col rounded-lg bg-slate-100/80 sm:w-[272px]"
    >
      <header className="flex items-center gap-1.5 px-3 pb-1 pt-2.5">
        {stage.is_final && <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-label="Etapa de conclusão" />}
        {stage.is_waiting_docs && <FileClock className="size-3.5 shrink-0 text-amber-600" aria-label="Aguardando documentos" />}
        <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink" title={stage.name}>
          {stage.name}
        </h3>
        <span className="tabular rounded-full bg-white px-1.5 text-[11px] font-medium text-ink-muted ring-1 ring-line">{open.length}</span>
        <Button variant="ghost" size="icon" onClick={onCreate} aria-label={`Nova demanda em ${stage.name}`} title="Nova demanda">
          <Plus className="size-4" />
        </Button>
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-28 flex-1 flex-col gap-2 rounded-b-lg p-2 transition-colors',
          isOver && 'bg-accent-50 ring-2 ring-inset ring-accent-200',
        )}
      >
        {loading ? (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </>
        ) : (
          <>
            {open.map(children)}
            {open.length === 0 && closed.length === 0 && <p className="px-1 py-4 text-center text-[12px] text-ink-muted">Nenhuma demanda</p>}
            {closed.length > 0 && (
              <>
                <p className="mt-1 px-1 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                  Concluídas recentemente ({closed.length})
                </p>
                {closed.map(children)}
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function DraggableCard({
  demand,
  responsible,
  onMove,
}: {
  demand: BoardDemand
  responsible: string | null
  onMove: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: demand.id })
  return (
    <div ref={setNodeRef} className={cn('rounded-md outline-none', isDragging && 'opacity-40')}>
      <CardBody
        demand={demand}
        responsible={responsible}
        onMove={onMove}
        handle={
          <button
            type="button"
            {...listeners}
            {...attributes}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Arrastar demanda ${demand.title}`}
            title="Arrastar"
            className="touch-target -mt-0.5 flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded text-ink-subtle hover:bg-navy-50 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-500 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" aria-hidden />
          </button>
        }
      />
    </div>
  )
}

const stop = {
  onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
  onClick: (e: MouseEvent) => e.stopPropagation(),
}

function CardBody({
  demand: d,
  responsible,
  onMove,
  handle,
  className,
}: {
  demand: BoardDemand
  responsible: string | null
  onMove?: () => void
  handle?: ReactNode
  className?: string
}) {
  const closed = isClosed(d)
  const days = daysSince(d.stage_changed_at)
  const today = todayISO()
  const nextLate = !!d.next_action_date && d.next_action_date < today
  return (
    <article
      className={cn(
        'rounded-md border border-line bg-surface p-2.5 text-left shadow-[0_1px_1px_rgb(15_23_42/0.04)] transition-shadow hover:shadow-[var(--shadow-card)]',
        closed && 'border-dashed bg-canvas shadow-none',
        className,
      )}
    >
      <div className="flex items-start gap-1.5">
        <Link
          to={`/demandas/${d.id}`}
          {...stop}
          className="line-clamp-2 min-w-0 flex-1 text-[13px] font-medium leading-snug text-ink hover:underline"
        >
          {d.title}
        </Link>
        {handle}
        {onMove && (
          <button
            type="button"
            {...stop}
            onClick={(e) => {
              e.stopPropagation()
              onMove()
            }}
            className="touch-target -mr-1 -mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-subtle hover:bg-navy-50 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent-500"
            aria-label={`Mover "${d.title}" para outra etapa`}
            title="Mover para…"
          >
            <ArrowRightLeft className="size-3.5" />
          </button>
        )}
      </div>
      {d.client && <p className="mt-0.5 truncate text-[12px] text-ink-muted">{d.client.full_name}</p>}

      <div className="mt-2 flex items-center gap-1.5">
        {d.priority !== 'media' && <Badge tone={PRIORITY[d.priority].tone}>{PRIORITY[d.priority].label}</Badge>}
        {closed ? (
          <span className="text-[11.5px] text-emerald-700">Concluída {d.closed_at ? `em ${formatDate(d.closed_at)}` : ''}</span>
        ) : (
          <span
            className={cn(
              'tabular inline-flex items-center gap-1 text-[11.5px]',
              days >= STALE_DAYS * 2 ? 'font-medium text-red-700' : days >= STALE_DAYS ? 'font-medium text-amber-700' : 'text-ink-subtle',
            )}
            title={`${days} ${days === 1 ? 'dia' : 'dias'} nesta etapa`}
          >
            <Clock className="size-3" aria-hidden />
            {days === 0 ? 'hoje' : `${days} d parada`}
          </span>
        )}
        <span className="ml-auto">
          {responsible ? <Avatar name={responsible} /> : <span className="text-[11px] text-ink-subtle">Sem resp.</span>}
        </span>
      </div>

      {!closed && (d.next_action || d.next_action_date) && (
        <p className={cn('mt-1.5 truncate border-t border-line pt-1.5 text-[11.5px]', nextLate ? 'text-red-700' : 'text-ink-muted')}>
          <span className="text-ink-subtle">Próx.: </span>
          {d.next_action ?? 'Atividade'}
          {d.next_action_date && <span className="tabular"> · {formatDate(d.next_action_date)}</span>}
        </p>
      )}
    </article>
  )
}

function MoveToModal({
  demand,
  stages,
  onClose,
  onSelect,
}: {
  demand: BoardDemand | null
  stages: WorkflowStage[]
  onClose: () => void
  onSelect: (stageId: string) => void
}) {
  return (
    <Modal open={!!demand} onClose={onClose} title="Mover para…" description={demand?.title} size="sm">
      <ul className="-mx-2 flex flex-col" role="list">
        {stages.map((s, i) => {
          const current = s.id === demand?.stage_id
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={current}
                onClick={() => onSelect(s.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13.5px] text-ink hover:bg-navy-50 disabled:cursor-default disabled:text-ink-subtle disabled:hover:bg-transparent"
              >
                <span className="tabular w-5 text-[12px] text-ink-subtle">{i + 1}.</span>
                <span className="flex-1 truncate">{s.name}</span>
                {current && <span className="text-[11.5px]">atual</span>}
                {!current && s.is_final && <Badge tone="green">Conclui</Badge>}
              </button>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
