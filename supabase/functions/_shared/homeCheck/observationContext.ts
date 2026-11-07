import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { readHomeCheckReview } from './reviewSelection.ts'
import { normalizeSmsPhone } from '../sms/inbound_db.ts'

type Latest = { id?: string; body?: string; raw_payload?: { source?: string }; provider_status?: string; from_number?: string; to_number?: string }

/** An answered summary for another check does not cancel an explicit capture's pending observation. */
export async function answeredSummaryAllowsObservation(db: SupabaseClient, input: {
  landlordId: string; conversationId: string; checkId: string; from: string; to: string; latest: Latest | null;
}): Promise<boolean> {
  const latest = input.latest
  if (!addressedHomeCheckSummary(latest, input.from, input.to)) return false
  const { data: thread, error } = await db.from('sms_conversations').select('intake_state')
    .eq('id', input.conversationId).eq('landlord_id', input.landlordId)
    .eq('external_phone_number', normalizeSmsPhone(input.from)).maybeSingle()
  if (error || !thread) return false
  const review = readHomeCheckReview(thread.intake_state)
  if (!review?.selectedId || review.selectedId === input.checkId || review.summaryMessageId !== latest!.id) return false
  const { data: other, error: checkError } = await db.from('home_checks').select('id,completed_at,answers')
    .eq('id', review.selectedId).eq('landlord_id', input.landlordId)
    .eq('ulo_number', normalizeSmsPhone(input.to)).eq('status', 'completed')
    .is('confirmed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
  return !checkError && !!other?.completed_at &&
    (other.answers?.warningSigns != null || other.answers?.observationsConfirmed === true)
}

export function addressedHomeCheckSummary(latest: Latest | null, from: string, to: string): boolean {
 return !!latest?.id && /^Results:/i.test(latest.body ?? '') && latest.raw_payload?.source === 'home_check' &&
 latest.provider_status !== 'failed' && normalizeSmsPhone(latest.from_number ?? '') === normalizeSmsPhone(to) &&
 normalizeSmsPhone(latest.to_number ?? '') === normalizeSmsPhone(from)
}
