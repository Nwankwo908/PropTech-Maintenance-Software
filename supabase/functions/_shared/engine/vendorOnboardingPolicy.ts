/**
 * Pure vendor-onboarding policy — steps, timing, reminder copy (no I/O).
 */
import type { WorkflowRunRow } from "./types.ts"

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

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

function daysSince(iso: string, now = new Date()): number {
  const start = new Date(iso)
  if (Number.isNaN(start.getTime())) return 0
  return (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
}

export function vendorOnboardingActionDue(
  run: WorkflowRunRow,
  escalationConfig: Record<string, unknown>,
  now = new Date(),
): { due: boolean; reason: string; overdueByMs: number } {
  const state = readVendorOnboardingState(run)
  if (VENDOR_ONBOARDING_TERMINAL_STEPS.has(state.step ?? "")) {
    return { due: false, reason: "terminal", overdueByMs: 0 }
  }

  const reminderDays = positiveInt(escalationConfig.reminder_days, 2)
  const noResponseDays = positiveInt(escalationConfig.no_response_days, 5)
  const startedDays = daysSince(run.started_at, now)
  const reminderSentAt = state.reminder_sent_at

  if (!reminderSentAt && startedDays >= reminderDays) {
    const overdueByMs = Math.max(
      0,
      now.getTime() -
        (new Date(run.started_at).getTime() + reminderDays * 86400000),
    )
    return { due: true, reason: "reminder_due", overdueByMs }
  }

  if (startedDays >= noResponseDays) {
    const overdueByMs = Math.max(
      0,
      now.getTime() -
        (new Date(run.started_at).getTime() + noResponseDays * 86400000),
    )
    return { due: true, reason: "no_response_by_no_response_days", overdueByMs }
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
