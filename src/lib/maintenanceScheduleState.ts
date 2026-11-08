/**
 * Display-only schedule state for the Active Tasks work-order right rail.
 * Does not drive SMS, timers, or ticket writes.
 */
import { VISIT_OVERDUE_GRACE_MS } from '@shared/ops/maintenanceStallFollowUp.ts'

export type MaintenanceScheduleState =
  | 'awaiting_resident_first_confirm'
  | 'awaiting_resident_reschedule_confirm'
  | 'resident_declined_waiting_vendor'
  | 'window_saved_awaiting_vendor_accept'
  | 'proposed_window_passed'
  | 'confirmed_upcoming'
  | 'confirmed_visit_passed_no_update'
  | 'none'

export type PendingResidentScheduleAsk = {
  windowText: string
  scheduledAt: string | null
  askedAt: string | null
  kind: 'initial' | 'reschedule'
}

export type MaintenanceScheduleStateInput = {
  vendorWorkStatus: string | null | undefined
  scheduledAt: string | null | undefined
  scheduleConfirmedAt: string | null | undefined
  scheduleStatus: string | null | undefined
  residentConfirmationStatus: string | null | undefined
  vendorNotifiedAt?: string | null | undefined
  pendingResidentAsk?: PendingResidentScheduleAsk | null
  nowMs?: number
}

export type VisitLabelKind = 'proposed' | 'confirmed' | 'passed' | null

const SCHEDULE_ASK_TTL_MS = 24 * 60 * 60 * 1000

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || ''
  return trimmed || null
}

function parseMs(iso: string | null | undefined): number | null {
  const trimmed = trimOrNull(iso)
  if (!trimmed) return null
  const ms = Date.parse(trimmed)
  return Number.isFinite(ms) ? ms : null
}

function vendorStatus(input: MaintenanceScheduleStateInput): string {
  return (input.vendorWorkStatus ?? '').trim().toLowerCase()
}

function scheduleStatus(input: MaintenanceScheduleStateInput): string {
  return (input.scheduleStatus ?? '').trim().toLowerCase()
}

function residentConfirmStatus(input: MaintenanceScheduleStateInput): string {
  return (input.residentConfirmationStatus ?? '').trim().toLowerCase()
}

/** Prefer ticket ISO, then pending-ask ISO. Never invents a time. */
export function resolveScheduleDisplayIso(input: {
  scheduledAt: string | null | undefined
  pendingResidentAsk?: PendingResidentScheduleAsk | null
}): string | null {
  return (
    trimOrNull(input.scheduledAt) ||
    trimOrNull(input.pendingResidentAsk?.scheduledAt) ||
    null
  )
}

/** Prefer ISO short label; fall back to pending ask window text. */
export function resolveScheduleWhenLabel(input: {
  scheduledAt: string | null | undefined
  pendingResidentAsk?: PendingResidentScheduleAsk | null
  formatIso: (iso: string) => string | null
}): string | null {
  const iso = resolveScheduleDisplayIso(input)
  if (iso) {
    const formatted = input.formatIso(iso)
    if (formatted) return formatted
  }
  return trimOrNull(input.pendingResidentAsk?.windowText)
}

function proposedTimePassed(
  input: MaintenanceScheduleStateInput,
  nowMs: number,
): boolean {
  const iso = resolveScheduleDisplayIso({
    scheduledAt: input.scheduledAt,
    pendingResidentAsk: input.pendingResidentAsk,
  })
  const ms = parseMs(iso)
  return ms != null && ms < nowMs
}

function confirmedVisitOverdue(
  input: MaintenanceScheduleStateInput,
  nowMs: number,
): boolean {
  const ms = parseMs(input.scheduledAt)
  return ms != null && ms + VISIT_OVERDUE_GRACE_MS < nowMs
}

/**
 * Pure classifier for landlord-facing schedule copy on the work-order rail.
 */
export function deriveMaintenanceScheduleState(
  input: MaintenanceScheduleStateInput,
): MaintenanceScheduleState {
  const nowMs = input.nowMs ?? Date.now()
  const vws = vendorStatus(input)
  if (vws === 'completed' || vws === 'cancelled') return 'none'

  const confirmStatus = residentConfirmStatus(input)
  const schedStatus = scheduleStatus(input)
  const confirmedAt = trimOrNull(input.scheduleConfirmedAt)
  const ticketScheduledAt = trimOrNull(input.scheduledAt)
  const pending = input.pendingResidentAsk ?? null
  const pendingKind = pending?.kind ?? null

  if (
    schedStatus === 'resident_declined_reschedule' ||
    confirmStatus === 'declined' ||
    confirmStatus === 'counter_proposed'
  ) {
    return 'resident_declined_waiting_vendor'
  }

  if (confirmedAt) {
    if (
      confirmedVisitOverdue(input, nowMs) &&
      (vws === 'accepted' || vws === 'pending_accept')
    ) {
      return 'confirmed_visit_passed_no_update'
    }
    return 'confirmed_upcoming'
  }

  const waitingResidentReschedule =
    pendingKind === 'reschedule' ||
    schedStatus === 'vendor_rescheduled_pending_resident' ||
    (confirmStatus === 'pending' &&
      Boolean(ticketScheduledAt) &&
      schedStatus.includes('reschedule'))

  const waitingResidentFirst =
    pendingKind === 'initial' ||
    (Boolean(pending) && !waitingResidentReschedule && !ticketScheduledAt)

  if (waitingResidentReschedule || waitingResidentFirst) {
    if (proposedTimePassed(input, nowMs)) return 'proposed_window_passed'
    return waitingResidentReschedule
      ? 'awaiting_resident_reschedule_confirm'
      : 'awaiting_resident_first_confirm'
  }

  if (ticketScheduledAt && !confirmedAt) {
    if (vws === 'pending_accept') {
      return 'window_saved_awaiting_vendor_accept'
    }
    if (proposedTimePassed(input, nowMs)) return 'proposed_window_passed'
    // Saved window without confirm and not pending_accept — treat as reschedule wait.
    return 'awaiting_resident_reschedule_confirm'
  }

  return 'none'
}

export function visitLabelKindForScheduleState(
  state: MaintenanceScheduleState,
): VisitLabelKind {
  switch (state) {
    case 'awaiting_resident_first_confirm':
    case 'awaiting_resident_reschedule_confirm':
    case 'window_saved_awaiting_vendor_accept':
      return 'proposed'
    case 'confirmed_upcoming':
      return 'confirmed'
    case 'proposed_window_passed':
    case 'confirmed_visit_passed_no_update':
      return 'passed'
    case 'resident_declined_waiting_vendor':
    case 'none':
    default:
      return null
  }
}

/** Compact "2h ago" / "1d ago" for asked-at — never invents a timestamp. */
export function formatAskedAgo(
  askedAt: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  const ms = parseMs(askedAt)
  if (ms == null) return null
  const delta = Math.max(0, nowMs - ms)
  const minutes = Math.floor(delta / (60 * 1000))
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/**
 * Parse awaiting_schedule_confirmation from a resident SMS conversation intake.
 * askedAt: explicit asked_at, else expires_at − 24h, else conversationUpdatedAt.
 */
export function parsePendingResidentScheduleAsk(input: {
  intakeState: unknown
  ticketId: string
  conversationUpdatedAt?: string | null
  nowMs?: number
}): PendingResidentScheduleAsk | null {
  if (!input.intakeState || typeof input.intakeState !== 'object') return null
  const raw = (input.intakeState as Record<string, unknown>)
    .awaiting_schedule_confirmation
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const ticketId =
    (typeof row.ticket_id === 'string' && row.ticket_id.trim()) ||
    (typeof row.ticketId === 'string' && row.ticketId.trim()) ||
    ''
  if (ticketId !== input.ticketId.trim()) return null

  const windowText =
    (typeof row.window_text === 'string' && row.window_text.trim()) ||
    (typeof row.windowText === 'string' && row.windowText.trim()) ||
    ''
  if (!windowText) return null

  const scheduledAt =
    (typeof row.scheduled_at === 'string' && row.scheduled_at.trim()) ||
    (typeof row.scheduledAt === 'string' && row.scheduledAt.trim()) ||
    null
  const kind = row.kind === 'reschedule' ? 'reschedule' : 'initial'

  let askedAt =
    (typeof row.asked_at === 'string' && row.asked_at.trim()) ||
    (typeof row.askedAt === 'string' && row.askedAt.trim()) ||
    null
  if (!askedAt) {
    const expiresAt =
      (typeof row.expires_at === 'string' && row.expires_at.trim()) ||
      (typeof row.expiresAt === 'string' && row.expiresAt.trim()) ||
      null
    const expiresMs = parseMs(expiresAt)
    if (expiresMs != null) {
      askedAt = new Date(expiresMs - SCHEDULE_ASK_TTL_MS).toISOString()
    } else {
      askedAt = trimOrNull(input.conversationUpdatedAt)
    }
  }

  const nowMs = input.nowMs ?? Date.now()
  const expiryMs = parseMs(
    (typeof row.expires_at === 'string' && row.expires_at) ||
      (typeof row.expiresAt === 'string' && row.expiresAt) ||
      null,
  )
  if (expiryMs != null && nowMs >= expiryMs) return null

  return {
    windowText,
    scheduledAt,
    askedAt,
    kind,
  }
}

export { VISIT_OVERDUE_GRACE_MS }
