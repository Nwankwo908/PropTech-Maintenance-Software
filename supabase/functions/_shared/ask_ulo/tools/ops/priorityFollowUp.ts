import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import type { AskUloHistoryMessage } from '../../core/types.ts'
import { isDailyPrioritiesQuestion } from './dailyPrioritiesDetect.ts'
import { lookupDailyPriorities } from './dailyPrioritiesLookup.ts'

export function isPriorityFollowUp(question: string, history: AskUloHistoryMessage[]): boolean {
  return /\b(which one|which of (?:these|those))\b/i.test(question) &&
    !/\b(vendors?|residents?|tenants?|leases?|rent|properties)\b/i.test(question) &&
    isDailyPrioritiesQuestion(history.filter(m => m.role === 'user').at(-1)?.content ?? '')
}

export async function answerPriorityFollowUp(db: SupabaseClient, landlordId: string, buildingFilter: string | null): Promise<string> {
  const result = await lookupDailyPriorities(db, { landlordId, role: 'landlord', buildingFilter })
  if (!result.available || result.partialSources.length) return 'I could not fully refresh those priorities. Please retry before relying on a first recommendation.'
  const first = result.items[0]
  if (!first) return 'There are no actionable items in the current priorities. Nothing has been assigned or approved.'
  let place = first.propertyLabel
  if (!place && first.propertyId) {
    const { data, error } = await db.from('properties').select('name').eq('landlord_id', landlordId).eq('id', first.propertyId).maybeSingle()
    if (error) return 'I could not verify the property for that priority. Please retry before acting.'
    place = data?.name ?? null
  }
  const ref = first.displayId != null ? `request ${first.displayId}` : `WO-${first.entityId.slice(0, 4).toUpperCase()}`
  const reason = first.category === 'emergency' ? 'It is marked as an emergency and takes precedence over routine work.'
    : first.blocker?.toLowerCase().includes('vendor needed') ? 'It needs a vendor before work can proceed.'
    : first.blocker ? `The current blocker is: ${first.blocker}.` : 'It is the highest-ranked actionable item in the current records.'
  return `I'd start with **${first.title} (${ref})**${place ? ` at **${place}**` : ''}. ${reason}\n\nReview this request first. Nothing has been assigned, approved or paid.`
}
