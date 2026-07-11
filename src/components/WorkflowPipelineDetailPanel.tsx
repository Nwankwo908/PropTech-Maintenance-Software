import { useEffect, useId, useState } from 'react'
import { ConversationMonitoringBody } from '@/components/ConversationMonitoringModal'
import {
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

function ConversationPhotosSection({
  attachments,
  subtitle,
}: {
  attachments: WorkflowPipelineAttachment[]
  subtitle: string
}) {
  if (attachments.length === 0) return null

  return (
    <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div>
        <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Photos from conversation</h3>
        <p className="text-[12px] leading-4 text-[#6a7282]">{subtitle}</p>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {attachments.map((attachment) => (
          <div
            key={`${attachment.name}-${attachment.url ?? attachment.sizeLabel}`}
            className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-[#fafafa]"
          >
            {attachment.url && attachment.kind === 'image' ? (
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
                {attachment.kind === 'image' ? <ImageIcon /> : <DocumentIcon />}
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
  return 'Sent by the tenant in the SMS thread'
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

function WorkflowProgressStepper({
  steps,
  caption,
}: {
  steps: WorkflowPipelineStep[]
  caption: string
}) {
  const stepCount = steps.length
  const activeIndex = steps.findIndex((step) => step.state === 'active')
  const lastCompleteIndex = steps.reduce(
    (lastIndex, step, index) => (step.state === 'complete' ? index : lastIndex),
    -1,
  )
  const progressIndex = activeIndex >= 0 ? activeIndex : Math.max(0, lastCompleteIndex)
  const trackInset = stepCount > 0 ? `${100 / (2 * stepCount)}%` : '0%'
  const fillWidth =
    stepCount <= 1
      ? '0%'
      : `calc((100% - ${100 / stepCount}%) * ${progressIndex / (stepCount - 1)})`

  return (
    <section className="w-full rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Workflow Progress</h3>
        <span className="text-[12px] font-medium text-[#6a7282]">{caption}</span>
      </div>

      {/* Small screens: vertical list so every stage label stays readable */}
      <ol className="flex flex-col md:hidden">
        {steps.map((step, index) => (
          <li key={step.label} className="flex gap-3">
            <div className="flex w-7 shrink-0 flex-col items-center">
              <WorkflowStepIndicator step={step} index={index} />
              {index < steps.length - 1 ? (
                <div
                  className={[
                    'my-1 w-0.5 flex-1 min-h-3',
                    step.state === 'complete' ? 'bg-[#00a63e]' : 'bg-[#e5e7eb]',
                  ].join(' ')}
                  aria-hidden
                />
              ) : null}
            </div>
            <p
              className={[
                'min-w-0 flex-1 pb-4 pt-1 text-[13px] leading-5',
                step.state === 'active'
                  ? 'font-semibold text-[#0a0a0a]'
                  : step.state === 'complete'
                    ? 'text-[#364153]'
                    : 'text-[#6a7282]',
              ].join(' ')}
            >
              {step.label}
            </p>
          </li>
        ))}
      </ol>

      {/* md+: horizontal stepper */}
      <div className="relative hidden w-full md:block">
        {stepCount > 1 ? (
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
          style={{ gridTemplateColumns: `repeat(${Math.max(stepCount, 1)}, minmax(0, 1fr))` }}
        >
          {steps.map((step, index) => (
            <div key={step.label} className="flex min-w-0 flex-col items-center px-1">
              <WorkflowStepIndicator step={step} index={index} />
              <p
                className={[
                  'mt-2 w-full px-0.5 text-center text-[11px] leading-4 break-words',
                  step.state === 'active'
                    ? 'font-semibold text-[#0a0a0a]'
                    : 'text-[#364153]',
                ].join(' ')}
              >
                {step.label}
              </p>
            </div>
          ))}
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
  const [threadDetail, setThreadDetail] = useState<ConversationMonitoringDetail | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [moveOutActionSaving, setMoveOutActionSaving] = useState(false)
  const [moveOutActionError, setMoveOutActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setPanelView('work_order')
      setThreadDetail(null)
      setThreadError(null)
      setThreadLoading(false)
    }
  }, [open])

  useEffect(() => {
    setPanelView('work_order')
    setThreadDetail(null)
    setThreadError(null)
    setThreadLoading(false)
  }, [detail?.runId])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (panelView === 'thread') {
        setPanelView('work_order')
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, panelView])

  useEffect(() => {
    if (!open || panelView !== 'thread' || !detail) {
      return
    }

    let cancelled = false
    setThreadLoading(true)
    setThreadError(null)
    setThreadDetail(null)

    const loadThread = async () => {
      if (!detail.uloThread) return null
      return fetchWorkflowUloThreadMonitoring(detail.uloThread)
    }

    void loadThread().then((result) => {
      if (cancelled) return
      setThreadLoading(false)
      if (!result) {
        setThreadError('Could not load the Ulo conversation for this workflow.')
        return
      }
      setThreadDetail(result)
    })

    return () => {
      cancelled = true
    }
  }, [open, panelView, detail])

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
      setMoveOutActionError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setMoveOutActionSaving(false)
    }
  }

  if (!open) return null

  const canSeeThread = Boolean(detail?.uloThread)
  const showingThread = panelView === 'thread'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,920px)] flex-col overflow-hidden rounded-l-[12px] border border-[#e5e7eb] bg-[#f9fafb] shadow-[0px_8px_24px_rgba(0,0,0,0.12)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#e5e7eb] bg-white px-6 py-4">
          <div className="min-w-0 flex-1">
            {showingThread ? (
              <>
                <button
                  type="button"
                  onClick={() => setPanelView('work_order')}
                  className="inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[13px] font-medium text-[#1447e6] outline-none hover:bg-[#eff6ff] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                >
                  <BackIcon />
                  Back to task
                </button>
                <h2 id={threadTitleId} className="mt-3 text-[24px] font-semibold leading-8 tracking-[-0.3px] text-[#0a0a0a]">
                  {detail?.uloThread?.kind === 'move_in'
                    ? 'Move-in coordination'
                    : detail?.uloThread?.kind === 'inspection'
                      ? 'Conversational inspection'
                      : 'Resident conversation'}
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                  {detail?.uloThread?.kind === 'move_in'
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
                  <span className={`inline-flex rounded-[6px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${detail.stageClassName}`}>
                    {detail.stageLabel}
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
                  {detail.locationLine ? ` · ${detail.locationLine}` : ''}
                </p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
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
              <div className="flex min-h-[min(70dvh,720px)] flex-col overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                <ConversationMonitoringBody detail={threadDetail} titleId={threadTitleId} embedded />
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
                        className="inline-flex cursor-pointer items-center rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-medium text-[#364153] outline-none transition-colors hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] disabled:opacity-50"
                      >
                        {MOVE_OUT_ADMIN_ACTION_LABELS[action]}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Overview</h3>
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
                {canSeeThread && !detail.resident ? (
                  <div className="mt-5 border-t border-[#f3f4f6] pt-5">
                    <button
                      type="button"
                      onClick={() => setPanelView('thread')}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-[12px] font-medium text-[#1447e6] outline-none hover:bg-[#dbeafe] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 sm:w-auto"
                    >
                      <ThreadIcon />
                      See thread
                    </button>
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
                        onClick={() => setPanelView('thread')}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-[12px] font-medium text-[#1447e6] outline-none hover:bg-[#dbeafe] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                      >
                        <ThreadIcon />
                        See thread
                      </button>
                      <button
                        type="button"
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
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

              <ConversationPhotosSection
                attachments={detail.attachments}
                subtitle={conversationPhotosSubtitle(detail)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
