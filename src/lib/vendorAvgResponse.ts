/**
 * Average vendor response: share of job-offer SMS asks answered with YES/NO.
 */

import { supabase } from '@/lib/supabase'

/** Landlord-facing explanation for the Average response KPI / column. */
export const VENDOR_AVG_RESPONSE_RATE_INFO =
  'Percent of job-offer texts this vendor answered with YES or NO. Offers with no reply lower the rate.'

export type VendorResponseTimingEvent = {
  ticketId: string
  toStatus: string
  createdAtMs: number
  vendorId?: string | null
}

export type VendorResponseTimingTicket = {
  id: string
  notifiedAtMs: number | null
  assignedAtMs: number | null
  createdAtMs: number | null
}

export type VendorResponseTimingMessage = {
  conversationId: string
  direction: string
  body: string
  createdAtMs: number
}

/** Outbound SMS that asks the vendor to accept or decline the job. */
export function looksLikeVendorDispatchAsk(body: string): boolean {
  const text = body.replace(/\s+/g, ' ').trim()
  if (!text) return false
  // Initial job offer: "Reply YES {WO} to accept or NO {WO} to decline."
  if (/reply\s+yes\b/i.test(text) && /\baccept\b/i.test(text) && /\bdecline\b|\bunable\b/i.test(text)) {
    return true
  }
  if (/would you like to take this job\?/i.test(text)) return true
  // Older assignment copy + estimate continuation asks.
  if (/ulo has assigned you a new work order/i.test(text) && /reply\s+yes\b/i.test(text)) {
    return true
  }
  if (/reply\s+yes\s+to\s+accept/i.test(text)) return true
  if (/would you like to continue with this job\?/i.test(text) && /reply\s+yes/i.test(text)) {
    return true
  }
  return false
}

/** Inbound YES / NO after a dispatch ask (not schedule "okay" acks). */
export function looksLikeVendorAcceptDeclineReply(body: string): boolean {
  const text = body.replace(/\s+/g, ' ').trim().toLowerCase()
  if (!text) return false
  // "YES", "YES WO-ABCD", "NO", "no, booked"
  if (/^(yes|y)\b/.test(text)) return true
  if (/^(no|n)\b/.test(text)) return true
  return false
}

/** Latest dispatch clock that is still at/before the vendor's reply. */
function notifyStartMs(
  ticket: VendorResponseTimingTicket,
  responseAtMs: number,
): number | null {
  const candidates = [ticket.notifiedAtMs, ticket.assignedAtMs, ticket.createdAtMs].filter(
    (ms): ms is number => ms != null && Number.isFinite(ms) && ms > 0 && ms <= responseAtMs,
  )
  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

/**
 * Average minutes from ticket notify/assign to first accept/decline event
 * for this vendor. Events must already be scoped to the vendor when possible.
 */
export function averageResponseMinutesFromStatusEvents(input: {
  tickets: VendorResponseTimingTicket[]
  events: VendorResponseTimingEvent[]
  vendorId?: string | null
}): number | null {
  const ticketById = new Map(input.tickets.map((ticket) => [ticket.id, ticket]))
  const firstByTicket = new Map<string, number>()

  for (const event of input.events) {
    const status = event.toStatus.trim().toLowerCase()
    if (status !== 'accepted' && status !== 'declined') continue
    if (input.vendorId && event.vendorId && event.vendorId !== input.vendorId) continue
    if (!Number.isFinite(event.createdAtMs) || event.createdAtMs <= 0) continue
    const previous = firstByTicket.get(event.ticketId)
    if (previous == null || event.createdAtMs < previous) {
      firstByTicket.set(event.ticketId, event.createdAtMs)
    }
  }

  const durations: number[] = []
  for (const [ticketId, responseAt] of firstByTicket) {
    const ticket = ticketById.get(ticketId)
    if (!ticket) continue
    const start = notifyStartMs(ticket, responseAt)
    if (start == null) continue
    durations.push((responseAt - start) / 60_000)
  }

  if (durations.length === 0) return null
  return (
    durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length
  )
}

export type SmsDispatchResponseSummary = {
  minutes: number | null
  dispatchAskCount: number
  replyPairCount: number
}

/**
 * Average minutes from outbound dispatch ask → next inbound YES/NO on the
 * same conversation (matches what landlords see in Messages).
 */
export function summarizeSmsDispatchResponse(
  messages: VendorResponseTimingMessage[],
): SmsDispatchResponseSummary {
  const byConversation = new Map<string, VendorResponseTimingMessage[]>()
  for (const message of messages) {
    if (!message.conversationId || !Number.isFinite(message.createdAtMs)) continue
    const bucket = byConversation.get(message.conversationId)
    if (bucket) bucket.push(message)
    else byConversation.set(message.conversationId, [message])
  }

  const durations: number[] = []
  let dispatchAskCount = 0
  for (const thread of byConversation.values()) {
    const ordered = [...thread].sort((a, b) => a.createdAtMs - b.createdAtMs)
    let pendingAskAt: number | null = null
    for (const message of ordered) {
      const direction = message.direction.trim().toLowerCase()
      if (direction === 'outbound' && looksLikeVendorDispatchAsk(message.body)) {
        dispatchAskCount += 1
        pendingAskAt = message.createdAtMs
        continue
      }
      if (pendingAskAt == null) continue
      if (direction !== 'inbound') continue
      if (!looksLikeVendorAcceptDeclineReply(message.body)) continue
      if (message.createdAtMs < pendingAskAt) continue
      durations.push((message.createdAtMs - pendingAskAt) / 60_000)
      pendingAskAt = null
    }
  }

  return {
    dispatchAskCount,
    replyPairCount: durations.length,
    minutes:
      durations.length === 0
        ? null
        : durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length,
  }
}

export function averageResponseMinutesFromSmsThread(
  messages: VendorResponseTimingMessage[],
): number | null {
  return summarizeSmsDispatchResponse(messages).minutes
}

export type VendorAvgResponseLoadResult = {
  minutes: number | null
  /**
   * Share of job-offer SMS asks that got a YES/NO reply (0–100).
   * Null when no dispatch asks were found.
   */
  responseRatePercent: number | null
  /** Job-offer SMS asks found on this vendor’s threads. */
  dispatchAskCount: number
  /** Completed ask → YES/NO pairs (SMS or status events). */
  replyPairCount: number
  source: 'sms' | 'events' | 'none'
}

export function responseRatePercentFromCounts(
  dispatchAskCount: number,
  replyPairCount: number,
): number | null {
  if (dispatchAskCount <= 0) return null
  const rate = (100 * Math.min(replyPairCount, dispatchAskCount)) / dispatchAskCount
  return Math.round(rate)
}

function parseIsoMs(value: unknown): number | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Resolve average dispatch→YES/NO minutes for a vendor profile KPI.
 * Prefer SMS thread timing (what landlords see); fall back to status events.
 */
export async function loadVendorAverageResponseDetail(input: {
  landlordId: string
  vendorId: string
  conversationIds?: string[]
}): Promise<VendorAvgResponseLoadResult> {
  const empty: VendorAvgResponseLoadResult = {
    minutes: null,
    responseRatePercent: null,
    dispatchAskCount: 0,
    replyPairCount: 0,
    source: 'none',
  }
  if (!supabase) return empty

  const conversationIds = [...new Set((input.conversationIds ?? []).filter(Boolean))]
  if (conversationIds.length === 0) {
    const threads = await supabase
      .from('sms_conversations')
      .select('id, conversation_type')
      .eq('landlord_id', input.landlordId)
      .eq('vendor_id', input.vendorId)
      .order('updated_at', { ascending: false })
      .limit(20)
    if (!threads.error) {
      const rows = (threads.data ?? []) as Array<{ id?: unknown; conversation_type?: unknown }>
      const preferred = rows.filter(
        (row) => String(row.conversation_type ?? '').toLowerCase() === 'vendor_alert',
      )
      const ordered = preferred.length > 0 ? preferred : rows
      for (const row of ordered) {
        const id = typeof row.id === 'string' ? row.id : ''
        if (id) conversationIds.push(id)
      }
    }
  }

  if (conversationIds.length > 0) {
    const messages = await supabase
      .from('sms_messages')
      .select('conversation_id, direction, body, created_at')
      .eq('landlord_id', input.landlordId)
      .in('conversation_id', conversationIds.slice(0, 20))
      .order('created_at', { ascending: true })
      .limit(1000)
    if (messages.error) {
      console.warn('[vendorAvgResponse] sms messages', messages.error.message)
    } else {
      const timed = ((messages.data ?? []) as Record<string, unknown>[]).map((row) => ({
        conversationId: typeof row.conversation_id === 'string' ? row.conversation_id : '',
        direction: typeof row.direction === 'string' ? row.direction : '',
        body: typeof row.body === 'string' ? row.body : '',
        createdAtMs: parseIsoMs(row.created_at) ?? 0,
      }))
      const sms = summarizeSmsDispatchResponse(timed)
      if (sms.dispatchAskCount > 0) {
        return {
          minutes: sms.minutes == null ? null : roundResponseMinutes(sms.minutes),
          responseRatePercent: responseRatePercentFromCounts(
            sms.dispatchAskCount,
            sms.replyPairCount,
          ),
          dispatchAskCount: sms.dispatchAskCount,
          replyPairCount: sms.replyPairCount,
          source: 'sms',
        }
      }
    }
  }

  // No SMS job offers: fall back to accept/decline events for speed only (no %).
  const events = await supabase
    .from('vendor_status_events')
    .select('ticket_id, to_status, created_at, vendor_id')
    .eq('vendor_id', input.vendorId)
    .in('to_status', ['accepted', 'declined'])
    .order('created_at', { ascending: true })
    .limit(500)

  if (events.error) {
    console.warn('[vendorAvgResponse] status events', events.error.message)
    return empty
  }

  const eventRows = ((events.data ?? []) as Record<string, unknown>[]).map((row) => ({
    ticketId: typeof row.ticket_id === 'string' ? row.ticket_id : '',
    toStatus: typeof row.to_status === 'string' ? row.to_status : '',
    createdAtMs: parseIsoMs(row.created_at) ?? 0,
    vendorId: typeof row.vendor_id === 'string' ? row.vendor_id : null,
  }))
  const ticketIds = [...new Set(eventRows.map((row) => row.ticketId).filter(Boolean))]
  if (ticketIds.length === 0) return empty

  const tickets = await supabase
    .from('maintenance_requests')
    .select('id, vendor_notified_at, assigned_at, created_at')
    .eq('landlord_id', input.landlordId)
    .in('id', ticketIds.slice(0, 200))

  if (tickets.error) {
    console.warn('[vendorAvgResponse] tickets', tickets.error.message)
    return empty
  }

  const ticketRows = ((tickets.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: typeof row.id === 'string' ? row.id : '',
    notifiedAtMs: parseIsoMs(row.vendor_notified_at),
    assignedAtMs: parseIsoMs(row.assigned_at),
    createdAtMs: parseIsoMs(row.created_at),
  }))

  const fromEvents = averageResponseMinutesFromStatusEvents({
    vendorId: input.vendorId,
    tickets: ticketRows,
    events: eventRows,
  })
  if (fromEvents == null) return empty
  return {
    minutes: roundResponseMinutes(fromEvents),
    responseRatePercent: null,
    dispatchAskCount: 0,
    replyPairCount: ticketIds.length,
    source: 'events',
  }
}

export async function loadVendorAverageResponseMinutes(input: {
  landlordId: string
  vendorId: string
  conversationIds?: string[]
}): Promise<number | null> {
  const detail = await loadVendorAverageResponseDetail(input)
  return detail.minutes
}

/** Batch response-rate % for the Vendors list. */
export async function loadVendorResponseRatePercentForLandlord(input: {
  landlordId: string
  vendorIds: string[]
}): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (!supabase) return result

  const vendorIds = [...new Set(input.vendorIds.filter(Boolean))].slice(0, 200)
  if (vendorIds.length === 0) return result

  const threads = await supabase
    .from('sms_conversations')
    .select('id, vendor_id, conversation_type')
    .eq('landlord_id', input.landlordId)
    .in('vendor_id', vendorIds)
    .limit(500)

  if (threads.error) {
    console.warn('[vendorAvgResponse] landlord threads', threads.error.message)
    return result
  }

  const conversationToVendor = new Map<string, string>()
  const allRows = (threads.data ?? []) as Array<{
    id?: unknown
    vendor_id?: unknown
    conversation_type?: unknown
  }>
  const preferred = allRows.filter(
    (row) => String(row.conversation_type ?? '').toLowerCase() === 'vendor_alert',
  )
  const orderedRows = preferred.length > 0 ? preferred : allRows
  for (const row of orderedRows) {
    const conversationId = typeof row.id === 'string' ? row.id : ''
    const vendorId = typeof row.vendor_id === 'string' ? row.vendor_id : ''
    if (!conversationId || !vendorId) continue
    conversationToVendor.set(conversationId, vendorId)
  }

  const conversationIds = [...conversationToVendor.keys()]
  if (conversationIds.length === 0) return result

  const messagesByVendor = new Map<string, VendorResponseTimingMessage[]>()
  for (let offset = 0; offset < conversationIds.length; offset += 40) {
    const chunk = conversationIds.slice(offset, offset + 40)
    const messages = await supabase
      .from('sms_messages')
      .select('conversation_id, direction, body, created_at')
      .eq('landlord_id', input.landlordId)
      .in('conversation_id', chunk)
      .order('created_at', { ascending: true })
      .limit(2000)
    if (messages.error) {
      console.warn('[vendorAvgResponse] landlord messages', messages.error.message)
      continue
    }
    for (const row of (messages.data ?? []) as Record<string, unknown>[]) {
      const conversationId =
        typeof row.conversation_id === 'string' ? row.conversation_id : ''
      const vendorId = conversationToVendor.get(conversationId)
      if (!vendorId) continue
      const timed: VendorResponseTimingMessage = {
        conversationId,
        direction: typeof row.direction === 'string' ? row.direction : '',
        body: typeof row.body === 'string' ? row.body : '',
        createdAtMs: parseIsoMs(row.created_at) ?? 0,
      }
      const bucket = messagesByVendor.get(vendorId)
      if (bucket) bucket.push(timed)
      else messagesByVendor.set(vendorId, [timed])
    }
  }

  for (const [vendorId, timed] of messagesByVendor) {
    const sms = summarizeSmsDispatchResponse(timed)
    const rate = responseRatePercentFromCounts(sms.dispatchAskCount, sms.replyPairCount)
    if (rate != null) result.set(vendorId, rate)
  }

  return result
}

function roundResponseMinutes(minutes: number): number {
  return Math.round(minutes * 100) / 100
}
