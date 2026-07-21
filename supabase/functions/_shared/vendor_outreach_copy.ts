/** Vendor outreach copy — short, friendly, one clear CTA (6th–8th grade reading level). */

/** Short work-order ref for SMS (matches admin WO-XXXX style). */
export function formatWorkOrderRef(ticketId: string): string {
  const compact = ticketId.replace(/-/g, "").slice(0, 4).toUpperCase()
  return `WO-${compact || "0000"}`
}

/** Full company / legal business name for greetings. */
export function vendorCompanyName(vendorName: string): string {
  const trimmed = vendorName.trim()
  return trimmed || "there"
}

/** @deprecated Use vendorCompanyName */
export function vendorFirstName(vendorName: string): string {
  return vendorCompanyName(vendorName)
}

function humanPriority(priority: string): string {
  const p = priority.trim().toLowerCase()
  if (p === "critical" || p === "emergency") return "urgent"
  if (p === "high") return "high-priority"
  if (p === "medium" || p === "normal") return "standard"
  if (p === "low") return "low-priority"
  return priority.trim() || "standard"
}

export function buildVendorJobAssignmentSubject(unit: string): string {
  const loc = unit.trim() || "your property"
  return `New job at ${loc}`
}

export function buildVendorJobAssignmentEmailText(input: {
  vendorName: string
  priority: string
  unit: string
  description: string
  ticketId: string
  dueAt?: string | null
  estimatedMinutes?: number | null
  viewJobUrl?: string | null
  acceptUrl?: string | null
  declineUrl?: string | null
  portalHomeUrl?: string | null
  accessCode?: string | null
}): string {
  const company = vendorCompanyName(input.vendorName)
  const pri = humanPriority(input.priority)
  const unit = input.unit.trim() || "the property"
  const lines: string[] = [
    `Hi ${company},`,
    "",
    `You have a new ${pri} maintenance job at ${unit}.`,
    "",
    input.description.trim(),
    "",
  ]

  if (input.dueAt?.trim()) {
    lines.push(`Please respond by ${new Date(input.dueAt).toLocaleString()}.`, "")
  } else if (
    typeof input.estimatedMinutes === "number" &&
    Number.isFinite(input.estimatedMinutes)
  ) {
    lines.push(`We're hoping to get this done within about ${input.estimatedMinutes} minutes.`, "")
  }

  lines.push("Want this job? Use the links below to accept or decline.", "")

  if (input.acceptUrl) lines.push(`Accept: ${input.acceptUrl}`)
  if (input.declineUrl) lines.push(`Decline: ${input.declineUrl}`)
  if (input.viewJobUrl) lines.push(`View details: ${input.viewJobUrl}`)
  else if (input.portalHomeUrl) lines.push(`Vendor portal: ${input.portalHomeUrl}`)

  if (input.accessCode?.trim()) {
    lines.push(
      "",
      `Your sign-in code: ${input.accessCode.trim()}`,
      "Use this on the vendor portal if you're asked to log in.",
    )
  }

  lines.push("", `Job ref: ${input.ticketId}`, "", "Thanks!")
  return lines.join("\n")
}

export function buildVendorJobAssignmentSms(input: {
  vendorName: string
  priority: string
  unit: string
  description: string
  ticketId: string
  /** Public job detail link (`/w/{vendor_action_token}`). */
  jobDetailUrl?: string | null
  viewJobUrl?: string | null
  acceptUrl?: string | null
}): string {
  const company = vendorCompanyName(input.vendorName)
  const issueSummary = input.description.trim().replace(/\s+/g, " ")
  const wo = formatWorkOrderRef(input.ticketId)

  // Job detail link is SMS 3 after accept + scheduling ask (`buildVendorJobDetailLinkSms`).
  return [
    `Hi ${company},`,
    "",
    `Ulo has assigned you a new work order (${wo}).`,
    "",
    `Issue: ${issueSummary || "See work order for details."}`,
    "",
    "Would you like to take this job? Reply YES to accept or NO to decline.",
  ].join("\n")
}

/** Job detail link — sent after schedule is locked (completes the scheduling thread). */
export function buildVendorJobDetailLinkSms(jobDetailUrl: string): string {
  const url = jobDetailUrl.trim()
  if (!url) return ""
  return [
    "Open the work order and submit your estimate when you can:",
    url,
  ].join("\n")
}

export function buildVendorAvailabilityAskSms(): string {
  return "Earliest availability?"
}

export function buildVendorScheduleConfirmedSms(input: {
  workOrderRef: string
  windowText: string
  /** When set, confirmation + next step ship in one SMS. */
  jobDetailUrl?: string
}): string {
  const wo = input.workOrderRef.trim() || "this job"
  const when = input.windowText.trim() || "the time you shared"
  const lines = [
    `Confirmed. Job ${wo} is scheduled for ${when}.`,
    "We've notified the tenant and the property team.",
  ]
  const url = input.jobDetailUrl?.trim() ?? ""
  if (url) {
    lines.push("")
    lines.push("Next, open the work order and submit your estimate:")
    lines.push(url)
  }
  return lines.join("\n")
}

/** Soft confirmation before locking a medium-confidence parse. */
export function buildVendorScheduleSoftConfirmSms(windowText: string): string {
  const when = windowText.trim() || "that time"
  return `Got it — ${when}. Reply YES to confirm, or send a different time.`
}

/** Soft clarification when availability is unclear (never a hard "couldn't save"). */
export function buildVendorScheduleClarifySms(custom?: string): string {
  const q = (custom ?? "").trim()
  if (q) return q
  return "Thanks — what day and time works best? For example: Tomorrow 9am."
}

/** Soft retry when persistence fails but we still understood the time. */
export function buildVendorScheduleSaveRetrySms(windowText: string): string {
  const when = windowText.trim() || "that time"
  return `I have ${when} — reply YES and I'll lock it in.`
}

export function buildVendorRetryEmailSubject(ticketId: string): string {
  return `Resending your job alert (ref ${ticketId})`
}

export function buildVendorRetryEmailText(input: {
  vendorName: string
  priority: string
  unit: string
  description: string
  ticketId: string
}): string {
  const company = vendorCompanyName(input.vendorName)
  const pri = humanPriority(input.priority)
  const unit = input.unit.trim() || "the property"

  return [
    `Hi ${company},`,
    "",
    `We're resending your job alert — our last message may not have gone through.`,
    "",
    `${pri.charAt(0).toUpperCase()}${pri.slice(1)} job at ${unit}.`,
    "",
    input.description.trim(),
    "",
    `Job ref: ${input.ticketId}`,
    "",
    "Check your email or vendor portal for accept/decline links.",
    "",
    "Thanks!",
  ].join("\n")
}

export function buildVendorRetrySms(input: {
  ticketId: string
  priority: string
  unit: string
}): string {
  const pri = humanPriority(input.priority)
  const unit = input.unit.trim() || "the property"
  return `Job alert resend · ${pri} job at ${unit}. Ref ${input.ticketId}. Check your email or portal to respond.`
}

export function buildVendorSmsAcceptReply(): string {
  return buildVendorAvailabilityAskSms()
}

export function buildVendorSmsDeclineReply(): string {
  return "Thanks — we recorded your decline. We'll find another vendor for this job."
}

export function buildVendorSmsReplyPrompt(): string {
  return "Would you like to take this job? Reply YES to accept or NO to decline."
}
