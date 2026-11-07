import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import type { HomeCheckRow } from './service.ts'
import { readCaptureContext } from './captureContext.ts'
import { normalizeSmsPhone } from '../sms/inbound_db.ts'
import { isStorageMediaPath } from '../sms/media.ts'
import { extractWorkOrderRefFromSms, formatWorkOrderRef, workOrderRefMatchesTicket } from '../vendor_outreach_copy.ts'

const KEY = 'home_check_completed_photo'
const DAY = 24 * 60 * 60 * 1000
const OPEN = ['pending_accept', 'accepted', 'in_progress', 'unassigned']
type Pending = { checkId: string; messageId: string; phase: 'choice' | 'job'; expiresAt: string }
export type CompletedPhotoAction = {
  kind: 'completed_photo'; check: HomeCheckRow; conversationId: string; vendorId: string;
  phone: string; line: string; originalMessageId: string; body: string;
  phase: 'initial' | 'choice' | 'job'; newPhoto: boolean;
}
function pending(value: unknown): Pending | null {
  const p = value as Pending | null
  return p && typeof p.checkId === 'string' && typeof p.messageId === 'string' &&
    ['choice', 'job'].includes(p.phase) && Date.parse(p.expiresAt) > Date.now() ? p : null
}
function location(check: HomeCheckRow) {
  const parts = check.property_label.split(' · ')
  return (parts.length > 1 ? parts.slice(1) : parts).concat(check.unit_label ? [`Unit ${check.unit_label}`] : []).join(', ')
}
const question = (check: HomeCheckRow) => `I received your photo, but your last Home Check at ${location(check)} is already complete. Is this a correction to that check or a photo for another job? Reply CORRECTION or ANOTHER JOB. I’ll keep the photo unassigned until you choose.`

/** Only the explicitly selected, recently confirmed check on this sender/line is relevant. */
export async function prepareCompletedPhoto(ctx: InboundSmsHandlerContext): Promise<CompletedPhotoAction | null> {
  if (ctx.identity.identity_type !== 'vendor' || !ctx.identity.vendor_id) return null
  const body = ctx.inbound.body.trim(), hasMedia = ctx.inbound.mediaUrls.length > 0
  if (/^(?:stop|start|help|cancel all|home check|retry photos|resume photos)\b/i.test(body)) return null
  const phone = normalizeSmsPhone(ctx.inbound.from), line = normalizeSmsPhone(ctx.inbound.to)
  const thread = await ctx.supabase.from('sms_conversations').select('intake_state')
    .eq('id', ctx.conversationId).eq('landlord_id', ctx.landlordId).eq('external_phone_number', phone).maybeSingle()
  if (thread.error || !thread.data) return null
  const held = pending(thread.data.intake_state?.[KEY])
  if (!hasMedia && !held) return null
  // An explicit reference on a new upload belongs to its existing routing path.
  if (!held && /\b(?:WO[- ]?[A-F0-9]{4}|HC-[A-F0-9]{12})\b/i.test(body)) return null
  const active = await ctx.supabase.from('home_checks').select('id').eq('landlord_id', ctx.landlordId)
    .eq('recipient_phone', phone).eq('ulo_number', line).eq('role', 'contractor')
    .in('status', ['collecting', 'completed']).is('confirmed_at', null).gt('expires_at', new Date().toISOString()).limit(1)
  if (active.error || active.data?.length) return null
  const selected = await readCaptureContext(ctx.supabase, ctx.landlordId, ctx.conversationId, { allowExpiredForReply: true })
  const checkId = held?.checkId ?? selected?.checkId
  if (!checkId || selected?.checkId !== checkId) return null
  const found = await ctx.supabase.from('home_checks').select('*').eq('id', checkId)
    .eq('landlord_id', ctx.landlordId).eq('recipient_phone', phone).eq('ulo_number', line)
    .eq('vendor_id', ctx.identity.vendor_id).eq('role', 'contractor').eq('status', 'confirmed')
    .gte('confirmed_at', new Date(Date.now() - 7 * DAY).toISOString()).maybeSingle()
  if (found.error || !found.data?.confirmed_at) return null
  const offer = thread.data.intake_state?.pending_vendor_job_offer
  if (!held && offer?.vendorId === ctx.identity.vendor_id && Date.parse(offer.sentAt) > Date.parse(found.data.confirmed_at)) return null
  return { kind: 'completed_photo', check: found.data as HomeCheckRow, conversationId: ctx.conversationId,
    vendorId: ctx.identity.vendor_id, phone, line, originalMessageId: held?.messageId ?? ctx.messageId,
    body, phase: held?.phase ?? 'initial', newPhoto: hasMedia }
}

/** Compare-and-swap preserves unrelated thread state and fences competing photos. */
async function savePending(db: SupabaseClient, action: CompletedPhotoAction, next: Pending | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await db.from('sms_conversations').select('intake_state').eq('id', action.conversationId)
      .eq('landlord_id', action.check.landlord_id).eq('external_phone_number', action.phone).maybeSingle()
    if (read.error || !read.data) return false
    const old = pending(read.data.intake_state?.[KEY])
    if (old && old.messageId !== action.originalMessageId) return false
    if (action.phase !== 'initial' && !old) return false
    const state = { ...(read.data.intake_state ?? {}) }
    if (next) state[KEY] = next
    else delete state[KEY]
    let q = db.from('sms_conversations').update({ intake_state: state }).eq('id', action.conversationId)
      .eq('landlord_id', action.check.landlord_id).eq('external_phone_number', action.phone)
    q = read.data.intake_state == null ? q.is('intake_state', null) : q.eq('intake_state', JSON.stringify(read.data.intake_state))
    const result = await q.select('id').maybeSingle()
    if (result.error) return false
    if (result.data) return true
  }
  return false
}
async function resolvePhoto(db: SupabaseClient, action: CompletedPhotoAction, choice: 'correction' | 'job', ticketId: string | null = null) {
  const result = await db.rpc('resolve_completed_home_check_photo', {
    p_landlord_id: action.check.landlord_id, p_conversation_id: action.conversationId,
    p_check_id: action.check.id, p_vendor_id: action.vendorId, p_message_id: action.originalMessageId,
    p_phone: action.phone, p_line: action.line, p_choice: choice, p_ticket_id: ticketId,
  })
  return !result.error && result.data === true
}
export async function actCompletedPhoto(db: SupabaseClient, action: CompletedPhotoAction): Promise<{reply: string; runId?: string | null}> {
  // Revalidate the confirmed check and original inbound media at action time.
  const selected = await readCaptureContext(db, action.check.landlord_id, action.conversationId, { allowExpiredForReply: true })
  if (selected?.checkId !== action.check.id) return {reply: 'The selected Home Check changed. Your photo remains unassigned; please follow the current instructions.'}
  const check = await db.from('home_checks').select('id').eq('id', action.check.id)
    .eq('landlord_id', action.check.landlord_id).eq('role', 'contractor').eq('vendor_id', action.vendorId)
    .eq('recipient_phone', action.phone).eq('ulo_number', action.line).eq('status', 'confirmed').maybeSingle()
  const original = await db.from('sms_messages').select('media_urls').eq('id', action.originalMessageId)
    .eq('landlord_id', action.check.landlord_id).eq('conversation_id', action.conversationId)
    .eq('direction', 'inbound').eq('from_number', action.phone).eq('to_number', action.line).maybeSingle()
  const paths = original.data?.media_urls
  if (check.error || !check.data || original.error || !Array.isArray(paths) || !paths.length || !paths.every(path => typeof path === 'string' && isStorageMediaPath(path))) {
    return { reply: 'I could not verify which photo you mean. No records were changed. Please ask your property team to review this conversation.' }
  }
  const state = (phase: Pending['phase']): Pending => ({checkId: action.check.id, messageId: action.originalMessageId, phase, expiresAt: new Date(Date.now() + DAY).toISOString()})
  const failed = { reply: 'Your photo is still unassigned. I could not save your choice; please try again.' }
  if (action.phase === 'initial') return await savePending(db, action, state('choice'))
    ? { reply: question(action.check) } : failed
  if (action.newPhoto) return { reply: 'I still have your earlier photo. Please reply CORRECTION or ANOTHER JOB before sending more. The new photo has not been assigned.' }
  if (/^cancel[.!]?$/i.test(action.body)) return await savePending(db, action, null)
    ? { reply: 'Photo assignment cancelled. The photo remains in this conversation; no records were changed.' } : failed
  if (/^(?:1|(?:(?:it[’']?s|this is|it is) )?(?:a )?correction(?: to (?:that|the) (?:home )?check)?)[.!]?$/i.test(action.body)) {
    if (!await resolvePhoto(db, action, 'correction')) return failed
    return { reply: `Your correction photo is retained in this conversation for the property team to review. The confirmed Home Check records for ${location(action.check)} have not changed.` }
  }
  const another = /^(?:2|(?:(?:it[’']?s|this is|it is|for) )?(?:another|other|different) job)[.!]?$/i.test(action.body)
  if (another || action.phase === 'job') {
    const jobs = await db.from('maintenance_requests').select('id,photo_paths,description')
      .eq('landlord_id', action.check.landlord_id).eq('assigned_vendor_id', action.vendorId)
      .in('vendor_work_status', OPEN).is('completed_at', null).order('created_at', { ascending: false }).limit(20)
    if (jobs.error) return failed
    const openJobs = (jobs.data ?? []) as Array<{id: string; photo_paths: string[] | null; description: string | null}>
    const ref = extractWorkOrderRefFromSms(action.body)
    const matches = openJobs.filter(row => row.id === action.body.trim() || ref && workOrderRefMatchesTicket(ref, row.id))
    if (!another && matches.length === 1) {
      const job = matches[0]
      if (!await resolvePhoto(db, action, 'job', job.id)) return failed
      return { reply: `Your photo is saved to ${formatWorkOrderRef(job.id)}. The completed Home Check records have not changed.` }
    }
    if (!await savePending(db, action, state('job'))) return failed
    if (!openJobs.length) return {reply: 'I don’t see an open job assigned to you. Your photo is still unassigned. Ask your property team which job it belongs to, or reply CORRECTION or CANCEL.'}
    return { reply: ['Which job is this photo for? Reply with its work-order reference. Your photo is still unassigned.',
      ...openJobs.slice(0, 8).map(job => `${formatWorkOrderRef(job.id)}: ${String(job.description ?? 'Maintenance').replace(/\s+/g, ' ').slice(0, 60)}`),
      'You can also reply CORRECTION or CANCEL.'].join('\n') }
  }
  return { reply: question(action.check) }
}
