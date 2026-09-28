import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export const SMS_NO_RECIPIENTS_EVENT = 'sms.no_recipients'

export type SmsNoRecipientsAttention = {
  id: string
  messageType: string | null
  createdAt: string
  message: string | null
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

/** Open "SMS could not be delivered" items for Needs Your Attention. */
export async function loadSmsNoRecipientsAttention(
  landlordId: string = getActiveLandlordId(),
): Promise<SmsNoRecipientsAttention[]> {
  if (!supabase || !landlordId.trim()) return []

  const { data, error } = await supabase
    .from('operations_graph_events')
    .select('id, created_at, metadata')
    .eq('landlord_id', landlordId)
    .eq('event_type', SMS_NO_RECIPIENTS_EVENT)
    .order('created_at', { ascending: false })
    .limit(40)

  if (error) {
    console.warn('[sms-no-recipients] load', error.message)
    return []
  }

  const seen = new Set<string>()
  const items: SmsNoRecipientsAttention[] = []
  for (const row of data ?? []) {
    const metadata =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {}
    if (asString(metadata.notification_status) === 'resolved') continue
    const messageType = asString(metadata.message_type) || 'update'
    if (seen.has(messageType)) continue
    seen.add(messageType)
    items.push({
      id: asString(row.id),
      messageType,
      createdAt: asString(row.created_at),
      message: typeof metadata.message === 'string' ? metadata.message : null,
    })
  }
  return items
}
