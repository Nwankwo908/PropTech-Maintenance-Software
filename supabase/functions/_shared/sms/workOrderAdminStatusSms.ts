/**
 * Shared plain-language SMS for admin work-order decisions.
 * Acceptance-aware: if the vendor has not replied YES yet, keep asking.
 * See `.cursor/rules/admin-work-order-status-sms.mdc`.
 */

import { vendorCompanyName } from "../vendor_outreach_copy.ts"

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

/** Explicit vendor decision on the work order (from vendor_work_status). */
export type VendorJobDecisionState = "pending" | "accepted" | "declined"

/**
 * Map ticket `vendor_work_status` to whether the vendor has accepted the job.
 * Do not treat workflow progress alone as acceptance.
 */
export function vendorJobDecisionFromWorkStatus(
  vendorWorkStatus: string | null | undefined,
): VendorJobDecisionState {
  const status = (vendorWorkStatus ?? "").trim().toLowerCase()
  if (status === "declined") return "declined"
  if (status === "accepted" || status === "in_progress" || status === "completed") {
    return "accepted"
  }
  // pending_accept, unassigned, empty, or unknown → still need a YES/NO
  return "pending"
}

/**
 * After estimate approve, how to start (or skip) visit coordination.
 * Prefer confirming a window the vendor already offered (probe / seed)
 * with the tenant — do not re-ask the vendor for the same slot.
 */
export type EstimateScheduleKickoff =
  | { kind: "none" }
  | { kind: "ask_vendor" }
  | { kind: "confirm_tenant"; windowText: string; scheduledAt: string | null }

export function resolveEstimateScheduleKickoff(input: {
  approved: boolean
  vendorDecision: VendorJobDecisionState
  scheduleConfirmedAt?: string | null
  scheduleStep?: string | null
  scheduleTicketId?: string | null
  ticketId: string
  /** Window already on the ticket (probe seed or prior propose). */
  proposedWindowText?: string | null
  proposedScheduledAt?: string | null
}): EstimateScheduleKickoff {
  if (!input.approved) return { kind: "none" }
  if (input.vendorDecision !== "accepted") return { kind: "none" }
  if (input.scheduleConfirmedAt?.trim()) return { kind: "none" }

  const step = (input.scheduleStep ?? "").trim().toLowerCase()
  const fsmTicket = (input.scheduleTicketId ?? "").trim()
  const sameTicket = !fsmTicket || fsmTicket === input.ticketId
  if (
    sameTicket &&
    (step === "awaiting_tenant_confirmation" || step === "scheduled")
  ) {
    return { kind: "none" }
  }

  const windowText = input.proposedWindowText?.trim() || ""
  if (windowText) {
    return {
      kind: "confirm_tenant",
      windowText,
      scheduledAt: input.proposedScheduledAt?.trim() || null,
    }
  }

  if (
    sameTicket &&
    (step === "awaiting_availability" || step === "awaiting_confirmation")
  ) {
    return { kind: "none" }
  }
  return { kind: "ask_vendor" }
}

/** @deprecated Prefer resolveEstimateScheduleKickoff */
export function shouldKickoffScheduleOnEstimateApprove(input: {
  approved: boolean
  vendorDecision: VendorJobDecisionState
  scheduleConfirmedAt?: string | null
  scheduleStep?: string | null
  scheduleTicketId?: string | null
  ticketId: string
  proposedWindowText?: string | null
  proposedScheduledAt?: string | null
}): boolean {
  return resolveEstimateScheduleKickoff(input).kind !== "none"
}

export function buildEstimateDecisionStatusSms(input: {
  vendorName: string
  workOrderRef: string
  approved: boolean
  totalCost: number
  /** Optional job page URL (`/w/{token}`). Used after an approved estimate. */
  jobLink?: string | null
  /** Optional estimate form URL (`/estimate/{token}`). Used after a declined estimate. */
  estimateLink?: string | null
  /**
   * Whether the vendor has explicitly accepted the work order.
   * Defaults to pending (keep asking) when omitted.
   */
  vendorDecision?: VendorJobDecisionState
  /**
   * When the vendor is already on the job and no visit window exists yet,
   * fold the earliest-availability ask into the approval SMS (one message).
   */
  includeScheduleAsk?: boolean
  /**
   * When the vendor already offered a window (probe / seed), tell them we're
   * confirming that window with the resident — do not re-ask for availability.
   */
  confirmingWindowText?: string | null
  /** Resident-shared times from intake, when present. */
  residentAvailabilityText?: string | null
}): string | null {
  const decision = input.vendorDecision ?? "pending"
  if (decision === "declined") {
    return null
  }

  const name = vendorCompanyName(input.vendorName)
  const wo = input.workOrderRef.trim() || "this work order"
  const jobLink = input.jobLink?.trim() || ""
  const estimateLink = input.estimateLink?.trim() || jobLink
  const amount = money(input.totalCost)

  if (input.approved) {
    if (decision === "accepted") {
      const lines = [
        `Hi ${name},`,
        "",
        `Update for work order ${wo}.`,
        "",
        `The property team approved your estimate of ${amount}.`,
      ]
      const confirming = input.confirmingWindowText?.trim()
      if (confirming) {
        lines.push(
          "",
          `We're confirming ${confirming} with the resident now.`,
          "We'll text you when they reply.",
        )
      } else if (input.includeScheduleAsk) {
        const avail = input.residentAvailabilityText?.trim()
        lines.push("")
        if (avail) {
          lines.push(
            `The resident shared these times: ${avail}.`,
            "Please reply with a day and arrival window that works within those times (or the closest option you can do), e.g. Sat after 3pm or Mon 10:30am–12pm.",
          )
        } else {
          lines.push(
            "What's your earliest availability?",
            "Reply with a day and arrival window (e.g. Wed 9am–12pm) or an exact time (e.g. Wed at 10am).",
          )
        }
        lines.push(
          "",
          "We'll confirm that time with the resident before you go.",
        )
      } else {
        lines.push("", "You can now continue with the repair.")
      }
      if (jobLink) {
        lines.push("", "View details:", jobLink)
      }
      return lines.join("\n")
    }

    const lines = [
      `Hi ${name},`,
      "",
      `Update for work order ${wo}.`,
      "",
      `The property team approved your estimate of ${amount}.`,
      "",
      "Would you like to continue with this job?",
      "",
      "Reply YES to accept the work order or NO if you're unable to take it.",
      "",
      "After you accept, we'll set a visit time with the resident.",
    ]
    if (jobLink) {
      lines.push("", "View details:", jobLink)
    }
    return lines.join("\n")
  }

  const lines = [
    `Hi ${name},`,
    "",
    `Update for work order ${wo}.`,
    "",
    `The property team did not approve your estimate of ${amount}.`,
    "",
    "Please submit an updated estimate when you're ready.",
  ]
  if (estimateLink) {
    lines.push("", estimateLink)
  }
  return lines.join("\n")
}
