/** How long a tenant or vendor text can sit before it needs a reply. */
export const NEEDS_YOUR_RESPONSE_WAIT_MS = 4 * 60 * 60 * 1000

const NOT_A_TENANT_OR_VENDOR_THREAD = new Set(['ai_copilot', 'landlord_update'])

export type NeedsResponseMessage = {
  direction: string
  createdAtMs: number
}

/**
 * True when this thread is with a tenant or vendor, it is still open, their
 * message is the latest one, and neither the property team nor Ulo has replied
 * for at least four hours.
 *
 * Messages must be newest first. A later outbound message is a reply from
 * either side and does not count.
 */
export function threadNeedsYourResponse(input: {
  conversationType: string
  closed: boolean
  messages: NeedsResponseMessage[] | undefined
  atMs: number
}): boolean {
  if (input.closed) return false
  const conversationType = input.conversationType.trim()
  if (NOT_A_TENANT_OR_VENDOR_THREAD.has(conversationType)) return false
  const latest = input.messages?.find((message) => message.createdAtMs <= input.atMs)
  if (!latest || latest.direction !== 'inbound') return false
  return input.atMs - latest.createdAtMs >= NEEDS_YOUR_RESPONSE_WAIT_MS
}
