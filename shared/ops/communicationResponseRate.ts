/**
 * Messages "Response rate" — per-inbound reply latency, not conversation-level
 * outbound existence and not Overview "Vendor Response" (job acceptance).
 */

export const COMMUNICATION_RESPONSE_WINDOW_HOURS = 24
export const COMMUNICATION_RESPONSE_WINDOW_MS =
  COMMUNICATION_RESPONSE_WINDOW_HOURS * 60 * 60 * 1000

export type CommunicationResponseMessage = {
  id: string
  conversationId: string
  direction: 'inbound' | 'outbound' | string
  createdAtMs: number
}

export type CommunicationResponseRateResult = {
  totalInbounds: number
  answeredInbounds: number
  /** null when there are zero inbounds in the window (nothing to measure). */
  responseRatePct: number | null
}

function normalizeDirection(raw: string): 'inbound' | 'outbound' | 'other' {
  const d = raw.trim().toLowerCase()
  if (d === 'inbound') return 'inbound'
  if (d === 'outbound') return 'outbound'
  return 'other'
}

/**
 * Pure algorithm mirroring `communication_inbound_response_rate` SQL.
 * An inbound is answered when a same-thread outbound is sent after it, before
 * the next inbound in that thread (if any), and within `windowMs`.
 * Outbound-only threads contribute nothing — they have no inbounds.
 */
export function computeCommunicationResponseRate(
  messages: CommunicationResponseMessage[],
  opts: {
    fromMs: number
    toMs: number
    windowMs?: number
  },
): CommunicationResponseRateResult {
  const windowMs = opts.windowMs ?? COMMUNICATION_RESPONSE_WINDOW_MS
  const byConv = new Map<string, CommunicationResponseMessage[]>()
  for (const message of messages) {
    const direction = normalizeDirection(String(message.direction ?? ''))
    if (direction === 'other') continue
    const convId = message.conversationId.trim()
    if (!convId) continue
    const list = byConv.get(convId) ?? []
    list.push({
      ...message,
      conversationId: convId,
      direction,
      createdAtMs: message.createdAtMs,
    })
    byConv.set(convId, list)
  }

  let totalInbounds = 0
  let answeredInbounds = 0

  for (const list of byConv.values()) {
    list.sort((a, b) => {
      if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs
      return a.id.localeCompare(b.id)
    })

    const inbounds = list.filter((m) => m.direction === 'inbound')
    if (inbounds.length === 0) continue

    for (let i = 0; i < inbounds.length; i += 1) {
      const inbound = inbounds[i]!
      if (inbound.createdAtMs < opts.fromMs || inbound.createdAtMs >= opts.toMs) {
        continue
      }
      totalInbounds += 1
      const nextInboundAt = inbounds[i + 1]?.createdAtMs ?? null
      const deadline = inbound.createdAtMs + windowMs
      const answered = list.some((m) => {
        if (m.direction !== 'outbound') return false
        if (m.createdAtMs <= inbound.createdAtMs) return false
        if (m.createdAtMs > deadline) return false
        if (nextInboundAt != null && m.createdAtMs >= nextInboundAt) return false
        return true
      })
      if (answered) answeredInbounds += 1
    }
  }

  if (totalInbounds === 0) {
    return { totalInbounds: 0, answeredInbounds: 0, responseRatePct: null }
  }
  return {
    totalInbounds,
    answeredInbounds,
    responseRatePct: Math.round((answeredInbounds / totalInbounds) * 100),
  }
}

/** Delta between two window rates (same formula). null if either window has no inbounds. */
export function communicationResponseRateDelta(
  recent: CommunicationResponseRateResult,
  previous: CommunicationResponseRateResult,
): number | null {
  if (recent.responseRatePct == null || previous.responseRatePct == null) {
    return null
  }
  return recent.responseRatePct - previous.responseRatePct
}
