import { analyzeHomeCheckEquipmentPair } from './equipmentPair.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  HOME_CHECK_PHOTOS,
  type HomeCheckAnswers,
  type HomeCheckAsset,
  homeCheckAsset,
  homeCheckReference,
  type HomeCheckRole,
  type HomeCheckSlot,
  homeCheckSummary,
} from '../../../../shared/homeCheck.ts'
import {
  generateInspectionCaptureToken,
  hashInspectionCaptureToken,
  timingSafeEqualHex,
} from '../inspectionCapture/token.ts'
import {
  inspectionBytesToBase64,
  processInspectionUpload,
} from '../vision/ingestInspectionUpload.ts'
import type { ApplianceVisionResult } from '../vision/types.ts'
import { logPipelineStageEvent, updateWorkflowRun } from '../engine/workflowRuns.ts'
import { startMaintenanceRequestWorkflow } from '../engine/startMaintenanceRequestWorkflow.ts'
import { uloAppOrigin } from '../uloAppUrl.ts'
import { findOrCreateConversation, normalizeSmsPhone } from '../sms/inbound_db.ts'
import { sendInboundAutoReply } from '../sms/inboundReply.ts'
import { resolveOutboundLandlordSmsLine } from '../sms/landlordSmsOnboarding.ts'

export type HomeCheckRow = {
  id: string
  reference: string
  landlord_id: string
  property_id: string
  unit_id: string | null
  ticket_id: string
  workflow_run_id: string
  assessment_id: string
  role: HomeCheckRole
  recipient_phone: string | null
  resident_id: string | null
  vendor_id: string | null
  ulo_number: string | null
  property_label: string
  unit_label: string | null
  token_hash: string
  status: string
  expires_at: string
  sent_at: string | null
  opened_at: string | null
  completed_at: string | null
  confirmed_at: string | null
  summary_sent_at: string | null
  labels_readable: boolean
  answers: HomeCheckAnswers
  issue_ticket_id: string | null
  detected_warning: string | null
  created_at: string
}

type PropertyRow = {
  id: string
  name: string
  street_address: string | null
  city: string | null
  state: string | null
}
type ResidentRow = { id: string; phone: string | null; sms_consent_status: string | null }
type LandlordRow = { name: string; phone: string | null }
type VendorRow = { id: string; phone: string | null; active: boolean; roster_status: string | null }

export function requireData<T>(
  result: { data: T | null; error: { message: string } | null },
): NonNullable<T> {
  if (result.error) throw new Error(result.error.message)
  if (result.data == null) throw new Error('Record not found')
  return result.data as NonNullable<T>
}
export async function checked(result: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await result
  if (error) throw new Error(error.message)
}
export async function homeCheckEvent(
  db: SupabaseClient,
  check: HomeCheckRow,
  event: string,
  metadata = {},
) {
  await checked(
    db.from('home_check_events').insert({
      check_id: check.id,
      role: check.role,
      event_type: event,
      metadata,
    }),
  )
}
export const checkLocation = (check: Pick<HomeCheckRow, 'property_label' | 'unit_label'>) =>
  `${check.property_label}${check.unit_label ? ` / ${check.unit_label}` : ''}`

export async function sendHomeCheckSms(
  db: SupabaseClient,
  check: HomeCheckRow,
  to: string,
  body: string,
  residentId: string | null = null,
) {
  if (!check.ulo_number) {
    throw new Error('This account needs an active Ulo SMS number before sending texts.')
  }
  if (residentId) {
    const resident = requireData<Pick<ResidentRow, 'sms_consent_status'>>(
      await db.from('users').select('sms_consent_status').eq('id', residentId).eq(
        'landlord_id',
        check.landlord_id,
      ).single(),
    )
    if (resident.sms_consent_status === 'opted_out') {
      throw new Error('This tenant has opted out of text messages. Use another capture role.')
    }
  }
  const line = await resolveOutboundLandlordSmsLine(db, check.landlord_id)
  if (!line || line.phone !== check.ulo_number) {
    throw new Error('The Home Check’s Ulo SMS line is no longer active.')
  }
  const phone = normalizeSmsPhone(to)
  const { conversationId } = await findOrCreateConversation(db, {
    landlordId: check.landlord_id,
    smsNumberId: line.id,
    externalPhone: phone,
    identity: {
      id: '',
      landlord_id: check.landlord_id,
      resident_id: residentId,
      vendor_id: check.vendor_id,
      unit_id: check.unit_id,
      phone_number: phone,
      identity_type: residentId
        ? 'resident'
        : phone === check.recipient_phone && check.role === 'contractor'
        ? 'vendor'
        : 'landlord',
      verified: true,
    },
  })
  const result = await sendInboundAutoReply(db, {
    landlordId: check.landlord_id,
    conversationId,
    fromNumber: check.ulo_number,
    toNumber: phone,
    body,
    provider: 'twilio',
    source: 'home_check',
  })
  if (!result.ok) throw new Error(result.error)
}

export async function loadHomeCheck(
  db: SupabaseClient,
  id: string,
  landlordId?: string,
): Promise<HomeCheckRow> {
  let query = db.from('home_checks').select('*').eq('id', id)
  if (landlordId) query = query.eq('landlord_id', landlordId)
  return requireData(await query.single()) as HomeCheckRow
}
export async function authorizeHomeCheckLink(db: SupabaseClient, id: string, token: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id) || token.length < 32 || token.length > 128) {
    throw new Error('This Home Check link is invalid or has expired.')
  }
  const { data } = await db.from('home_checks').select('*').eq('id', id).maybeSingle()
  const match = timingSafeEqualHex(
    data?.token_hash || '0'.repeat(64),
    await hashInspectionCaptureToken(token),
  )
  if (
    !data || !match || Date.parse(data.expires_at) <= Date.now() ||
    ['confirmed', 'expired'].includes(data.status)
  ) throw new Error('This Home Check link is invalid or has expired.')
  return data as HomeCheckRow
}
export async function publicHomeCheck(db: SupabaseClient, check: HomeCheckRow) {
  const photos = requireData(
    await db.from('home_check_photos').select('slot, inspection_photo_id').eq('check_id', check.id),
  )
  const photoIds = photos.map((photo) => photo.inspection_photo_id)
  const rows = photoIds.length ? requireData(await db.from('property_inspection_photos').select('id, status, ai_result').in('id', photoIds)) : []
  // Upload capability returns only scope, progress and retake feedback. No photos, asset records,
  // tenant details, other checks, or storage download links are exposed.
  return {
    id: check.id,
    reference: check.reference,
    role: check.role,
    location: checkLocation(check),
    expiresAt: check.expires_at,
    slots: photos.map((photo) => photo.slot),
    feedback: photos.filter((photo) => photo.slot.endsWith('_label')).map((photo) => {
      const row = rows.find((row) => row.id === photo.inspection_photo_id)
      const quality = (row?.ai_result as ApplianceVisionResult | null)?.labelReadability
      return { slot: photo.slot, state: row?.status || 'queued', retakeMessage: quality?.retakeRequested ? quality.retakeMessage : null, uncertainCharacters: quality?.uncertainCharacters || [], formatWarnings: quality?.formatWarnings || [] }
    }),
    status: check.status,
  }
}

export async function createHomeCheck(db: SupabaseClient, input: {
  landlordId: string
  propertyId: string
  unitId?: string | null
  role: HomeCheckRole
  authorizedBy: string
  vendorId?: string | null
  jobWindowEnd?: string | null
  sendSms?: boolean
}) {
  const property = requireData<PropertyRow>(
    await db.from('properties').select('id, name, street_address, city, state').eq(
      'id',
      input.propertyId,
    ).eq('landlord_id', input.landlordId).single(),
  )
  let unit: { id: string; unit_label: string } | null = null
  if (input.unitId) {
    unit = requireData(
      await db.from('units').select('id, unit_label').eq('id', input.unitId).eq(
        'property_id',
        property.id,
      ).eq('landlord_id', input.landlordId).single(),
    )
  }
  if (input.role === 'tenant' && !unit) {
    throw new Error('Select the tenant’s exact unit before asking them.')
  }
  const landlord = requireData<LandlordRow>(
    await db.from('landlords').select('name, phone').eq('id', input.landlordId).single(),
  )
  let recipientPhone: string | null = input.role === 'landlord' ? landlord.phone : null
  let residentId: string | null = null
  if (input.role === 'tenant') {
    const occupancy = requireData(
      await db.from('occupancy').select('resident_id').eq('landlord_id', input.landlordId).eq(
        'unit_id',
        unit!.id,
      ).eq('status', 'active'),
    )
    if (occupancy.length !== 1) {
      throw new Error(
        'This unit needs one clearly identified active tenant. Resolve the occupancy before texting.',
      )
    }
    const resident = requireData<ResidentRow>(
      await db.from('users').select('id, phone, sms_consent_status').eq(
        'id',
        occupancy[0].resident_id,
      ).eq('landlord_id', input.landlordId).single(),
    )
    if (!resident.phone || resident.sms_consent_status === 'opted_out') {
      throw new Error(
        'The tenant has no usable SMS number or has opted out. Choose another capture role.',
      )
    }
    recipientPhone = resident.phone
    residentId = resident.id
  }
  if (input.role === 'contractor' && input.vendorId) {
    const vendor = requireData<VendorRow>(
      await db.from('vendors').select('id, phone, active, roster_status').eq('id', input.vendorId)
        .eq('landlord_id', input.landlordId).single(),
    )
    if (
      !vendor.active || ['suspended', 'banned'].includes(vendor.roster_status || '') ||
      !vendor.phone
    ) throw new Error('Choose an active contractor with a phone number.')
    recipientPhone = vendor.phone
  }
  if (input.sendSms && !recipientPhone && !landlord.phone) {
    throw new Error('Add a landlord phone number before texting a forwarding link.')
  }
  const start = Date.now()
  let expires = start + 7 * 86400000
  if (input.role === 'contractor') {
    const end = Date.parse(input.jobWindowEnd || '')
    if (!Number.isFinite(end) || end <= start || end > expires) {
      throw new Error('Set the contractor’s job window end within the next seven days.')
    }
    expires = end
  }
  const origin = new URL(uloAppOrigin())
  if (
    origin.protocol !== 'https:' ||
    !(origin.hostname === 'ulohome.io' || origin.hostname.endsWith('.ulohome.io'))
  ) throw new Error('APP_URL must use the branded HTTPS Ulo domain for Home Check links.')
  const line = await resolveOutboundLandlordSmsLine(db, input.landlordId)
  if (input.sendSms && !line?.phone) throw new Error('Configure an active Ulo SMS number first.')
  const recent = requireData(
    await db.from('home_checks').select('id').eq('landlord_id', input.landlordId).gte(
      'created_at',
      new Date(Date.now() - 3600000).toISOString(),
    ),
  )
  if (recent.length >= 20) {
    throw new Error('Too many Home Checks started this hour. Please try later.')
  }
  const id = crypto.randomUUID()
  const token = generateInspectionCaptureToken()
  const label = [
    property.name,
    property.street_address,
    [property.city, property.state].filter(Boolean).join(', '),
  ].filter(Boolean).join(' · ')
  await checked(db.rpc('create_home_check', {
    p_input: {
      id,
      reference: homeCheckReference(id),
      landlord_id: input.landlordId,
      property_id: property.id,
      unit_id: unit?.id || null,
      unit_label: unit?.unit_label || null,
      role: input.role,
      recipient_phone: recipientPhone ? normalizeSmsPhone(recipientPhone) : null,
      resident_id: residentId,
      vendor_id: input.role === 'contractor' ? input.vendorId || null : null,
      ulo_number: line?.phone || null,
      property_label: label,
      token_hash: await hashInspectionCaptureToken(token),
      expires_at: new Date(expires).toISOString(),
      authorized_by: input.authorizedBy,
    },
  }))
  const check = await loadHomeCheck(db, id)
  await logPipelineStageEvent(db, {
    runId: check.workflow_run_id,
    stage: 'trigger',
    message: 'Landlord authorized an observation-only Home Check.',
    metadata: {
      trigger_type: 'home_check',
      property_id: check.property_id,
      unit_id: check.unit_id,
      role: check.role,
    },
  })
  const link = `${origin.origin}/c/${id}#${token}`
  await homeCheckEvent(db, check, 'authorized', { authorized_by: input.authorizedBy })
  const instructions = `${
    HOME_CHECK_PHOTOS.map((photo, i) => `${i + 1}. ${photo.title}`).join('\n')
  }\n5. Leaks, odd noises or smells? Yes / no.\n6. Last service and last filter change, if known.\nObservation only. Don’t open covers or touch equipment.\nFor text photos: send one photo per message with ${check.reference} and its number (1–4). Otherwise use the link.\n${link}`
  let deliveryError: string | null = null
  if (input.sendSms) {
    const destination = recipientPhone || landlord.phone
    if (!destination) {
      throw new Error('Add a landlord phone number before texting a forwarding link.')
    }
    const greeting = input.role === 'tenant'
      ? `Hi, this is Ulo for ${
        landlord.name || 'your landlord'
      }. Please take 4 quick photos of the water heater and furnace for ${
        checkLocation(check)
      }. Takes 2 minutes:`
      : input.role === 'contractor'
      ? `${recipientPhone ? 'Home Check' : 'Forward this contractor link'} for ${
        checkLocation(check)
      }. Link expires at the end of the job window.`
      : `Your Home Check for ${checkLocation(check)}.`
    try {
      await sendHomeCheckSms(db, check, destination, `${greeting}\n${instructions}`, residentId)
      await checked(
        db.from('home_checks').update({ sent_at: new Date().toISOString() }).eq('id', id),
      )
      await homeCheckEvent(db, check, 'link_sent')
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : 'Text delivery failed'
      await homeCheckEvent(db, check, 'delivery_failed')
    }
  } else {
    // The dashboard delivers the landlord's capture link directly.
    await checked(db.from('home_checks').update({ sent_at: new Date().toISOString() }).eq('id', id))
    await homeCheckEvent(db, check, 'link_provided')
  }
  return { check: await loadHomeCheck(db, id), link, deliveryError }
}

export async function rebuildHomeCheckAssets(
  db: SupabaseClient,
  check: HomeCheckRow,
  attempt = 0,
): Promise<HomeCheckAsset[]> {
  const photos = requireData(
    await db.from('home_check_photos').select('slot, inspection_photo_id, storage_path').eq(
      'check_id',
      check.id,
    ),
  )
  const ids = photos.map((photo) => photo.inspection_photo_id)
  const rows = ids.length
    ? requireData(await db.from('property_inspection_photos').select('id, ai_result').in('id', ids))
    : []
  const find = (slot: HomeCheckSlot) => {
    const photo = photos.find((row) => row.slot === slot)
    return {
      id: photo?.inspection_photo_id || null,
      path: photo?.storage_path || null,
      result: (rows.find((row) => row.id === photo?.inspection_photo_id)?.ai_result || null) as
        | ApplianceVisionResult
        | null,
    }
  }
  const assets: HomeCheckAsset[] = []
  const payloads: Record<string, unknown>[] = []
  for (const system of ['water_heater', 'heating'] as const) {
    const label = find(system === 'water_heater' ? 'water_heater_label' : 'heating_label')
    const whole = find(system === 'water_heater' ? 'water_heater_whole' : 'heating_whole')
    const asset = homeCheckAsset({
      system,
      role: check.role,
      label: label.result,
      whole: whole.result,
      labelPhotoId: label.id,
      wholePhotoId: whole.id,
      answers: check.answers,
    })
    assets.push(asset)
    const registryType = system === 'water_heater'
      ? 'water_heater'
      : (whole.result?.category === 'boiler' || label.result?.category === 'boiler')
      ? 'boiler'
      : 'hvac'
    payloads.push({
      system,
      asset,
      registryType,
      title: system === 'water_heater'
        ? 'Water heater'
        : registryType === 'boiler'
        ? 'Boiler'
        : 'Furnace / heating system',
      conditionRating: whole.result?.condition.rating || null,
      sourcePhotoUrl: label.path || whole.path,
      photoId: label.id || whole.id,
    })
  }
  const persisted = requireData(
    await db.rpc('persist_home_check_assets', {
      p_check_id: check.id,
      p_photo_ids: ids,
      p_assets: payloads,
    }),
  )
  if (!persisted) {
    if (attempt >= 3) throw new Error('Photos are still syncing. Please refresh this Home Check.')
    return rebuildHomeCheckAssets(db, await loadHomeCheck(db, check.id), attempt + 1)
  }
  return assets
}

export async function notifyHomeCheckResult(
  db: SupabaseClient,
  check: HomeCheckRow,
  assets: HomeCheckAsset[],
) {
  if (!check.completed_at || check.summary_sent_at || check.answers.warningSigns == null) return
  const { data: landlord } = await db.from('landlords').select('phone').eq('id', check.landlord_id)
    .single()
  if (!landlord?.phone || !check.ulo_number) return
  await sendHomeCheckSms(
    db,
    check,
    landlord.phone,
    `${checkLocation(check)} — ${homeCheckSummary(assets, check.answers)}${
      check.detected_warning ? ' A photo warning needs landlord review.' : ''
    }\nReply OK ${check.reference} to confirm. Reply OK alone only when you have one pending Home Check.`,
  )
  await checked(
    db.from('home_checks').update({ summary_sent_at: new Date().toISOString() }).eq('id', check.id),
  )
}

export async function uploadHomeCheckPhoto(
  db: SupabaseClient,
  check: HomeCheckRow,
  input: {
    slot: HomeCheckSlot
    bytes: Uint8Array
    contentType: string
    source: 'link' | 'photo_text'
  },
) {
  if (check.confirmed_at || Date.parse(check.expires_at) <= Date.now()) {
    throw new Error('This Home Check has ended.')
  }
  const photo = await processInspectionUpload({
    supabase: db,
    landlordId: check.landlord_id,
    propertyId: check.property_id,
    building: check.property_label,
    assessmentId: check.assessment_id,
    bytes: input.bytes,
    imageBase64: inspectionBytesToBase64(input.bytes),
    contentType: input.contentType,
    fileName: `${input.slot}.jpg`,
    hintCategory: input.slot.startsWith('water_heater') ? 'water_heater' : 'hvac',
    mode: 'photo',
    autoConfirm: false,
    deferPhotoAnalysis: true,
  })
  await checked(
    db.rpc('record_home_check_photo', {
      p_check_id: check.id,
      p_slot: input.slot,
      p_photo_id: photo.photo.id,
      p_storage_path: photo.photo.storage_path,
      p_source: input.source,
    }),
  )
  const result = await analyzeHomeCheckEquipmentPair(db, check.id, input.slot)
  const current = await loadHomeCheck(db, check.id)
  const assets = await rebuildHomeCheckAssets(db, current)
  const warnings = result?.deficiencies.filter((item) =>
    item.severity === 'safety_hazard' ||
    (item.severity === 'repair_recommended' &&
      /leak|gas|smoke|burn|scorch/i.test(item.description))
  ) || []
  if (warnings.length) {
    await checked(
      db.from('home_checks').update({
        detected_warning: warnings.map((item) => item.description).join('; ').slice(0, 2000),
      }).eq('id', check.id),
    )
    await openHomeCheckFollowUp(db, await loadHomeCheck(db, check.id))
  }
  await notifyHomeCheckResult(db, await loadHomeCheck(db, check.id), assets)
  return publicHomeCheck(db, current)
}

export async function saveHomeCheckAnswers(
  db: SupabaseClient,
  check: HomeCheckRow,
  answers: HomeCheckAnswers,
) {
  if (check.confirmed_at || Date.parse(check.expires_at) <= Date.now()) {
    throw new Error('This Home Check has ended.')
  }
  await checked(
    db.from('home_checks').update({ answers }).eq('id', check.id).is('confirmed_at', null),
  )
  const current = await loadHomeCheck(db, check.id)
  await openHomeCheckFollowUp(db, current)
  await homeCheckEvent(db, current, 'answers_saved')
  const assets = await rebuildHomeCheckAssets(db, current)
  await notifyHomeCheckResult(db, current, assets)
}

async function openHomeCheckFollowUp(db: SupabaseClient, check: HomeCheckRow) {
  const { data: issueId, error } = await db.rpc('report_home_check_issue', { p_check_id: check.id })
  if (error) throw new Error(error.message)
  if (issueId) {
    await startMaintenanceRequestWorkflow(db, {
      landlordId: check.landlord_id,
      ticketId: issueId,
      propertyId: check.property_id,
      unitId: check.unit_id,
      unitLabel: check.unit_label,
      residentId: check.resident_id,
      triggerType: 'home_check',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      issueCategory: 'home_check_warning',
      severity: 'medium',
      source: 'web_form',
    })
  }
}

export async function confirmHomeCheck(db: SupabaseClient, id: string, landlordId: string, labelCorrections: Array<{ assetId: string; modelNumber?: string; serialNumber?: string }> = []) {
  await checked(db.rpc('confirm_home_check_label_review', { p_check_id: id, p_landlord_id: landlordId, p_corrections: labelCorrections }))
  const check = await loadHomeCheck(db, id, landlordId)
  await updateWorkflowRun(db, check.workflow_run_id, {
    metadata: { landlord_confirmed: true },
    pipelineStage: 'log',
    eventStep: 'landlord_confirmed',
    eventMessage: 'Landlord confirmed the Home Check asset record.',
  })
}
