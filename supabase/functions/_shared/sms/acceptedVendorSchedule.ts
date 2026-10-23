/**
 * An accepted vendor whose schedule thread went idle should give a time,
 * not accept the job again.
 */

export const AVAILABILITY_ASK_DEDUPE_MS = 10 * 60 * 1000
export const RECENT_VENDOR_WINDOW_MS = 24 * 60 * 60 * 1000

export type AcceptedVendorIdlePlan =
  | { kind: "passthrough" }
  | { kind: "restart_availability" }
  | { kind: "seed_window" }
  | { kind: "ask_window" }

export function vendorHasAcceptedJob(vendorWorkStatus: string | null | undefined): boolean {
  const status = (vendorWorkStatus ?? "").trim().toLowerCase()
  return status === "accepted" || status === "in_progress"
}

export function visitIsLocked(input: {
  scheduleConfirmedAt?: string | null
  scheduleStep?: string | null
}): boolean {
  if ((input.scheduleConfirmedAt ?? "").trim()) return true
  return (input.scheduleStep ?? "").trim().toLowerCase() === "scheduled"
}

/**
 * Idle (or expired) thread for a vendor who already accepted.
 * YES restarts the availability ask. A time window is seeded into the schedule
 * flow. Anything else asks for a day and arrival window — never "take this job?".
 */
export function planAcceptedVendorIdleTurn(input: {
  inScheduleFlow: boolean
  parsedAction: "accept" | "decline" | null
  vendorWorkStatus: string | null | undefined
  visitLocked: boolean
  /** True when the message resolved to a time window. Ignored for YES/NO. */
  availabilityResolved: boolean
}): AcceptedVendorIdlePlan {
  if (input.inScheduleFlow) return { kind: "passthrough" }
  if (input.parsedAction === "decline") return { kind: "passthrough" }
  if (input.visitLocked) return { kind: "passthrough" }
  if (!vendorHasAcceptedJob(input.vendorWorkStatus)) return { kind: "passthrough" }
  if (input.parsedAction === "accept") return { kind: "restart_availability" }
  if (input.availabilityResolved) return { kind: "seed_window" }
  return { kind: "ask_window" }
}

export function looksLikeVendorAvailabilityAsk(body: string): boolean {
  return /earliest availability|day and arrival window|still need a time/i.test(body)
}

export function latestAvailabilityAskAt(
  messages: Array<{ direction: string; body: string; createdAt: string }>,
  nowMs: number,
): string | null {
  const cutoff = nowMs - AVAILABILITY_ASK_DEDUPE_MS
  for (const message of messages) {
    if (message.direction !== "outbound") continue
    const at = Date.parse(message.createdAt)
    if (!Number.isFinite(at) || at < cutoff || at > nowMs) continue
    if (looksLikeVendorAvailabilityAsk(message.body)) return message.createdAt
  }
  return null
}

export function latestInboundWithin(
  messages: Array<{ direction: string; body: string; createdAt: string }>,
  nowMs: number,
  windowMs = RECENT_VENDOR_WINDOW_MS,
): { body: string; createdAt: string } | null {
  const cutoff = nowMs - windowMs
  for (const message of messages) {
    if (message.direction !== "inbound") continue
    const at = Date.parse(message.createdAt)
    if (!Number.isFinite(at) || at < cutoff || at > nowMs) continue
    const body = message.body.trim()
    if (body) return { body, createdAt: message.createdAt }
  }
  return null
}
