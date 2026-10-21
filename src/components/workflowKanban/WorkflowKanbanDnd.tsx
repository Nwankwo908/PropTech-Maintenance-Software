import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState, type CSSProperties } from 'react'
import { stageDropValidity } from '@/lib/workflowStageMoveRules'
import {
  canStageMoveKanbanCard,
  cardHasAssignedVendorForStageMove,
  stageMoveNotDraggableReason,
  stageMoveTemplateGroupForCard,
} from '@/lib/workflowStageMoveCard'
import { tryDemoActiveTasksFirstRowColumnId } from '@/lib/tryDemoAttentionGuide'
import {
  EmptyColumnBody,
  KanbanCardBody,
  MoveToMenu,
  STAGE_ORDER,
  StageColumnShell,
  type KanbanCard,
  type StageId,
} from './WorkflowKanbanStatic'

function stageDropId(stage: StageId): string {
  return `stage:${stage}`
}

export function parseStageDropId(id: string | number): StageId | null {
  const raw = String(id)
  if (!raw.startsWith('stage:')) return null
  const stage = raw.slice(6) as StageId
  return STAGE_ORDER.some((s) => s.id === stage) ? stage : null
}

function DraggableKanbanCard({
  card,
  highlighted,
  stagger,
  onSelect,
  spotlightId,
  onMove,
  disabled,
  notAllowedTitle,
}: {
  card: KanbanCard
  highlighted?: boolean
  stagger?: number
  onSelect: (runId: string) => void
  spotlightId?: string
  onMove: (to: StageId) => void
  disabled?: boolean
  notAllowedTitle?: string | null
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    disabled: Boolean(disabled),
    data: { type: 'card', card },
  })

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : undefined,
    ...(spotlightId ? {} : ({ '--sa-stagger': stagger } as CSSProperties)),
  }

  return (
    <div ref={setNodeRef} style={style}>
      <KanbanCardBody
        card={card}
        highlighted={highlighted}
        stagger={stagger}
        onSelect={onSelect}
        spotlightId={spotlightId}
        dimmed={Boolean(notAllowedTitle)}
        notAllowedTitle={notAllowedTitle}
        dragHandleProps={
          disabled
            ? undefined
            : {
                ...attributes,
                ...listeners,
              }
        }
        menu={<MoveToMenu card={card} onMove={onMove} />}
      />
    </div>
  )
}

function DroppableColumn({
  stageId,
  label,
  cards,
  columnIndex,
  loading,
  onAdd,
  onSelect,
  highlightRunId,
  onMove,
  draggingCard,
}: {
  stageId: StageId
  label: string
  cards: KanbanCard[]
  columnIndex: number
  loading: boolean
  onAdd: () => void
  onSelect: (runId: string) => void
  highlightRunId: string | null
  onMove: (card: KanbanCard, to: StageId) => void
  draggingCard: KanbanCard | null
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stageDropId(stageId),
    data: { type: 'stage', stageId },
  })

  let columnHighlight = ''
  let columnTitle: string | undefined
  if (draggingCard) {
    const validity = stageDropValidity(draggingCard.stage, stageId, {
      templateGroup: stageMoveTemplateGroupForCard(draggingCard),
      hasAssignedVendor: cardHasAssignedVendorForStageMove(draggingCard),
      fromCompleted: draggingCard.stage === 'completed',
    })
    if (!validity.valid) {
      columnHighlight = 'opacity-40'
      columnTitle = validity.reason ?? 'Cannot drop here'
    } else if (isOver) {
      columnHighlight = 'ring-2 ring-[#0030b5]/40 bg-[#eff6ff]'
    } else {
      columnHighlight = 'ring-1 ring-[#0030b5]/20'
    }
  }

  const visible = cards.filter((c) => c.stage === stageId)

  return (
    <StageColumnShell
      stageId={stageId}
      label={label}
      columnIndex={columnIndex}
      count={visible.length}
      loading={loading}
      onAdd={onAdd}
      columnHighlight={columnHighlight}
      columnTitle={columnTitle}
      setNodeRef={setNodeRef}
    >
      {!loading && visible.length === 0 ? (
        <EmptyColumnBody columnIndex={columnIndex} />
      ) : null}
      {!loading
        ? visible.map((card, cardIndex) => {
            const canDrag = canStageMoveKanbanCard(card)
            return (
              <DraggableKanbanCard
                key={card.id}
                card={card}
                stagger={Math.min(cardIndex, 6)}
                highlighted={highlightRunId === card.id}
                onSelect={onSelect}
                spotlightId={
                  cardIndex === 0
                    ? tryDemoActiveTasksFirstRowColumnId(columnIndex)
                    : undefined
                }
                onMove={(to) => onMove(card, to)}
                disabled={!canDrag}
                notAllowedTitle={canDrag ? null : stageMoveNotDraggableReason(card)}
              />
            )
          })
        : null}
    </StageColumnShell>
  )
}

export function DndKanbanLayer({
  displayCards,
  loading,
  highlightRunId,
  onSelect,
  onAdd,
  onMove,
  applyOptimisticStage,
  setError,
  requestMove,
}: {
  displayCards: KanbanCard[]
  loading: boolean
  highlightRunId: string | null
  onSelect: (runId: string) => void
  onAdd: () => void
  onMove: (card: KanbanCard, to: StageId) => void
  applyOptimisticStage: (card: KanbanCard) => StageId
  setError: (message: string | null) => void
  requestMove: (card: KanbanCard, to: StageId) => Promise<void>
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  )
  const cardsById = useMemo(() => new Map(displayCards.map((c) => [c.id, c])), [displayCards])
  const draggingCard = activeId ? cardsById.get(activeId) ?? null : null

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
    setError(null)
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const card = cardsById.get(String(event.active.id))
    if (!card) return

    const overId = event.over?.id
    if (overId == null) return

    let toStage = parseStageDropId(overId)
    if (!toStage) {
      const overCard = cardsById.get(String(overId))
      if (overCard) toStage = applyOptimisticStage(overCard)
    }
    if (!toStage || toStage === card.stage) return

    const validity = stageDropValidity(card.stage, toStage, {
      templateGroup: stageMoveTemplateGroupForCard(card),
      hasAssignedVendor: cardHasAssignedVendorForStageMove(card),
      fromCompleted: card.stage === 'completed',
    })
    if (!validity.valid) {
      setError(validity.reason)
      return
    }

    await requestMove(card, toStage)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={(e) => void onDragEnd(e)}
      onDragCancel={() => setActiveId(null)}
    >
      <div
        className="min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [-ms-overflow-style:none] [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:overflow-visible"
        aria-label="Workflow stages"
        data-try-demo-active-tasks-ready={loading ? '0' : '1'}
      >
        <div className="flex w-max snap-x snap-mandatory gap-3 p-4 sm:gap-4 xl:grid xl:w-full xl:snap-none xl:grid-cols-4">
          {STAGE_ORDER.map((column, columnIndex) => (
            <DroppableColumn
              key={column.id}
              stageId={column.id}
              label={column.label}
              cards={displayCards}
              columnIndex={columnIndex}
              loading={loading}
              onAdd={onAdd}
              onSelect={onSelect}
              highlightRunId={highlightRunId}
              onMove={onMove}
              draggingCard={draggingCard}
            />
          ))}
        </div>
      </div>
      <DragOverlay>
        {draggingCard ? (
          <div className="w-[min(85vw,20rem)] rotate-1 opacity-95">
            <KanbanCardBody card={draggingCard} onSelect={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
