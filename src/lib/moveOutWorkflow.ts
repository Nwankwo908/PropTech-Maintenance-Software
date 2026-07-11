import type { AdminWorkflowRow } from '@/lib/adminWorkflows'
import { lifecycleStepKey } from '@/lib/adminWorkflowKanban'

export type MoveOutTimelineStepKey =
  | 'move_out_started'
  | 'instructions_sent'
  | 'cleaning_scheduled'
  | 'inspection_scheduled'
  | 'inspection_completed'
  | 'keys_returned'
  | 'deposit_review'
  | 'move_out_complete'

export type MoveOutChecklistKey =
  | 'resident_notified'
  | 'instructions_delivered'
  | 'notice_received'
  | 'utilities_confirmed'
  | 'cleaning_scheduled'
  | 'keys_return_scheduled'
  | 'inspection_scheduled'
  | 'inspection_completed'
  | 'keys_returned'
  | 'deposit_review_completed'
  | 'property_ready_for_turnover'

export type MoveOutTimelineStep = {
  key: MoveOutTimelineStepKey
  label: string
  state: 'complete' | 'active' | 'upcoming'
  completedAt: string | null
}

export type MoveOutChecklistItem = {
  key: MoveOutChecklistKey
  label: string
  complete: boolean
}

export type MoveOutAdminAction =
  | 'send_reminder'
  | 'schedule_inspection'
  | 'update_move_out_date'
  | 'mark_keys_returned'
  | 'complete_cleaning'
  | 'upload_inspection_report'
  | 'complete_move_out'
  | 'cancel_move_out'

export const MOVE_OUT_TIMELINE_DEFINITION: Array<{ key: MoveOutTimelineStepKey; label: string }> = [
  { key: 'move_out_started', label: 'Initiated' },
  { key: 'instructions_sent', label: 'Instructions Sent' },
  { key: 'cleaning_scheduled', label: 'Cleaning Scheduled' },
  { key: 'inspection_scheduled', label: 'Inspection Scheduled' },
  { key: 'inspection_completed', label: 'Inspection Completed' },
  { key: 'keys_returned', label: 'Keys Returned' },
  { key: 'deposit_review', label: 'Security Deposit Review' },
  { key: 'move_out_complete', label: 'Complete' },
]

export const MOVE_OUT_CHECKLIST_DEFINITION: Array<{ key: MoveOutChecklistKey; label: string }> = [
  { key: 'resident_notified', label: 'Resident notified' },
  { key: 'instructions_delivered', label: 'Move-out instructions delivered' },
  { key: 'notice_received', label: 'Notice received' },
  { key: 'utilities_confirmed', label: 'Utilities confirmed' },
  { key: 'cleaning_scheduled', label: 'Cleaning scheduled' },
  { key: 'keys_return_scheduled', label: 'Keys return scheduled' },
  { key: 'inspection_scheduled', label: 'Inspection scheduled' },
  { key: 'inspection_completed', label: 'Inspection completed' },
  { key: 'keys_returned', label: 'Keys returned' },
  { key: 'deposit_review_completed', label: 'Deposit review completed' },
  { key: 'property_ready_for_turnover', label: 'Property ready for turnover' },
]

export const MOVE_OUT_ADMIN_ACTION_LABELS: Record<MoveOutAdminAction, string> = {
  send_reminder: 'Send Reminder',
  schedule_inspection: 'Schedule Inspection',
  update_move_out_date: 'Update Move-Out Date',
  mark_keys_returned: 'Mark Keys Returned',
  complete_cleaning: 'Complete Cleaning',
  upload_inspection_report: 'Upload Inspection Report',
  complete_move_out: 'Complete Move-Out',
  cancel_move_out: 'Cancel Move-Out Workflow',
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function readBool(value: unknown): boolean {
  return value === true
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function deriveActiveTimelineKey(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
): MoveOutTimelineStepKey {
  if (row.status === 'completed') return 'move_out_complete'
  const step = lifecycleStepKey(row)
  const checklist = readRecord(metadata.checklist)
  const milestones = readRecord(metadata.milestones)

  if (readBool(checklist.property_ready_for_turnover)) return 'move_out_complete'
  if (readBool(checklist.deposit_review_completed) || step === 'deposit_pending') return 'deposit_review'
  if (readBool(checklist.keys_returned) || step === 'unit_vacated') return 'keys_returned'
  if (readBool(checklist.inspection_completed)) return 'inspection_completed'
  if (readBool(checklist.inspection_scheduled) || step === 'inspection_scheduled') {
    return 'inspection_scheduled'
  }
  if (readBool(checklist.keys_return_scheduled)) return 'inspection_scheduled'
  if (readBool(checklist.cleaning_scheduled) || step === 'turnover_in_progress') return 'cleaning_scheduled'
  if (readBool(checklist.notice_received) || step === 'awaiting_vacate') return 'cleaning_scheduled'
  if (
    readString(milestones.instructions_sent) ||
    readBool(checklist.instructions_delivered)
  ) {
    return 'cleaning_scheduled'
  }
  if (
    readString(milestones.resident_notified) ||
    readBool(checklist.resident_notified) ||
    step === 'notice_sent'
  ) {
    return 'instructions_sent'
  }
  return 'move_out_started'
}

export function buildMoveOutTimeline(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown>,
): MoveOutTimelineStep[] {
  const milestones = readRecord(metadata.milestones)
  const activeKey = deriveActiveTimelineKey(row, metadata)
  const activeIndex = MOVE_OUT_TIMELINE_DEFINITION.findIndex((step) => step.key === activeKey)

  return MOVE_OUT_TIMELINE_DEFINITION.map((step, index) => {
    const completedAt = readString(milestones[step.key])
    let state: MoveOutTimelineStep['state'] = 'upcoming'
    if (row.status === 'completed' && step.key === 'move_out_complete') {
      state = 'complete'
    } else if (completedAt || index < activeIndex) {
      state = 'complete'
    } else if (index === activeIndex) {
      state = 'active'
    }
    return {
      key: step.key,
      label: step.label,
      state,
      completedAt,
    }
  })
}

export function buildMoveOutChecklist(metadata: Record<string, unknown>): MoveOutChecklistItem[] {
  const checklist = readRecord(metadata.checklist)
  return MOVE_OUT_CHECKLIST_DEFINITION.map((item) => ({
    key: item.key,
    label: item.label,
    complete: readBool(checklist[item.key]),
  }))
}

export function moveOutProgressPercent(timeline: MoveOutTimelineStep[]): number {
  if (!timeline.length) return 0
  const completed = timeline.filter((step) => step.state === 'complete').length
  const active = timeline.some((step) => step.state === 'active') ? 0.5 : 0
  return Math.min(100, Math.round(((completed + active) / timeline.length) * 100))
}

export function moveOutPipelineTitle(): string {
  return 'Move-Out Preparation'
}

export function formatMoveOutDateLabel(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—'
  const date = new Date(iso.includes('T') ? iso : `${iso.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const ACTION_PATCH: Partial<
  Record<
    MoveOutAdminAction,
    {
      checklist?: Partial<Record<MoveOutChecklistKey, boolean>>
      milestone?: MoveOutTimelineStepKey
      currentStep?: string
      status?: 'active' | 'completed' | 'cancelled'
      graphEvent?: string
      message: string
    }
  >
> = {
  send_reminder: {
    graphEvent: 'move_out.reminder_sent',
    message: 'Move-out reminder sent by admin',
  },
  schedule_inspection: {
    checklist: { inspection_scheduled: true },
    milestone: 'inspection_scheduled',
    currentStep: 'inspection_scheduled',
    graphEvent: 'move_out.inspection_scheduled',
    message: 'Move-out inspection scheduled',
  },
  mark_keys_returned: {
    checklist: { keys_returned: true },
    milestone: 'keys_returned',
    currentStep: 'unit_vacated',
    graphEvent: 'move_out.keys_returned',
    message: 'Keys marked returned by admin',
  },
  complete_cleaning: {
    checklist: { cleaning_scheduled: true },
    milestone: 'cleaning_scheduled',
    currentStep: 'turnover_in_progress',
    graphEvent: 'move_out.cleaning_completed',
    message: 'Cleaning marked complete',
  },
  complete_move_out: {
    checklist: {
      deposit_review_completed: true,
      property_ready_for_turnover: true,
    },
    milestone: 'move_out_complete',
    currentStep: 'completed',
    status: 'completed',
    graphEvent: 'move_out.completed',
    message: 'Move-out workflow completed',
  },
  cancel_move_out: {
    status: 'cancelled',
    currentStep: 'cancelled',
    graphEvent: 'move_out.cancelled',
    message: 'Move-out workflow cancelled by admin',
  },
}

export async function applyMoveOutAdminAction(
  action: MoveOutAdminAction,
  params: {
    workflowRunId: string
    landlordId: string
    residentId?: string | null
    unitId?: string | null
    moveOutDate?: string | null
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch = ACTION_PATCH[action]
  if (!patch) {
    return { ok: false, error: 'This action is not available yet.' }
  }

  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' }

  const { data: run, error: fetchError } = await supabase
    .from('workflow_runs')
    .select('id, status, metadata, resident_id, unit_id')
    .eq('id', params.workflowRunId)
    .eq('landlord_id', params.landlordId)
    .eq('template_id', 'move_out')
    .maybeSingle()

  if (fetchError) return { ok: false, error: fetchError.message }
  if (!run) return { ok: false, error: 'Move-out workflow not found.' }

  const metadata = readRecord(run.metadata)
  const checklist = readRecord(metadata.checklist)
  const milestones = readRecord(metadata.milestones)
  const now = new Date().toISOString()

  if (patch.checklist) {
    for (const [key, value] of Object.entries(patch.checklist)) {
      if (value === true) checklist[key] = true
    }
  }
  if (patch.milestone) milestones[patch.milestone] = now

  const updatePayload: Record<string, unknown> = {
    metadata: {
      ...metadata,
      checklist,
      milestones,
      ...(action === 'update_move_out_date' && params.moveOutDate
        ? { move_out_date: params.moveOutDate, step_state: { ...readRecord(metadata.step_state), move_out_date: params.moveOutDate } }
        : {}),
    },
  }

  if (patch.currentStep) updatePayload.current_step = patch.currentStep
  if (patch.status === 'completed') {
    updatePayload.status = 'completed'
    updatePayload.completed_at = now
  } else if (patch.status === 'cancelled') {
    updatePayload.status = 'cancelled'
  }

  const { error: updateError } = await supabase
    .from('workflow_runs')
    .update(updatePayload)
    .eq('id', params.workflowRunId)
    .eq('landlord_id', params.landlordId)

  if (updateError) return { ok: false, error: updateError.message }

  if (patch.graphEvent) {
    await supabase.from('operations_graph_events').insert({
      landlord_id: params.landlordId,
      event_type: patch.graphEvent,
      source: 'dashboard',
      actor_type: 'landlord',
      workflow_run_id: params.workflowRunId,
      workflow_template_id: 'move_out',
      resident_id: params.residentId ?? run.resident_id,
      unit_id: params.unitId ?? run.unit_id,
      metadata: { action, message: patch.message },
    })
  }

  await supabase.from('workflow_events').insert({
    workflow_run_id: params.workflowRunId,
    event_type: patch.graphEvent ?? `move_out.${action}`,
    step: patch.currentStep ?? null,
    actor_type: 'landlord',
    message: patch.message,
    metadata: { action },
  })

  return { ok: true }
}
