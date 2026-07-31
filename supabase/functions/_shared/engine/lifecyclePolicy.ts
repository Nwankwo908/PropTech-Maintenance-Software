/**
 * Pure lifecycle workflow policy — steps, timing, reminder copy (no I/O).
 */
import type { WorkflowRunRow, WorkflowTriggerType } from "./types.ts"
import type { LifecycleWorkflowKey } from "./lifecycleWorkflowTemplates.ts"

/** Triggers that run welcome / notice outreach on a newly started lifecycle run. */
export function isLifecycleInitialActTrigger(
  trigger: WorkflowTriggerType,
): boolean {
  return trigger === "dashboard" ||
    trigger === "automation" ||
    trigger === "webhook"
}

export type MoveInStep =
  | "initiated"
  | "occupancy_registered"
  | "checklist_sent"
  | "awaiting_confirm"
  | "utilities_confirmed"
  | "completed"
  | "escalated"
  | "cancelled"
  | "reminder_sent"

export type MoveOutStep =
  | "initiated"
  | "notice_sent"
  | "awaiting_vacate"
  | "turnover_in_progress"
  | "unit_vacated"
  | "inspection_scheduled"
  | "deposit_pending"
  | "completed"
  | "escalated"
  | "cancelled"
  | "reminder_sent"

export type InspectionStep =
  | "initiated"
  | "scheduled"
  | "notice_sent"
  | "awaiting_resident"
  | "in_progress"
  | "completed"
  | "rescheduled"
  | "no_show"
  | "escalated"
  | "cancelled"
  | "reminder_sent"

export type LifecycleStep = MoveInStep | MoveOutStep | InspectionStep

export type LifecycleStepState = {
  step?: LifecycleStep
  reminder_sent_at?: string | null
  reminder_count?: number
  last_activity_at?: string | null
  escalated_at?: string | null
  escalation_reason?: string | null
  conversation_id?: string | null
  move_in_date?: string | null
  move_out_date?: string | null
  scheduled_at?: string | null
  inspection_type?: string | null
}

export const LIFECYCLE_WAITING_STEPS = new Set<string>([
  // move_in
  "initiated",
  "occupancy_registered",
  "checklist_sent",
  "awaiting_confirm",
  "utilities_confirmed",
  // move_out
  "notice_sent",
  "awaiting_vacate",
  "turnover_in_progress",
  "unit_vacated",
  "inspection_scheduled",
  "deposit_pending",
  // inspection
  "scheduled",
  "notice_sent",
  "awaiting_resident",
  "in_progress",
  "rescheduled",
  "no_show",
  // shared
  "reminder_sent",
])

export const LIFECYCLE_TERMINAL_STEPS = new Set<string>([
  "completed",
  "cancelled",
  "escalated",
])

export function readLifecycleStepState(run: WorkflowRunRow): LifecycleStepState {
  const stepState = run.metadata?.step_state
  const base =
    stepState && typeof stepState === "object" && !Array.isArray(stepState)
      ? (stepState as LifecycleStepState)
      : {}
  const step =
    (typeof run.current_step === "string" ? run.current_step : null) ??
    base.step ??
    "initiated"
  return { ...base, step: step as LifecycleStep }
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

/** Default reminder / escalate thresholds by lifecycle template. */
export function lifecycleTimingDefaults(templateId: LifecycleWorkflowKey): {
  reminderDays: number
  noResponseDays: number
} {
  switch (templateId) {
    case "move_in":
      return { reminderDays: 2, noResponseDays: 5 }
    case "move_out":
      return { reminderDays: 3, noResponseDays: 7 }
    case "inspection":
      return { reminderDays: 1, noResponseDays: 3 }
  }
}

export function lifecycleActionDue(
  run: WorkflowRunRow,
  escalationConfig: Record<string, unknown> = {},
  now = new Date(),
): { due: boolean; reason: string; overdueByMs: number } {
  const templateId = run.template_id as LifecycleWorkflowKey
  if (!["move_in", "move_out", "inspection"].includes(templateId)) {
    return { due: false, reason: "not_lifecycle", overdueByMs: 0 }
  }

  const state = readLifecycleStepState(run)
  if (LIFECYCLE_TERMINAL_STEPS.has(state.step ?? "")) {
    return { due: false, reason: "terminal", overdueByMs: 0 }
  }

  // Already alerted landlord (auto-forward path keeps run active).
  const meta = run.metadata ?? {}
  if (
    state.escalated_at ||
    (typeof meta.landlord_alerted_at === "string" && meta.landlord_alerted_at)
  ) {
    return { due: false, reason: "already_alerted", overdueByMs: 0 }
  }

  const defaults = lifecycleTimingDefaults(templateId)
  const reminderDays = positiveInt(
    escalationConfig.reminder_days,
    defaults.reminderDays,
  )
  const noResponseDays = positiveInt(
    escalationConfig.no_response_days,
    defaults.noResponseDays,
  )

  const anchorIso = state.last_activity_at || run.started_at
  const startedDays = daysSince(anchorIso, now)
  const reminderSentAt = state.reminder_sent_at

  if (!reminderSentAt && startedDays >= reminderDays) {
    const overdueByMs = Math.max(
      0,
      now.getTime() -
        (new Date(anchorIso).getTime() + reminderDays * 86400000),
    )
    return { due: true, reason: "reminder_due", overdueByMs }
  }

  if (startedDays >= noResponseDays) {
    const overdueByMs = Math.max(
      0,
      now.getTime() -
        (new Date(anchorIso).getTime() + noResponseDays * 86400000),
    )
    return { due: true, reason: "no_response_by_no_response_days", overdueByMs }
  }

  return { due: false, reason: "within_threshold", overdueByMs: 0 }
}

function teamLine(companyName?: string | null): string {
  const company = companyName?.trim()
  return company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
}

export function buildMoveInWelcomeSms(input: {
  residentName: string
  companyName?: string | null
  unitLabel?: string | null
  moveInDate?: string | null
}): string {
  const name = input.residentName.trim() || "there"
  const unit = input.unitLabel?.trim()
  const unitPart = unit ? ` for unit ${unit}` : ""
  let datePart = ""
  if (input.moveInDate?.trim()) {
    const formatted = new Date(`${input.moveInDate.trim().slice(0, 10)}T12:00:00`)
      .toLocaleDateString("en-US", { month: "long", day: "numeric" })
    datePart = ` Your move-in date is ${formatted}.`
  }
  return [
    `Hi ${name},`,
    "",
    teamLine(input.companyName),
    "",
    `Welcome${unitPart}.${datePart} We'll text you here with a short checklist so your move-in goes smoothly.`,
    "",
    "Reply here anytime if you have questions.",
  ].join("\n")
}

export function buildMoveInReminderSms(input: {
  residentName: string
  companyName?: string | null
}): string {
  const name = input.residentName.trim() || "there"
  return [
    `Hi ${name},`,
    "",
    teamLine(input.companyName),
    "",
    "Just a friendly reminder to finish your move-in checklist when you can. Reply here if you need help with anything.",
  ].join("\n")
}

export function buildMoveOutReminderSms(input: {
  residentName: string
  companyName?: string | null
  moveOutDate?: string | null
}): string {
  const name = input.residentName.trim() || "there"
  let datePart = ""
  if (input.moveOutDate?.trim()) {
    const formatted = new Date(`${input.moveOutDate.trim().slice(0, 10)}T12:00:00`)
      .toLocaleDateString("en-US", { month: "long", day: "numeric" })
    datePart = ` Your move-out date is ${formatted}.`
  }
  return [
    `Hi ${name},`,
    "",
    teamLine(input.companyName),
    "",
    `Friendly reminder about your move-out steps.${datePart} Please finish cleaning, return your keys, and complete the inspection. Reply here if you have questions.`,
  ].join("\n")
}

export function buildInspectionNoticeSms(input: {
  residentName: string
  companyName?: string | null
  scheduledAt?: string | null
  inspectionType?: string | null
}): string {
  const name = input.residentName.trim() || "there"
  const typeLabel = (input.inspectionType ?? "inspection").replace(/_/g, " ")
  let when = "soon"
  if (input.scheduledAt?.trim()) {
    when = new Date(input.scheduledAt).toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  }
  return [
    `Hi ${name},`,
    "",
    teamLine(input.companyName),
    "",
    `We're scheduling a ${typeLabel} for ${when}. Please make sure we can access the unit, or reply here to reschedule.`,
  ].join("\n")
}

export function buildInspectionReminderSms(input: {
  residentName: string
  companyName?: string | null
  scheduledAt?: string | null
}): string {
  const name = input.residentName.trim() || "there"
  let when = "your upcoming inspection"
  if (input.scheduledAt?.trim()) {
    when = new Date(input.scheduledAt).toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })
  }
  return [
    `Hi ${name},`,
    "",
    teamLine(input.companyName),
    "",
    `Reminder: we still need access for the inspection on ${when}. Reply here if you need to reschedule.`,
  ].join("\n")
}
