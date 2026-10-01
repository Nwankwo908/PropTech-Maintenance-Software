/**
 * Stall detection + follow-up policy for unfinished maintenance tickets.
 *
 * Scope: vendor / resident maintenance only. Never rent_collection, payment
 * reminders, or invoice-paid confirmation (those have their own TTL/escalation).
 *
 * Vendor quiet hours: vendors use the shared automated-message gate (cooldown /
 * ticket-advanced checks) — NOT resident overnight quiet hours. Commercial
 * vendor follow-ups may send whenever that gate allows (business hours are not
 * required); resident follow-ups always honor property/resident quiet hours
 * (default 21–8).
 */
import { generateIssueSummary } from '../maintenance/generateIssueSummary.ts'
import { PENDING_ACCEPT_STALE_MS, isStickyNeedsAdminVendor } from './vendorReassignGuards.ts'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/**
 * Soft nudge before pending_accept rematch. Derived from PENDING_ACCEPT_STALE_MS
 * (half) so we do not invent an unrelated magic number for the same concept.
 * Rematch at full PENDING_ACCEPT_STALE_MS keeps ownership of reassignment.
 */
export const NO_VENDOR_RESPONSE_FOLLOW_UP_MS = Math.floor(PENDING_ACCEPT_STALE_MS / 2)

/** Accepted but no visit window confirmed. */
export const NO_SCHEDULE_CONFIRMED_MS = 48 * HOUR_MS

/** scheduled_at passed with no progress. */
export const VISIT_OVERDUE_GRACE_MS = 4 * HOUR_MS

/** in_progress with no activity. */
export const STALLED_IN_PROGRESS_MS = 3 * DAY_MS

/** After first follow-up, escalate to needs_admin digest if still stalled. */
export const STALL_FOLLOW_UP_ESCALATE_MS = 24 * HOUR_MS

/**
 * Soft-nudge exclusivity window. While a stall follow-up SMS is this recent,
 * rematch / schedule-FSM TTL must yield so they do not re-SMS or reassign over
 * the same episode. After this window, stall escalates to sticky needs_admin
 * (rematch already skips sticky) or rematch may proceed on pending_accept_stale.
 */
export const STALL_FOLLOW_UP_REMATCH_YIELD_MS = STALL_FOLLOW_UP_ESCALATE_MS

export type MaintenanceStallKind =
  | 'no_vendor_response'
  | 'no_schedule_confirmed'
  | 'visit_overdue_no_update'
  | 'stalled_in_progress'

export type StallFollowUpAudience = 'vendor' | 'resident'

export type StallTicketSnapshot = {
  id: string
  landlordId: string
  vendorWorkStatus: string | null
  assignedVendorId: string | null
  assignedAt: string | null
  scheduledAt: string | null
  scheduleConfirmedAt: string | null
  updatedAt: string | null
  createdAt: string | null
  inspectionReportId: string | null
  description: string | null
  issueHeadline: string | null
  autoReassignLastOutcome: string | null
  awaitingLandlordChoiceAt: string | null
  awaitingVendorAvailabilityAt: string | null
  vendorNotifyError: string | null
  stallFollowUpSentAt: string | null
  stallFollowUpKind: string | null
  stallFollowUpEpisodeKey: string | null
  /** When true, schedule FSM is awaiting tenant YES/NO for a proposed window. */
  awaitingTenantScheduleConfirm?: boolean
  /**
   * When true, vendor schedule FSM is mid-flight (awaiting availability /
   * confirmation / tenant confirm). Stall follow-up must yield to schedule FSM TTL.
   */
  scheduleFsmActive?: boolean
  /** Workflow template ids linked to this ticket (for rent exclusion asserts). */
  linkedWorkflowTemplateIds?: string[] | null
}

export type StallThresholds = {
  noVendorResponseFollowUpMs: number
  pendingAcceptRematchMs: number
  noScheduleConfirmedMs: number
  visitOverdueGraceMs: number
  stalledInProgressMs: number
  escalateAfterFollowUpMs: number
}

export const DEFAULT_STALL_THRESHOLDS: StallThresholds = {
  noVendorResponseFollowUpMs: NO_VENDOR_RESPONSE_FOLLOW_UP_MS,
  pendingAcceptRematchMs: PENDING_ACCEPT_STALE_MS,
  noScheduleConfirmedMs: NO_SCHEDULE_CONFIRMED_MS,
  visitOverdueGraceMs: VISIT_OVERDUE_GRACE_MS,
  stalledInProgressMs: STALLED_IN_PROGRESS_MS,
  escalateAfterFollowUpMs: STALL_FOLLOW_UP_ESCALATE_MS,
}

export type StallSkipReason =
  | 'needs_admin_vendor_sticky'
  | 'awaiting_landlord_choice'
  | 'awaiting_vendor_probe'
  | 'rematch_owns_pending_accept'
  | 'schedule_fsm_owns_ticket'
  | 'terminal_status'
  | 'rent_collection_linked'
  | 'already_followed_up_episode'
  | 'already_escalated_episode'
  | 'not_stalled'

/** Sticky signature written on stall escalate — picked up by needs_admin digest. */
export const STALL_FOLLOW_UP_NEEDS_ADMIN_SIGNATURE = 'needs_admin_vendor|stall_follow_up'

export type StallClassifyResult =
  | {
      action: 'follow_up'
      kind: MaintenanceStallKind
      audience: StallFollowUpAudience
      episodeKey: string
      stalledSinceMs: number
    }
  | {
      action: 'escalate'
      kind: MaintenanceStallKind
      episodeKey: string
      followUpSentAtMs: number
    }
  | { action: 'skip'; reason: StallSkipReason }

function parseMs(value: string | null | undefined): number | null {
  if (value == null || !String(value).trim()) return null
  const ms = new Date(String(value).trim()).getTime()
  return Number.isFinite(ms) ? ms : null
}

function statusOf(ticket: StallTicketSnapshot): string {
  return String(ticket.vendorWorkStatus ?? '').trim().toLowerCase()
}

export function isTerminalVendorWorkStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase()
  return s === 'completed' || s === 'cancelled' || s === 'archived'
}

/** Rent / payment workflows must never be touched by this system. */
export function isRentOrPaymentWorkflowTemplate(templateId: string | null | undefined): boolean {
  const id = String(templateId ?? '').trim().toLowerCase()
  if (!id) return false
  return (
    id === 'rent_collection' ||
    id.startsWith('rent_') ||
    id.includes('invoice_paid') ||
    id.includes('payment_reminder')
  )
}

export function ticketLinkedToRentOrPayment(ticket: StallTicketSnapshot): boolean {
  const ids = ticket.linkedWorkflowTemplateIds ?? []
  return ids.some((id) => isRentOrPaymentWorkflowTemplate(id))
}

export function isAwaitingLandlordChoice(ticket: StallTicketSnapshot): boolean {
  if (ticket.awaitingLandlordChoiceAt) return true
  const err = String(ticket.vendorNotifyError ?? '').toLowerCase()
  return err.includes('awaiting landlord') && err.includes('choice')
}

export function isAwaitingVendorProbe(ticket: StallTicketSnapshot): boolean {
  if (ticket.awaitingVendorAvailabilityAt) return true
  const err = String(ticket.vendorNotifyError ?? '').toLowerCase()
  return err.includes('awaiting vendor availability')
}

/**
 * Rematch owns pending_accept once assigned_at + PENDING_ACCEPT_STALE_MS has elapsed.
 * Stall follow-up must not SMS the same ticket in that window.
 */
export function rematchOwnsPendingAccept(
  ticket: StallTicketSnapshot,
  nowMs: number,
  thresholds: StallThresholds = DEFAULT_STALL_THRESHOLDS,
): boolean {
  if (statusOf(ticket) !== 'pending_accept') return false
  const assigned = parseMs(ticket.assignedAt)
  if (assigned == null) return false
  return nowMs - assigned >= thresholds.pendingAcceptRematchMs
}

/**
 * Reverse coordination lock: rematch / schedule-FSM TTL yield while a soft
 * stall nudge is still unanswered (any stall kind, not only pending_accept).
 * Sticky needs_admin after escalate remains the durable rematch stop.
 */
export function shouldYieldToRecentStallFollowUp(input: {
  stallFollowUpSentAt?: string | null
  nowMs: number
  yieldMs?: number
}): boolean {
  const sent = parseMs(input.stallFollowUpSentAt)
  if (sent == null) return false
  const window = input.yieldMs ?? STALL_FOLLOW_UP_REMATCH_YIELD_MS
  return input.nowMs - sent < window
}

export function buildStallEpisodeKey(input: {
  kind: MaintenanceStallKind
  ticketId: string
  inspectionReportId?: string | null
  stalledSinceMs: number
}): string {
  const scope =
    input.inspectionReportId?.trim() ||
    input.ticketId.trim()
  // Bucket by calendar day of stall start so a multi-day stall stays one episode.
  const day = new Date(input.stalledSinceMs).toISOString().slice(0, 10)
  return `${input.kind}|${scope}|${day}`
}

export function stallIssueLabel(ticket: StallTicketSnapshot): string {
  const headline = ticket.issueHeadline?.trim()
  if (headline) return headline
  const desc = ticket.description?.trim() ?? ''
  if (!desc) return 'this repair'
  const summarized = generateIssueSummary(desc, { format: 'title', maxChars: 80 })
  return summarized.replace(/^HQS fail:\s*/i, '').trim() || 'this repair'
}

/**
 * Resident overnight quiet hours (default 21–8). Vendors do not use this —
 * they go through shouldSendAutomatedMessage cooldown / ticket-advanced only.
 */
export function isResidentOvernightQuietHour(
  localHour: number,
  startHour = 21,
  endHour = 8,
): boolean {
  if (startHour === endHour) return true
  if (startHour < endHour) return localHour >= startHour && localHour < endHour
  return localHour >= startHour || localHour < endHour
}

export type StallDeliveryDecision =
  | { action: 'send' }
  | { action: 'defer_quiet_hours' }
  | { action: 'suppress'; reason: string }

/**
 * Pure send gate after classify. Residents honor quiet hours; vendors never
 * defer for overnight quiet hours (commercial follow-ups).
 */
export function decideStallFollowUpDelivery(input: {
  audience: StallFollowUpAudience
  /** Resident local hour 0–23 when audience is resident; ignored for vendor. */
  residentLocalHour?: number | null
  quietHoursStart?: number
  quietHoursEnd?: number
  /** From shouldSendAutomatedMessage when audience is vendor. */
  automatedGateAction?: 'send' | 'suppress' | 'hold_quiet_hours'
  automatedGateReason?: string
}): StallDeliveryDecision {
  if (input.audience === 'vendor') {
    const gate = input.automatedGateAction ?? 'send'
    if (gate === 'suppress') {
      return { action: 'suppress', reason: input.automatedGateReason ?? 'automated_gate' }
    }
    // Vendors: ignore hold_quiet_hours — overnight quiet hours are resident-only.
    return { action: 'send' }
  }
  const hour = input.residentLocalHour
  if (
    typeof hour === 'number' &&
    isResidentOvernightQuietHour(
      hour,
      input.quietHoursStart ?? 21,
      input.quietHoursEnd ?? 8,
    )
  ) {
    return { action: 'defer_quiet_hours' }
  }
  return { action: 'send' }
}

/**
 * Detect the primary stall kind for a maintenance ticket (pure).
 * Priority: visit overdue → in_progress stall → no schedule → no vendor response.
 */
export function detectMaintenanceStallKind(
  ticket: StallTicketSnapshot,
  nowMs: number,
  thresholds: StallThresholds = DEFAULT_STALL_THRESHOLDS,
): { kind: MaintenanceStallKind; stalledSinceMs: number; audience: StallFollowUpAudience } | null {
  const status = statusOf(ticket)
  if (isTerminalVendorWorkStatus(status)) return null

  const scheduledAt = parseMs(ticket.scheduledAt)
  const confirmedAt = parseMs(ticket.scheduleConfirmedAt)
  const updatedAt = parseMs(ticket.updatedAt) ?? parseMs(ticket.createdAt)
  const assignedAt = parseMs(ticket.assignedAt)

  if (
    scheduledAt != null &&
    scheduledAt + thresholds.visitOverdueGraceMs < nowMs &&
    (status === 'accepted' || status === 'pending_accept' || status === 'scheduled') &&
    (updatedAt == null || updatedAt <= scheduledAt + thresholds.visitOverdueGraceMs)
  ) {
    return {
      kind: 'visit_overdue_no_update',
      stalledSinceMs: scheduledAt + thresholds.visitOverdueGraceMs,
      audience: 'vendor',
    }
  }

  if (
    status === 'in_progress' &&
    updatedAt != null &&
    nowMs - updatedAt >= thresholds.stalledInProgressMs
  ) {
    return {
      kind: 'stalled_in_progress',
      stalledSinceMs: updatedAt + thresholds.stalledInProgressMs,
      audience: 'vendor',
    }
  }

  // pending_accept is owned by no_vendor_response (+ rematch at full stale).
  // Do not classify it as no_schedule_confirmed — that would collide with rematch.
  if (
    status === 'accepted' &&
    ticket.assignedVendorId &&
    scheduledAt == null &&
    confirmedAt == null &&
    assignedAt != null &&
    nowMs - assignedAt >= thresholds.noScheduleConfirmedMs
  ) {
    return {
      kind: 'no_schedule_confirmed',
      stalledSinceMs: assignedAt + thresholds.noScheduleConfirmedMs,
      audience: 'vendor',
    }
  }

  // Resident: window proposed, waiting on their YES past threshold.
  // Skipped at classify when schedule FSM is active (FSM TTL owns that nudge).
  if (
    ticket.awaitingTenantScheduleConfirm === true &&
    !ticket.scheduleFsmActive &&
    scheduledAt != null &&
    confirmedAt == null &&
    nowMs - scheduledAt >= thresholds.noScheduleConfirmedMs
  ) {
    return {
      kind: 'no_schedule_confirmed',
      stalledSinceMs: scheduledAt + thresholds.noScheduleConfirmedMs,
      audience: 'resident',
    }
  }

  if (
    status === 'pending_accept' &&
    ticket.assignedVendorId &&
    assignedAt != null &&
    nowMs - assignedAt >= thresholds.noVendorResponseFollowUpMs
  ) {
    return {
      kind: 'no_vendor_response',
      stalledSinceMs: assignedAt + thresholds.noVendorResponseFollowUpMs,
      audience: 'vendor',
    }
  }

  return null
}

export function classifyMaintenanceStallFollowUp(
  ticket: StallTicketSnapshot,
  nowMs: number,
  thresholds: StallThresholds = DEFAULT_STALL_THRESHOLDS,
): StallClassifyResult {
  if (ticketLinkedToRentOrPayment(ticket)) {
    return { action: 'skip', reason: 'rent_collection_linked' }
  }
  if (isTerminalVendorWorkStatus(ticket.vendorWorkStatus)) {
    return { action: 'skip', reason: 'terminal_status' }
  }
  if (isStickyNeedsAdminVendor(ticket.autoReassignLastOutcome)) {
    return { action: 'skip', reason: 'needs_admin_vendor_sticky' }
  }
  if (isAwaitingLandlordChoice(ticket)) {
    return { action: 'skip', reason: 'awaiting_landlord_choice' }
  }
  if (isAwaitingVendorProbe(ticket)) {
    return { action: 'skip', reason: 'awaiting_vendor_probe' }
  }
  // Coordination lock: schedule FSM TTL owns mid-flight schedule threads.
  if (ticket.scheduleFsmActive === true) {
    return { action: 'skip', reason: 'schedule_fsm_owns_ticket' }
  }
  // Coordination lock: rematch owns full-stale pending_accept (any stall kind).
  if (rematchOwnsPendingAccept(ticket, nowMs, thresholds)) {
    return { action: 'skip', reason: 'rematch_owns_pending_accept' }
  }

  const detected = detectMaintenanceStallKind(ticket, nowMs, thresholds)
  if (!detected) return { action: 'skip', reason: 'not_stalled' }

  const episodeKey = buildStallEpisodeKey({
    kind: detected.kind,
    ticketId: ticket.id,
    inspectionReportId: ticket.inspectionReportId,
    stalledSinceMs: detected.stalledSinceMs,
  })

  const sentAt = parseMs(ticket.stallFollowUpSentAt)
  const priorEpisode = ticket.stallFollowUpEpisodeKey?.trim() || null

  if (sentAt != null && priorEpisode === episodeKey) {
    if (nowMs - sentAt >= thresholds.escalateAfterFollowUpMs) {
      // Already sticky needs_admin from a prior escalate of this episode.
      if (isStickyNeedsAdminVendor(ticket.autoReassignLastOutcome)) {
        return { action: 'skip', reason: 'already_escalated_episode' }
      }
      return {
        action: 'escalate',
        kind: detected.kind,
        episodeKey,
        followUpSentAtMs: sentAt,
      }
    }
    return { action: 'skip', reason: 'already_followed_up_episode' }
  }

  return {
    action: 'follow_up',
    kind: detected.kind,
    audience: detected.audience,
    episodeKey,
    stalledSinceMs: detected.stalledSinceMs,
  }
}

export type StallFollowUpGroup = {
  groupKey: string
  kind: MaintenanceStallKind
  audience: StallFollowUpAudience
  episodeKey: string
  ticketIds: string[]
  landlordId: string
  inspectionReportId: string | null
}

/**
 * Collapse inspection_report siblings into one follow-up group.
 * Tickets without a report id stay one-per-ticket.
 */
export function groupStallFollowUps(
  items: Array<{
    ticket: StallTicketSnapshot
    kind: MaintenanceStallKind
    audience: StallFollowUpAudience
    episodeKey: string
  }>,
): StallFollowUpGroup[] {
  const map = new Map<string, StallFollowUpGroup>()
  for (const item of items) {
    const reportId = item.ticket.inspectionReportId?.trim() || null
    const groupKey = reportId
      ? `report:${reportId}:${item.kind}:${item.audience}`
      : `ticket:${item.ticket.id}`
    const existing = map.get(groupKey)
    if (existing) {
      existing.ticketIds.push(item.ticket.id)
      continue
    }
    map.set(groupKey, {
      groupKey,
      kind: item.kind,
      audience: item.audience,
      episodeKey: item.episodeKey,
      ticketIds: [item.ticket.id],
      landlordId: item.ticket.landlordId,
      inspectionReportId: reportId,
    })
  }
  return [...map.values()]
}

export function buildVendorStallFollowUpSms(input: {
  vendorName: string
  kind: MaintenanceStallKind
  items: Array<{ workOrderRef: string; issueLabel: string }>
  locationLabel?: string | null
}): string {
  const name = input.vendorName.trim() || 'there'
  const loc = input.locationLabel?.trim()
  const lines: string[] = [`Hi ${name},`, '']

  if (input.items.length > 1) {
    lines.push(
      loc
        ? `Quick follow-up on the inspection visit at ${loc} — we still need an update on ${input.items.length} open items:`
        : `Quick follow-up — we still need an update on ${input.items.length} open jobs:`,
      '',
    )
    for (const item of input.items) {
      lines.push(`• ${item.issueLabel} (${item.workOrderRef})`)
    }
    lines.push('')
  } else {
    const only = input.items[0]!
    lines.push(
      `Quick follow-up on ${only.workOrderRef}${loc ? ` at ${loc}` : ''}: ${only.issueLabel}.`,
      '',
    )
  }

  switch (input.kind) {
    case 'no_vendor_response':
      lines.push(
        'Can you still take this work?',
        'Reply with your earliest day + window (e.g. Wed 9am–12pm), or NO + the WO code if you cannot.',
      )
      break
    case 'no_schedule_confirmed':
      lines.push(
        'What is your earliest availability?',
        'Reply with a day and arrival window (e.g. Wed 9am–12pm).',
      )
      break
    case 'visit_overdue_no_update':
      lines.push(
        'The scheduled visit window has passed. Reply with an update, a new window, or COMPLETED if the work is done.',
      )
      break
    case 'stalled_in_progress':
      lines.push(
        'Any update on progress? Reply with a status, a new visit window, or COMPLETED when finished.',
      )
      break
  }

  return lines.join('\n')
}

export function buildResidentStallFollowUpSms(input: {
  residentFirstName: string
  kind: MaintenanceStallKind
  issueLabel: string
  workOrderRef: string
  windowText?: string | null
}): string {
  const name = input.residentFirstName.trim() || 'there'
  const window = input.windowText?.trim()
  if (input.kind === 'no_schedule_confirmed' && window) {
    return [
      `Hi ${name},`,
      '',
      `Just checking in on your repair (${input.workOrderRef}: ${input.issueLabel}).`,
      '',
      `Does ${window} still work for you?`,
      'Reply YES to confirm or NO if you need a different time.',
    ].join('\n')
  }
  return [
    `Hi ${name},`,
    '',
    `Just checking in on your repair (${input.workOrderRef}: ${input.issueLabel}).`,
    '',
    'Reply YES if that time still works, or tell us a better window.',
  ].join('\n')
}
