import { HOME_CHECK_OBSERVATION_PROMPT, homeCheckObservationAcknowledgement, homeCheckConfirmationSms } from './smsCopy.ts'
import { captureContextAction, readCaptureContext } from "./captureContext.ts"
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
  parseHomeCheckPhotoChoice,
  type HomeCheckSlot,
} from '../../../../shared/homeCheck.ts'
import { isVendorMatchableForDispatch } from '../vendor_assignment.ts'
import { normalizeUsStateCode, vendorServiceStateCodes } from '../vendorServiceArea.ts'
import {
  homeCheckVisitAllowsPhotos,
  homeCheckVisitPhotoSms,
  readHomeCheckVisit,
  type HomeCheckVisitEvent,
} from '../../../../shared/homeCheckVisit.ts'
import { applyHomeCheckVisitReply, prepareHomeCheckVisitReply } from './visitAct.ts'
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
const PENDING_PHOTO_TTL_MS = 30 * 60000

function readPendingPhoto(intake: unknown): PendingHomeCheckPhoto | null {
  if (!intake || typeof intake !== 'object') return null
  const pending = (intake as Record<string, unknown>)[PENDING_PHOTO_KEY] as
    | PendingHomeCheckPhoto
    | undefined
  if (!pending || typeof pending.path !== 'string' || typeof pending.at !== 'string') return null
  const age = Date.now() - Date.parse(pending.at)
  if (!Number.isFinite(age) || age < 0 || age > PENDING_PHOTO_TTL_MS) return null
  return pending
}

async function writePendingPhoto(db: SupabaseClient, landlordId: string, conversationId: string,
 pending: PendingHomeCheckPhoto | null, expectedPath?: string): Promise<boolean> {
 const { data, error } = await db.rpc('hold_home_check_sms_photo', { p_landlord_id: landlordId,
   p_conversation_id: conversationId, p_pending: pending, p_expected_path: expectedPath ?? null })
 if (error) throw new Error('Could not safely hold the Home Check photo')
 return data === true
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
  loadHomeCheck,
  pendingHomeCheckSystems,
  notifyHomeCheckResult,
  rebuildHomeCheckAssets,
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
    expectedVersion?: string
  }
  | { kind: 'hold_photo'; conversationId: string; pending: PendingHomeCheckPhoto; reply: string }
  | { kind: 'cancel_photo'; conversationId: string }
  | { kind: 'confirm'; check: HomeCheckRow }
  | { kind: 'results'; check: HomeCheckRow }
  | { kind: 'answers'; check: HomeCheckRow; answers: HomeCheckAnswers }
  | { kind: 'clarify'; reply: string }
  | {
    kind: 'guide'
    body: string
    conversationId: string
    initiatorPhone: string
    sender: 'landlord' | 'tenant'
  }
  | { kind: 'visit_reply'; check: HomeCheckRow; event: HomeCheckVisitEvent }

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
  const roster = requireData(
    await db.from('vendors').select(
      'id, name, phone, latitude, longitude, roster_status, state, preferred_emergency, active, onboarding_overridden_at',
    ).eq('landlord_id', landlordId).eq('active', true),
  )
    .filter((vendor) => vendor.phone && !['suspended', 'banned'].includes(vendor.roster_status))
  const ids = roster.map((vendor) => vendor.id)
  const verificationByVendor = new Map<string, {
    serviceArea: unknown
    licenseState: string | null
    status: string | null
    availability: string | null
  }>()
  if (ids.length) {
    const { data } = await db.from('vendor_verifications').select(
      'vendor_id, service_area, license_state, status, availability, updated_at',
    ).eq('landlord_id', landlordId).in('vendor_id', ids).order('updated_at', { ascending: false })
    for (const row of data ?? []) {
      if (!row.vendor_id || verificationByVendor.has(row.vendor_id)) continue
      verificationByVendor.set(row.vendor_id, {
        serviceArea: row.service_area,
        licenseState: typeof row.license_state === 'string' ? row.license_state : null,
        status: typeof row.status === 'string' ? row.status : null,
        availability: typeof row.availability === 'string' ? row.availability : null,
      })
    }
  }
  const vendors = roster.filter((vendor) => {
    const verification = verificationByVendor.get(vendor.id)
    return isVendorMatchableForDispatch({
      verificationStatus: verification?.status ?? null,
      vendorActive: vendor.active !== false,
      availability: verification?.availability ?? null,
      rosterStatus: typeof vendor.roster_status === 'string' ? vendor.roster_status : null,
      onboardingOverriddenAt: typeof vendor.onboarding_overridden_at === 'string'
        ? vendor.onboarding_overridden_at
        : null,
    })
  })
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
  if (!ctx.inbound.mediaUrls.length && /^(?:\d{1,2}|cancel)$/i.test(body)) {
    const { data } = await ctx.supabase.from('sms_conversations').select('intake_state').eq(
      'id',
      ctx.conversationId,
    ).maybeSingle()
    const pending = readPendingPhoto(data?.intake_state)
    if (pending) return /^cancel$/i.test(body) ? { kind: 'cancel_photo', conversationId: ctx.conversationId } : await answerPendingPhoto(ctx, pending, body)
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
  const visitReply = await prepareHomeCheckVisitReply(ctx)
  if (visitReply) return visitReply
  const hasMedia = ctx.inbound.mediaUrls.length > 0
  if (!hasMedia && landlord && /^results$/i.test(body)) {
    const context = await readCaptureContext(ctx.supabase, ctx.landlordId, ctx.conversationId, { allowExpiredForReply: true })
    const checks = context ? await openChecksForSender(ctx, false) : []
    const check = checks.find(check => check.id === context?.checkId && check.completed_at)
    return check ? { kind: 'results', check } : { kind: 'clarify', reply: 'No completed Home Check results are selected in this conversation. Open the property in Property Intelligence to review its Home Check.' }
  }
  if (!hasMedia && /^(?:yes|no|none|unsure)\b/i.test(body)) {
    const context = await readCaptureContext(ctx.supabase, ctx.landlordId, ctx.conversationId, { allowExpiredForReply: true })
    if (context && context.slot === null) {
      const assigned = await openChecksForSender(ctx, false)
      const selected = assigned.find(check => check.id === context.checkId && check.completed_at && Date.parse(check.expires_at) > Date.now() && !check.confirmed_at && check.answers?.warningSigns == null && !check.answers?.observationsConfirmed)
      if (selected) {
        const { data: prompts } = await ctx.supabase.from('sms_messages').select('body')
          .eq('conversation_id', ctx.conversationId).eq('landlord_id', ctx.landlordId)
          .eq('direction', 'outbound').order('created_at', { ascending: false }).limit(1)
        const latest = String(prompts?.[0]?.body ?? '')
        // Do not capture a YES/NO meant for a different workflow's newer ask.
        if (/Did you notice leaks|Reply YES followed by what you noticed|Any leaks, unusual noises or smells\?/i.test(latest)) {
          if (/^unsure[.!]?$/i.test(body)) return { kind: 'answers', check: selected, answers: { ...selected.answers, observationsConfirmed: true, warningSigns: null, warningDetails: '' } }
          if (/^(?:no|none)[.!]?$/i.test(body)) return { kind: 'answers', check: selected,
            answers: { ...selected.answers, observationsConfirmed: true, warningSigns: false, warningDetails: '' } }
          const details = body.replace(/^yes\b[,:.!\s]*/i, '').trim()
          if (/^yes\b/i.test(body) && details && details.length <= 800) return { kind: 'answers', check: selected,
            answers: { ...selected.answers, observationsConfirmed: true, warningSigns: true, warningDetails: details } }
          return { kind: 'clarify', reply: `${HOME_CHECK_OBSERVATION_PROMPT} For example: YES water is leaking at the base.` }
        }
      }
    }
  }
  if (
    !hasMedia && !/^OK(?:\s+HC-[A-F0-9]{12})?$/i.test(body) &&
    !/^HC-[A-F0-9]{12}/i.test(body)
  ) return null
  const checks = await openChecksForSender(ctx, landlord && /^OK/i.test(body) && !hasMedia)
  if (!checks.length) {
    if (landlord && !hasMedia && /^OK$/i.test(body)) {
      const selected = await readCaptureContext(ctx.supabase, ctx.landlordId, ctx.conversationId, { allowExpiredForReply: true })
      if (selected) {
        const { data: confirmed } = await ctx.supabase.from('home_checks').select('*')
          .eq('id', selected.checkId).eq('landlord_id', ctx.landlordId)
          .eq('recipient_phone', normalizeSmsPhone(ctx.inbound.from))
          .eq('ulo_number', normalizeSmsPhone(ctx.inbound.to)).eq('status', 'confirmed').maybeSingle()
        if (confirmed?.confirmed_at) {
          const { data: latest } = await ctx.supabase.from('sms_messages').select('body')
            .eq('conversation_id', ctx.conversationId).eq('landlord_id', ctx.landlordId)
            .eq('direction', 'outbound').order('created_at', { ascending: false }).limit(1)
          if (/^(?:Home Check confirmed for |Your Home Check records are saved for )/i.test(String(latest?.[0]?.body ?? ''))) {
            return { kind: 'confirm', check: confirmed as HomeCheckRow }
          }
        }
      }
    }
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
    const thread = await ctx.supabase.from('sms_conversations').select('intake_state').eq('landlord_id',ctx.landlordId).eq('id',ctx.conversationId).maybeSingle()
    if (readPendingPhoto(thread.data?.intake_state)) return { kind: 'clarify', reply: 'I am still holding your previous photo. Please answer its question before sending another.' }
    const path = ctx.inbound.mediaUrls[0]
    const pool = ref ? checks.filter((check) => check.reference === ref) : checks
    if (!pool.length) {
      return {
        kind: 'clarify',
        reply: 'That Home Check is not available for this phone number or has expired. Ask the landlord for a new check.',
      }
    }
    const numbered = parseHomeCheckPhotoReply(body)
    let context = await readCaptureContext(ctx.supabase, ctx.landlordId, ctx.conversationId, { allowExpiredForReply: true })
    if (context && Date.parse(context.expiresAt) <= Date.now()) {
      const remembered = pool.find(check => check.id === context!.checkId)
      // Preserve explicit selection, never infer a check from recency or a lone candidate.
      context = remembered && pool.length === 1 && context.slot && !numbered
        ? await captureContextAction(ctx.supabase, { action: 'bind', landlordId: ctx.landlordId,
          conversationId: ctx.conversationId, checkId: remembered.id, slot: context.slot, version: context.version })
        : null
    }
    const selected = context ? pool.find(check => check.id === context.checkId) : null
    const check = ref && pool.length === 1 ? pool[0] : selected
    if (check && !homeCheckVisitAllowsPhotos(readHomeCheckVisit(check.visit))) {
      return {
        kind: 'clarify',
        reply: 'Photo instructions arrive when it’s time for the visit. No photo has been saved yet.',
      }
    }
    if (check && (numbered?.slot || (selected && context?.slot))) {
      return { kind: 'photo', check, slot: numbered?.slot ?? context!.slot,
        path, conversationId: ctx.conversationId,
        expectedVersion: numbered ? undefined : context!.version }
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
  const confirmationContext = landlord && /^OK$/i.test(body)
    ? await readCaptureContext(ctx.supabase, ctx.landlordId, ctx.conversationId, { allowExpiredForReply: true }) : null
  const candidates = ref ? checks.filter((check) => check.reference === ref)
    : confirmationContext ? checks.filter(check => check.id === confirmationContext.checkId) : checks
  if (candidates.length !== 1) {
    return {
      kind: 'clarify',
      reply: 'More than one Home Check needs a reply. Open the correct property in Property Intelligence to review and confirm its Home Check.',
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
  if (action.kind === 'visit_reply') {
    const reply = await applyHomeCheckVisitReply(db, action.check, action.event)
    return { runId: action.check.workflow_run_id, reply: reply || undefined }
  }
  if (action.kind === 'cancel_photo') {
    const reset = await db.rpc('reset_home_check_sms_capture', { p_landlord_id: landlordId, p_conversation_id: action.conversationId })
    return { reply: !reset.error && reset.data === true ? 'Photo collection paused. The held photo was not attached. Text HOME CHECK when you want to resume.' : 'A photo is still processing. Please wait for its reply before pausing.' }
  }
  if (action.kind === 'hold_photo') {
    const held = await writePendingPhoto(db, landlordId, action.conversationId, action.pending)
    return { reply: held ? action.reply : 'I am still holding your previous photo. Please answer that photo’s question before sending another. This newer photo was not attached.' }
  }
  if (action.kind === 'guide') {
    if (parseHomeCheckCommand(action.body) || parseHomeCheckGuideStart(action.body)) {
      const reset = await db.rpc('reset_home_check_sms_capture', { p_landlord_id: landlordId, p_conversation_id: action.conversationId })
      if (reset.error || reset.data !== true) return { reply: 'A photo is still processing. Please wait for its reply before restarting the Home Check.' }
    }
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
  if (action.kind === 'results') {
    const sent = await notifyHomeCheckResult(db, action.check, await rebuildHomeCheckAssets(db, action.check), true)
    return { runId: action.check.workflow_run_id, reply: sent ? undefined : 'Your results could not be sent. Please review this Home Check in Property Intelligence.' }
  }
  if (action.kind === 'confirm') {
    if (action.check.confirmed_at) return { runId: action.check.workflow_run_id, reply: homeCheckConfirmationSms(checkLocation(action.check), action.check.detected_warning) }
    if (action.check.answers?.warningSigns == null && !action.check.answers?.observationsConfirmed) return { runId: action.check.workflow_run_id, reply: HOME_CHECK_OBSERVATION_PROMPT }
    try {
      if ((await pendingHomeCheckSystems(db, action.check.id)).length) return { runId: action.check.workflow_run_id, reply: 'Photo analysis is pending. Your Home Check is not confirmed yet. Text RESULTS to review the current results.' }
      await confirmHomeCheck(db, action.check.id, landlordId, [], { acknowledgeUnknownLabels: true })
    } catch (error) {
      // A network/logging failure after commit must not falsely say it failed.
      const latest = await loadHomeCheck(db, action.check.id, landlordId).catch(() => null)
      if (!latest?.confirmed_at) return { runId: action.check.workflow_run_id,
        reply: latest
          ? /flagged label|label.*review/i.test(String(error))
            ? 'A label still needs review in Property Intelligence. Your Home Check is not confirmed. Text RESULTS to review it.'
            : 'Your Home Check is not confirmed. Please retry OK, or review it in Property Intelligence.'
          : 'I could not verify confirmation. Please check this Home Check in Property Intelligence before retrying.',
      }
    }
    return {
      runId: action.check.workflow_run_id,
      reply: homeCheckConfirmationSms(checkLocation(action.check), action.check.detected_warning),
    }
  }
  if (action.kind === 'answers') {
    const previewShown = action.check.role === 'landlord' && Boolean(action.check.summary_sent_at)
    const sent = await saveHomeCheckAnswers(db, action.check, action.answers, { notifyResults: !previewShown })
    if (previewShown && sent) return { runId: action.check.workflow_run_id,
      reply: homeCheckObservationAcknowledgement(action.answers, (await pendingHomeCheckSystems(db, action.check.id)).length > 0, Boolean(action.check.detected_warning)),
    }
    return {
      runId: action.check.workflow_run_id,
      // The Results SMS is the acknowledgement; never send a second saved notice.
      reply: sent ? action.check.role === 'landlord' ? undefined : 'Thank you. Your observations were sent to your property team for review. No repairs are authorized.' : 'Your Home Check is not confirmed yet. Text RESULTS to review the results before confirming.',
    }
  }
  if (!action.conversationId) return { reply: 'Please send this photo in the same Home Check conversation.' }
  const proof = await db.from('sms_messages').select('id').eq('landlord_id', landlordId)
    .eq('conversation_id', action.conversationId).eq('direction', 'inbound')
    .eq('from_number', action.check.recipient_phone).eq('to_number', action.check.ulo_number)
    .contains('media_urls', [action.path]).limit(1)
  if (proof.error || !proof.data?.length) return { reply: 'I could not verify this photo in your Home Check conversation. No photo was attached.' }
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
  if (!slot || action.expectedVersion) {
    const placed = homeCheckSlotFromReading(await readHomeCheckPhoto(bytes, blob.type), filled)
    if (!placed.slot || (action.expectedVersion && placed.slot !== slot)) {
      if (action.conversationId) {
        const held = await writePendingPhoto(db, landlordId, action.conversationId, {
          step: 'kind',
          path: action.path,
          at: new Date().toISOString(),
          checkId: action.check.id,
        })
        if (!held) return { reply: 'I am still holding your previous photo. Please answer its question before sending another.' }
      }
      return { reply: homeCheckPhotoKindQuestion(location, 'reason' in placed && placed.reason === 'not_equipment') }
    }
    slot = placed.slot
  }
  const bound = action.expectedVersion
    ? { version: action.expectedVersion }
    : await captureContextAction(db, { action: 'bind', landlordId, conversationId: action.conversationId,
      checkId: action.check.id, slot })
  if (!bound) return { reply: 'Another photo is processing. Please wait for its reply before sending this one again. This photo was not attached.' }
  const claimed = await captureContextAction(db, { action: 'claim', landlordId, conversationId: action.conversationId,
    checkId: action.check.id, slot, version: bound.version, path: action.path })
  if (!claimed?.claim) return { reply: 'The Home Check step changed or another photo is processing. This photo was not attached. Please wait for Ulo’s next prompt before resending it.' }
  let progress: Awaited<ReturnType<typeof uploadHomeCheckPhoto>>
  try { progress = await uploadHomeCheckPhoto(db, action.check, {
    slot,
    bytes,
    contentType: blob.type,
    source: 'photo_text',
    capture: { conversationId: action.conversationId, claim: claimed.claim },
  }) } catch {
    await captureContextAction(db, { action: 'release', landlordId, conversationId: action.conversationId,
      checkId: action.check.id, claim: claimed.claim }).catch(() => null)
    return { reply: 'I could not finish verifying this photo. Please retry when the Home Check is available; I will not guess where it belongs.' }
  }
  if (action.conversationId) await writePendingPhoto(db, landlordId, action.conversationId, null, action.path)
  const savedReply = homeCheckVisitPhotoSms({ location, company: '', savedSlot: slot, filled })
  const retake = progress.feedback.filter((feedback) =>
    feedback.retakeMessage &&
    feedback.slot.startsWith(slot!.startsWith('water_heater') ? 'water_heater' : 'heating')
  )
  if (retake.length) {
    const water = slot.startsWith('water_heater')
    const mismatch = retake[0].retakeReason === 'system_mismatch'
    // A mismatch does not tell us which member of the pair is wrong. Ask for
    // the other view first, one step at a time; do not keep asking for the
    // photo that just arrived or claim that the equipment was verified.
    const retakeSlot = mismatch && slot.endsWith('_label')
      ? water ? 'water_heater_whole' : 'heating_whole'
      : water ? 'water_heater_label' : 'heating_label'
    const rebound = await captureContextAction(db, { action: 'bind', landlordId, conversationId: action.conversationId,
      checkId: action.check.id, slot: retakeSlot })
    return {
      runId: action.check.workflow_run_id,
      reply: !rebound
        ? `Your photo was received for ${location}, but verification needs another photo. Please wait before sending it; I could not prepare the next step.`
        : mismatch
        ? `Your photo was received for ${location}, but I could not verify these as ${water ? 'water heater' : 'furnace or boiler'} photos. They may show different equipment. Next, send a clear photo of ${homeCheckSlotName(retakeSlot)}. Keep both views of the same equipment.`
        : `Your photo was received for ${location}, but I could not read the ${water ? 'water heater' : 'furnace or boiler'} label clearly. Next, send a closer, well-lit photo of ${homeCheckSlotName(retakeSlot)}.`,
    }
  }
  return {
    runId: action.check.workflow_run_id,
    reply: savedReply,
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
