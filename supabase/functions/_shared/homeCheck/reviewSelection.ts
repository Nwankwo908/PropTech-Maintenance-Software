import type { HomeCheckAnswers } from '../../../../shared/homeCheck.ts'
import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'
import { isLandlordAccountOrOpsPhone } from '../sms/landlordAccountPhone.ts'
import { normalizeSmsPhone } from '../sms/inbound_db.ts'
import { checkLocation, type HomeCheckRow } from './service.ts'

const KEY = 'home_check_results_review'
type Review = { ids: string[]; selectedId?: string; summaryMessageId?: string; expiresAt: string }
export function readHomeCheckReview(value: unknown, now = Date.now()): Review | null {
  const raw = (value as Record<string, unknown> | null)?.[KEY] as Review | undefined
  if (!raw || !Array.isArray(raw.ids) || !raw.ids.length || raw.ids.length > 50 ||
      raw.ids.some(id => typeof id !== 'string') || new Set(raw.ids).size !== raw.ids.length ||
      !Number.isFinite(Date.parse(raw.expiresAt)) || Date.parse(raw.expiresAt) <= now ||
      (raw.selectedId !== undefined && !raw.ids.includes(raw.selectedId))) return null
  return raw
}

/** Review state is separate from photo-capture state: the reviewer need not be the photo taker. */
export async function prepareHomeCheckReview(ctx: InboundSmsHandlerContext, start = false): Promise<
  { kind: 'results' | 'confirm'; check: HomeCheckRow } | { kind: 'answers'; check: HomeCheckRow; answers: HomeCheckAnswers } | { kind: 'clarify'; reply: string } | null
> {
  if (ctx.identity.identity_type !== 'landlord' || ctx.inbound.mediaUrls.length) return null
  const body = ctx.inbound.body.trim()
  const observation = /^(?:NONE|NO|UNSURE)[.!]?$|^YES\b/i.test(body)
  if (!start && !observation && !/^(?:\d{1,2}|OK|CANCEL)$/i.test(body)) return null
  const { data: thread, error } = await ctx.supabase.from('sms_conversations').select('intake_state')
    .eq('id', ctx.conversationId).eq('landlord_id', ctx.landlordId)
    .eq('external_phone_number', normalizeSmsPhone(ctx.inbound.from)).maybeSingle()
  if (error || !thread) return start ? { kind: 'clarify', reply: 'I could not load your Home Checks. Please try RESULTS again.' } : null
  const pending = readHomeCheckReview(thread.intake_state)
  // An unbound OK must enter results review, never borrow the independent
  // photo-capture session. Offer completed results explicitly before confirming.
  if (!start && !pending) {
    if (!/^OK$/i.test(body)) return null
    return prepareHomeCheckReview(ctx, true)
  }
  if (!await isLandlordAccountOrOpsPhone(ctx.supabase, { fromNumber: ctx.inbound.from, landlordId: ctx.landlordId })) return null
  const save = async (review: Review | null) => {
    const intake = { ...(thread.intake_state ?? {}) }
    if (review) intake[KEY] = review
    else delete intake[KEY]
    let q = ctx.supabase.from('sms_conversations').update({ intake_state: intake })
      .eq('id', ctx.conversationId).eq('landlord_id', ctx.landlordId)
      .eq('external_phone_number', normalizeSmsPhone(ctx.inbound.from))
    q = thread.intake_state == null ? q.is('intake_state', null) : q.eq('intake_state', JSON.stringify(thread.intake_state))
    const { data, error } = await q.select('id').maybeSingle()
    return !error && !!data
  }
  const changed = { kind: 'clarify' as const, reply: 'The conversation changed. Text RESULTS to choose the Home Check again.' }
  if (!start && /^cancel$/i.test(body)) return await save(null)
    ? { kind: 'clarify', reply: 'Home Check review paused. Text RESULTS when you are ready.' } : changed
  const { data, error: checksError } = await ctx.supabase.from('home_checks').select('*')
    .eq('landlord_id', ctx.landlordId).eq('ulo_number', normalizeSmsPhone(ctx.inbound.to))
    .eq('status', 'completed').is('confirmed_at', null).gt('expires_at', new Date().toISOString())
  if (checksError) return { kind: 'clarify', reply: 'I could not load your Home Checks. Please try RESULTS again.' }
  const checks = (data ?? []).filter((c: HomeCheckRow) => c.completed_at && !c.confirmed_at) as HomeCheckRow[]
  if (!start && observation) {
    // Recovery may finish photo analysis without reaching the capture-session
    // observations stage. Only an explicitly selected review may resume it.
    const selected = checks.find(c => c.id === pending?.selectedId && c.role === 'landlord'
      && normalizeSmsPhone(c.recipient_phone ?? '') === normalizeSmsPhone(ctx.inbound.from)
      && c.answers?.warningSigns == null && !c.answers?.observationsConfirmed)
    if (!selected) return null
    const { data: prompts, error: promptError } = await ctx.supabase.from('sms_messages').select('body')
      .eq('conversation_id', ctx.conversationId).eq('landlord_id', ctx.landlordId)
      .eq('direction', 'outbound').order('created_at', { ascending: false }).limit(1)
    if (promptError || !/Any leaks, unusual noises or smells\?/i.test(String(prompts?.[0]?.body ?? ''))) return null
    const details = body.replace(/^yes\b[,:.!\s]*/i, '').trim()
    if (/^yes\b/i.test(body) && (!details || details.length > 800)) return { kind: 'clarify', reply: 'Please describe what you noticed after YES, or reply NONE or UNSURE.' }
    return { kind: 'answers', check: selected, answers: { ...selected.answers, observationsConfirmed: true,
      warningSigns: /^unsure/i.test(body) ? null : /^yes\b/i.test(body),
      warningDetails: /^yes\b/i.test(body) ? details : '' } }
  }
  if (!start) {
    const id = /^OK$/i.test(body) ? pending!.selectedId : pending!.ids[Number(body) - 1]
    if (!id) return { kind: 'clarify', reply: `Reply with a number from 1 to ${pending!.ids.length}, or CANCEL.` }
    const check = checks.find(c => c.id === id)
    if (!check) return changed
    if (/^OK$/i.test(body) && pending?.summaryMessageId) {
      const { data: summaries, error: summaryError } = await ctx.supabase.from('sms_messages').select('id')
        .eq('landlord_id', ctx.landlordId).eq('conversation_id', ctx.conversationId).eq('direction', 'outbound')
        .eq('raw_payload->>source', 'home_check').like('body', 'Results:%').order('created_at', { ascending: false }).limit(1)
      if (summaryError || summaries?.[0]?.id !== pending.summaryMessageId) return changed
    }
    if (!await save({ ...pending!, selectedId: id })) return changed
    return { kind: /^OK$/i.test(body) ? 'confirm' : 'results', check }
  }
  if (!checks.length) return { kind: 'clarify', reply: 'No completed Home Check is awaiting review.' }
  // Sorting controls only menu presentation; it never chooses a record for the user.
  checks.sort((a,b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
  const review: Review = { ids: checks.map(c => c.id), expiresAt: new Date(Date.now() + 30*60*1000).toISOString(), ...(checks.length === 1 ? { selectedId: checks[0].id } : {}) }
  if (!await save(review)) return changed
  if (checks.length === 1) return { kind: 'results', check: checks[0] }
  const choices = checks.map((c,i) => `${i+1}) ${checkLocation(c)} — started ${new Date(c.created_at).toLocaleDateString('en-US', {timeZone:'America/New_York',month:'short',day:'numeric'})}`)
  return { kind: 'clarify', reply: `Which Home Check results would you like to review?\n${choices.join('\n')}\nReply with a number, or CANCEL.` }
}
