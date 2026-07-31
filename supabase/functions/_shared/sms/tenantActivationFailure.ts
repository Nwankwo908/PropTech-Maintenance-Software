/**
 * Friendly failure reasons + permanent vs retryable classification
 * for tenant welcome/activation SMS delivery.
 */

export type ActivationFailureKind =
  | "invalid_phone"
  | "cannot_receive_sms"
  | "carrier_rejected"
  | "unreachable"
  | "exhausted_retries"
  | "unknown"

/** Permanent failures should skip remaining automatic retries and alert immediately. */
export function isPermanentDeliveryFailure(
  reason: string | null | undefined,
  errorCode?: string | null,
): boolean {
  const r = `${reason ?? ""} ${errorCode ?? ""}`.trim().toLowerCase()
  if (!r) return false
  if (
    /\binvalid\b/.test(r) ||
    r.includes("invalid_phone") ||
    r.includes("21211") || // Twilio invalid
    r.includes("21614") || // Twilio not SMS-capable
    r.includes("30006") || // landline / cannot receive
    r.includes("30007") || // carrier filtered / blocked
    r.includes("landline") ||
    r.includes("not a mobile") ||
    r.includes("cannot receive") ||
    r.includes("blocked") ||
    r.includes("blacklisted")
  ) {
    return true
  }
  return false
}

export function classifyActivationFailure(
  reason: string | null | undefined,
  errorCode?: string | null,
): ActivationFailureKind {
  const r = `${reason ?? ""} ${errorCode ?? ""}`.trim().toLowerCase()
  if (!r) return "unknown"
  if (r.includes("exhausted") || r.includes("max_attempt") || r.includes("after multiple")) {
    return "exhausted_retries"
  }
  if (
    r.includes("invalid") ||
    r.includes("21211") ||
    r.includes("21614")
  ) {
    return "invalid_phone"
  }
  if (
    r.includes("landline") ||
    r.includes("cannot receive") ||
    r.includes("not a mobile") ||
    r.includes("30006")
  ) {
    return "cannot_receive_sms"
  }
  if (
    r.includes("filtered") ||
    r.includes("rejected") ||
    r.includes("blocked") ||
    r.includes("30007")
  ) {
    return "carrier_rejected"
  }
  if (
    r.includes("unreachable") ||
    r.includes("undelivered") ||
    r.includes("30003") ||
    r.includes("30005")
  ) {
    return "unreachable"
  }
  if (isPermanentDeliveryFailure(reason, errorCode)) return "unreachable"
  return "unknown"
}

export function friendlyActivationFailureReason(
  reason: string | null | undefined,
  errorCode?: string | null,
): string {
  switch (classifyActivationFailure(reason, errorCode)) {
    case "invalid_phone":
      return "Invalid phone number"
    case "cannot_receive_sms":
      return "Number cannot receive text messages"
    case "carrier_rejected":
      return "Carrier rejected the message"
    case "unreachable":
      return "Number is unreachable"
    case "exhausted_retries":
      return "Delivery failed after multiple attempts"
    default:
      return "Delivery failed after multiple attempts"
  }
}

export function maskPhoneLast4(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "")
  if (digits.length < 4) return null
  return digits.slice(-4)
}

export function activationAdminAlertDedupKey(
  residentId: string,
  attemptIdOrNumber: string | number,
): string {
  return `resident_activation_undeliverable:${residentId.trim()}:${String(attemptIdOrNumber)}`
}

/** Onboarding / approval-rules channel preference for operational alerts. */
export type OpsAlertChannelPreference = "sms" | "email" | "activity_feed" | "both"

export function normalizeOpsAlertChannelPreference(
  raw: unknown,
): OpsAlertChannelPreference {
  const v = String(raw ?? "").trim().toLowerCase().replace(/-/g, "_")
  if (v === "sms" || v === "text") return "sms"
  if (v === "email" || v === "mail") return "email"
  if (v === "activity_feed" || v === "feed" || v === "activityfeed") {
    return "activity_feed"
  }
  return "both"
}

/** Which channels to attempt for an operational landlord alert. */
export function opsAlertChannelsEnabled(
  preference: OpsAlertChannelPreference,
): { sms: boolean; email: boolean; activityFeed: boolean } {
  if (preference === "sms") {
    return { sms: true, email: false, activityFeed: false }
  }
  if (preference === "email") {
    return { sms: false, email: true, activityFeed: false }
  }
  if (preference === "activity_feed") {
    return { sms: false, email: false, activityFeed: true }
  }
  // both = SMS + email + Ulo Activity Feed
  return { sms: true, email: true, activityFeed: true }
}

/** Normalize US phones to E.164-ish `+1…` for ops recipient comparison. */
function normalizeOpsPhoneDigits(input: string | null | undefined): string | null {
  if (input == null) return null
  let digits = String(input).replace(/\D/g, "")
  if (digits.length === 10) digits = `1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  if (digits.length > 11) return `+${digits}`
  return null
}

/** Pure filter: drop candidate phones that match a vendor phone. */
export function filterVendorPhonesFromOpsRecipients(
  candidates: Iterable<string>,
  vendorPhones: Iterable<string>,
): { allowed: string[]; blocked: string[] } {
  const blockedSet = new Set<string>()
  for (const v of vendorPhones) {
    const n = normalizeOpsPhoneDigits(typeof v === "string" ? v : "")
    if (n) blockedSet.add(n)
  }
  const allowed: string[] = []
  const blocked: string[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    const n = normalizeOpsPhoneDigits(typeof c === "string" ? c : "")
    if (!n || seen.has(n)) continue
    seen.add(n)
    if (blockedSet.has(n)) {
      blocked.push(n)
      continue
    }
    allowed.push(n)
  }
  return { allowed, blocked }
}

export function buildActivationAdminSms(input: {
  residentName?: string | null
  unitLabel: string
  propertyName: string
  last4?: string | null
}): string {
  const unit = input.unitLabel.trim() || "their unit"
  const property = input.propertyName.trim() || "your property"
  const name = (input.residentName ?? "").trim()
  const who = name
    ? `${name} in Unit ${unit}`
    : `the resident in Unit ${unit}`
  const lines = [
    `Ulo alert: We couldn't deliver the activation text to ${who} at ${property}. Please verify or update their phone number before activating SMS access.`,
  ]
  if (input.last4) {
    lines.push(`Phone ending in ${input.last4}`)
  }
  return lines.join(" ")
}

export function buildActivationAdminEmail(input: {
  residentName?: string | null
  unitLabel: string
  propertyName: string
  maskedPhone?: string | null
  friendlyReason: string
  residentDetailsUrl: string
}): { subject: string; text: string; html: string } {
  const unit = input.unitLabel.trim() || "—"
  const property = input.propertyName.trim() || "your property"
  const name = (input.residentName ?? "").trim() || "the resident"
  const subject = `Resident phone needs attention — Unit ${unit}`
  const phoneLine = input.maskedPhone
    ? `Phone on file: ${input.maskedPhone}`
    : null
  const text = [
    `Ulo couldn't deliver the activation text to ${name} in Unit ${unit} at ${property}.`,
    "",
    "Please review and update the resident's phone number before activating SMS access.",
    "",
    phoneLine,
    `Delivery issue: ${input.friendlyReason}`,
    "",
    "Open resident details:",
    input.residentDetailsUrl,
  ]
    .filter((line): line is string => line != null)
    .join("\n")

  const html = `<p>Ulo couldn't deliver the activation text to <strong>${escapeHtml(name)}</strong> in Unit <strong>${escapeHtml(unit)}</strong> at ${escapeHtml(property)}.</p>
<p>Please review and update the resident's phone number before activating SMS access.</p>
${phoneLine ? `<p>${escapeHtml(phoneLine)}</p>` : ""}
<p>Delivery issue: ${escapeHtml(input.friendlyReason)}</p>
<p><a href="${escapeHtml(input.residentDetailsUrl)}" style="display:inline-block;padding:10px 16px;background:#186179;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open resident details</a></p>
<p style="color:#6a7282;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:<br>${escapeHtml(input.residentDetailsUrl)}</p>`

  return { subject, text, html }
}

export function buildActivationInAppCopy(input: {
  unitLabel: string
}): { title: string; summary: string } {
  const unit = input.unitLabel.trim() || "—"
  return {
    title: "Resident phone needs attention",
    summary:
      `Unit ${unit} — We couldn't deliver the activation text. Verify or update the resident's phone number before activating SMS access.`,
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
