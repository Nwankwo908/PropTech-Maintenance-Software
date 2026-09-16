/**
 * Pure vendor-onboarding policy — steps, timing, reminder copy (no I/O).
 *
 * Silence follow-ups match tenant activation: every 48 hours from the last
 * outbound invite/nudge until the vendor submits the form or we hit the cap.
 */
import type { WorkflowRunRow } from "./types.ts"

/** Same cadence as tenant `ACTIVATION_SILENCE_NUDGE_HOURS`. */
export const VENDOR_ONBOARDING_SILENCE_NUDGE_HOURS = 48
/** Invite + follow-ups. Same cap as tenant `MAX_SILENCE_NUDGE_ATTEMPTS`. */
export const MAX_VENDOR_ONBOARDING_SILENCE_OUTBOUND = 14

export type VendorOnboardingStep =
  | "invited"
  | "in_progress"
  | "submitted"
  | "needs_review"
  | "verified"
  | "cancelled"
  | "reminder_sent"
  | "escalated"

export type VendorOnboardingState = {
  step?: VendorOnboardingStep
  verification_id?: string | null
  vendor_id?: string | null
  channel?: string | null
  business_name?: string | null
  contact_name?: string | null
  invite_conversation_id?: string | null
  reminder_sent_at?: string | null
  reminder_count?: number
  last_activity_at?: string | null
  escalated_at?: string | null
  escalation_reason?: string | null
}

export const VENDOR_ONBOARDING_WAITING_STEPS = new Set<string>([
  "invited",
  "in_progress",
  "submitted",
  "needs_review",
  "reminder_sent",
])

export const VENDOR_ONBOARDING_TERMINAL_STEPS = new Set<string>([
  "verified",
  "cancelled",
  "escalated",
])

const VENDOR_ONBOARDING_FORM_SUBMITTED = new Set<string>([
  "submitted",
  "needs_review",
  "verified",
])

/** True after the vendor has submitted the verification form (complete or not). */
export function vendorOnboardingFormWasSubmitted(
  step?: string | null,
  verificationStatus?: string | null,
): boolean {
  return VENDOR_ONBOARDING_FORM_SUBMITTED.has(step ?? "") ||
    VENDOR_ONBOARDING_FORM_SUBMITTED.has(verificationStatus ?? "")
}

/** Invite must actually reach SMS or email before the run stays on Active Tasks. */
export function vendorOnboardingInviteWasDelivered(
  delivered: { anyDelivered?: boolean } | null | undefined,
): boolean {
  return delivered?.anyDelivered === true
}

export function readVendorOnboardingState(
  run: WorkflowRunRow,
): VendorOnboardingState {
  const stepState = run.metadata?.step_state
  const base =
    stepState && typeof stepState === "object" && !Array.isArray(stepState)
      ? (stepState as VendorOnboardingState)
      : {}
  const step =
    (typeof run.current_step === "string" ? run.current_step : null) ??
    base.step ??
    "invited"
  return {
    ...base,
    step: step as VendorOnboardingStep,
    verification_id:
      base.verification_id ??
      (typeof run.metadata?.verification_id === "string"
        ? run.metadata.verification_id
        : null),
    vendor_id:
      base.vendor_id ??
      (typeof run.metadata?.vendor_id === "string"
        ? run.metadata.vendor_id
        : null),
  }
}

export function vendorOnboardingActionDue(
  run: WorkflowRunRow,
  _escalationConfig: Record<string, unknown> = {},
  now = new Date(),
): { due: boolean; reason: string; overdueByMs: number } {
  const state = readVendorOnboardingState(run)
  if (VENDOR_ONBOARDING_TERMINAL_STEPS.has(state.step ?? "")) {
    return { due: false, reason: "terminal", overdueByMs: 0 }
  }
  if (vendorOnboardingFormWasSubmitted(state.step)) {
    return { due: false, reason: "form_already_submitted", overdueByMs: 0 }
  }

  const reminderCount = Math.max(0, Math.floor(state.reminder_count ?? 0))
  const outbound = 1 + reminderCount
  if (outbound >= MAX_VENDOR_ONBOARDING_SILENCE_OUTBOUND) {
    return { due: false, reason: "silence_cap", overdueByMs: 0 }
  }

  const lastOutboundIso = state.reminder_sent_at?.trim() || run.started_at
  const lastOutbound = new Date(lastOutboundIso)
  const dueMs = VENDOR_ONBOARDING_SILENCE_NUDGE_HOURS * 60 * 60 * 1000
  const overdueByMs = Number.isNaN(lastOutbound.getTime())
    ? 0
    : now.getTime() - lastOutbound.getTime() - dueMs
  if (overdueByMs >= 0) {
    return { due: true, reason: "reminder_due", overdueByMs }
  }

  return { due: false, reason: "within_threshold", overdueByMs: 0 }
}

function companyTeamLine(companyName: string | null | undefined): string {
  const company = companyName?.trim()
  return company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
}

export function buildVendorOnboardingReminderSms(input: {
  vendorLabel: string
  companyName?: string | null
  link: string
  needsReview?: boolean
}): string {
  const greeting = input.vendorLabel === "there"
    ? "Hi,"
    : `Hi ${input.vendorLabel},`
  const why = input.needsReview
    ? "A few verification items still need attention before we can begin sending you work orders."
    : "We still need your quick verification so we can begin sending you work orders."
  return [
    greeting,
    "",
    companyTeamLine(input.companyName),
    "",
    why,
    "It takes about 5 minutes.",
    "",
    input.link,
  ].join("\n")
}

export function buildVendorOnboardingReminderEmail(input: {
  vendorLabel: string
  companyName?: string | null
  link: string
  needsReview?: boolean
}): { subject: string; text: string; html: string } {
  const vendor = input.vendorLabel === "there" ? "there" : input.vendorLabel
  const company = input.companyName?.trim() || "Our property management team"
  const subject = input.needsReview
    ? "Please finish your vendor verification"
    : "Reminder: complete your vendor verification"
  const why = input.needsReview
    ? "A few items still need attention before we can begin sending you work orders."
    : "We'd still like you to complete a quick verification so we can begin sending you work orders."
  const text =
    `Hi ${vendor},\n\n${company} here.\n\n${why}\n\n` +
    `The process takes about 5 minutes.\n\n` +
    `Start here:\n${input.link}\n\nThank you,\n${company}`
  const html =
    `<p>Hi ${vendor},</p>` +
    `<p>${company} here.</p>` +
    `<p>${why}</p>` +
    `<p>The process takes about 5 minutes.</p>` +
    `<p><a href="${input.link}">Start Verification</a></p>` +
    `<p>If the button doesn't work, copy and paste this link into your browser:<br/>${input.link}</p>` +
    `<p>Thank you,<br/>${company}</p>`
  return { subject, text, html }
}
