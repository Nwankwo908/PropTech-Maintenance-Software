import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import type { ClassifyMaintenanceSmsContext } from '../maintenance_classification/types.ts'

export const SMS_CONTEXT_MESSAGE_LIMIT = 20
export const SMS_CONTEXT_CHAR_LIMIT = 8000
export const SMS_CONTEXT_BODY_LIMIT = 700
// Delivery callbacks can lag an inbound reply. Keep accepted/queued texts as
// context, explicitly labeled with status, without claiming delivery.
const outboundStatuses = ['accepted', 'queued', 'sending', 'sent', 'delivered', 'read']

type ContextMessage = {
  id: string
  conversation_id: string
  landlord_id: string
  direction: string
  from_number: string
  to_number: string
  body: string | null
  created_at: string
  provider_status: string | null
}
export type ResidentSmsContextInput = {
  landlordId: string
  conversationId: string
  messageId: string
  residentId: string
  unitId: string | null
  externalPhone: string
  uloPhone: string
  ticketId?: string | null
}
const messageColumns =
  'id, conversation_id, landlord_id, direction, from_number, to_number, body, created_at, provider_status'
const phone = (value: string) => value.replace(/[^\d+]/g, '')
const emptyContext = (): ClassifyMaintenanceSmsContext => ({
  recentTurns: null,
  lastOutboundMessage: null,
  scopeContext: null,
})
const text = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : ''
const messageText = (value: unknown, limit: number) =>
  text(typeof value === 'string' ? value.replace(/https?:\/\/[^\s]+/gi, '[link]') : value, limit)

function belongsToParticipant(row: ContextMessage, input: ResidentSmsContextInput): boolean {
  if (row.conversation_id !== input.conversationId || row.landlord_id !== input.landlordId) {
    return false
  }
  const inbound = row.direction === 'inbound'
  if (!inbound && row.direction !== 'outbound') return false
  if (!inbound && !outboundStatuses.includes(row.provider_status || '')) return false
  return phone(row.from_number) === phone(inbound ? input.externalPhone : input.uloPhone) &&
    phone(row.to_number) === phone(inbound ? input.uloPhone : input.externalPhone)
}

/** One resident thread only. Anchor history before the current inbound so later
 * messages or replies from overlapping webhooks cannot become its context.
 * No age cutoff: a delayed reply still sees its reminder, with a timestamp.
 * The model sees text only, never provider payloads, media URLs or upload tokens. */
export async function loadResidentSmsContext(
  db: SupabaseClient,
  input: ResidentSmsContextInput,
): Promise<ClassifyMaintenanceSmsContext> {
  if (!input.residentId || !phone(input.externalPhone) || !phone(input.uloPhone)) {
    return emptyContext()
  }
  try {
    let threadQuery = db.from('sms_conversations')
      .select(
        'id, landlord_id, resident_id, vendor_id, unit_id, external_phone_number, sms_number_id',
      )
      .eq('id', input.conversationId).eq('landlord_id', input.landlordId)
      .eq('resident_id', input.residentId).is('vendor_id', null)
      .eq('external_phone_number', phone(input.externalPhone))
    threadQuery = input.unitId
      ? threadQuery.eq('unit_id', input.unitId)
      : threadQuery.is('unit_id', null)
    const { data: thread, error: threadError } = await threadQuery.maybeSingle()
    if (
      threadError || !thread || thread.landlord_id !== input.landlordId ||
      thread.resident_id !== input.residentId || thread.vendor_id ||
      (thread.unit_id || null) !== input.unitId ||
      phone(thread.external_phone_number || '') !== phone(input.externalPhone)
    ) return emptyContext()
    const { data: line, error: lineError } = await db.from('sms_numbers').select('id, phone_number')
      .eq('id', thread.sms_number_id).eq('phone_number', phone(input.uloPhone)).maybeSingle()
    if (lineError || !line || phone(line.phone_number || '') !== phone(input.uloPhone)) {
      return emptyContext()
    }
    const { data: anchor, error: anchorError } = await db.from('sms_messages').select(
      messageColumns,
    )
      .eq('id', input.messageId).eq('conversation_id', input.conversationId).eq(
        'landlord_id',
        input.landlordId,
      )
      .eq('direction', 'inbound').maybeSingle()
    if (
      anchorError || !anchor || anchor.direction !== 'inbound' ||
      !belongsToParticipant(anchor, input) || !Number.isFinite(Date.parse(anchor.created_at))
    ) return emptyContext()

    const messagesQuery = () =>
      db.from('sms_messages').select(messageColumns)
        .eq('conversation_id', input.conversationId).eq('landlord_id', input.landlordId)
        .lt('created_at', anchor.created_at).order('created_at', { ascending: false }).order('id', {
          ascending: false,
        })
    const [recent, outbound, unit] = await Promise.all([
      messagesQuery().or(
        `and(direction.eq.inbound,from_number.eq.${phone(input.externalPhone)},to_number.eq.${
          phone(input.uloPhone)
        }),and(direction.eq.outbound,from_number.eq.${phone(input.uloPhone)},to_number.eq.${
          phone(input.externalPhone)
        },provider_status.in.(${outboundStatuses.join(',')}))`,
      ).limit(SMS_CONTEXT_MESSAGE_LIMIT),
      messagesQuery().eq('direction', 'outbound').eq('from_number', phone(input.uloPhone)).eq(
        'to_number',
        phone(input.externalPhone),
      ).in('provider_status', outboundStatuses).limit(1).maybeSingle(),
      input.unitId
        ? db.from('units').select('id, unit_label, building, property_id').eq('id', input.unitId)
          .eq('landlord_id', input.landlordId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
    const rows: ContextMessage[] = recent.error
      ? []
      : (recent.data || []).filter((row: ContextMessage) =>
        row.id !== input.messageId && belongsToParticipant(row, input) &&
        Date.parse(row.created_at) < Date.parse(anchor.created_at)
      )
    const lines: string[] = []
    let chars = 0
    for (const row of rows.slice(0, SMS_CONTEXT_MESSAGE_LIMIT)) {
      const body = messageText(row.body, SMS_CONTEXT_BODY_LIMIT)
      if (!body) continue
      const formatted = JSON.stringify({
        at: row.created_at,
        role: row.direction === 'outbound' ? 'ulo' : 'resident',
        ...(row.direction === 'outbound' ? { deliveryStatus: row.provider_status } : {}),
        text: body,
      })
      if (chars + formatted.length + 1 > SMS_CONTEXT_CHAR_LIMIT) break
      lines.unshift(formatted)
      chars += formatted.length + 1
    }
    const lastOutbound = !outbound.error && outbound.data?.direction === 'outbound' &&
        belongsToParticipant(outbound.data, input) &&
        Date.parse(outbound.data.created_at) < Date.parse(anchor.created_at)
      ? JSON.stringify({
        at: outbound.data.created_at,
        role: 'ulo',
        deliveryStatus: outbound.data.provider_status,
        text: messageText(outbound.data.body, 2000),
      })
      : null
    const location = !unit.error && unit.data?.id === input.unitId ? unit.data : null
    let ticket: Record<string, unknown> | null = null
    if (input.ticketId) {
      const result = await db.from('maintenance_requests')
        .select(
          'id, landlord_id, resident_id, resident_user_id, resident_phone, unit_id, property_id, description, vendor_work_status',
        )
        .eq('id', input.ticketId).eq('landlord_id', input.landlordId).maybeSingle()
      const row = result.error ? null : result.data
      const owned = row &&
        (row.resident_id || row.resident_user_id
          ? row.resident_id === input.residentId || row.resident_user_id === input.residentId
          : phone(row.resident_phone || '') === phone(input.externalPhone))
      const matchesLocation = row && (!row.unit_id || row.unit_id === input.unitId) &&
        (!row.property_id || row.property_id === location?.property_id)
      if (
        row?.id === input.ticketId && row.landlord_id === input.landlordId && owned &&
        matchesLocation
      ) {
        ticket = {
          id: row.id,
          status: row.vendor_work_status,
          description: messageText(row.description, 700),
        }
      }
    }
    return {
      recentTurns: lines.length ? lines.join('\n') : null,
      lastOutboundMessage: lastOutbound,
      scopeContext: JSON.stringify({
        landlordId: input.landlordId,
        conversationId: input.conversationId,
        currentMessageId: input.messageId,
        currentMessageAt: anchor.created_at,
        participantRole: 'resident',
        residentId: input.residentId,
        unitId: input.unitId,
        propertyId: location?.property_id || null,
        property: text(location?.building, 120) || null,
        unit: text(location?.unit_label, 80) || null,
        ticket,
      }),
    }
  } catch {
    // History lookup failures must not interrupt intake or leak another thread.
    console.warn('[sms-context] Could not load scoped conversation context.')
    return emptyContext()
  }
}
