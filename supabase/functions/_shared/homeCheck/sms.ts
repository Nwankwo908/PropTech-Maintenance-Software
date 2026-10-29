import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'
import { normalizeSmsPhone } from '../sms/inbound_db.ts'
import { isLandlordAccountOrOpsPhone } from '../sms/landlordAccountPhone.ts'
import {
  type HomeCheckAnswers,
  type HomeCheckTarget,
  chooseHomeCheckContractorId,
  nearestHomeCheckVendors,
  parseHomeCheckCommand,
  parseHomeCheckGuideStart,
  parseHomeCheckPhotoReply,
  HOME_CHECK_PHOTOS,
  homeCheckPhotoChoiceQuestion,
  homeCheckPhotoChoices,
  homeCheckPhotoKindQuestion,
  homeCheckSlotFromReading,
  homeCheckSlotName,
  nextHomeCheckSlot,
  parseHomeCheckPhotoChoice,
  pickHomeCheckForPhoto,
  type HomeCheckSlot,
} from '../../../../shared/homeCheck.ts'
import { normalizeUsStateCode, vendorServiceStateCodes } from '../vendorServiceArea.ts'
function homeCheckGuidePending(intake: unknown): boolean {
  if (!intake || typeof intake !== 'object') return false
  const guide = (intake as { home_check_guide?: { step?: unknown } }).home_check_guide
  return Boolean(guide && typeof guide === 'object' && typeof guide.step === 'string')
}

/** An unnumbered photo Ulo is holding until the sender picks the check or says what it shows. */
export type PendingHomeCheckPhoto =
  | { step: 'check'; path: string; at: string; checkIds: string[] }
  | { step: 'kind'; path: string; at: string; checkId: string }

const PENDING_PHOTO_KEY = 'home_check_photo_pending'
const PENDING_PHOTO_TTL_MS = 24 * 3600000

function readPendingPhoto(intake: unknown): PendingHomeCheckPhoto | null {
  if (!intake || typeof intake !== 'object') return null
  const pending = (intake as Record<string, unknown>)[PENDING_PHOTO_KEY] as
    | PendingHomeCheckPhoto
    | undefined
  if (!pending || typeof pending.path !== 'string' || typeof pending.at !== 'string') return null
  if (Date.now() - Date.parse(pending.at) > PENDING_PHOTO_TTL_MS) return null
  return pending
}

async function writePendingPhoto(
  db: SupabaseClient,
  conversationId: string,
  pending: PendingHomeCheckPhoto | null,
) {
  const { data } = await db.from('sms_conversations').select('intake_state').eq(
    'id',
    conversationId,
  ).maybeSingle()
  const intake = data?.intake_state && typeof data.intake_state === 'object'
    ? { ...(data.intake_state as Record<string, unknown>) }
    : {}
  if (pending) intake[PENDING_PHOTO_KEY] = pending
  else delete intake[PENDING_PHOTO_KEY]
  await checked(db.from('sms_conversations').update({ intake_state: intake }).eq('id', conversationId))
}

/** Reads thread state only for a short reply that could continue a guide. */
function mightContinueHomeCheckGuide(body: string): boolean {
  const text = body.trim()
  if (!text || text.length > 80) return false
  if (/^(yes|y|yeah|yep|no|nope|n|cancel|\d{1,2})$/i.test(text)) return true
  return /\b(be home|enter|without me|without you|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|\d\s*(?:am|pm)|[–-]\s*\d)/i
    .test(text)
}
import {
  checked,
  checkLocation,
  confirmHomeCheck,
  type HomeCheckRow,
  requireData,
  saveHomeCheckAnswers,
  sendHomeCheckSms,
  uploadHomeCheckPhoto,
} from './service.ts'
import { readHomeCheckPhoto } from './photoSlot.ts'

export type HomeCheckSmsAction =
  | {
    kind: 'start'
    command: NonNullable<ReturnType<typeof parseHomeCheckCommand>>
    messageId: string
    initiatorPhone: string
  }
  | {
    kind: 'photo'
    check: HomeCheckRow
    /** Null: read the photo to find its slot, or ask what it shows. */
    slot: HomeCheckSlot | null
    path: string
    conversationId?: string
  }
  | { kind: 'hold_photo'; conversationId: string; pending: PendingHomeCheckPhoto; reply: string }
  | { kind: 'confirm'; check: HomeCheckRow }
  | { kind: 'answers'; check: HomeCheckRow; answers: HomeCheckAnswers }
  | { kind: 'clarify'; reply: string }
  | {
    kind: 'guide'
    body: string
    conversationId: string
    initiatorPhone: string
    sender: 'landlord' | 'tenant'
  }

/** Explicit reference + assigned phone + receiving Ulo line takes precedence
 * over ambiguous contact identities on the shared Alpha DID. */
export async function resolveHomeCheckLandlord(
  db: SupabaseClient,
  inbound: { body: string; from: string; to: string },
) {
  const reference = inbound.body.match(/\bHC-[A-F0-9]{12}\b/i)?.[0].toUpperCase()
  if (!reference) return null
  const { data: check } = await db.from('home_checks').select('landlord_id, recipient_phone').eq(
    'reference',
    reference,
  ).eq('ulo_number', normalizeSmsPhone(inbound.to)).maybeSingle()
  if (!check) return null
  if (check.recipient_phone === normalizeSmsPhone(inbound.from)) return check.landlord_id as string
  if (/^OK\s+HC-/i.test(inbound.body.trim())) {
    const { data: landlord } = await db.from('landlords').select('phone').eq(
      'id',
      check.landlord_id,
    ).single()
    if (landlord?.phone && normalizeSmsPhone(landlord.phone) === normalizeSmsPhone(inbound.from)) {
      return check.landlord_id as string
    }
  }
  return null
}

export async function homeCheckTargets(
  db: SupabaseClient,
  landlordId: string,
): Promise<HomeCheckTarget[]> {
  const properties = requireData(
    await db.from('properties').select('id, name, street_address').eq('landlord_id', landlordId),
  )
  const units = requireData(
    await db.from('units').select('id, property_id, unit_label').eq('landlord_id', landlordId),
  )
  return properties.flatMap((
    property,
  ) => [
    {
      propertyId: property.id,
      unitId: null,
      propertyName: property.name,
      address: property.street_address || property.name,
      unitLabel: null,
    },
    ...units.filter((unit) => unit.property_id === property.id).map((unit) => ({
      propertyId: property.id,
      unitId: unit.id,
      propertyName: property.name,
      address: property.street_address || property.name,
      unitLabel: unit.unit_label,
    })),
  ])
}
export async function homeCheckVendors(db: SupabaseClient, landlordId: string, propertyId: string) {
  const property = requireData<{
    latitude: number | null
    longitude: number | null
    state: string | null
  }>(
    await db.from('properties').select('latitude, longitude, state').eq('landlord_id', landlordId)
      .eq('id', propertyId).single(),
  )
  const vendors = requireData(
    await db.from('vendors').select(
      'id, name, phone, latitude, longitude, roster_status, state, preferred_emergency',
    ).eq('landlord_id', landlordId).eq('active', true),
  )
    .filter((vendor) => vendor.phone && !['suspended', 'banned'].includes(vendor.roster_status))
  const ids = vendors.map((vendor) => vendor.id)
  const verificationByVendor = new Map<string, { serviceArea: unknown; licenseState: string | null }>()
  if (ids.length) {
    const { data } = await db.from('vendor_verifications').select(
      'vendor_id, service_area, license_state, updated_at',
    ).eq('landlord_id', landlordId).in('vendor_id', ids).order('updated_at', { ascending: false })
    for (const row of data ?? []) {
      if (!row.vendor_id || verificationByVendor.has(row.vendor_id)) continue
      verificationByVendor.set(row.vendor_id, {
        serviceArea: row.service_area,
        licenseState: typeof row.license_state === 'string' ? row.license_state : null,
      })
    }
  }
  const ranked = nearestHomeCheckVendors(property, vendors)
  const candidates = vendors.map((vendor) => {
    const verification = verificationByVendor.get(vendor.id)
    return {
      id: vendor.id,
      latitude: vendor.latitude,
      longitude: vendor.longitude,
      preferred: vendor.preferred_emergency === true,
      states: vendorServiceStateCodes({
        serviceArea: verification?.serviceArea,
        licenseState: verification?.licenseState ?? null,
        rosterState: typeof vendor.state === 'string' ? vendor.state : null,
      }),
    }
  })
  return {
    vendors: vendors.map((vendor) => ({
      ...vendor,
      states: candidates.find((row) => row.id === vendor.id)?.states ?? [],
      distanceKm: ranked.find((row) => row.id === vendor.id)?.distanceKm ?? null,
    })),
    propertyState: normalizeUsStateCode(property.state),
    closest: chooseHomeCheckContractorId(
      { ...property, state: normalizeUsStateCode(property.state) },
      candidates,
    ),
  }
}

/** Called after identity validation and duplicate SID suppression, before generic
 * intake. Global consent and admin takeover still win. All mutations go through
 * the shared home_check workflow template, not a second SMS state machine. */
export async function prepareHomeCheckSms(
  ctx: InboundSmsHandlerContext,
): Promise<HomeCheckSmsAction | null> {
  const landlord = ctx.identity.identity_type === 'landlord'
  const body = ctx.inbound.body.trim()
  const command = parseHomeCheckCommand(body)
  const guideStart = parseHomeCheckGuideStart(body)
  if (command || guideStart) {
    if (!landlord) return null
    if (
      !await isLandlordAccountOrOpsPhone(ctx.supabase, {
        fromNumber: ctx.inbound.from,
        landlordId: ctx.landlordId,
      })
    ) {
      return {
        kind: 'clarify',
        reply:
          'Only the landlord or an authorized property manager or team member can start a Home Check. Ask your property team to initiate it from their registered phone number.',
      }
    }
    return {
      kind: 'guide',
      body,
      conversationId: ctx.conversationId,
      initiatorPhone: normalizeSmsPhone(ctx.inbound.from),
      sender: 'landlord',
    }
  }
  if (!ctx.inbound.mediaUrls.length && /^\d{1,2}$/.test(body)) {
    const { data } = await ctx.supabase.from('sms_conversations').select('intake_state').eq(
      'id',
      ctx.conversationId,
    ).maybeSingle()
    const pending = readPendingPhoto(data?.intake_state)
    if (pending) return await answerPendingPhoto(ctx, pending, body)
  }
  if (
    landlord && mightContinueHomeCheckGuide(body) &&
    await isLandlordAccountOrOpsPhone(ctx.supabase, {
      fromNumber: ctx.inbound.from,
      landlordId: ctx.landlordId,
    })
  ) {
    const { data } = await ctx.supabase.from('sms_conversations').select('intake_state').eq(
      'id',
      ctx.conversationId,
    ).maybeSingle()
    if (homeCheckGuidePending(data?.intake_state)) {
      return {
        kind: 'guide',
        body,
        conversationId: ctx.conversationId,
        initiatorPhone: normalizeSmsPhone(ctx.inbound.from),
        sender: 'landlord',
      }
    }
  }
  if (ctx.identity.identity_type === 'resident' && mightContinueHomeCheckGuide(body)) {
    const { data } = await ctx.supabase.from('sms_conversations').select('intake_state').eq(
      'id',
      ctx.conversationId,
    ).maybeSingle()
    const pending = data?.intake_state &&
      typeof data.intake_state === 'object' &&
      (data.intake_state as { home_check_tenant_reply?: unknown }).home_check_tenant_reply
    if (pending) {
      const { data: threads } = await ctx.supabase.from('sms_conversations').select(
        'id, intake_state',
      ).eq('landlord_id', ctx.landlordId)
      const landlordThread = (threads ?? []).find((row) => homeCheckGuidePending(row.intake_state))
      if (landlordThread) {
        return {
          kind: 'guide',
          body,
          conversationId: landlordThread.id,
          initiatorPhone: normalizeSmsPhone(ctx.inbound.from),
          sender: 'tenant',
        }
      }
    }
  }
  const hasMedia = ctx.inbound.mediaUrls.length > 0
  if (
    !hasMedia && !/^OK(?:\s+HC-[A-F0-9]{12})?$/i.test(body) &&
    !/^HC-[A-F0-9]{12}/i.test(body)
  ) return null
  const checks = await openChecksForSender(ctx, landlord && /^OK/i.test(body) && !hasMedia)
  if (!checks.length) {
    return /^HC-/i.test(body)
      ? {
        kind: 'clarify',
        reply:
          'That Home Check is not available for this phone number or has expired. Ask the landlord for a new check.',
      }
      : null
  }
  const ref = body.match(/HC-[A-F0-9]{12}/i)?.[0].toUpperCase()
  if (hasMedia) {
    if (ctx.inbound.mediaUrls.length !== 1 || /^https?:/i.test(ctx.inbound.mediaUrls[0])) {
      return {
        kind: 'clarify',
        reply: 'Please send one photo per text. No photo has been saved yet.',
      }
    }
    const path = ctx.inbound.mediaUrls[0]
    const pool = ref ? checks.filter((check) => check.reference === ref) : checks
    if (!pool.length) {
      return {
        kind: 'clarify',
        reply: 'That Home Check is not available for this phone number or has expired. Ask the landlord for a new check.',
      }
    }
    const numbered = parseHomeCheckPhotoReply(body)
    const check = pool.length === 1 ? pool[0] : pickHomeCheckForPhoto(pool)
    if (check) {
      return {
        kind: 'photo',
        check,
        slot: numbered?.slot ?? null,
        path,
        conversationId: ctx.conversationId,
      }
    }
    const choices = homeCheckPhotoChoices(pool)
    return {
      kind: 'hold_photo',
      conversationId: ctx.conversationId,
      pending: {
        step: 'check',
        path,
        at: new Date().toISOString(),
        checkIds: choices.map((choice) => choice.id),
      },
      reply: homeCheckPhotoChoiceQuestion(
        choices.map((choice) => ({ location: checkLocation(choice), created_at: choice.created_at })),
      ),
    }
  }
  const candidates = ref ? checks.filter((check) => check.reference === ref) : checks
  if (candidates.length !== 1) {
    return {
      kind: 'clarify',
      reply: `Please name the exact Home Check. ${
        checks.map((check) => `${check.reference}: ${checkLocation(check)}`).join('; ')
      }.`,
    }
  }
  const check = candidates[0]
  if (landlord && /^OK(?:\s+HC-[A-F0-9]{12})?$/i.test(body)) return { kind: 'confirm', check }
  const answers = body.match(
    /^HC-[A-F0-9]{12}\s+ANSWERS\s+(YES|NO)(?:\s*\|\s*([^|]*))?(?:\s*\|\s*([^|]*))?(?:\s*\|\s*([^|]*))?$/i,
  )
  if (answers) {
    return {
      kind: 'answers',
      check,
      answers: {
        warningSigns: answers[1].toUpperCase() === 'YES',
        lastService: answers[2]?.trim() || '',
        lastFilterChange: answers[3]?.trim() || '',
        warningDetails: answers[4]?.trim() || '',
      },
    }
  }
  return {
    kind: 'clarify',
    reply: `For ${checkLocation(check)}, text the photo itself and Ulo will file it. No photo has been saved yet.`,
  }
}

/** Open checks assigned to this sender on this Ulo line. Confirming looks at completed results. */
async function openChecksForSender(
  ctx: InboundSmsHandlerContext,
  confirming: boolean,
): Promise<HomeCheckRow[]> {
  let query = ctx.supabase.from('home_checks').select('*').eq('landlord_id', ctx.landlordId).eq(
    'ulo_number',
    normalizeSmsPhone(ctx.inbound.to),
  )
  query = confirming
    ? query.eq('status', 'completed').not('summary_sent_at', 'is', null)
    : query.eq('recipient_phone', normalizeSmsPhone(ctx.inbound.from)).in('status', [
      'collecting',
      'completed',
    ]).gt('expires_at', new Date().toISOString())
  return requireData(await query) as HomeCheckRow[]
}

async function answerPendingPhoto(
  ctx: InboundSmsHandlerContext,
  pending: PendingHomeCheckPhoto,
  body: string,
): Promise<HomeCheckSmsAction> {
  const open = await openChecksForSender(ctx, false)
  if (pending.step === 'check') {
    const index = parseHomeCheckPhotoChoice(body, pending.checkIds.length)
    const check = index == null ? null : open.find((row) => row.id === pending.checkIds[index])
    if (index == null) {
      return {
        kind: 'clarify',
        reply: `Please reply with a number from 1 to ${pending.checkIds.length}.`,
      }
    }
    if (!check) {
      return { kind: 'clarify', reply: 'That home check has ended. Ask the landlord for a new one.' }
    }
    return { kind: 'photo', check, slot: null, path: pending.path, conversationId: ctx.conversationId }
  }
  const n = Number(body)
  if (!(n >= 1 && n <= HOME_CHECK_PHOTOS.length)) {
    return { kind: 'clarify', reply: 'Please reply with a number from 1 to 4.' }
  }
  const check = open.find((row) => row.id === pending.checkId)
  if (!check) {
    return { kind: 'clarify', reply: 'That home check has ended. Ask the landlord for a new one.' }
  }
  return {
    kind: 'photo',
    check,
    slot: HOME_CHECK_PHOTOS[n - 1].slot,
    path: pending.path,
    conversationId: ctx.conversationId,
  }
}

export async function actHomeCheckSms(
  db: SupabaseClient,
  landlordId: string,
  action: HomeCheckSmsAction,
) {
  if (action.kind === 'clarify') return { reply: action.reply }
  if (action.kind === 'hold_photo') {
    await writePendingPhoto(db, action.conversationId, action.pending)
    return { reply: action.reply }
  }
  if (action.kind === 'guide') {
    const { actHomeCheckGuide } = await import('./guideAct.ts')
    const guided = await actHomeCheckGuide(db, landlordId, action)
    return { reply: guided.reply }
  }
  if (action.kind === 'start') {
    return {
      reply:
        'Upload equipment photos from Property Intelligence. Home Check links are no longer sent by text.',
    }
  }
  if (action.kind === 'confirm') {
    await confirmHomeCheck(db, action.check.id, landlordId)
    return {
      runId: action.check.workflow_run_id,
      reply: `Confirmed the water heater and heating system records for ${
        checkLocation(action.check)
      }. Their ages remain estimates.`,
    }
  }
  if (action.kind === 'answers') {
    await saveHomeCheckAnswers(db, action.check, action.answers)
    return {
      runId: action.check.workflow_run_id,
      reply: `Saved the observations for ${checkLocation(action.check)}.${
        action.answers.warningSigns
          ? ' A linked follow-up is waiting for landlord review. If you smell gas, see smoke, or feel unsafe, leave the area and contact emergency services or your utility.'
          : ''
      }`,
    }
  }
  // Media was already fetched through the authenticated provider and rehosted
  // by inbound_processor. Never fetch a user-provided URL here.
  const blob = requireData(await db.storage.from('maintenance-uploads').download(action.path))
  if (
    blob.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)
  ) return { reply: 'Please send a JPEG, PNG or WebP photo under 10 MB.' }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const location = checkLocation(action.check)
  const { data: photoRows } = await db.from('home_check_photos').select('slot').eq(
    'check_id',
    action.check.id,
  )
  const filled = (photoRows ?? []).map((row: { slot: string }) => String(row.slot))
  let slot = action.slot
  if (!slot) {
    const placed = homeCheckSlotFromReading(await readHomeCheckPhoto(bytes, blob.type), filled)
    if (!placed.slot) {
      if (action.conversationId) {
        await writePendingPhoto(db, action.conversationId, {
          step: 'kind',
          path: action.path,
          at: new Date().toISOString(),
          checkId: action.check.id,
        })
      }
      return { reply: homeCheckPhotoKindQuestion(location, placed.reason === 'not_equipment') }
    }
    slot = placed.slot
  }
  const progress = await uploadHomeCheckPhoto(db, action.check, {
    slot,
    bytes,
    contentType: blob.type,
    source: 'photo_text',
  })
  if (action.conversationId) await writePendingPhoto(db, action.conversationId, null)
  const saved = `Saved as ${homeCheckSlotName(slot)} for ${location}.`
  const retake = progress.feedback.filter((feedback) =>
    feedback.retakeMessage &&
    feedback.slot.startsWith(slot!.startsWith('water_heater') ? 'water_heater' : 'heating')
  )
  if (retake.length) {
    return {
      runId: action.check.workflow_run_id,
      reply: `${saved} ${retake[0].retakeMessage} Please send a closer photo of ${
        homeCheckSlotName(slot.startsWith('water_heater') ? 'water_heater_label' : 'heating_label')
      }.`,
    }
  }
  const next = nextHomeCheckSlot([...filled, slot])
  return {
    runId: action.check.workflow_run_id,
    reply: next
      ? `${saved} Next, send a photo of ${homeCheckSlotName(next)}.`
      : `${saved} All four photos are in. If you noticed leaks, odd noises or smells, reply: ${action.check.reference} ANSWERS YES | last service | last filter change | details (or ${action.check.reference} ANSWERS NO).`,
  }
}

export async function runHomeCheckReminder(db: SupabaseClient, check: HomeCheckRow) {
  const claimed = requireData(
    await db.from('home_checks').update({ reminder_claimed_at: new Date().toISOString() }).eq(
      'id',
      check.id,
    ).eq('status', 'collecting').is('reminder_claimed_at', null).select('id'),
  )
  if (!claimed.length) return
  // Capture links are retired. Claiming the reminder stops the cron from
  // texting the old page. Existing checks stay in Property Intelligence.
  await checked(
    db.from('home_checks').update({ reminder_sent_at: new Date().toISOString() }).eq(
      'id',
      check.id,
    ),
  )
}
