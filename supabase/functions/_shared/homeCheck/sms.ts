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
} from '../../../../shared/homeCheck.ts'
import { normalizeUsStateCode, vendorServiceStateCodes } from '../vendorServiceArea.ts'
function homeCheckGuidePending(intake: unknown): boolean {
  if (!intake || typeof intake !== 'object') return false
  const guide = (intake as { home_check_guide?: { step?: unknown } }).home_check_guide
  return Boolean(guide && typeof guide === 'object' && typeof guide.step === 'string')
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
    slot: NonNullable<ReturnType<typeof parseHomeCheckPhotoReply>>['slot']
    path: string
  }
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
  if (
    !ctx.inbound.mediaUrls.length && !/^OK(?:\s+HC-[A-F0-9]{12})?$/i.test(body) &&
    !/^HC-[A-F0-9]{12}/i.test(body)
  ) return null
  let query = ctx.supabase.from('home_checks').select('*').eq('landlord_id', ctx.landlordId).eq(
    'ulo_number',
    normalizeSmsPhone(ctx.inbound.to),
  )
  query = landlord && /^OK/i.test(body)
    ? query.eq('status', 'completed').not('summary_sent_at', 'is', null)
    : query.eq('recipient_phone', normalizeSmsPhone(ctx.inbound.from)).in('status', [
      'collecting',
      'completed',
    ]).gt('expires_at', new Date().toISOString())
  const checks = requireData(await query) as HomeCheckRow[]
  if (!checks.length) {
    return /^HC-/i.test(body)
      ? {
        kind: 'clarify',
        reply:
          'That Home Check is not available for this phone number or has expired. Use your scoped link or ask the landlord for a new check.',
      }
      : null
  }
  const ref = body.match(/HC-[A-F0-9]{12}/i)?.[0].toUpperCase()
  const candidates = ref ? checks.filter((check) => check.reference === ref) : checks
  if (candidates.length !== 1) {
    return {
      kind: 'clarify',
      reply: `Please name the exact Home Check; no photo has been assigned. ${
        checks.map((check) => `${check.reference}: ${checkLocation(check)}`).join('; ')
      }. For photos, include the reference and photo number (1–4).`,
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
  const photo = parseHomeCheckPhotoReply(body)
  if (!photo || ctx.inbound.mediaUrls.length !== 1 || /^https?:/i.test(ctx.inbound.mediaUrls[0])) {
    return {
      kind: 'clarify',
      reply: `For ${
        checkLocation(check)
      }, text one photo with ${check.reference} and its number: 1 water heater label, 2 whole water heater, 3 heating label, 4 whole furnace/boiler. Or use the capture link. No photo has been assigned yet.`,
    }
  }
  return { kind: 'photo', check, slot: photo.slot, path: ctx.inbound.mediaUrls[0] }
}

export async function actHomeCheckSms(
  db: SupabaseClient,
  landlordId: string,
  action: HomeCheckSmsAction,
) {
  if (action.kind === 'clarify') return { reply: action.reply }
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
  ) return { reply: 'Please use a JPEG, PNG or WebP photo under 10 MB, or the capture link.' }
  const progress = await uploadHomeCheckPhoto(db, action.check, {
    slot: action.slot,
    bytes: new Uint8Array(await blob.arrayBuffer()),
    contentType: blob.type,
    source: 'photo_text',
  })
  const retake = progress.feedback.filter((feedback) =>
    feedback.retakeMessage &&
    feedback.slot.startsWith(action.slot.startsWith('water_heater') ? 'water_heater' : 'heating')
  )
  if (retake.length) {
    return {
      runId: action.check.workflow_run_id,
      reply: `Saved the photo for ${checkLocation(action.check)}. ${
        retake[0].retakeMessage
      } Retake photo ${
        action.slot.startsWith('water_heater')
          ? '1 (water heater label)'
          : '3 (furnace or boiler label)'
      } with ${action.check.reference}. Uncertain numbers remain unknown.`,
    }
  }
  return {
    runId: action.check.workflow_run_id,
    reply: `Saved the photo to ${
      checkLocation(action.check)
    } (${action.check.reference}). Report leaks, odd noises or smells with: ${action.check.reference} ANSWERS YES or NO | last service | last filter change | details. Leave unknown dates blank.`,
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
