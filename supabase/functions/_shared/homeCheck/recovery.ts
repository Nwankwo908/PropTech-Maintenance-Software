import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { analyzeHomeCheckEquipmentPair } from './equipmentPair.ts'
import { captureContextAction } from './captureContext.ts'
import { HOME_CHECK_OBSERVATION_PROMPT } from './smsCopy.ts'
import { homeCheckSlotName, nextHomeCheckSlot, type HomeCheckSlot } from '../../../../shared/homeCheck.ts'
import { checkLocation, finishHomeCheckPhotoAnalysis, loadHomeCheck, notifyHomeCheckResult,
  rebuildHomeCheckAssets, sendHomeCheckSms } from './service.ts'

/** The SQL lease and exact photo IDs survive restarts. Never upload a second copy. */
export async function runHomeCheckPhotoRecovery(db: SupabaseClient, landlordId?: string,
  options: { limit?: number; analyze?: typeof analyzeHomeCheckEquipmentPair } = {}) {
  const counts = { processed: 0, notices: 0, uncertain: 0 }
  for (let i = 0; i < Math.min(options.limit ?? 1, 1); i++) {
    const { data: job, error } = await db.rpc('claim_home_check_photo_retry', { p_landlord: landlordId ?? null })
    if (error) throw new Error('Could not claim Home Check photo recovery')
    if (!job) break
    const check = await loadHomeCheck(db, job.check_id, job.landlord_id)
    if (landlordId && check.landlord_id !== landlordId) throw new Error('Recovery account mismatch')
    const result = await (options.analyze ?? analyzeHomeCheckEquipmentPair)(db, check.id,
      `${job.system}_label` as HomeCheckSlot, undefined,
      { token: job.token, labelId: job.label_id, wholeId: job.whole_id })
    if (result) await finishHomeCheckPhotoAnalysis(db, check, result, true)
    counts.processed++
  }
  // Also finds work completed before a crash between analysis and notification.
  let q = db.from('home_check_photo_jobs').select('check_id,landlord_id').in('state', ['done', 'failed'])
    .gt('attempts', 1).is('noticed_at', null).order('updated_at', { ascending: true }).limit(50)
  if (landlordId) q = q.eq('landlord_id', landlordId)
  const { data: finished, error } = await q
  if (error) throw new Error('Could not load recovered Home Checks')
  for (const id of new Set((finished ?? []).map(row => row.check_id as string))) {
    const reserved = await db.rpc('reserve_home_check_recovery_notice', { p_check: id })
    if (reserved.error) throw new Error('Could not reserve recovery notice')
    if (!reserved.data) continue
    const notice = reserved.data
    let state = 'uncertain'
    let outcomeError: Error | null = null
    try {
      const check = await loadHomeCheck(db, id, notice.landlord_id)
      if (landlordId && check.landlord_id !== landlordId) throw new Error('Notice account mismatch')
      if (!check.recipient_phone) throw new Error('No authorized photo recipient')
      if (check.confirmed_at || Date.parse(check.expires_at) <= Date.now()) { state = 'sent'; continue }
      if (notice.failed) {
        await sendHomeCheckSms(db, check, check.recipient_phone,
          `Your photos for ${checkLocation(check)} are kept, but automatic processing could not finish. Your property team needs to review this Home Check. Please do not resend the photos.`,
          check.role === 'tenant' ? check.resident_id : null)
      } else {
        // Rebuild even when a previous process died immediately after committing analysis.
        const progress = await finishHomeCheckPhotoAnalysis(db, check, null, true)
        if (check.answers?.warningSigns != null || check.answers?.observationsConfirmed) {
          if (!await notifyHomeCheckResult(db, check, await rebuildHomeCheckAssets(db, check), true)) throw new Error('Results send outcome unavailable')
        } else {
          const retake = progress.feedback.find(item => item.retakeMessage)
          const next = nextHomeCheckSlot(progress.slots)
          const retakeSlot = retake?.retakeReason === 'system_unverified' ? retake.slot.startsWith('water_heater') ? 'water_heater_whole' : 'heating_whole' : retake?.slot
          const selected = await db.from('home_check_sms_capture_sessions').select('check_id,conversation_id')
            .eq('landlord_id', check.landlord_id).eq('check_id', check.id).maybeSingle()
          if (selected.error) throw new Error('Could not verify the photo conversation')
          if (selected.data && (retake || next || progress.slots.length === 4)) {
            const bound = await captureContextAction(db, { action: 'bind', landlordId: check.landlord_id,
              conversationId: selected.data.conversation_id, checkId: check.id, slot: retakeSlot ?? next })
            if (!bound) throw new Error('The photo conversation changed during recovery')
          }
          const followup = !selected.data ? 'Review this Home Check in Property Intelligence.'
            : retake ? `Please send a clearer photo of ${homeCheckSlotName(retakeSlot!)}.`
            : next ? `Next, send a photo of ${homeCheckSlotName(next)}.` : `All four photos are in. ${HOME_CHECK_OBSERVATION_PROMPT}`
          await sendHomeCheckSms(db, check, check.recipient_phone,
            `Photo processing finished for ${checkLocation(check)}. ${followup}`,
            check.role === 'tenant' ? check.resident_id : null)
        }
      }
      state = 'sent'; counts.notices++
    } catch { counts.uncertain++ }
    finally {
      // Reserve BEFORE sending. A crash/ambiguous provider outcome is never blindly resent.
      const saved = await db.from('home_check_recovery_notices').update({ state, updated_at: new Date().toISOString() })
        .eq('id', notice.id).eq('check_id', id).eq('state', 'sending')
      if (saved.error) outcomeError = new Error('Recovery notice outcome requires review')
    }
    if (outcomeError) throw outcomeError
  }
  return counts
}
