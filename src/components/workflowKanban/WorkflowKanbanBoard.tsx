import {
  Component,
  lazy,
  Suspense,
  useMemo,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { WORKFLOW_STAGE_LABEL } from '@/lib/adminWorkflowKanban'
import { ChangeAssignedVendorModal } from '@/components/ChangeAssignedVendorModal'
import { WorkflowStageMoveDialogs } from './WorkflowStageMoveDialogs'
import { useWorkflowStageMove } from './useWorkflowStageMove'
import {
  StaticKanbanColumns,
  type KanbanCard,
  type StageId,
} from './WorkflowKanbanStatic'

const DndKanbanLayerLazy = lazy(async () => {
  const mod = await import('./WorkflowKanbanDnd')
  return { default: mod.DndKanbanLayer }
})

class DndBoardErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      '[Active Tasks] drag layer crashed; falling back to static board',
      error,
      info.componentStack,
    )
  }

  render() {
    if (this.state.error) return this.props.fallback
    return this.props.children
  }
}

/**
 * Active Tasks kanban. Renders a static board immediately (no @dnd-kit).
 * Drag-and-drop loads in a separate chunk and falls back to static on any error.
 */
export function WorkflowKanbanBoard({
  cards,
  loading,
  highlightRunId,
  onSelect,
  onAdd,
  onReload,
  vendorOptions = [],
}: {
  cards: KanbanCard[]
  loading: boolean
  highlightRunId: string | null
  onSelect: (runId: string) => void
  onAdd: () => void
  onReload: () => void | Promise<void>
  vendorOptions?: string[]
}) {
  const move = useWorkflowStageMove({ onReload, vendorOptions })

  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  const displayCards = useMemo(() => {
    return cards.map((card) => ({
      ...card,
      stage: move.applyOptimisticStage(card),
    }))
  }, [cards, move.applyOptimisticStage])

  const boardProps = {
    cards: displayCards,
    loading,
    highlightRunId,
    onSelect,
    onAdd,
    onMove: (card: KanbanCard, to: StageId) => void move.requestMove(card, to),
  }

  const staticBoard = <StaticKanbanColumns {...boardProps} />

  return (
    <>
      {move.error ? (
        <div className="mb-3 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[14px] text-[#b52a00]">
          {move.error}
        </div>
      ) : null}

      <DndBoardErrorBoundary fallback={staticBoard}>
        <Suspense fallback={staticBoard}>
          <DndKanbanLayerLazy
            displayCards={displayCards}
            loading={loading}
            highlightRunId={highlightRunId}
            onSelect={onSelect}
            onAdd={onAdd}
            onMove={boardProps.onMove}
            applyOptimisticStage={move.applyOptimisticStage}
            setError={move.setError}
            requestMove={async (card, to) => {
              await move.requestMove(card, to)
            }}
          />
        </Suspense>
      </DndBoardErrorBoundary>

      <WorkflowStageMoveDialogs
        request={move.confirm}
        busy={move.busy}
        onCancel={() => move.setConfirm(null)}
        onConfirm={(opts) => {
          if (!move.confirm) return
          const card = cardsById.get(move.confirm.runId)
          if (!card) return
          void move.executeMove({
            card,
            fromStage: move.confirm.fromStage,
            toStage: move.confirm.toStage,
            ...opts,
          })
        }}
      />

      <ChangeAssignedVendorModal
        open={move.vendorModalCard != null}
        currentVendor={move.vendorModalCard?.assignedVendorName ?? ''}
        vendorOptions={move.vendorOptions}
        saving={move.busy}
        saveError={move.error}
        onClose={move.cancelVendorModal}
        onSave={(name) => void move.onVendorPicked(name)}
      />

      {move.toast ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[10px] bg-[#101828] px-4 py-3 text-[14px] text-white shadow-lg"
        >
          <span>
            Moved to {WORKFLOW_STAGE_LABEL[move.toast.undoFrom]} ·{' '}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => void move.undoMove()}
            >
              Undo
            </button>
          </span>
        </div>
      ) : null}
    </>
  )
}
