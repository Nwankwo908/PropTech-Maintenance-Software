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
