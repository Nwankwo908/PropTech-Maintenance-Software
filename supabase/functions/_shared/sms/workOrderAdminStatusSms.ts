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

export function buildEstimateDecisionStatusSms(input: {
  vendorName: string
  workOrderRef: string
  approved: boolean
  totalCost: number
  /** Optional job page URL (`/w/{token}`). */
  jobLink?: string | null
  /**
   * Whether the vendor has explicitly accepted the work order.
   * Defaults to pending (keep asking) when omitted.
   */
  vendorDecision?: VendorJobDecisionState
}): string | null {
  const decision = input.vendorDecision ?? "pending"
  if (decision === "declined") {
    return null
  }

  const name = vendorCompanyName(input.vendorName)
  const wo = input.workOrderRef.trim() || "this work order"
  const link = input.jobLink?.trim() || ""
  const amount = money(input.totalCost)

  if (input.approved) {
    if (decision === "accepted") {
      const lines = [
        `Hi ${name},`,
        "",
        `Update for work order ${wo}.`,
        "",
        `The property team approved your estimate of ${amount}.`,
        "",
        "You can now continue with the repair.",
      ]
      if (link) {
        lines.push("", "View details:", link)
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
    ]
    if (link) {
      lines.push("", "View details:", link)
    }
    return lines.join("\n")
  }

  // Landlord declined the estimate
  if (decision === "accepted") {
    const lines = [
      `Hi ${name},`,
      "",
      `Update for work order ${wo}.`,
      "",
      "The property team declined your estimate.",
      "",
      "Please submit a revised estimate when ready.",
    ]
    if (link) {
      lines.push("", "View details:", link)
    }
    return lines.join("\n")
  }

  const lines = [
    `Hi ${name},`,
    "",
    `Update for work order ${wo}.`,
    "",
    "The property team declined your estimate.",
    "",
    "Would you like to continue with this job?",
    "",
    "Reply YES to accept the work order or NO if you're unable to take it.",
  ]
  if (link) {
    lines.push("", "View details:", link)
  }
  return lines.join("\n")
}
