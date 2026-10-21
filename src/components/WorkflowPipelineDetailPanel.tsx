import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ConversationMonitoringBody } from '@/components/ConversationMonitoringModal'
import { WorkflowStageMoveDialogs } from '@/components/workflowKanban/WorkflowStageMoveDialogs'
import { useWorkflowStageMove } from '@/components/workflowKanban/useWorkflowStageMove'
import { deleteWorkOrderPermanently } from '@/api/deleteWorkOrder'
import { postAdminReassignVendor, resolveAdminReassignUrl } from '@/api/adminReassignVendor'
import { requireAdminEdgeSecret } from '@/lib/adminEdgeAuth'
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
import {
  WORKFLOW_KANBAN_STAGES,
  WORKFLOW_STAGE_LABEL,
  type WorkflowKanbanCard,
  type WorkflowKanbanStageId,
} from '@/lib/adminWorkflowKanban'
import { canStageMoveKanbanCard } from '@/lib/workflowStageMoveCard'
import type {
  WorkflowPipelineAttachment,
  WorkflowPipelineDetail,
  WorkflowPipelineField,
  WorkflowPipelineStep,
} from '@/lib/workflowPipelineDetail'
import { getErrorMessage } from '@/lib/errorMessage'
import { residentDetailPath } from '@/lib/propertyRoutes'
import { supabase } from '@/lib/supabase'

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

function FieldGrid({
  fields,
  columns = 4,
  overrides,
}: {
  fields: WorkflowPipelineField[]
  columns?: 2 | 4
  overrides?: Partial<Record<string, { control: ReactNode }>>
}) {
  const gridClass = columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4'
  return (
    <div className={`grid grid-cols-1 gap-4 ${gridClass}`}>
      {fields.map((field) => {
        const override = overrides?.[field.label]
        return (
          <div key={field.label} className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
              {field.label}
            </p>
            {override ? (
              <div className="mt-1">{override.control}</div>
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-[14px] font-medium leading-5 text-[#0a0a0a]">
                {field.value}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function detailToStageMoveCard(detail: WorkflowPipelineDetail): WorkflowKanbanCard | null {
  if (!detail.isMaintenanceWorkflow || !detail.kanbanStage) return null
  const ticketIds =
    detail.stageMoveTicketIds.length > 0
      ? detail.stageMoveTicketIds
      : detail.maintenanceRequestId
        ? [detail.maintenanceRequestId]
        : []
  if (ticketIds.length === 0) return null
  return {
    id: detail.runId,
    title: detail.title,
    context: detail.locationLine || '—',
    category: 'maintenance',
    issueCategoryLabel: null,
    workOrderRef: detail.workOrderRef || null,
    workOrderSummary: null,
    stage: detail.kanbanStage,
    critical: false,
    initials: null,
    templateId: detail.templateId || 'maintenance_request',
    ticketId: detail.maintenanceRequestId || ticketIds[0]!,
    stageMoveTicketIds: ticketIds,
    assignedVendorId: detail.assignedVendorId,
    assignedVendorName: detail.assignedVendorName,
    inspectionReportId: detail.inspectionReportId,
    inspectionChecklist: detail.inspectionGroup
      ? detail.inspectionGroup.items.map((item) => ({
          ticketId: item.ticketId,
          workOrderRef: item.workOrderRef,
          label: item.label,
          statusLabel: item.statusLabel,
          stage: detail.kanbanStage!,
          runId: item.runId,
          assignedVendorId: detail.assignedVendorId,
        }))
      : null,
  }
}

const selectClassName =
  'mt-0 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-2.5 py-1.5 text-[14px] font-medium text-[#0a0a0a] outline-none hover:border-[#d1d5db] focus-visible:ring-2 focus-visible:ring-[#0030b5]'

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

function resolveWorkflowProgressIndex(steps: WorkflowPipelineStep[]): number {
  const activeIndex = steps.findIndex((step) => step.state === 'active')
  const lastCompleteIndex = steps.reduce(
    (lastIndex, step, index) => (step.state === 'complete' ? index : lastIndex),
    -1,
  )
  return activeIndex >= 0 ? activeIndex : Math.max(0, lastCompleteIndex)
}

function WorkflowProgressStepper({
  steps,
  caption,
  title,
  nextAction,
  changeStage,
}: {
  steps: WorkflowPipelineStep[]
  caption: string
  title: string
  nextAction?: string | null
  changeStage?: {
    current: WorkflowKanbanStageId
    busy: boolean
    options: Array<{ id: WorkflowKanbanStageId; label: string; disabled: boolean; reason?: string }>
    onChange: (to: WorkflowKanbanStageId) => void
  } | null
}) {
  const stepCount = steps.length
  const progressIndex = resolveWorkflowProgressIndex(steps)
  const trackInset = stepCount > 0 ? `${100 / (2 * stepCount)}%` : '0%'
  const fillWidth =
    stepCount <= 1
      ? '0%'
      : `calc((100% - ${100 / stepCount}%) * ${progressIndex / (stepCount - 1)})`
  const [stageMenuOpen, setStageMenuOpen] = useState(false)

  return (
    <section className="w-full rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">{title}</h3>
          {changeStage ? (
            <div className="relative">
              <button
                type="button"
                disabled={changeStage.busy}
                aria-expanded={stageMenuOpen}
                aria-haspopup="listbox"
                onClick={() => setStageMenuOpen((open) => !open)}
                className="sa-press inline-flex h-7 items-center rounded-[8px] border border-[#e5e7eb] bg-white px-2.5 text-[12px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] disabled:opacity-50"
              >
                Change stage
              </button>
              {stageMenuOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Close stage menu"
                    className="fixed inset-0 z-[1] cursor-default"
                    onClick={() => setStageMenuOpen(false)}
                  />
                  <ul
                    role="listbox"
                    aria-label="Change repair stage"
                    className="absolute left-0 top-full z-[2] mt-1 min-w-[11rem] overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white py-1 shadow-[0px_8px_24px_rgba(16,24,40,0.12)]"
                  >
                    {changeStage.options.map((option) => {
                      const selected = option.id === changeStage.current
                      return (
                        <li key={option.id} role="option" aria-selected={selected}>
                          <button
                            type="button"
                            disabled={option.disabled || selected || changeStage.busy}
                            title={option.disabled ? option.reason : undefined}
                            onClick={() => {
                              setStageMenuOpen(false)
                              if (!selected && !option.disabled) changeStage.onChange(option.id)
                            }}
                            className={[
                              'flex w-full items-center px-3 py-2 text-left text-[13px] outline-none',
                              selected
                                ? 'bg-[#f3f4f6] font-semibold text-[#0a0a0a]'
                                : option.disabled
                                  ? 'cursor-not-allowed text-[#9ca3af]'
                                  : 'text-[#364153] hover:bg-[#f9fafb]',
                            ].join(' ')}
                          >
                            {option.label}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <span className="shrink-0 text-[12px] font-medium text-[#6a7282]">{caption}</span>
      </div>

      <div className="-mx-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
        <div
          className="relative min-w-0"
          style={{
            minWidth: stepCount > 4 ? `${stepCount * 4.5}rem` : undefined,
          }}
        >
          {stepCount > 1 ? (
            <>
              <div
                className="pointer-events-none absolute top-[14px] h-0.5 bg-[#e5e7eb]"
                style={{ left: trackInset, right: trackInset }}
              />
              <div
                className="pointer-events-none absolute top-[14px] h-0.5 bg-[#00a63e] transition-[width] duration-200"
                style={{ left: trackInset, width: fillWidth }}
              />
            </>
          ) : null}
          <div
            className="relative grid w-full"
            style={{ gridTemplateColumns: `repeat(${Math.max(stepCount, 1)}, minmax(0, 1fr))` }}
            aria-hidden={false}
          >
            {steps.map((step, index) => (
              <div
                key={`${step.label}-${index}`}
                className="pointer-events-none flex min-w-0 flex-col items-center px-1"
              >
                <WorkflowStepIndicator step={step} index={index} />
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
            ))}
          </div>
        </div>
      </div>
      {stepCount > 4 ? (
        <p className="mt-2 text-[11px] text-[#9ca3af] sm:hidden">Swipe to see all {stepCount} steps</p>
      ) : null}

      {nextAction ? (
        <p className="mt-4 break-words text-[13px] leading-5 text-[#364153]">{nextAction}</p>
      ) : null}
      {changeStage?.busy ? (
        <p className="mt-2 text-[12px] text-[#6a7282]">Updating stage…</p>
      ) : null}
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
  const location = useLocation()
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
  const [vendorOptions, setVendorOptions] = useState<string[]>([])
  const [vendorSaving, setVendorSaving] = useState(false)
  const [vendorSaveError, setVendorSaveError] = useState<string | null>(null)

  const stageMoveCard = useMemo(
    () => (detail ? detailToStageMoveCard(detail) : null),
    [detail],
  )
  const canOverrideStage = Boolean(stageMoveCard && canStageMoveKanbanCard(stageMoveCard))
  const canOverrideVendor = Boolean(
    detail?.isMaintenanceWorkflow && (detail.maintenanceRequestId || stageMoveCard),
  )

  const stageMove = useWorkflowStageMove({
    onReload: () => {
      onWorkflowUpdated?.()
    },
    vendorOptions,
  })

  const currentVendorName =
    detail?.assignedVendorName?.trim() ||
    detail?.overviewFields.find((field) => field.label === 'Vendor')?.value?.trim() ||
    ''
  const vendorSelectOptions = useMemo(() => {
    const names = [...vendorOptions]
    if (currentVendorName && currentVendorName !== '—' && !names.includes(currentVendorName)) {
      names.unshift(currentVendorName)
    }
    return names
  }, [vendorOptions, currentVendorName])

  useEffect(() => {
    if (!open || !canOverrideVendor) return
    const landlordId = getActiveLandlordId()
    if (!landlordId || !supabase) return
    let cancelled = false
    void supabase
      .from('vendors')
      .select('name')
      .eq('landlord_id', landlordId)
      .order('name', { ascending: true })
      .limit(300)
      .then(({ data }) => {
        if (cancelled) return
        const names = (data ?? [])
          .map((row) => (typeof row.name === 'string' ? row.name.trim() : ''))
          .filter(Boolean)
        setVendorOptions([...new Set(names)])
      })
    return () => {
      cancelled = true
    }
  }, [open, canOverrideVendor, detail?.runId])

  async function handleStageOverride(toStage: WorkflowKanbanStageId) {
    if (!stageMoveCard || toStage === stageMoveCard.stage) return
    const gate = stageMove.gateFor(stageMoveCard, toStage)
    if (gate.kind === 'needs_vendor_modal') {
      stageMove.setError('Select a vendor below, then move to Assigned.')
      return
    }
    await stageMove.requestMove(stageMoveCard, toStage)
  }

  async function handleVendorOverride(nextVendor: string) {
    const trimmed = nextVendor.trim()
    if (!trimmed || trimmed === currentVendorName) return
    const openVisitIds =
      detail?.inspectionGroup?.items
        .filter((item) => !/completed|cancelled/i.test(item.statusLabel))
        .map((item) => item.ticketId.trim())
        .filter(Boolean) ?? []
    const ticketIds =
      openVisitIds.length > 0
        ? openVisitIds
        : stageMoveCard?.stageMoveTicketIds.length
          ? stageMoveCard.stageMoveTicketIds
          : detail?.maintenanceRequestId
            ? [detail.maintenanceRequestId]
            : []
    if (ticketIds.length === 0) {
      setVendorSaveError('This card is not linked to a work order.')
      return
    }
    const url = resolveAdminReassignUrl()
    if (!url) {
      setVendorSaveError('Vendor reassignment is not configured.')
      return
    }
    setVendorSaving(true)
    setVendorSaveError(null)
    stageMove.setError(null)
    try {
      const secret = requireAdminEdgeSecret('Reassign vendor')
      for (const ticketId of ticketIds) {
        await postAdminReassignVendor({
          url,
          secret,
          ticketId,
          vendorName: trimmed,
          createVendorIfMissing: true,
        })
      }
      onWorkflowUpdated?.()
    } catch (err) {
      setVendorSaveError(err instanceof Error ? err.message : 'Could not assign vendor.')
    } finally {
      setVendorSaving(false)
    }
  }

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
      setVendorSaveError(null)
      setVendorSaving(false)
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
    setVendorSaveError(null)
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
                {detail.locationLine ? (
                  <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                    {detail.locationLine}
                  </p>
                ) : null}
                <p className="mt-0.5 text-[13px] leading-5 text-[#6a7282]">
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
              {stageMove.error && detail.isMaintenanceWorkflow ? (
                <div className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b52a00]">
                  {stageMove.error}
                </div>
              ) : null}
              <WorkflowProgressStepper
                key={detail.runId}
                steps={detail.progressSteps}
                caption={detail.progressCaption}
                title={
                  detail.isMaintenanceWorkflow
                    ? 'Repair progress'
                    : detail.isMoveOutWorkflow
                      ? 'Move-out progress'
                      : 'Workflow progress'
                }
                nextAction={detail.progressNextAction}
                changeStage={
                  detail.isMaintenanceWorkflow && canOverrideStage && stageMoveCard
                    ? {
                        current: stageMoveCard.stage,
                        busy: stageMove.busy || vendorSaving,
                        options: WORKFLOW_KANBAN_STAGES.map((stage) => {
                          const gate =
                            stage.id === stageMoveCard.stage
                              ? null
                              : stageMove.gateFor(stageMoveCard, stage.id)
                          const blocked =
                            gate != null &&
                            (gate.kind === 'blocked' || gate.kind === 'not_draggable')
                          return {
                            id: stage.id,
                            label: stage.label,
                            disabled: blocked,
                            reason: blocked ? gate.reason : undefined,
                          }
                        }),
                        onChange: (to) => {
                          void handleStageOverride(to)
                        },
                      }
                    : null
                }
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

              {detail.inspectionGroup ? (
                <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">
                        Inspection fail items
                      </h3>
                      <p className="mt-1 text-[13px] text-[#6a7282]">
                        {detail.inspectionGroup.reportRef} · {detail.inspectionGroup.progressLabel}
                      </p>
                    </div>
                  </div>
                  <ul className="mt-4 flex flex-col gap-2">
                    {detail.inspectionGroup.items.map((item) => (
                      <li
                        key={item.ticketId}
                        className="flex items-start justify-between gap-3 rounded-[8px] border border-[#f3f4f6] bg-[#f9fafb] px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-[#0a0a0a]">{item.label}</p>
                          <p className="mt-0.5 text-[12px] text-[#6a7282]">{item.workOrderRef}</p>
                        </div>
                        <span className="shrink-0 rounded-[6px] bg-white px-2 py-0.5 text-[11px] font-medium text-[#364153] ring-1 ring-[#e5e7eb]">
                          {item.statusLabel}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Overview</h3>
                <p className="mt-3 whitespace-pre-wrap text-[14px] leading-6 text-[#364153]">
                  {detail.description}
                </p>
                {detail.statusContext ? (
                  <p className="mt-2 text-[13px] leading-5 text-[#6a7282]">{detail.statusContext}</p>
                ) : null}
                <div className="mt-5 border-t border-[#f3f4f6] pt-5">
                  {stageMove.error || vendorSaveError ? (
                    <div className="mb-3 rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b52a00]">
                      {vendorSaveError || stageMove.error}
                    </div>
                  ) : null}
                  <FieldGrid
                    fields={detail.overviewFields}
                    overrides={{
                      ...(canOverrideStage && stageMoveCard
                        ? {
                            Status: {
                              control: (
                                <select
                                  aria-label="Override work order stage"
                                  className={selectClassName}
                                  disabled={stageMove.busy || vendorSaving}
                                  value={stageMoveCard.stage}
                                  onChange={(e) => {
                                    void handleStageOverride(
                                      e.target.value as WorkflowKanbanStageId,
                                    )
                                  }}
                                >
                                  {WORKFLOW_KANBAN_STAGES.map((stage) => {
                                    const gate =
                                      stage.id === stageMoveCard.stage
                                        ? null
                                        : stageMove.gateFor(stageMoveCard, stage.id)
                                    const blocked =
                                      gate != null &&
                                      (gate.kind === 'blocked' || gate.kind === 'not_draggable')
                                    return (
                                      <option
                                        key={stage.id}
                                        value={stage.id}
                                        disabled={blocked}
                                        title={blocked ? gate.reason : undefined}
                                      >
                                        {stage.label}
                                      </option>
                                    )
                                  })}
                                </select>
                              ),
                            },
                          }
                        : {}),
                      ...(canOverrideVendor
                        ? {
                            Vendor: {
                              control: (
                                <select
                                  aria-label="Override assigned vendor"
                                  className={selectClassName}
                                  disabled={stageMove.busy || vendorSaving}
                                  value={
                                    currentVendorName && currentVendorName !== '—'
                                      ? currentVendorName
                                      : ''
                                  }
                                  onChange={(e) => {
                                    void handleVendorOverride(e.target.value)
                                  }}
                                >
                                  <option value="" disabled={Boolean(currentVendorName && currentVendorName !== '—')}>
                                    Select a vendor…
                                  </option>
                                  {vendorSelectOptions.map((name) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ))}
                                </select>
                              ),
                            },
                          }
                        : {}),
                    }}
                  />
                </div>
                {detail.maintenanceDetails.length > 0 ? (
                  <div className="mt-5 border-t border-[#f3f4f6] pt-5">
                    <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                      Maintenance Details
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                      {detail.maintenanceDetails.slice(0, 3).map((field) => (
                        <div key={field.label}>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
                            {field.label}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[14px] font-medium leading-5 text-[#0a0a0a]">{field.value}</p>
                        </div>
                      ))}
                      <div className="flex min-w-0 flex-col gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
                          Actions
                        </p>
                        {canSeeThread ? (
                          <button
                            type="button"
                            onClick={() => openThread('resident')}
                            className="sa-press inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-[12px] font-medium text-[#1447e6] outline-none hover:bg-[#dbeafe] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                          >
                            <ThreadIcon />
                            See thread
                          </button>
                        ) : null}
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
                        {detail.resident.id ? (
                          <Link
                            to={residentDetailPath(detail.resident.id)}
                            state={{ from: `${location.pathname}${location.search}` }}
                            className="sa-link text-[15px] font-semibold leading-5 text-[#186179] hover:text-[#0f4d5f] hover:underline"
                          >
                            {detail.resident.name}
                          </Link>
                        ) : (
                          <p className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">{detail.resident.name}</p>
                        )}
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
                  </section>
                ) : null}

                <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
                  <h3 className="text-[15px] font-semibold leading-6 text-[#0a0a0a]">Property</h3>
                  <div className="mt-5">
                    <FieldGrid
                      columns={2}
                      fields={[
                        { label: 'Address', value: detail.property.address },
                        { label: 'Unit', value: detail.property.unit },
                        { label: 'Manager', value: detail.property.manager },
                        ...(detail.property.accessRows.length === 0
                          ? [
                              { label: 'Access', value: detail.property.access },
                              { label: 'Entry Code', value: detail.property.entryCode },
                            ]
                          : []),
                      ]}
                    />
                    {detail.property.accessRows.length > 0 ? (
                      <div className="mt-5 border-t border-[#f3f4f6] pt-5">
                        <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                          Property access
                        </p>
                        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {detail.property.accessRows.map((row) => (
                            <div key={row.label} className="min-w-0">
                              <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9ca3af]">
                                {row.label}
                              </dt>
                              <dd className="mt-1 whitespace-pre-wrap text-[14px] font-medium leading-5 text-[#0a0a0a]">
                                {row.value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ) : null}
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

      <WorkflowStageMoveDialogs
        request={stageMove.confirm}
        busy={stageMove.busy}
        onCancel={() => stageMove.setConfirm(null)}
        onConfirm={(opts) => {
          if (!stageMove.confirm || !stageMoveCard) return
          void stageMove.executeMove({
            card: stageMoveCard,
            fromStage: stageMove.confirm.fromStage,
            toStage: stageMove.confirm.toStage,
            ...opts,
          })
        }}
      />

      {stageMove.toast ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-3 rounded-[10px] bg-[#101828] px-4 py-3 text-[14px] text-white shadow-lg"
        >
          <span>
            {stageMove.toast.message ||
              `Moved to ${WORKFLOW_STAGE_LABEL[stageMove.toast.undoFrom]}`}{' '}
            ·{' '}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => void stageMove.undoMove()}
            >
              Undo
            </button>
          </span>
        </div>
      ) : null}
    </div>
  )
}
