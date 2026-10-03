/** Inbound SMS is saved before the early work-order insert. */
export const WORK_ORDER_SMS_PHOTO_LOOKBACK_MS = 3 * 60 * 1000

/**
 * A tenant SMS thread is reused across work orders. Only media from this
 * request's window belongs on the work order — not earlier repairs.
 */
export function smsMessageBelongsToWorkOrder(input: {
  messageCreatedAt: string
  ticketCreatedAt: string | null | undefined
  nextTicketCreatedAt?: string | null
  lookbackMs?: number
}): boolean {
  const ticketTs = Date.parse(input.ticketCreatedAt ?? '')
  if (!Number.isFinite(ticketTs)) return false
  const messageTs = Date.parse(input.messageCreatedAt)
  if (!Number.isFinite(messageTs)) return false
  const lookback = input.lookbackMs ?? WORK_ORDER_SMS_PHOTO_LOOKBACK_MS
  if (messageTs < ticketTs - lookback) return false
  const nextTs = Date.parse(input.nextTicketCreatedAt ?? '')
  if (Number.isFinite(nextTs) && messageTs >= nextTs - lookback) return false
  return true
}

/**
 * Detail-panel gallery merges ticket `photo_paths` with inbound
 * `sms_messages.media_urls` in the work-order time window. When a later
 * request re-homes media onto its own `photo_paths` (split / remediation),
 * those refs must not keep rendering on the earlier ticket via the SMS
 * extras path — even though the messages still fall in the earlier window.
 */
export function smsMediaExtraAllowedOnWorkOrder(input: {
  ref: string
  thisTicketPhotoPaths: ReadonlySet<string>
  claimedByOtherTicketPhotoPaths: ReadonlySet<string>
}): boolean {
  const ref = input.ref.trim()
  if (!ref) return false
  if (input.thisTicketPhotoPaths.has(ref)) return false
  if (input.claimedByOtherTicketPhotoPaths.has(ref)) return false
  return true
}

/**
 * Once this ticket already has curated `photo_paths` and a later sibling
 * work order exists on the same thread, trust `photo_paths` only — do not
 * pull late unclaimed SMS media (rent receipts, a subsequent repair's
 * MMS, etc.) into the earlier gallery.
 */
export function shouldSkipUnclaimedSmsMediaExtras(input: {
  thisTicketPhotoPathCount: number
  nextTicketCreatedAt?: string | null
}): boolean {
  if (input.thisTicketPhotoPathCount <= 0) return false
  const nextTs = Date.parse(input.nextTicketCreatedAt ?? '')
  return Number.isFinite(nextTs)
}
