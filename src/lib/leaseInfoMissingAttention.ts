import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'

export const LEASE_INFO_MISSING_EVENT = 'sms.lease_info_missing'

export type LeaseInfoMissingAttention = {
  id: string
  residentId: string | null
  createdAt: string
  message: string | null
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

/** Open "leasing information is missing" items for Needs Your Attention. */
export async function loadLeaseInfoMissingAttention(
  landlordId: string = getActiveLandlordId(),
): Promise<LeaseInfoMissingAttention[]> {
  if (!supabase || !landlordId.trim()) return []

  const { data, error } = await supabase
    .from('operations_graph_events')
    .select('id, resident_id, created_at, metadata')
    .eq('landlord_id', landlordId)
    .eq('event_type', LEASE_INFO_MISSING_EVENT)
    .order('created_at', { ascending: false })
    .limit(80)

  if (error) {
    console.warn('[lease-info-missing] load', error.message)
    return []
  }

  const seen = new Set<string>()
  const items: LeaseInfoMissingAttention[] = []
  for (const row of data ?? []) {
    const residentId = asString(row.resident_id) || null
    const dedupe = residentId ?? asString(row.id)
    if (!dedupe || seen.has(dedupe)) continue
    seen.add(dedupe)
    const metadata = row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {}
    items.push({
      id: asString(row.id),
      residentId,
      createdAt: asString(row.created_at),
      message: typeof metadata.message === 'string' ? metadata.message : null,
    })
  }
  return items
}
