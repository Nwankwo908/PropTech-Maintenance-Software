import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

/** Bind the exact Results message after provider acceptance, independently of the photo taker. */
export async function bindHomeCheckResultsReview(db: SupabaseClient, input: {
  landlordId: string; conversationId: string; checkId: string; phone: string;
  uloNumber: string; messageId: string; checkExpiresAt: string;
}): Promise<boolean> {
  if (!input.messageId || !Number.isFinite(Date.parse(input.checkExpiresAt)) || Date.parse(input.checkExpiresAt) <= Date.now()) return false
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: thread, error } = await db.from('sms_conversations').select('intake_state')
      .eq('id', input.conversationId).eq('landlord_id', input.landlordId)
      .eq('external_phone_number', input.phone).maybeSingle()
    if (error || !thread) return false
    const { data: messages, error: messageError } = await db.from('sms_messages')
      .select('id,from_number,to_number,provider_status')
      .eq('landlord_id', input.landlordId).eq('conversation_id', input.conversationId)
      .eq('direction', 'outbound').eq('raw_payload->>source', 'home_check')
      .like('body', 'Results:%').order('created_at', { ascending: false }).limit(1)
    const latest = messages?.[0]
    if (messageError || latest?.id !== input.messageId || latest.from_number !== input.uloNumber ||
        latest.to_number !== input.phone || latest.provider_status === 'failed') return false
    const review = { ids: [input.checkId], selectedId: input.checkId, summaryMessageId: input.messageId,
      expiresAt: new Date(Math.min(Date.parse(input.checkExpiresAt), Date.now() + 24*60*60*1000)).toISOString() }
    const intake = { ...(thread.intake_state ?? {}), home_check_results_review: review }
    let q = db.from('sms_conversations').update({ intake_state: intake })
      .eq('id', input.conversationId).eq('landlord_id', input.landlordId).eq('external_phone_number', input.phone)
    q = thread.intake_state == null ? q.is('intake_state', null) : q.eq('intake_state', JSON.stringify(thread.intake_state))
    const result = await q.select('id').maybeSingle()
    if (result.error) return false
    if (result.data) return true
  }
  return false
}
