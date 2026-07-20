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
  const desc = input.description.trim().replace(/\s+/g, " ")
  const issueSummary = desc.length > 100 ? `${desc.slice(0, 99)}…` : desc
  const wo = formatWorkOrderRef(input.ticketId)
  const workOrderUrl =
    input.jobDetailUrl?.trim() ||
    input.viewJobUrl?.trim() ||
    input.acceptUrl?.trim() ||
    ""

  const lines = [
    `Hi ${company},`,
    "",
    `Ulo has assigned you a new work order (${wo}).`,
    "",
    `Issue: ${issueSummary || "See work order for details."}`,
  ]

  if (workOrderUrl) {
    lines.push("", "View the work order:", workOrderUrl)
  }

  lines.push(
    "",
    "Would you like to take this job? Reply YES to accept or NO to decline.",
  )
  return lines.join("\n")
}

export function buildVendorAvailabilityAskSms(): string {
  return "Earliest availability?"
}

export function buildVendorScheduleConfirmedSms(input: {
  workOrderRef: string
  windowText: string
}): string {
  const wo = input.workOrderRef.trim() || "this job"
  const when = input.windowText.trim() || "the time you shared"
  return `Confirmed. Job ${wo} scheduled ${when}. Tenant and property team notified.`
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
