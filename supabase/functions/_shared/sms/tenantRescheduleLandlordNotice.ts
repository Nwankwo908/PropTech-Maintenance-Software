/**
 * Landlord notice when a resident asks to move a visit.
 * The saved appointment stays in place until a new time is confirmed.
 * Technical failures stay out of the text.
 */

export type TenantRescheduleNoticeInput = {
  /** Vendor text was accepted by the provider. */
  vendorNotified: boolean
  /** Stable code from the reschedule attempt. Never a database message. */
  failureCode?: string | null
  /** Confirmed visit still on the request, in plain language. */
  currentVisitLabel: string | null
  /** Day and time the resident offered. */
  preferredWindow: string | null
  /**
   * True only when this account's settings require a sign-off
   * before the vendor is asked. A normal visit change is not one of these.
   */
  approvalRequired?: boolean
}

export type TenantRescheduleNotice = {
  outcome: "inform" | "failed" | "approval"
  headline: string
  detail: string
  /** Replaces the generic "This needs a decision from you." */
  whyLine: string
  nextSteps: string[]
}

function sentence(value: string | null | undefined, fallback: string): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim()
  return text || fallback
}

export function buildTenantRescheduleLandlordNotice(
  input: TenantRescheduleNoticeInput,
): TenantRescheduleNotice {
  const current = sentence(input.currentVisitLabel, "the current visit")
  const preferred = sentence(input.preferredWindow, "another time")

  if (input.approvalRequired === true && !input.vendorNotified) {
    return {
      outcome: "approval",
      headline: "A resident asked to move a visit",
      detail:
        `They suggested ${preferred}. ${current} stays the confirmed visit until you approve a change.`,
      whyLine:
        `Reply YES to ask the vendor about ${preferred}, or NO to keep ${current}.`,
      nextSteps: [],
    }
  }

  if (input.vendorNotified) {
    return {
      outcome: "inform",
      headline: "A resident asked to move a visit",
      detail:
        `They suggested ${preferred}. ${current} is still the confirmed visit. We asked the vendor for a new time and will text you when it is confirmed.`,
      whyLine: "No reply is needed.",
      nextSteps: [],
    }
  }

  const code = (input.failureCode ?? "").trim()
  const next = code === "no_vendor" || code === "no_vendor_phone"
    ? "Add a phone number for the vendor in Ulo. The resident can send the new time again after that."
    : code === "send_failed"
    ? "Open the visit in Ulo and contact the vendor, or wait for the resident to send the time again."
    : "No reply is needed. The resident can send the new day and time again."

  return {
    outcome: "failed",
    headline: "A visit change did not go through",
    detail:
      `The resident asked for ${preferred}. ${current} is still confirmed, and the vendor was not texted.`,
    whyLine: next,
    nextSteps: [],
  }
}
