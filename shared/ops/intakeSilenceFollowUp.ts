/**
 * Mid-intake silence policy — nudge once, then resolve unit_entry so drafts
 * cannot sit forever on an unanswered question.
 *
 * Thresholds scale by the emergency/habitability band already persisted on
 * intake_state (urgency / urgency_alert_tier) — do not re-run classification.
 *
 * Out of scope: vendor stall follow-up, rent, invoice-paid (separate TTLs).
 *
 * Urgency-gap audit:
 * - schedule FSM tenant-confirm: scaled via urgencyScaledTimeouts (60m/120m)
 * - schedule FSM vendor availability ask: still 24h flat (do not compress)
 * - landlord choice / probe dwell: scaled (1h / 2h) via urgencyScaledTimeouts
 * - pending_accept rematch / stall soft-nudge: 48h / 24h flat (intentional)
 * - estimate landlord notify stall: 20 min flat (already short; not urgency-scaled)
 */

import { generateIssueSummary } from '../maintenance/generateIssueSummary.ts'
import { URGENCY_SLA_MINUTES } from '../maintenance/urgencyPolicy.ts'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/** Routine: first silence nudge after an open intake question goes unanswered. */
export const INTAKE_SILENCE_NUDGE_MS = 3 * HOUR_MS

/**
 * Routine: second threshold — resolve unit_entry (default unconfirmed) or
 * escalate other open questions to the landlord.
 */
export const INTAKE_SILENCE_RESOLVE_MS = 36 * HOUR_MS

/**
 * Emergency/habitability: first nudge. Well under the life-safety SLA bar
 * (URGENCY_SLA_MINUTES.emergencyLifeSafety = 60).
 */
export const URGENT_INTAKE_SILENCE_NUDGE_MS = 20 * MINUTE_MS

/**
 * Emergency/habitability: resolve/escalate. Matches emergencyWater SLA
 * (URGENCY_SLA_MINUTES.emergencyWater = 120). Life-safety drafts use the
 * tighter life-safety SLA (60) via thresholdsForIntakeSilence.
 */
export const URGENT_INTAKE_SILENCE_RESOLVE_MS =
  URGENCY_SLA_MINUTES.emergencyWater * MINUTE_MS

export const LIFE_SAFETY_INTAKE_SILENCE_RESOLVE_MS =
  URGENCY_SLA_MINUTES.emergencyLifeSafety * MINUTE_MS

export type IntakeSilenceUrgencyAlertTier = 'life_safety' | 'same_day'

export type IntakeSilenceSnapshot = {
  conversationId: string
  landlordId: string
  /** intake_collecting | diagnostic | photo | etc. */
  step: string | null
  diagnosticQuestionType: string | null
  diagnosticQuestion: string | null
  openQuestionAskedAt: string | null
  silenceNudgeSentAt: string | null
  silenceResolvedAt: string | null
  draftTicketId: string | null
  description: string | null
  issueHeadline: string | null
  issueType: string | null
  vendorTrade: string | null
  /**
   * Persisted SMS urgency from intake_state.urgency / recommended_urgency
   * (or draft ticket.urgency). Set during applyQuestionPlan — not recomputed here.
   */
  urgency: string | null
  /**
   * Persisted after prependEmergencySafetyIfNeeded — life_safety | same_day.
   * Presence alone means the emergency layer already classified this intake.
   */
  urgencyAlertTier: IntakeSilenceUrgencyAlertTier | null
}

export type IntakeSilenceAction =
  | {
      action: 'nudge'
      questionType: string
      /** Plain re-ask — not a raw re-paste of the first SMS. */
      body: string
      urgent: boolean
    }
  | {
      action: 'resolve_unit_entry_unconfirmed'
      questionType: 'unit_entry'
      /** Resident SMS after auto-submit. */
      body: string
      /** When true, process must fire the emergency landlord-alert tier. */
      emergencyAlert: boolean
      urgencyAlertTier: IntakeSilenceUrgencyAlertTier
    }
  | {
      action: 'resolve_skip_photo'
      questionType: 'photo'
      urgent: boolean
    }
  | {
      action: 'escalate_landlord'
      questionType: string
      reason: 'intake_silence_unanswered'
      urgent: boolean
    }
  | { action: 'skip'; reason: IntakeSilenceSkipReason }

export type IntakeSilenceSkipReason =
  | 'not_awaiting_answer'
  | 'no_open_question_timestamp'
  | 'before_nudge_threshold'
  | 'already_nudged_waiting'
  | 'already_resolved'
  | 'before_resolve_threshold'

export type IntakeSilenceThresholds = {
  nudgeMs: number
  resolveMs: number
}

export const DEFAULT_INTAKE_SILENCE_THRESHOLDS: IntakeSilenceThresholds = {
  nudgeMs: INTAKE_SILENCE_NUDGE_MS,
  resolveMs: INTAKE_SILENCE_RESOLVE_MS,
}

export const URGENT_INTAKE_SILENCE_THRESHOLDS: IntakeSilenceThresholds = {
  nudgeMs: URGENT_INTAKE_SILENCE_NUDGE_MS,
  resolveMs: URGENT_INTAKE_SILENCE_RESOLVE_MS,
}

export const LIFE_SAFETY_INTAKE_SILENCE_THRESHOLDS: IntakeSilenceThresholds = {
  nudgeMs: 15 * MINUTE_MS,
  resolveMs: LIFE_SAFETY_INTAKE_SILENCE_RESOLVE_MS,
}

function parseMs(value: string | null | undefined): number | null {
  if (value == null || !String(value).trim()) return null
  const ms = new Date(String(value).trim()).getTime()
  return Number.isFinite(ms) ? ms : null
}

export type IntakeSilenceAskedAtSource =
  | 'open_question_asked_at'
  | 'recovered_from_nudge'
  | 'updated_at_fallback'
  | 'none'

/**
 * Resolve the silence clock for an open intake question.
 *
 * Never keep measuring from conversation `updated_at` after a reminder — saving
 * the nudge bumps `updated_at` and would restart the 36h resolve wait. Prefer a
 * frozen `open_question_asked_at`; if missing but a nudge was already sent,
 * recover ask time as nudgeSentAt − nudgeMs.
 */
export function resolveIntakeSilenceAskedAt(input: {
  openQuestionAskedAt?: string | null
  silenceNudgeSentAt?: string | null
  conversationUpdatedAt?: string | null
  hasOpenQuestion: boolean
  /** Used only to recover ask time when nudge stamp exists but ask stamp does not. */
  nudgeMs?: number
}): { askedAt: string | null; source: IntakeSilenceAskedAtSource } {
  const stamped = input.openQuestionAskedAt?.trim() || ''
  if (stamped) {
    return { askedAt: stamped, source: 'open_question_asked_at' }
  }

  const nudgeMs = input.nudgeMs ?? INTAKE_SILENCE_NUDGE_MS
  const nudgedAt = parseMs(input.silenceNudgeSentAt)
  if (nudgedAt != null && nudgeMs > 0) {
    return {
      askedAt: new Date(nudgedAt - nudgeMs).toISOString(),
      source: 'recovered_from_nudge',
    }
  }

  if (input.hasOpenQuestion) {
    const updated = input.conversationUpdatedAt?.trim() || ''
    if (updated) {
      return { askedAt: updated, source: 'updated_at_fallback' }
    }
  }

  return { askedAt: null, source: 'none' }
}

/**
 * True when intake already carries the emergency/habitability band from the
 * SMS urgency pipeline (same band that triggers prependEmergencySafetyIfNeeded).
 * Does not re-run resolveUrgencyPolicy.
 */
export function isEmergencyIntakeSilence(
  snapshot: Pick<IntakeSilenceSnapshot, 'urgency' | 'urgencyAlertTier'>,
): boolean {
  if (
    snapshot.urgencyAlertTier === 'life_safety' ||
    snapshot.urgencyAlertTier === 'same_day'
  ) {
    return true
  }
  const u = String(snapshot.urgency ?? '')
    .trim()
    .toLowerCase()
  return u === 'emergency'
}

export function resolveIntakeSilenceAlertTier(
  snapshot: Pick<IntakeSilenceSnapshot, 'urgency' | 'urgencyAlertTier'>,
): IntakeSilenceUrgencyAlertTier {
  if (snapshot.urgencyAlertTier === 'life_safety') return 'life_safety'
  if (snapshot.urgencyAlertTier === 'same_day') return 'same_day'
  // Emergency SMS urgency without a prior alert stamp — treat as same-day
  // habitability unless leave-immediately was already recorded.
  return 'same_day'
}

/** Pick thresholds from persisted urgency; optional hard override for tests/cron. */
export function thresholdsForIntakeSilence(
  snapshot: Pick<IntakeSilenceSnapshot, 'urgency' | 'urgencyAlertTier'>,
  override?: IntakeSilenceThresholds | null,
): IntakeSilenceThresholds {
  if (override) return override
  if (snapshot.urgencyAlertTier === 'life_safety') {
    return LIFE_SAFETY_INTAKE_SILENCE_THRESHOLDS
  }
  if (isEmergencyIntakeSilence(snapshot)) {
    return URGENT_INTAKE_SILENCE_THRESHOLDS
  }
  return DEFAULT_INTAKE_SILENCE_THRESHOLDS
}

/** Open intake questions that can stall waiting for a resident reply. */
export function isOpenIntakeQuestionStep(step: string | null | undefined): boolean {
  const s = String(step ?? '').trim().toLowerCase()
  return (
    s === 'diagnostic' ||
    s === 'photo' ||
    s === 'intake_collecting' ||
    s === 'urgency' ||
    s === 'issue_type'
  )
}

function issueLabel(snapshot: IntakeSilenceSnapshot): string {
  const headline = snapshot.issueHeadline?.trim()
  if (headline) return headline
  const desc = snapshot.description?.trim() ?? ''
  if (!desc) return 'this repair'
  return (
    generateIssueSummary(desc, { format: 'title', maxChars: 80 }).trim() ||
    'this repair'
  )
}

/**
 * Re-ask copy for the open question — summarized, not a verbatim paste.
 */
export function buildIntakeSilenceNudgeSms(snapshot: IntakeSilenceSnapshot): string {
  const qType = (snapshot.diagnosticQuestionType ?? '').trim().toLowerCase()
  const issue = issueLabel(snapshot)
  const urgent = isEmergencyIntakeSilence(snapshot)
  const prefix = urgent ? 'Urgent follow-up' : 'Quick follow-up'

  if (qType === 'unit_entry') {
    return (
      `${prefix} on ${issue}: if you're not home, may staff or a vendor enter the unit?\n` +
      `Reply YES, NO, or NOT SURE so we can keep this moving.`
    )
  }
  if (qType === 'photo') {
    return (
      `${prefix} on ${issue}. If you can, send a photo of what you saw. ` +
      `If you'd rather not, reply SKIP.`
    )
  }
  if (qType === 'pest_location') {
    return (
      `${prefix} on ${issue}: where are you seeing them most — ` +
      `kitchen, bathroom, bedroom, or multiple rooms?`
    )
  }
  if (qType === 'pest_frequency') {
    return (
      `${prefix} on ${issue}: have you seen just one, or are you seeing them repeatedly?`
    )
  }

  const openQ = snapshot.diagnosticQuestion?.trim()
  if (openQ) {
    return `${prefix} on ${issue}: ${openQ}`
  }
  return (
    `${prefix} on ${issue}: we still need a short reply to finish opening your request.`
  )
}

export function buildIntakeSilenceResolvedSms(snapshot: IntakeSilenceSnapshot): string {
  const issue = issueLabel(snapshot)
  if (isEmergencyIntakeSilence(snapshot)) {
    return (
      `We've opened your urgent request for ${issue} and alerted the property team. ` +
      `Entry permission wasn't confirmed yet — they or the vendor will check with you before entering if you're not home.`
    )
  }
  return (
    `We've opened your request for ${issue}. ` +
    `Entry permission wasn't confirmed yet — the vendor will check with you before entering if you're not home.`
  )
}

/**
 * Pure classify for one conversation's open intake question.
 * Thresholds come from persisted urgency on the snapshot unless `thresholds` is passed.
 */
export function classifyIntakeSilenceFollowUp(
  snapshot: IntakeSilenceSnapshot,
  nowMs: number,
  thresholds?: IntakeSilenceThresholds | null,
): IntakeSilenceAction {
  const resolvedThresholds = thresholdsForIntakeSilence(snapshot, thresholds ?? null)
  const urgent = isEmergencyIntakeSilence(snapshot)

  if (parseMs(snapshot.silenceResolvedAt) != null) {
    return { action: 'skip', reason: 'already_resolved' }
  }

  if (!isOpenIntakeQuestionStep(snapshot.step)) {
    return { action: 'skip', reason: 'not_awaiting_answer' }
  }

  const questionType = (snapshot.diagnosticQuestionType ?? '').trim() || 'general_clarify'
  const effectiveType =
    questionType === 'general_clarify' &&
    String(snapshot.step ?? '').toLowerCase() === 'photo'
      ? 'photo'
      : questionType

  if (
    !snapshot.diagnosticQuestion?.trim() &&
    effectiveType === 'general_clarify' &&
    String(snapshot.step ?? '').toLowerCase() !== 'photo'
  ) {
    return { action: 'skip', reason: 'not_awaiting_answer' }
  }

  const askedAt = parseMs(snapshot.openQuestionAskedAt)
  if (askedAt == null) {
    return { action: 'skip', reason: 'no_open_question_timestamp' }
  }

  const silentFor = nowMs - askedAt
  const nudgedAt = parseMs(snapshot.silenceNudgeSentAt)

  if (silentFor < resolvedThresholds.nudgeMs) {
    return { action: 'skip', reason: 'before_nudge_threshold' }
  }

  if (nudgedAt == null) {
    return {
      action: 'nudge',
      questionType: effectiveType,
      body: buildIntakeSilenceNudgeSms({
        ...snapshot,
        diagnosticQuestionType: effectiveType,
      }),
      urgent,
    }
  }

  if (silentFor < resolvedThresholds.resolveMs) {
    return { action: 'skip', reason: 'already_nudged_waiting' }
  }

  if (effectiveType === 'unit_entry') {
    return {
      action: 'resolve_unit_entry_unconfirmed',
      questionType: 'unit_entry',
      body: buildIntakeSilenceResolvedSms(snapshot),
      emergencyAlert: urgent,
      urgencyAlertTier: resolveIntakeSilenceAlertTier(snapshot),
    }
  }

  if (effectiveType === 'photo') {
    return { action: 'resolve_skip_photo', questionType: 'photo', urgent }
  }

  return {
    action: 'escalate_landlord',
    questionType: effectiveType,
    reason: 'intake_silence_unanswered',
    urgent,
  }
}
