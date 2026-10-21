import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  WORKFLOW_CATEGORY_BADGE,
  WORKFLOW_KANBAN_STAGES,
  type WorkflowKanbanCard,
  type WorkflowKanbanStageId,
} from '@/lib/adminWorkflowKanban'
import {
  canStageMoveKanbanCard,
  stageMoveNotDraggableReason,
} from '@/lib/workflowStageMoveCard'
import { tryDemoActiveTasksFirstRowColumnId } from '@/lib/tryDemoAttentionGuide'

export type KanbanCard = WorkflowKanbanCard
export type StageId = WorkflowKanbanStageId

export const STAGE_ORDER = WORKFLOW_KANBAN_STAGES
const CATEGORY_BADGE = WORKFLOW_CATEGORY_BADGE

export function KanbanCardBody({
  card,
  highlighted,
  stagger = 0,
  onSelect,
  spotlightId,
  dragHandleProps,
  menu,
  dimmed,
  notAllowedTitle,
}: {
  card: KanbanCard
  highlighted?: boolean
  stagger?: number
  onSelect: (runId: string) => void
  spotlightId?: string
  dragHandleProps?: Record<string, unknown>
  menu?: ReactNode
  dimmed?: boolean
  notAllowedTitle?: string | null
}) {
  const badge = CATEGORY_BADGE[card.category] ?? CATEGORY_BADGE.other
  const [checklistOpen, setChecklistOpen] = useState(false)
  const checklist = card.inspectionChecklist
  const hasChecklist = Boolean(checklist && checklist.length > 1)

  return (
    <div
      id={spotlightId ?? `workflow-card-${card.id}`}
      data-workflow-card-id={card.id}
      data-stage-draggable={canStageMoveKanbanCard(card) ? '1' : '0'}
      title={notAllowedTitle ?? undefined}
      style={spotlightId ? undefined : ({ '--sa-stagger': stagger } as CSSProperties)}
      className={[
        spotlightId ? '' : 'sa-stagger',
        'sa-card flex w-full flex-col gap-2 rounded-[10px] border bg-white p-3 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]',
        highlighted ? 'border-[#101828] ring-2 ring-[#101828]/20' : 'border-[#e5e7eb]',
        dimmed ? 'opacity-50' : '',
        notAllowedTitle ? 'cursor-not-allowed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...(dragHandleProps ?? {})}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          onClick={() => onSelect(card.id)}
          className="flex min-w-0 flex-1 flex-col gap-2 text-left outline-none hover:opacity-95 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 rounded-[6px]"
        >
          <p className="min-w-0 text-[14px] font-medium leading-5 text-[#0a0a0a]">
            {card.title}
          </p>
          {card.workOrderSummary ? (
            <p className="truncate text-[13px] font-medium leading-4 text-[#364153]">
              {card.workOrderSummary}
            </p>
          ) : null}
          {card.context && card.context !== '—' ? (
            <p className="truncate text-[12px] leading-4 text-[#6a7282]">{card.context}</p>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {card.issueCategoryLabel ? (
                <span className="inline-flex rounded-[6px] bg-[#e8f4f2] px-2 py-0.5 text-[11px] font-medium text-[#146b52]">
                  {card.issueCategoryLabel}
                </span>
              ) : null}
              <span
                className={`inline-flex rounded-[6px] px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
              >
                {badge.label}
              </span>
              {card.workOrderRef ? (
                <span className="truncate text-[11px] font-medium tabular-nums text-[#6a7282]">
                  {card.workOrderRef}
                </span>
              ) : null}
            </div>
            {card.initials ? (
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#6366f1] text-[10px] font-semibold text-white"
                aria-hidden
              >
                {card.initials}
              </span>
            ) : (
              <span className="size-6 shrink-0 rounded-full bg-[#e5e7eb]" aria-hidden />
            )}
          </div>
        </button>
        {menu}
      </div>

      {hasChecklist ? (
        <div className="border-t border-[#f3f4f6] pt-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setChecklistOpen((open) => !open)
            }}
            className="flex w-full items-center justify-between gap-2 rounded-[6px] px-1 py-0.5 text-left text-[12px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5]"
            aria-expanded={checklistOpen}
          >
            <span>
              {checklistOpen ? 'Hide' : 'Show'} fail items ({checklist!.length})
            </span>
            <span aria-hidden className="text-[#6a7282]">
              {checklistOpen ? '▴' : '▾'}
            </span>
          </button>
          {checklistOpen ? (
            <ul className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto">
              {checklist!.map((item) => (
                <li
                  key={item.ticketId}
                  className="flex items-start justify-between gap-2 rounded-[6px] bg-[#f9fafb] px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-[#0a0a0a]">
                      {item.label}
                    </p>
                    <p className="text-[11px] text-[#6a7282]">{item.workOrderRef}</p>
                  </div>
                  <span className="shrink-0 rounded-[4px] bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#364153] ring-1 ring-[#e5e7eb]">
                    {item.statusLabel}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function MoveToMenu({
  card,
  onMove,
}: {
  card: KanbanCard
  onMove: (to: StageId) => void
}) {
  const [open, setOpen] = useState(false)
  const draggable = canStageMoveKanbanCard(card)
  if (!draggable) return null

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Move to stage"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="rounded-[6px] px-1.5 py-1 text-[12px] font-medium text-[#6a7282] hover:bg-[#f3f4f6] hover:text-[#0a0a0a]"
      >
        ···
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-[8px] border border-[#e5e7eb] bg-white py-1 shadow-md"
        >
          <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">
            Move to…
          </p>
          {STAGE_ORDER.filter((s) => s.id !== card.stage).map((stage) => (
            <button
              key={stage.id}
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-[13px] text-[#0a0a0a] hover:bg-[#f9fafb]"
              onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                onMove(stage.id)
              }}
            >
              {stage.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function StageColumnShell({
  stageId,
  label,
  columnIndex,
  count,
  loading,
  onAdd,
  columnHighlight,
  columnTitle,
  setNodeRef,
  children,
}: {
  stageId: StageId
  label: string
  columnIndex: number
  count: number
  loading: boolean
  onAdd: () => void
  columnHighlight?: string
  columnTitle?: string
  setNodeRef?: (node: HTMLElement | null) => void
  children: ReactNode
}) {
  return (
    <div
      ref={setNodeRef}
      title={columnTitle}
      data-stage-column={stageId}
      style={{ '--sa-stagger': columnIndex } as CSSProperties}
      className={[
        'sa-stagger-scale flex w-[min(85vw,20rem)] shrink-0 snap-start flex-col rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] min-h-[min(40vh,320px)] sm:w-[min(70vw,22rem)] xl:w-auto xl:min-w-0',
        columnHighlight,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[#0a0a0a]">{label}</span>
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#e5e7eb] px-1.5 text-[11px] font-medium tabular-nums text-[#364153]">
            {count}
          </span>
        </div>
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add workflow to ${label}`}
          className="sa-press flex size-6 cursor-pointer items-center justify-center rounded-[10px] text-[#6a7282] hover:bg-[#e5e7eb] hover:text-[#101828]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="flex flex-col gap-3 px-3 pb-3">
        {loading ? (
          <div className="min-h-[7.5rem] w-full rounded-[10px]">
            <p className="px-1 py-6 text-center text-[12px] text-[#6a7282]">Loading…</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

export function EmptyColumnBody({ columnIndex }: { columnIndex: number }) {
  return (
    <div
      id={tryDemoActiveTasksFirstRowColumnId(columnIndex)}
      className="min-h-[7.5rem] w-full rounded-[10px]"
    >
      <p className="px-1 py-6 text-center text-[12px] text-[#9ca3af]">No tasks in this stage</p>
    </div>
  )
}

export function StaticKanbanCard({
  card,
  highlighted,
  stagger,
  onSelect,
  spotlightId,
  onMove,
  notAllowedTitle,
}: {
  card: KanbanCard
  highlighted?: boolean
  stagger?: number
  onSelect: (runId: string) => void
  spotlightId?: string
  onMove: (to: StageId) => void
  notAllowedTitle?: string | null
}) {
  return (
    <KanbanCardBody
      card={card}
      highlighted={highlighted}
      stagger={stagger}
      onSelect={onSelect}
      spotlightId={spotlightId}
      dimmed={Boolean(notAllowedTitle)}
      notAllowedTitle={notAllowedTitle}
      menu={<MoveToMenu card={card} onMove={onMove} />}
    />
  )
}

/** Columns with no @dnd-kit — Move to… menu still works. */
export function StaticKanbanColumns({
  cards,
  loading,
  highlightRunId,
  onSelect,
  onAdd,
  onMove,
}: {
  cards: KanbanCard[]
  loading: boolean
  highlightRunId: string | null
  onSelect: (runId: string) => void
  onAdd: () => void
  onMove: (card: KanbanCard, to: StageId) => void
}) {
  return (
    <div
      className="min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x [-ms-overflow-style:none] [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:overflow-visible"
      aria-label="Workflow stages"
      data-try-demo-active-tasks-ready={loading ? '0' : '1'}
    >
      <div className="flex w-max snap-x snap-mandatory gap-3 p-4 sm:gap-4 xl:grid xl:w-full xl:snap-none xl:grid-cols-4">
        {STAGE_ORDER.map((column, columnIndex) => {
          const visible = cards.filter((c) => c.stage === column.id)
          return (
            <StageColumnShell
              key={column.id}
              stageId={column.id}
              label={column.label}
              columnIndex={columnIndex}
              count={visible.length}
              loading={loading}
              onAdd={onAdd}
            >
              {!loading && visible.length === 0 ? (
                <EmptyColumnBody columnIndex={columnIndex} />
              ) : null}
              {!loading
                ? visible.map((card, cardIndex) => {
                    const canDrag = canStageMoveKanbanCard(card)
                    return (
                      <StaticKanbanCard
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
                        notAllowedTitle={canDrag ? null : stageMoveNotDraggableReason(card)}
                      />
                    )
                  })
                : null}
            </StageColumnShell>
          )
        })}
      </div>
    </div>
  )
}
