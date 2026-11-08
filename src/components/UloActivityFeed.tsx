import { NounInfoIcon } from '@/components/NounInfoIcon'
import { workflowOperationsPath } from '@/lib/adminWorkflowKanban'
import {
  buildActivityFeedTooltipCopy,
  splitEmphasizedText,
  type FeedTooltipDestination,
} from '@/lib/activityFeedTooltip'
import { PORTFOLIO_RECOMMENDATION_EVENT } from '@/lib/conversationMonitoring'
import { propertyDetailPathForBuilding } from '@/lib/propertyRoutes'
import { feedRowA11yProps } from '@/lib/landlordFeedCopy'
import {
  formatTimelineCategoryLabel,
  formatTimelineContextLine,
  ticketIdFromGraphPayload,
  type PropertyOperationsTimelineEvent,
} from '@/lib/propertyOperationsGraph'

export type { FeedTooltipDestination }

const FEED_BADGE_STYLES: Record<string, string> = {
  spend: 'bg-[#fef9c2] text-[#a65f00]',
  vendor: 'bg-[#e0f2fe] text-[#0069a8]',
  scheduling: 'bg-[#dbeafe] text-[#1447e6]',
  work_order: 'bg-[#f3e8ff] text-[#7c3aed]',
  equipment: 'bg-[#dbeafe] text-[#1447e6]',
  tenant: 'bg-[#dbfce7] text-[#008236]',
  maintenance: 'bg-[#f3e8ff] text-[#7c3aed]',
  rent: 'bg-[#fef9c2] text-[#a65f00]',
  move_in: 'bg-[#dbfce7] text-[#008236]',
  move_out: 'bg-[#ffe2e2] text-[#c10007]',
  inspection: 'bg-[#dbeafe] text-[#1447e6]',
  admin: 'bg-[#f3f4f6] text-[#364153]',
}

export const ULO_ACTIVITY_FEED_LIMIT = 20

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffMs = Date.now() - t
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function isUnitRegisteredFeedEvent(event: PropertyOperationsTimelineEvent): boolean {
  return event.eventType === 'unit.registered'
}

/** Ticket id for deep-links — column, payload, or nested legacy metadata. */
export function feedEventTicketId(event: PropertyOperationsTimelineEvent): string | null {
  const direct = event.maintenanceRequestId?.trim()
  if (direct) return direct
  return ticketIdFromGraphPayload(event.metadata)
}

export function feedEventOpenTarget(
  event: PropertyOperationsTimelineEvent,
  propertyIdByBuilding: Map<string, string>,
): FeedTooltipDestination | null {
  if (event.eventType === PORTFOLIO_RECOMMENDATION_EVENT) {
    return { kind: 'property', path: '/admin' }
  }
  if (isUnitRegisteredFeedEvent(event)) {
    const building = event.building?.trim()
    return {
      kind: 'property',
      path: building
        ? propertyDetailPathForBuilding(building, propertyIdByBuilding)
        : '/admin/properties',
    }
  }
  // Prefer ticket deep-links: Active Tasks can resolve an open run, or fall back
  // to the request page. Raw run ids often point at closed/cancelled runs and
  // leave the right rail stuck on “Loading workflow…”.
  const ticketId = feedEventTicketId(event)
  if (ticketId) return { kind: 'ticket', ticketId }
  const runId = event.workflowRunId?.trim()
  if (!runId) return null
  return { kind: 'workflow', runId }
}

/** Split a feed label so WO-XXXX tokens can render as links. */
export function splitFeedLabelForWorkOrderLinks(
  label: string,
): Array<{ text: string; workOrder: boolean }> {
  const parts: Array<{ text: string; workOrder: boolean }> = []
  const pattern = /\bWO-[A-Z0-9]{4,}\b/gi
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(label)) != null) {
    if (match.index > lastIndex) {
      parts.push({ text: label.slice(lastIndex, match.index), workOrder: false })
    }
    parts.push({ text: match[0], workOrder: true })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < label.length) {
    parts.push({ text: label.slice(lastIndex), workOrder: false })
  }
  return parts.length ? parts : [{ text: label, workOrder: false }]
}

export function activityFeedNavigatePath(
  target: FeedTooltipDestination,
): string {
  if (target.kind === 'property') return target.path
  if (target.kind === 'ticket') {
    return `/admin/workflows?ticket=${encodeURIComponent(target.ticketId)}`
  }
  return workflowOperationsPath(target.runId)
}

function FeedEventInfo({
  event,
  propertyIdByBuilding,
  onOpen,
}: {
  event: PropertyOperationsTimelineEvent
  propertyIdByBuilding: Map<string, string>
  onOpen: (target: FeedTooltipDestination) => void
}) {
  const target = feedEventOpenTarget(event, propertyIdByBuilding)
  const copy = buildActivityFeedTooltipCopy(event, target)
  const summaryParts = splitEmphasizedText(copy.summary)

  const openTarget = () => {
    if (target) onOpen(target)
  }

  return (
    <span className="group/feed-info relative inline-flex shrink-0 self-start pt-3.5">
      <button
        type="button"
        tabIndex={0}
        disabled={!target}
        onClick={openTarget}
        className={[
          'sa-press inline-flex rounded p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1',
          target ? 'cursor-pointer hover:opacity-70' : 'cursor-default opacity-40',
        ].join(' ')}
        aria-label={
          copy.actionLabel
            ? `${copy.actionLabel}: ${copy.title}`
            : `More information about ${copy.title}`
        }
      >
        <NounInfoIcon className="size-5" />
      </button>
      <div
        role="tooltip"
        className={[
          'absolute right-0 top-full z-50 mt-1.5 w-[min(280px,calc(100vw-2.5rem))] max-w-[calc(100vw-2.5rem)] rounded-[10px] border border-[#e5e7eb] bg-white p-3 opacity-0 shadow-[0px_8px_24px_rgba(0,0,0,0.12)] transition-opacity duration-150 group-hover/feed-info:opacity-100 group-focus-within/feed-info:opacity-100',
          target ? 'cursor-pointer' : 'pointer-events-none',
        ].join(' ')}
        onClick={(e) => {
          if (!target) return
          e.preventDefault()
          e.stopPropagation()
          openTarget()
        }}
        onKeyDown={(e) => {
          if (!target) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            openTarget()
          }
        }}
      >
        <p className="text-[12px] font-semibold leading-4 text-[#0a0a0a]">{copy.title}</p>
        <p className="mt-1.5 text-[12px] leading-[17px] text-[#374151]">
          {summaryParts.map((part, index) =>
            part.bold ? (
              <strong key={`${part.text}-${index}`} className="font-semibold text-[#0a0a0a]">
                {part.text}
              </strong>
            ) : (
              <span key={`${part.text}-${index}`}>{part.text}</span>
            ),
          )}
        </p>
        {copy.fields.length ? (
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {copy.fields.map((field) => (
              <li key={field.label} className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium leading-4 text-[#6a7282]">{field.label}</span>
                <span className="text-[12px] leading-4 text-[#0a0a0a]">{field.value}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {copy.actionLabel ? (
          <p className="mt-2.5 text-[12px] font-semibold leading-4 text-[#0030b5]">{copy.actionLabel}</p>
        ) : null}
      </div>
    </span>
  )
}

function FeedLabelWithWorkOrderLinks({
  label,
  context,
  target,
  onOpen,
}: {
  label: string
  context: string | null
  target: FeedTooltipDestination | null
  onOpen: (target: FeedTooltipDestination) => void
}) {
  const parts = splitFeedLabelForWorkOrderLinks(label)
  const hasWoLink = Boolean(target && parts.some((part) => part.workOrder))

  return (
    <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
      {parts.map((part, index) =>
        part.workOrder && target ? (
          <button
            key={`${part.text}-${index}`}
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpen(target)
            }}
            className="sa-link font-semibold text-[#1447e6] underline decoration-[#1447e6]/40 underline-offset-2 outline-none hover:decoration-[#1447e6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1"
            aria-label={`Open work order ${part.text}`}
          >
            {part.text}
          </button>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
      {context ? <span className="text-[#6a7282]"> · {context}</span> : null}
      {target && !hasWoLink ? (
        <>
          {' '}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpen(target)
            }}
            className="sa-link text-[13px] font-semibold text-[#1447e6] underline decoration-[#1447e6]/40 underline-offset-2 outline-none hover:decoration-[#1447e6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1"
          >
            View
          </button>
        </>
      ) : null}
    </p>
  )
}

export function UloActivityFeedList({
  events,
  loading,
  propertyIdByBuilding,
  onOpenTarget,
  emptyMessage = 'No AI actions yet. Activity will stream here as Ulo starts working.',
  showInfo = true,
  dense = false,
}: {
  events: PropertyOperationsTimelineEvent[]
  loading?: boolean
  propertyIdByBuilding: Map<string, string>
  onOpenTarget: (target: FeedTooltipDestination) => void
  emptyMessage?: string
  showInfo?: boolean
  dense?: boolean
}) {
  if (loading) {
    return <p className="px-4 py-8 text-center text-[13px] text-[#6a7282]">Loading…</p>
  }
  if (events.length === 0) {
    return <p className="px-4 py-8 text-center text-[13px] text-[#6a7282]">{emptyMessage}</p>
  }

  const pad = dense ? 'px-4' : 'px-4 sm:px-6'

  return (
    <div className="flex flex-col">
      {events.map((event, index) => {
        const context = formatTimelineContextLine(event)
        const isLast = index === events.length - 1
        const isFirst = index === 0
        const target = feedEventOpenTarget(event, propertyIdByBuilding)
        const spoken = feedRowA11yProps(event.fullLabel?.trim() || event.label)
        const row = (
          <>
            <div className="flex w-[4.75rem] shrink-0 flex-col items-center self-stretch">
              <span
                className={[
                  'w-full text-center text-[11px] leading-4 text-[#6a7282]',
                  isFirst ? 'mt-3' : 'mt-1',
                ].join(' ')}
              >
                {formatRelativeTime(event.createdAt)}
              </span>
              {!isLast ? (
                <span
                  className="mt-1 w-0 min-h-[12px] flex-1 border-l border-dotted border-[#d1d5dc]"
                  aria-hidden
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1 py-3">
              <FeedLabelWithWorkOrderLinks
                label={event.label}
                context={context}
                target={target}
                onOpen={onOpenTarget}
              />
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={[
                    'rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                    FEED_BADGE_STYLES[event.category] ?? FEED_BADGE_STYLES.admin,
                  ].join(' ')}
                >
                  {formatTimelineCategoryLabel(event.category)}
                </span>
              </div>
            </div>
            {showInfo ? (
              <FeedEventInfo
                event={event}
                propertyIdByBuilding={propertyIdByBuilding}
                onOpen={onOpenTarget}
              />
            ) : null}
          </>
        )

        return (
          <div
            key={event.id}
            style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
            className={`sa-enter flex min-w-0 gap-3 ${pad} ${target ? 'hover:bg-[#fafafa]' : ''}`}
            title={spoken.title}
            aria-label={spoken['aria-label']}
          >
            {row}
          </div>
        )
      })}
    </div>
  )
}
