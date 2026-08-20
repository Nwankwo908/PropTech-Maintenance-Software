import { useEffect, useId, useState } from 'react'
import { ConversationMonitoringBody } from '@/components/ConversationMonitoringModal'
import { deleteWorkOrderPermanently } from '@/api/deleteWorkOrder'
import {
  fetchInboxConversationMonitoring,
  fetchWorkflowUloThreadMonitoring,
  type ConversationMonitoringDetail,
} from '@/lib/conversationMonitoring'
import {
  applyMoveOutAdminAction,
  MOVE_OUT_ADMIN_ACTION_LABELS,
  type MoveOutAdminAction,
} from '@/lib/moveOutWorkflow'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import type {
  WorkflowPipelineAttachment,
  WorkflowPipelineDetail,
  WorkflowPipelineField,
  WorkflowPipelineStep,
} from '@/lib/workflowPipelineDetail'
import { getErrorMessage } from '@/lib/errorMessage'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M4 4h16v16H4z" strokeLinejoin="round" />
      <path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ThreadIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" strokeLinejoin="round" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg className="size-5 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10.5" r="1.5" />
      <path d="m21 17-5-5L8 21" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DocumentIcon() {
  return (
    <svg className="size-5 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" strokeLinejoin="round" />
      <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg className="size-5 text-[#6a7282]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x="3" y="6" width="14" height="12" rx="2" />
      <path d="m17 10 4-2v8l-4-2z" strokeLinejoin="round" />
    </svg>
  )
}

function WorkOrderPhotosSection({
  title,
  subtitle,
  attachments,
}: {
  title: string
  subtitle: string
  attachments: WorkflowPipelineAttachment[]
}) {
  if (attachments.length === 0) return null

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div>
        <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">{title}</h3>
        <p className="text-[12px] leading-4 text-[#6a7282]">{subtitle}</p>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {attachments.map((attachment) => (
          <div
            key={`${attachment.name}-${attachment.url ?? attachment.sizeLabel}`}
            className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-[#fafafa]"
          >
            {attachment.url && attachment.kind === 'video' ? (
              <div className="aspect-[4/3] overflow-hidden bg-[#0a0a0a]">
                <video
                  src={attachment.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="size-full object-contain"
                />
              </div>
            ) : attachment.url && attachment.kind === 'image' ? (
              <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block aspect-[4/3] overflow-hidden bg-[#f3f4f6]"
              >
                <img
                  src={attachment.url}
                  alt={attachment.caption || attachment.name}
                  className="size-full object-cover"
                />
              </a>
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center bg-[#f3f4f6]">
                {attachment.kind === 'video' ? (
                  <VideoIcon />
                ) : attachment.kind === 'image' ? (
                  <ImageIcon />
                ) : (
                  <DocumentIcon />
                )}
              </div>
            )}
            <div className="px-3 py-2.5">
              <p className="truncate text-[13px] font-medium text-[#0a0a0a]">{attachment.name}</p>
              {attachment.caption ? (
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-[#364153]">{attachment.caption}</p>
              ) : null}
              <p className="mt-1 text-[11px] text-[#6a7282]">{attachment.sizeLabel}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function conversationPhotosSubtitle(detail: WorkflowPipelineDetail): string {
  if (detail.uloThread?.kind === 'inspection') {
    return 'Captured during the guided SMS inspection'
  }
  return 'Sent by the tenant or vendor over text'
}

function FieldGrid({ fields, columns = 4 }: { fields: WorkflowPipelineField[]; columns?: 2 | 4 }) {
  const gridClass = columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4'
  return (
    <div className={`grid grid-cols-1 gap-4 ${gridClass}`}>
      {fields.map((field) => (
        <div key={field.label} className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">{field.label}</p>
          <p className="mt-1 text-[14px] font-medium leading-5 text-[#0a0a0a]">{field.value}</p>
        </div>
      ))}
    </div>
  )
}

function WorkflowStepIndicator({
  step,
  index,
}: {
  step: WorkflowPipelineStep
  index: number
}) {
  return (
    <span
      className={[
        'relative z-[1] inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
        step.state === 'complete'
          ? 'bg-[#00a63e] text-white'
          : step.state === 'active'
            ? 'bg-[#101828] text-white'
            : 'border border-[#e5e7eb] bg-white text-[#6a7282]',
      ].join(' ')}
    >
      {step.state === 'complete' ? <CheckIcon /> : index + 1}
    </span>
  )
}

const VISIBLE_WORKFLOW_STAGE_COUNT = 4

function resolveWorkflowProgressIndex(steps: WorkflowPipelineStep[]): number {
  const activeIndex = steps.findIndex((step) => step.state === 'active')
  const lastCompleteIndex = steps.reduce(
    (lastIndex, step, index) => (step.state === 'complete' ? index : lastIndex),
    -1,
  )
  return activeIndex >= 0 ? activeIndex : Math.max(0, lastCompleteIndex)
}

function resolveVisibleStageWindow(
  stepCount: number,
  progressIndex: number,
  windowSize = VISIBLE_WORKFLOW_STAGE_COUNT,
): { start: number; size: number } {
  if (stepCount <= windowSize) return { start: 0, size: stepCount }
  const maxStart = stepCount - windowSize
  const start = Math.min(Math.max(0, progressIndex - 1), maxStart)
  return { start, size: windowSize }
}

function WorkflowProgressStepper({
  steps,
  caption,
}: {
  steps: WorkflowPipelineStep[]
  caption: string
}) {
  const stepCount = steps.length
  const progressIndex = resolveWorkflowProgressIndex(steps)
  const { start: windowStart, size: visibleCount } = resolveVisibleStageWindow(stepCount, progressIndex)
  const visibleSteps = steps.slice(windowStart, windowStart + visibleCount)
  const localProgressIndex = Math.max(0, Math.min(progressIndex - windowStart, visibleCount - 1))
  const trackInset = visibleCount > 0 ? `${100 / (2 * visibleCount)}%` : '0%'
  const fillWidth =
    visibleCount <= 1
      ? '0%'
      : `calc((100% - ${100 / visibleCount}%) * ${localProgressIndex / (visibleCount - 1)})`

  return (
    <section className="w-full rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Workflow Progress</h3>
        <span className="text-[12px] font-medium text-[#6a7282]">{caption}</span>
      </div>

      <div className="relative w-full">
        {visibleCount > 1 ? (
          <>
            <div
              className="absolute top-[14px] h-0.5 bg-[#e5e7eb]"
              style={{ left: trackInset, right: trackInset }}
            />
            <div
              className="absolute top-[14px] h-0.5 bg-[#00a63e] transition-[width] duration-200"
              style={{ left: trackInset, width: fillWidth }}
            />
          </>
        ) : null}
        <div
          className="relative grid w-full"
          style={{ gridTemplateColumns: `repeat(${Math.max(visibleCount, 1)}, minmax(0, 1fr))` }}
        >
          {visibleSteps.map((step, visibleIndex) => {
            const globalIndex = windowStart + visibleIndex
            return (
              <div key={`${step.label}-${globalIndex}`} className="flex min-w-0 flex-col items-center px-1">
                <WorkflowStepIndicator step={step} index={globalIndex} />
                <p
                  className={[
                    'mt-2 w-full px-0.5 text-center text-[11px] leading-4 break-words',
                    step.state === 'active'
                      ? 'font-semibold text-[#0a0a0a]'
                      : step.state === 'complete'
                        ? 'text-[#364153]'
                        : 'text-[#6a7282]',
                  ].join(' ')}
                >
                  {step.label}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

type WorkflowPipelineDetailPanelProps = {
  open: boolean
  detail: WorkflowPipelineDetail | null
  loading?: boolean
  onClose: () => void
  onWorkflowUpdated?: () => void
}

/** Workflow pipeline card detail — Figma 719:177 work order view. */
export function WorkflowPipelineDetailPanel({
  open,
  detail,
  loading = false,
  onClose,
  onWorkflowUpdated,
}: WorkflowPipelineDetailPanelProps) {
  const titleId = useId()
  const threadTitleId = useId()
  const [panelView, setPanelView] = useState<'work_order' | 'thread'>('work_order')
  const [threadSource, setThreadSource] = useState<'resident' | 'vendor'>('resident')
  const [threadDetail, setThreadDetail] = useState<ConversationMonitoringDetail | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [moveOutActionSaving, setMoveOutActionSaving] = useState(false)
  const [moveOutActionError, setMoveOutActionError] = useState<string | null>(null)
  const deleteConfirmTitleId = useId()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const openThread = (source: 'resident' | 'vendor') => {
    setThreadSource(source)
    setPanelView('thread')
  }

  useEffect(() => {
    if (!open) {
      setPanelView('work_order')
      setThreadSource('resident')
      setThreadDetail(null)
      setThreadError(null)
      setThreadLoading(false)
      setDeleteConfirmOpen(false)
      setDeleteError(null)
      setDeleteSaving(false)
    }
  }, [open])

  useEffect(() => {
    setPanelView('work_order')
    setThreadSource('resident')
    setThreadDetail(null)
    setThreadError(null)
    setThreadLoading(false)
    setDeleteConfirmOpen(false)
    setDeleteError(null)
  }, [detail?.runId])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (deleteConfirmOpen) {
        if (!deleteSaving) {
          setDeleteError(null)
          setDeleteConfirmOpen(false)
        }
        return
      }
      if (panelView === 'thread') {
        setPanelView('work_order')
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, panelView, deleteConfirmOpen, deleteSaving])

  useEffect(() => {
    if (!open || panelView !== 'thread' || !detail) {
      return
    }

    let cancelled = false
    setThreadLoading(true)
    setThreadError(null)
    setThreadDetail(null)

    const loadThread = async () => {
      // Same loader as Messages so the transcript matches that page.
      if (threadSource === 'vendor' && detail.vendorConversationId) {
        return fetchInboxConversationMonitoring(detail.vendorConversationId)
      }
      if (detail.conversationId) {
        return fetchInboxConversationMonitoring(detail.conversationId)
      }
      if (!detail.uloThread) return null
      return fetchWorkflowUloThreadMonitoring(detail.uloThread)
    }

    void loadThread().then((result) => {
      if (cancelled) return
      setThreadLoading(false)
      if (!result) {
        setThreadError(
          threadSource === 'vendor'
            ? 'Could not load the vendor conversation for this work order.'
            : 'Could not load the Ulo conversation for this workflow.',
        )
        return
      }
      setThreadDetail(result)
    })

    return () => {
      cancelled = true
    }
  }, [open, panelView, detail, threadSource])

  const handleMoveOutAction = async (action: MoveOutAdminAction) => {
    if (!detail?.runId) return
    setMoveOutActionSaving(true)
    setMoveOutActionError(null)
    try {
      const result = await applyMoveOutAdminAction(action, {
        workflowRunId: detail.runId,
        landlordId: getActiveLandlordId(),
        residentId: detail.resident ? undefined : null,
      })
      if (!result.ok) {
        setMoveOutActionError(result.error)
        return
      }
      onWorkflowUpdated?.()
    } catch (err) {
      setMoveOutActionError(getErrorMessage(err, "That action didn't work. Please try again."))
    } finally {
      setMoveOutActionSaving(false)
    }
  }

  const handleDeleteWorkOrder = async () => {
    if (!detail?.runId) return
    setDeleteSaving(true)
    setDeleteError(null)
    try {
      await deleteWorkOrderPermanently({
        workflowRunId: detail.runId,
        maintenanceRequestId: detail.maintenanceRequestId,
      })
      setDeleteConfirmOpen(false)
      onClose()
      onWorkflowUpdated?.()
    } catch (err) {
      setDeleteError(getErrorMessage(err, 'Delete failed'))
    } finally {
      setDeleteSaving(false)
    }
  }

  if (!open) return null

  const canSeeThread = Boolean(detail?.uloThread)
  const canSeeVendorThread = Boolean(detail?.vendorConversationId)
  const showingThread = panelView === 'thread'
  const canDeleteWorkOrder = Boolean(detail?.isMaintenanceWorkflow && detail.runId)
  const vendorFromOverview = detail?.overviewFields.find((field) => field.label === 'Vendor')?.value
  const vendorName =
    (vendorFromOverview && vendorFromOverview !== '—' ? vendorFromOverview : null) ??
    (detail?.uloThread?.kind === 'maintenance' ? detail.uloThread.vendorName : null)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        role="presentation"
        className="sa-scrim absolute inset-0 bg-black/40"
        aria-hidden
        onClick={() => {
          if (!deleteSaving) onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sa-rail relative flex h-full max-h-dvh w-full max-w-[min(100vw,920px)] flex-col overflow-hidden rounded-l-[12px] border border-[#e5e7eb] bg-[#f9fafb] shadow-[0px_8px_24px_rgba(0,0,0,0.12)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#e5e7eb] bg-white px-6 py-4">
          <div className="min-w-0 flex-1">
            {showingThread ? (
              <>
                <button
                  type="button"
                  onClick={() => setPanelView('work_order')}
                  className="sa-link inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[13px] font-medium text-[#1447e6] outline-none hover:bg-[#eff6ff] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                >
                  <BackIcon />
                  Back to task
                </button>
                <h2 id={threadTitleId} className="mt-3 text-[24px] font-semibold leading-8 tracking-[-0.3px] text-[#0a0a0a]">
                  {threadSource === 'vendor'
                    ? 'Vendor conversation'
                    : detail?.uloThread?.kind === 'move_in'
                    ? 'Move-in coordination'
                    : detail?.uloThread?.kind === 'inspection'
                      ? 'Conversational inspection'
                      : 'Resident conversation'}
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                  {threadSource === 'vendor'
                    ? `SMS thread between ${vendorName ?? 'vendor'} and Ulo`
                    : detail?.uloThread?.kind === 'move_in'
                    ? `Scheduled SMS coordination with ${detail?.resident?.name ?? 'resident'}`
                    : detail?.uloThread?.kind === 'inspection'
                      ? 'Guided SMS inspection — room by room, no portal forms'
                      : `SMS thread between ${detail?.resident?.name ?? 'resident'} and Ulo`}
                </p>
              </>
            ) : loading || !detail ? (
              <p className="text-[13px] text-[#6a7282]">Loading workflow…</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                    {detail.workOrderRef}
                  </span>
                  <span className={`inline-flex rounded-[6px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${detail.categoryClassName}`}>
                    {detail.categoryLabel}
                  </span>
                  {detail.priorityLabel && detail.priorityClassName ? (
                    <span className={`inline-flex rounded-[6px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${detail.priorityClassName}`}>
                      {detail.priorityLabel}
                    </span>
                  ) : null}
                </div>
                <h2 id={titleId} className="mt-3 text-[24px] font-semibold leading-8 tracking-[-0.3px] text-[#0a0a0a]">
                  {detail.title}
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                  {detail.createdLine}
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="sa-press rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            <CloseIcon />
          </button>
        </div>

        <div
          className={
            showingThread
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-5'
              : 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5'
          }
        >
          {showingThread ? (
            threadLoading ? (
              <div className="flex h-40 items-center justify-center">
                <p className="text-[13px] text-[#6a7282]">Loading conversation…</p>
              </div>
            ) : threadError ? (
              <div className="flex h-40 items-center justify-center">
                <p className="text-[13px] text-[#6a7282]">{threadError}</p>
              </div>
            ) : threadDetail ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                <ConversationMonitoringBody
                  detail={threadDetail}
                  titleId={threadTitleId}
                  embedded
                  onEstimateDecided={() => {
                    const reloadId =
                      threadSource === 'vendor'
                        ? detail?.vendorConversationId
                        : detail?.conversationId
                    if (reloadId) {
                      void fetchInboxConversationMonitoring(reloadId).then((result) => {
                        if (result) setThreadDetail(result)
                      })
                    } else if (detail?.uloThread) {
                      void fetchWorkflowUloThreadMonitoring(detail.uloThread).then((result) => {
                        if (result) setThreadDetail(result)
                      })
                    }
                    onWorkflowUpdated?.()
                  }}
                />
              </div>
            ) : null
          ) : loading || !detail ? (
            <div className="flex h-40 items-center justify-center">
              <p className="text-[13px] text-[#6a7282]">Loading workflow details…</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <WorkflowProgressStepper
                steps={detail.progressSteps}
                caption={detail.progressCaption}
              />

              {detail.isMoveOutWorkflow ? (
                <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                  <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Admin actions</h3>
                  {moveOutActionError ? (
                    <p className="mt-2 text-[13px] text-[#b52a00]">{moveOutActionError}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(
                      [
                        'send_reminder',
                        'schedule_inspection',
                        'mark_keys_returned',
                        'complete_cleaning',
                        'complete_move_out',
                        'cancel_move_out',
                      ] as MoveOutAdminAction[]
                    ).map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled={moveOutActionSaving}
                        onClick={() => void handleMoveOutAction(action)}
                        className="sa-press inline-flex cursor-pointer items-center rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] disabled:opacity-50"
                      >
                        {MOVE_OUT_ADMIN_ACTION_LABELS[action]}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Overview</h3>
                <div className="mt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
                    Request number
                  </p>
                  <p className="mt-1 text-[14px] font-medium leading-5 text-[#0a0a0a]">
                    {detail.ticketRequestNumber}
                  </p>
                </div>
                <p className="mt-3 text-[14px] leading-6 text-[#364153]">{detail.description}</p>
                <div className="mt-5 border-t border-[#f3f4f6] pt-5">
                  <FieldGrid fields={detail.overviewFields} />
                </div>
                {detail.maintenanceDetails.length > 0 ? (
                  <div className="mt-5 border-t border-[#f3f4f6] pt-5">
                    <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                      Maintenance Details
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {detail.maintenanceDetails.map((field) => (
                        <div key={field.label}>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
                            {field.label}
                          </p>
                          <p className="mt-1 text-[14px] font-medium leading-5 text-[#0a0a0a]">{field.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {detail.invoiceSection ? (
                  <div className="mt-5 border-t border-[#f3f4f6] pt-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                        Invoice
                      </p>
                      <span className="inline-flex items-center rounded-full bg-[#f3f4f6] px-2.5 py-0.5 text-[11px] font-medium text-[#364153]">
                        {detail.invoiceSection.statusLabel}
                      </span>
                    </div>
                    <div className="space-y-2 text-[13px]">
                      {detail.invoiceSection.invoiceNumber ? (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[#6a7282]">Invoice number</span>
                          <span className="font-medium text-[#0a0a0a]">
                            {detail.invoiceSection.invoiceNumber}
                          </span>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[#6a7282]">Labor</span>
                        <span className="font-medium text-[#0a0a0a]">
                          {detail.invoiceSection.laborCost != null
                            ? `$${detail.invoiceSection.laborCost.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[#6a7282]">Parts &amp; materials</span>
                        <span className="font-medium text-[#0a0a0a]">
                          {detail.invoiceSection.materialCost != null
                            ? `$${detail.invoiceSection.materialCost.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[#6a7282]">Tax</span>
                        <span className="font-medium text-[#0a0a0a]">
                          {detail.invoiceSection.taxAmount != null
                            ? `$${detail.invoiceSection.taxAmount.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-[#f3f4f6] pt-2">
                        <span className="font-semibold text-[#0a0a0a]">Total</span>
                        <span className="text-[15px] font-semibold text-[#0a0a0a]">
                          {detail.invoiceSection.totalCost != null
                            ? `$${detail.invoiceSection.totalCost.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : '—'}
                        </span>
                      </div>
                      {detail.invoiceSection.ytdPaidTotal != null ? (
                        <div className="flex items-center justify-between gap-3 pt-1">
                          <span className="text-[#6a7282]">YTD paid to vendor</span>
                          <span className="font-medium text-[#0a0a0a]">
                            $
                            {detail.invoiceSection.ytdPaidTotal.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    {detail.invoiceSection.necTrackingNote ? (
                      <p className="mt-3 rounded-[8px] border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-[12px] leading-4 text-[#1e40af]">
                        {detail.invoiceSection.necTrackingNote}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {canSeeThread && !detail.resident ? (
                  <div className="mt-5 border-t border-[#f3f4f6] pt-5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <button
                        type="button"
                        onClick={() => openThread('resident')}
                        className="sa-press inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-[12px] font-medium text-[#1447e6] outline-none hover:bg-[#dbeafe] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 sm:w-auto"
                      >
                        <ThreadIcon />
                        See thread
                      </button>
                      {canSeeVendorThread ? (
                        <button
                          type="button"
                          onClick={() => openThread('vendor')}
                          className="sa-press inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 sm:w-auto"
                        >
                          <ThreadIcon />
                          See vendor thread
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {detail.resident ? (
                  <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                    <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Resident</h3>
                    <div className="mt-4 flex items-center gap-3">
                      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dbeafe] text-[13px] font-semibold text-[#1447e6]">
                        {detail.resident.initials}
                      </span>
                      <div>
                        <p className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">{detail.resident.name}</p>
                        <p className="text-[12px] leading-4 text-[#6a7282]">{detail.resident.statusLine}</p>
                      </div>
                    </div>
                    <div className="mt-5">
                      <FieldGrid
                        columns={2}
                        fields={[
                          { label: 'Phone', value: detail.resident.phone },
                          { label: 'Email', value: detail.resident.email },
                          { label: 'Move-In', value: detail.resident.moveIn },
                          { label: 'Preferred', value: detail.resident.preferred },
                          { label: 'Emergency Contact', value: detail.resident.emergencyContact },
                        ]}
                      />
                    </div>
                    <div className="mt-5 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => openThread('resident')}
                        className="sa-press inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-[12px] font-medium text-[#1447e6] outline-none hover:bg-[#dbeafe] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                      >
                        <ThreadIcon />
                        See thread
                      </button>
                      {canSeeVendorThread ? (
                        <button
                          type="button"
                          onClick={() => openThread('vendor')}
                          className="sa-press inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                        >
                          <ThreadIcon />
                          See vendor thread
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="sa-press inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                      >
                        <MailIcon />
                        Email
                      </button>
                    </div>
                  </section>
                ) : null}

                <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                  <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Property</h3>
                  <div className="mt-5">
                    <FieldGrid
                      columns={2}
                      fields={[
                        { label: 'Property', value: detail.property.property },
                        { label: 'Building', value: detail.property.building },
                        { label: 'Address', value: detail.property.address },
                        { label: 'Unit', value: detail.property.unit },
                        { label: 'Manager', value: detail.property.manager },
                        { label: 'Access', value: detail.property.access },
                        { label: 'Entry Code', value: detail.property.entryCode },
                      ]}
                    />
                  </div>
                </section>
              </div>

              <WorkOrderPhotosSection
                title="Photos & videos from conversation"
                subtitle={conversationPhotosSubtitle(detail)}
                attachments={detail.attachments}
              />
              <WorkOrderPhotosSection
                title="Vendor completion photos"
                subtitle="Uploaded by the vendor when closing out the job"
                attachments={detail.vendorAttachments ?? []}
              />
            </div>
          )}
        </div>

        {canDeleteWorkOrder && !showingThread && !loading && detail ? (
          <div className="shrink-0 border-t border-[#e5e7eb] bg-white px-6 py-4">
            <button
              type="button"
              onClick={() => {
                setDeleteError(null)
                setDeleteConfirmOpen(true)
              }}
              className="sa-press inline-flex w-full cursor-pointer items-center justify-center rounded-[8px] border border-[#b52a00]/30 bg-white px-3 py-2.5 text-[13px] font-medium text-[#b52a00] outline-none hover:bg-[#fff4f0] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
            >
              Delete work order
            </button>
          </div>
        ) : null}
      </div>

      {deleteConfirmOpen && detail ? (
        <div className="fixed inset-0 z-[81] flex items-center justify-center bg-black/40 p-4">
          <div
            role="presentation"
            className="absolute inset-0"
            aria-hidden
            onClick={() => {
              if (!deleteSaving) {
                setDeleteError(null)
                setDeleteConfirmOpen(false)
              }
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={deleteConfirmTitleId}
            className="sa-modal relative flex w-full max-w-[440px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#e5e7eb] px-6 py-4">
              <h2
                id={deleteConfirmTitleId}
                className="text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-[#0a0a0a]"
              >
                Are you sure you want to do this?
              </h2>
            </div>
            <div className="flex flex-col gap-4 px-6 pb-6 pt-4">
              <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
                This will permanently delete{' '}
                <span className="font-medium text-[#0a0a0a]">{detail.workOrderRef}</span>, including
                its ticket and workflow history. This cannot be undone.
              </p>
              <p className="text-[13px] leading-5 text-[#6a7282]">
                Resident SMS history is kept; only this work order is deleted.
              </p>
              {deleteError ? (
                <p className="text-[13px] leading-4 text-[#b52a00]" role="alert">
                  {deleteError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="button"
                  disabled={deleteSaving}
                  className="sa-press inline-flex h-9 min-w-0 flex-1 items-center justify-center rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#b52a00] outline-none hover:bg-[#ffe9e1] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 sm:flex-initial"
                  onClick={() => void handleDeleteWorkOrder()}
                >
                  {deleteSaving ? 'Deleting…' : 'Yes, delete permanently'}
                </button>
                <button
                  type="button"
                  disabled={deleteSaving}
                  className="sa-press inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
                  onClick={() => {
                    if (!deleteSaving) {
                      setDeleteError(null)
                      setDeleteConfirmOpen(false)
                    }
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
