/**
 * Tenant welcome-SMS retry schedule + eligibility (edge + client share semantics).
 *
 * Attempt 1: immediate
 * Attempt 2: T+24h after first attempt (delivery failure only)
 * Attempt 3: T+72h after first attempt (final automatic)
 * After 3 failures → action_required (no more auto retries)
 */

export const MAX_ACTIVATION_ATTEMPTS = 3
export const ACTIVATION_RETRY_2_HOURS = 24
export const ACTIVATION_RETRY_3_HOURS = 72

export type TenantActivationDbStatus =
  | "not_started"
  | "waiting"
  | "delivery_failed"
  | "action_required"
  | "activated"
  | "opted_out"

/** Digits-only fingerprint for phone-change detection. */
export function normalizeActivationPhone(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "")
}

/**
 * Delivery problems are retryable. Non-delivery skips (opt-out, missing phone, etc.)
 * are never auto-retried by the cron.
 */
export function isRetryableDeliveryFailure(reason: string | null | undefined): boolean {
  const r = (reason ?? "").trim().toLowerCase()
  if (!r) return true
  if (
    r === "opted_out" ||
    r === "opted_in" ||
    r === "already_activated" ||
    r === "already_waiting" ||
    r === "missing_phone" ||
    r === "phone_changed" ||
    r === "no_active_landlord_sms_line" ||
    r === "max_attempts" ||
    r === "not_eligible"
  ) {
    return false
  }
  // Permanent number/carrier failures should not consume the auto-retry schedule.
  if (
    r.includes("invalid_phone") ||
    r.includes("invalid") ||
    r.includes("landline") ||
    r.includes("cannot receive") ||
    r.includes("blocked") ||
    r.includes("blacklisted") ||
    r.includes("21211") ||
    r.includes("21614") ||
    r.includes("30006") ||
    r.includes("30007")
  ) {
    return false
  }
  // Temporary / unknown carrier failures → retry
  return true
}

/**
 * Whether an automatic retry is due now for a delivery_failed resident.
 * Schedule is measured from first_activation_attempt_at.
 */
export function isAutomaticRetryDue(params: {
  activationStatus: string | null | undefined
  attemptCount: number
  firstAttemptAt: string | Date | null | undefined
  now?: Date
}): boolean {
  const status = (params.activationStatus ?? "").trim().toLowerCase()
  if (status !== "delivery_failed") return false

  const attempts = Math.max(0, Math.floor(params.attemptCount || 0))
  if (attempts < 1 || attempts >= MAX_ACTIVATION_ATTEMPTS) return false

  const first = params.firstAttemptAt
    ? new Date(params.firstAttemptAt)
    : null
  if (!first || Number.isNaN(first.getTime())) return false

  const now = params.now ?? new Date()
  const hoursSinceFirst = (now.getTime() - first.getTime()) / (1000 * 60 * 60)

  if (attempts === 1) {
    return hoursSinceFirst >= ACTIVATION_RETRY_2_HOURS
  }
  if (attempts === 2) {
    return hoursSinceFirst >= ACTIVATION_RETRY_3_HOURS
  }
  return false
}

/** @deprecated Prefer buildActivationAdminEmail / notifyLandlordActivationUndeliverable. */
export function landlordActivationFailedCopy(residentName: string): {
  subject: string
  text: string
  html: string
  graphMessage: string
} {
  const name = residentName.trim() || "the resident"
  const subject = `Resident phone needs attention`
  const text =
    `We couldn't deliver the activation text to ${name}. ` +
    `Please verify or update their phone number before activating SMS access.`
  const html =
    `<p>We couldn't deliver the activation text to <strong>${escapeHtml(name)}</strong>.</p>` +
    `<p>Please verify or update their phone number before activating SMS access.</p>`
  return {
    subject,
    text,
    html,
    graphMessage: text,
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
