function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === "string" && v.trim()) return v.trim()
    if (typeof v === "number" && Number.isFinite(v)) return String(v)
  }
  return null
}

/** Walk a Thumbtack JSON envelope for the first matching id key. */
export function pickThumbtackId(parsed: unknown, keys: string[]): string | null {
  const seen = new Set<unknown>()
  const stack: unknown[] = [parsed]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== "object") continue
    if (seen.has(cur)) continue
    seen.add(cur)
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item)
      continue
    }
    const rec = cur as Record<string, unknown>
    const hit = stringField(rec, keys)
    if (hit) return hit
    for (const v of Object.values(rec)) {
      if (v && typeof v === "object") stack.push(v)
    }
  }
  return null
}

export function pickNegotiationId(parsed: unknown): string | null {
  return pickThumbtackId(parsed, ["negotiationID", "negotiationId", "negotiation_id"])
}

export function pickRequestId(parsed: unknown): string | null {
  return pickThumbtackId(parsed, ["requestID", "requestId", "request_id"])
}

export function pickMessageId(parsed: unknown): string | null {
  return pickThumbtackId(parsed, ["messageID", "messageId", "message_id"])
}

export type ThumbtackWebhookInbound = {
  negotiationId: string | null
  businessId: string | null
  text: string | null
  messageId: string | null
  fromPro: boolean
  eventType: string | null
}

export function parseThumbtackWebhookInbound(parsed: unknown): ThumbtackWebhookInbound {
  const rec = asRecord(parsed)
  const eventType = rec
    ? stringField(rec, ["eventType", "event_type", "type", "event"])
    : null
  const data = rec?.data ?? rec?.payload ?? parsed
  const nested = asRecord(data)
  const message = nested?.message ?? nested?.Message
  const messageRec = asRecord(message)
  const userType = (
    stringField(nested ?? {}, ["userType", "user_type", "senderType", "from"]) ||
    stringField(messageRec ?? {}, ["userType", "user_type", "senderType"]) ||
    ""
  ).toLowerCase()
  const fromPro =
    userType.includes("business") ||
    userType.includes("pro") ||
    userType.includes("seller") ||
    userType === ""
  const text =
    stringField(messageRec ?? {}, ["text", "body", "content"]) ||
    stringField(nested ?? {}, ["text", "body", "messageText"]) ||
    (typeof parsed === "string" ? parsed.trim() : null)
  return {
    negotiationId: pickNegotiationId(parsed),
    businessId: pickThumbtackId(parsed, ["businessID", "businessId", "business_id"]),
    text: text && text.length > 0 ? text : null,
    messageId: pickMessageId(parsed),
    fromPro,
    eventType,
  }
}

export function isThumbtackMessageCreatedEvent(eventType: string | null | undefined): boolean {
  const v = (eventType ?? "").trim().toLowerCase()
  if (!v) return true
  return v.includes("messagecreated") || v === "message.created" || v.includes("message_created")
}
