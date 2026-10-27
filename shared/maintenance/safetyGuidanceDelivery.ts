/**
 * Safety lines already delivered on this request stay off the next text.
 * A failed or unconfirmed send does not count. A different line still goes out.
 */

export const LIFE_SAFETY_GUIDANCE =
  "If you smell gas, see fire, or anyone is in danger, leave right away and call 911."

export type GuidanceDeliveryMessage = {
  direction?: string | null
  body?: string | null
  providerStatus?: string | null
}

export function isDeliveredProviderStatus(status: string | null | undefined): boolean {
  const value = (status ?? "").trim().toLowerCase()
  return value === "delivered" || value === "read"
}

function normalizeGuidance(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

/** True only when this exact guidance is in an outbound message the carrier delivered. */
export function guidanceTextWasDelivered(
  guidance: string | null | undefined,
  messages: GuidanceDeliveryMessage[],
): boolean {
  const needle = normalizeGuidance(guidance ?? "")
  if (!needle) return false
  return messages.some((message) => {
    if ((message.direction ?? "").toLowerCase() !== "outbound") return false
    if (!isDeliveredProviderStatus(message.providerStatus)) return false
    return normalizeGuidance(message.body ?? "").includes(needle)
  })
}

/** Drop lines that already arrived. Keep a new or undelivered line. */
export function undeliveredGuidance(
  lines: Array<string | null | undefined>,
  messages: GuidanceDeliveryMessage[],
): string[] {
  const kept: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const text = line?.replace(/\s+/g, " ").trim()
    if (!text) continue
    const key = normalizeGuidance(text)
    if (seen.has(key)) continue
    seen.add(key)
    if (guidanceTextWasDelivered(text, messages)) continue
    kept.push(text)
  }
  return kept
}
