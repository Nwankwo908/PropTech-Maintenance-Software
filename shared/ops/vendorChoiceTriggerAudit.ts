/**
 * Pure helpers: detect maintenance.vendor_choice_selected events with no
 * confirming inbound sms_messages row in the preceding window (WO-E6F7 class).
 *
 * Used by the daily cron and by scripts/audit-vendor-choice-triggers.mjs.
 */

export const VENDOR_CHOICE_TRIGGER_WINDOW_MS = 2 * 60 * 1000

export type VendorChoiceSelectedEvent = {
  id: string
  created_at: string
  landlord_id: string
  conversation_id?: string | null
  message_id?: string | null
  maintenance_request_id?: string | null
  metadata?: Record<string, unknown> | null
}

export type InboundSmsMessageRow = {
  id: string
  created_at: string
  conversation_id?: string | null
  landlord_id?: string | null
  direction?: string | null
}

export type PhantomVendorChoiceSelected = {
  eventId: string
  createdAt: string
  landlordId: string
  conversationId: string | null
  maintenanceRequestId: string | null
  messageId: string | null
  providerMessageSid: string | null
  reasons: string[]
}

/** Shape check for a row that may authorize landlord-choice dispatch. */
export function isConfirmedDurableInboundTrigger(
  row: {
    id?: string | null
    direction?: string | null
    conversation_id?: string | null
    landlord_id?: string | null
    provider_message_sid?: string | null
  } | null | undefined,
  expected: {
    messageId: string
    conversationId: string
    landlordId: string
  },
): { ok: true; messageId: string; providerMessageSid: string | null } | { ok: false; reason: string } {
  const messageId = expected.messageId.trim()
  if (!messageId) {
    return { ok: false, reason: 'missing_message_id' }
  }
  if (!row?.id) {
    return { ok: false, reason: 'inbound_row_not_found' }
  }
  if (row.id !== messageId) {
    return { ok: false, reason: 'inbound_row_id_mismatch' }
  }
  if (String(row.direction ?? '').toLowerCase() !== 'inbound') {
    return { ok: false, reason: 'not_inbound' }
  }
  if (
    expected.conversationId.trim() &&
    String(row.conversation_id ?? '') !== expected.conversationId.trim()
  ) {
    return { ok: false, reason: 'conversation_mismatch' }
  }
  if (
    expected.landlordId.trim() &&
    String(row.landlord_id ?? '') !== expected.landlordId.trim()
  ) {
    return { ok: false, reason: 'landlord_mismatch' }
  }
  const sid =
    typeof row.provider_message_sid === 'string' && row.provider_message_sid.trim()
      ? row.provider_message_sid.trim()
      : null
  return { ok: true, messageId, providerMessageSid: sid }
}

function providerSidFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null
  for (const key of [
    'provider_message_sid',
    'providerMessageSid',
    'trigger_provider_message_sid',
  ]) {
    const raw = metadata[key]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  return null
}

/**
 * Flag vendor_choice_selected rows with no inbound sms_messages in the
 * preceding window on the same conversation (preferred) or landlord.
 */
export function findPhantomVendorChoiceSelected(input: {
  events: VendorChoiceSelectedEvent[]
  inboundMessages: InboundSmsMessageRow[]
  windowMs?: number
}): PhantomVendorChoiceSelected[] {
  const windowMs = input.windowMs ?? VENDOR_CHOICE_TRIGGER_WINDOW_MS
  const inbounds = input.inboundMessages.filter(
    (m) => String(m.direction ?? 'inbound').toLowerCase() === 'inbound',
  )

  const phantoms: PhantomVendorChoiceSelected[] = []
  for (const ev of input.events) {
    const createdMs = Date.parse(ev.created_at)
    if (!Number.isFinite(createdMs)) continue
    const windowStart = createdMs - windowMs

    const linkedMessageId =
      typeof ev.message_id === 'string' && ev.message_id.trim()
        ? ev.message_id.trim()
        : null

    const matching = inbounds.filter((m) => {
      const at = Date.parse(m.created_at)
      if (!Number.isFinite(at)) return false
      if (at < windowStart || at > createdMs) return false
      if (linkedMessageId && m.id === linkedMessageId) return true
      if (
        ev.conversation_id &&
        m.conversation_id &&
        m.conversation_id === ev.conversation_id
      ) {
        return true
      }
      if (
        !ev.conversation_id &&
        ev.landlord_id &&
        m.landlord_id &&
        m.landlord_id === ev.landlord_id
      ) {
        return true
      }
      return false
    })

    if (matching.length > 0) continue

    const reasons = ['no_inbound_in_preceding_window']
    if (!linkedMessageId) reasons.push('event_message_id_null')
    if (!providerSidFromMetadata(ev.metadata ?? null)) {
      reasons.push('event_provider_sid_missing')
    }

    phantoms.push({
      eventId: ev.id,
      createdAt: ev.created_at,
      landlordId: ev.landlord_id,
      conversationId: ev.conversation_id ?? null,
      maintenanceRequestId: ev.maintenance_request_id ?? null,
      messageId: linkedMessageId,
      providerMessageSid: providerSidFromMetadata(ev.metadata ?? null),
      reasons,
    })
  }
  return phantoms
}
