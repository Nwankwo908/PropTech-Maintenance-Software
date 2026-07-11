import type { AdminWorkflowRow } from '@/lib/adminWorkflows'

export type LeaseRenewalRecommendAction =
  | 'call_tenant'
  | 'trigger_move_out_prep'
  | 'offer_renewal_incentive'

export type LeaseRenewalEscalatedAction =
  | LeaseRenewalRecommendAction
  | 'mark_resolved'

export type LeaseRenewalRecommendation = {
  id: LeaseRenewalRecommendAction
  title: string
  subtitle: string
  primary?: boolean
}

export type LeaseRenewalEscalatedReview = {
  workflowRunId: string
  workflowRef: string
  headerTitle: string
  locationLabel: string
  daysUntilLeaseEndLabel: string
  stageLabel: string
  escalatedAtLabel: string
  outreachAttemptsLabel: string
  recommendations: LeaseRenewalRecommendation[]
  residentId: string | null
  residentPhone: string | null
}

export type LeaseRenewalResidentContext = {
  phone?: string | null
}

function readMetaString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readMetaNumber(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = metadata?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function formatWorkflowRef(runId: string): string {
  const compact = runId.replace(/-/g, '').toUpperCase()
  return `WF-${compact.slice(-4)}`
}

function formatLocation(propertyLabel: string | null, unitLabel: string | null): string {
  const building = propertyLabel?.trim() || 'Property'
  const unit = (unitLabel ?? '').trim()
  if (!unit) return building
  const displayUnit = /^\d/.test(unit) ? `Unit ${unit}` : unit
  return `${building} · ${displayUnit}`
}

function formatShortName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Resident'
  if (parts.length === 1) return parts[0]
  return `${parts[0][0]}. ${parts[parts.length - 1]}`
}

function formatPhone(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return value.trim()
}

function formatStageLabel(currentStep: string | null, escalationReason: string | null): string {
  const step = (currentStep ?? escalationReason ?? '').trim().toLowerCase()
  if (step.includes('no_response') || step.includes('await')) return 'Tenant response'
  if (step.includes('renewal_offer') || step.includes('offer')) return 'Renewal offer sent'
  if (step.includes('move_out')) return 'Move-out prep'
  if (step.includes('negotiat')) return 'Negotiation'
  return 'Awaiting decision'
}

function formatEscalatedAt(iso: string | null | undefined, now = Date.now()): string {
  if (!iso?.trim()) return '—'
  const date = new Date(iso)
  const ts = date.getTime()
  if (Number.isNaN(ts)) return '—'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (dayStart.getTime() === startOfToday.getTime()) return `Today · ${time}`
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${time}`
}

function daysUntilLeaseEnd(leaseEndDate: string | null, now = Date.now()): number | null {
  if (!leaseEndDate?.trim()) return null
  const end = new Date(`${leaseEndDate.trim().slice(0, 10)}T12:00:00`).getTime()
  if (Number.isNaN(end)) return null
  const today = new Date(now)
  today.setHours(12, 0, 0, 0)
  const diffMs = end - today.getTime()
  return Math.max(0, Math.round(diffMs / 86_400_000))
}

function formatDaysUntilLeaseEnd(days: number | null): string {
  if (days == null) return '—'
  if (days === 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}

function buildRecommendations(
  row: AdminWorkflowRow,
  resident?: LeaseRenewalResidentContext | null,
): LeaseRenewalRecommendation[] {
  const shortName = formatShortName(row.residentName)
  const phone = formatPhone(resident?.phone) ?? 'Phone on file'
  return [
    {
      id: 'call_tenant',
      title: 'Call tenant directly',
      subtitle: `${shortName} · ${phone}`,
      primary: true,
    },
    {
      id: 'trigger_move_out_prep',
      title: 'Trigger move-out prep',
      subtitle: 'Notice period starts today',
    },
    {
      id: 'offer_renewal_incentive',
      title: 'Offer renewal incentive',
      subtitle: '$100 credit · auto-draft',
    },
  ]
}

export function isLeaseRenewalEscalatedRun(row: AdminWorkflowRow): boolean {
  return row.templateId === 'lease_renewal' && row.status === 'escalated'
}

export function buildLeaseRenewalEscalatedReview(
  row: AdminWorkflowRow,
  metadata: Record<string, unknown> | null | undefined,
  resident?: LeaseRenewalResidentContext | null,
): LeaseRenewalEscalatedReview {
  const noticeDays = readMetaNumber(metadata, 'notice_days') ?? 60
  const leaseEndDate = readMetaString(metadata, 'lease_end_date')
  const remindersSent = readMetaNumber(metadata, 'reminders_sent')
  const outreachAttempts =
    remindersSent ??
    (row.timeline?.filter((event) =>
      /reminder|outreach|notice|offer/.test(event.eventType.toLowerCase()),
    ).length || 1)

  const daysLeft = daysUntilLeaseEnd(leaseEndDate)
  const escalatedAt =
    readMetaString(metadata, 'escalated_at') ?? row.lastEventAt ?? row.startedAt

  return {
    workflowRunId: row.id,
    workflowRef: formatWorkflowRef(row.id),
    headerTitle: `Lease Renewal · ${noticeDays}-day cadence`,
    locationLabel: formatLocation(row.propertyLabel, row.unitLabel),
    daysUntilLeaseEndLabel: formatDaysUntilLeaseEnd(daysLeft),
    stageLabel: formatStageLabel(row.currentStep, row.escalationReason),
    escalatedAtLabel: formatEscalatedAt(escalatedAt),
    outreachAttemptsLabel: String(outreachAttempts),
    recommendations: buildRecommendations(row, resident),
    residentId: row.residentId,
    residentPhone: formatPhone(resident?.phone),
  }
}

const LEASE_RENEWAL_ACTION_EVENT: Record<LeaseRenewalEscalatedAction, string> = {
  call_tenant: 'lease.renewal_call_recommended',
  trigger_move_out_prep: 'lease.move_out_prep_triggered',
  offer_renewal_incentive: 'lease.renewal_incentive_offered',
  mark_resolved: 'lease.renewal_resolved',
}

const LEASE_RENEWAL_ACTION_MESSAGE: Record<LeaseRenewalEscalatedAction, string> = {
  call_tenant: 'Admin initiated tenant call for lease renewal',
  trigger_move_out_prep: 'Move-out prep triggered from lease renewal review',
  offer_renewal_incentive: 'Renewal incentive offered from admin review',
  mark_resolved: 'Lease renewal escalation marked resolved',
}

async function resumeLeaseRenewalAfterAdminResolve(
  workflowRunId: string,
  landlordId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' }

  const { data: run, error: fetchError } = await supabase
    .from('workflow_runs')
    .select('id, status, metadata')
    .eq('id', workflowRunId)
    .eq('landlord_id', landlordId)
    .eq('template_id', 'lease_renewal')
    .maybeSingle()

  if (fetchError) return { ok: false, error: fetchError.message }
  if (!run) return { ok: false, error: 'Workflow run not found.' }
  if (run.status !== 'escalated') return { ok: true }

  const metadata =
    run.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata)
      ? (run.metadata as Record<string, unknown>)
      : {}
  const stepState =
    metadata.step_state &&
    typeof metadata.step_state === 'object' &&
    !Array.isArray(metadata.step_state)
      ? (metadata.step_state as Record<string, unknown>)
      : {}

  const now = new Date().toISOString()
  const resumeStep = 'awaiting_response'

  const { error: updateError } = await supabase
    .from('workflow_runs')
    .update({
      status: 'active',
      current_step: resumeStep,
      current_stage: 'act',
      metadata: {
        ...metadata,
        admin_resolved_at: now,
        escalated_at: null,
        escalation_reason: null,
        step_state: {
          ...stepState,
          step: resumeStep,
        },
      },
    })
    .eq('id', workflowRunId)
    .eq('landlord_id', landlordId)

  if (updateError) return { ok: false, error: updateError.message }

  const { error: eventError } = await supabase.from('workflow_events').insert({
    workflow_run_id: workflowRunId,
    event_type: 'workflow.act',
    step: resumeStep,
    actor_type: 'landlord',
    message: 'Admin marked lease renewal escalation resolved — resuming outreach',
    metadata: { admin_resolved_at: now },
  })

  if (eventError) return { ok: false, error: eventError.message }
  return { ok: true }
}

export async function applyLeaseRenewalEscalatedAction(
  action: LeaseRenewalEscalatedAction,
  review: LeaseRenewalEscalatedReview,
  landlordId: string,
): Promise<
  | { ok: true; moveOutRunId?: string; conversationId?: string | null }
  | { ok: false; error: string }
> {
  if (action === 'trigger_move_out_prep') {
    const { postTriggerMoveOutFromLeaseRenewal } = await import(
      '@/api/triggerMoveOutFromLeaseRenewal'
    )
    const result = await postTriggerMoveOutFromLeaseRenewal(review.workflowRunId, landlordId)
    if (!result.ok) return result
    return {
      ok: true,
      moveOutRunId: result.moveOutRunId,
      conversationId: result.conversationId,
    }
  }

  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' }

  if (action === 'mark_resolved') {
    const resumeResult = await resumeLeaseRenewalAfterAdminResolve(
      review.workflowRunId,
      landlordId,
    )
    if (!resumeResult.ok) return resumeResult
  }

  const { error } = await supabase.from('operations_graph_events').insert({
    landlord_id: landlordId,
    event_type: LEASE_RENEWAL_ACTION_EVENT[action],
    source: 'dashboard',
    actor_type: 'landlord',
    workflow_run_id: review.workflowRunId,
    workflow_template_id: 'lease_renewal',
    resident_id: review.residentId,
    metadata: {
      action,
      workflow_ref: review.workflowRef,
      message: LEASE_RENEWAL_ACTION_MESSAGE[action],
    },
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
