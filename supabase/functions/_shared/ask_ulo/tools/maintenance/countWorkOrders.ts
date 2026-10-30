import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

/** Filtered, dated, trade and unit counts stay on normal retrieval. */
export function parseOpenWorkOrderCount(question: string): { property: string | null } | null {
  const q = question.trim().replace(/[?.!]+$/, '').replace(/^(how many) (work\s*orders?|maintenance requests?|repairs?|tickets?) (?:are|remain) (open|active|unresolved)/i, '$1 $3 $2').replace(/^(how many) (open|active|unresolved) (work\s*orders?|maintenance requests?|repairs?|tickets?) (?:do (?:i|we) have) (at|for|in) /i, '$1 $2 $3 $4 ')
  const match = q.match(/^(?:how many|count(?: my| the)?)\s+(?:open|active|unresolved)\s+(?:work\s*orders?|maintenance requests?|repairs?|tickets?)(?:\s+(do (?:i|we) have|are there|(?:in|across) (?:my|our|the) portfolio|(?:at|for|in) (.+)))?$/i)
  if (!match) return null
  const property = match[2]?.trim() || null
  if (property && /\b(last|today|week|month|year|unit|urgent|plumbing|vendor)\b/i.test(property)) return null
  return { property }
}

export async function countOpenWorkOrders(db: SupabaseClient, landlordId: string, property: string | null): Promise<{ count: number | null; answer: string; status: 'answered' | 'clarified' }> {
  let propertyId: string | null = null
  let label = 'your portfolio'
  if (property) {
    const { data, error } = await db.from('properties').select('id, name, street_address').eq('landlord_id', landlordId)
    if (error) throw new Error('Work-order property lookup failed')
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const target = normalize(property.replace(/^(?:the )?property (?:at|named) /i, ''))
    const matches = (data ?? []).filter((p) => [p.name, p.street_address].some((s) => s && normalize(s) === target))
    if (matches.length !== 1) return { count: null, status: 'clarified', answer: matches.length ? 'More than one property matches. Please use its full address.' : 'I could not find that property in your account. Please use its exact name or address.' }
    propertyId = matches[0].id
    label = matches[0].name || property
  }
  let query = db.from('maintenance_requests').select('id', { count: 'exact', head: true })
    .eq('landlord_id', landlordId).is('completed_at', null).is('cancelled_at', null)
    .or('status.is.null,status.not.in.(completed,closed,cancelled,canceled,resolved)')
  if (propertyId) query = query.eq('property_id', propertyId)
  const { count, error } = await query
  if (error || count == null) throw new Error('Work-order count unavailable')
  return { count, status: 'answered', answer: `You have **${count} open work order${count === 1 ? '' : 's'}** in ${label}.` }
}
