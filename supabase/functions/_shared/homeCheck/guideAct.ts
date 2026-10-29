import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { nearestHomeCheckVendors } from '../../../../shared/homeCheck.ts'
import { recordActivityLog } from '../graph/recordActivityLog.ts'
import { findOrCreateConversation, normalizeSmsPhone } from '../sms/inbound_db.ts'
import { sendInboundAutoReply } from '../sms/inboundReply.ts'
import { resolveOutboundLandlordSmsLine } from '../sms/landlordSmsOnboarding.ts'
import { createHomeCheck, requireData } from './service.ts'
import {
  type HomeCheckGuideCatalog,
  type HomeCheckGuideEffect,
  type HomeCheckGuideState,
  readHomeCheckGuide,
  reduceHomeCheckGuide,
  tickHomeCheckGuide,
} from './guide.ts'

class HomeCheckDeliveryError extends Error {
  constructor(message: string, readonly clearGuide: boolean) {
    super(message)
  }
}

function requireCaptureDelivery(result: { deliveryError: string | null }, recipient: string) {
  if (result.deliveryError) {
    // A check already exists. End this guide so another short reply cannot
    // create a second check while the first is awaiting delivery recovery.
    throw new HomeCheckDeliveryError(
      `The Home Check was created, but Ulo could not send the photo instructions to ${recipient}. Delivery is not confirmed. Please contact your property team before starting another check.`,
      true,
    )
  }
}

async function loadIntake(db: SupabaseClient, conversationId: string) {
  const { data } = await db.from('sms_conversations').select('intake_state').eq('id', conversationId)
    .maybeSingle()
  return data?.intake_state && typeof data.intake_state === 'object'
    ? { ...(data.intake_state as Record<string, unknown>) }
    : {}
}

async function writeGuide(
  db: SupabaseClient,
  conversationId: string,
  guide: HomeCheckGuideState | null,
) {
  const intake = await loadIntake(db, conversationId)
  if (guide) intake.home_check_guide = guide
  else delete intake.home_check_guide
  await db.from('sms_conversations').update({ intake_state: intake }).eq('id', conversationId)
}

async function clearOtherGuides(
  db: SupabaseClient,
  landlordId: string,
  keepConversationId: string,
) {
  const { data } = await db.from('sms_conversations').select('id, intake_state').eq(
    'landlord_id',
    landlordId,
  )
  for (const row of data ?? []) {
    if (row.id === keepConversationId || !readHomeCheckGuide(row.intake_state)) continue
    await writeGuide(db, row.id, null)
  }
}

async function loadCatalog(
  db: SupabaseClient,
  landlordId: string,
  scope: { propertyId?: string; unitId?: string | null },
): Promise<HomeCheckGuideCatalog & { landlordPhone: string | null }> {
  const properties = requireData<Array<{
    id: string
    name: string | null
    street_address: string | null
    property_type: string | null
  }>>(
    await db.from('properties').select('id, name, street_address, property_type').eq(
      'landlord_id',
      landlordId,
    ),
  )
  const units = requireData<Array<{ id: string; property_id: string; unit_label: string | null }>>(
    await db.from('units').select('id, property_id, unit_label').eq('landlord_id', landlordId),
  )
  const landlord = requireData<{ name: string | null; phone: string | null; time_zone: string | null }>(
    await db.from('landlords').select('name, phone, time_zone').eq('id', landlordId).single(),
  )
  const propertyId = scope.propertyId
    ?? (scope.unitId ? units.find((unit) => unit.id === scope.unitId)?.property_id : undefined)
    ?? (properties.length === 1 ? properties[0].id : undefined)
  let vendors: HomeCheckGuideCatalog['vendors'] = []
  if (propertyId) {
    const property = requireData<{ latitude: number | null; longitude: number | null }>(
      await db.from('properties').select('latitude, longitude').eq('landlord_id', landlordId).eq(
        'id',
        propertyId,
      ).single(),
    )
    const rows = requireData<Array<{
      id: string
      name: string | null
      phone: string | null
      latitude: number | null
      longitude: number | null
      roster_status: string | null
      active: boolean | null
    }>>(
      await db.from('vendors').select('id, name, phone, latitude, longitude, roster_status, active')
        .eq('landlord_id', landlordId).eq('active', true),
    ).filter((vendor) => vendor.phone && !['suspended', 'banned'].includes(vendor.roster_status || ''))
    const ranked = nearestHomeCheckVendors(property, rows)
    vendors = rows.map((vendor) => ({
      id: vendor.id,
      name: vendor.name?.trim() || 'Contractor',
      distanceKm: ranked.find((row) => row.id === vendor.id)?.distanceKm ?? null,
    }))
  }
  let tenant: HomeCheckGuideCatalog['tenant'] = null
  if (scope.unitId) {
    const occupancy = requireData<Array<{ resident_id: string }>>(
      await db.from('occupancy').select('resident_id').eq('landlord_id', landlordId).eq(
        'unit_id',
        scope.unitId,
      ).eq('status', 'active'),
    )
    if (occupancy.length === 1) {
      const resident = requireData<{
        full_name: string | null
        phone: string | null
        sms_consent_status: string | null
      }>(
        await db.from('users').select('full_name, phone, sms_consent_status').eq(
          'id',
          occupancy[0].resident_id,
        ).eq('landlord_id', landlordId).single(),
      )
      tenant = {
        name: resident.full_name?.trim() || 'the tenant',
        phone: resident.phone,
        optedOut: resident.sms_consent_status === 'opted_out',
      }
    }
  }
  return {
    properties: properties.map((property) => ({
      id: property.id,
      label: property.street_address?.trim() || property.name?.trim() || 'Property',
      name: property.name,
      propertyType: property.property_type,
      units: units.filter((unit) => unit.property_id === property.id).map((unit) => ({
        id: unit.id,
        label: unit.unit_label?.trim() || 'Unit',
      })),
    })),
    vendors,
    tenant,
    companyName: landlord.name,
    timeZone: landlord.time_zone,
    landlordPhone: landlord.phone,
  }
}

async function textPhone(
  db: SupabaseClient,
  input: {
    landlordId: string
    to: string
    body: string
    unitId?: string | null
    identityType: 'resident' | 'landlord' | 'vendor'
  },
) {
  const line = await resolveOutboundLandlordSmsLine(db, input.landlordId)
  if (!line?.phone) return null
  const phone = normalizeSmsPhone(input.to)
  const { conversationId } = await findOrCreateConversation(db, {
    landlordId: input.landlordId,
    smsNumberId: line.id,
    externalPhone: phone,
    identity: {
      id: '',
      landlord_id: input.landlordId,
      resident_id: null,
      vendor_id: null,
      unit_id: input.unitId ?? null,
      phone_number: phone,
      identity_type: input.identityType,
      verified: true,
    },
  })
  const sent = await sendInboundAutoReply(db, {
    landlordId: input.landlordId,
    conversationId,
    fromNumber: line.phone,
    toNumber: phone,
    body: input.body,
    provider: 'twilio',
    source: 'home_check',
  })
  if (!sent.ok) return null
  return conversationId
}

async function applyEffects(
  db: SupabaseClient,
  landlordId: string,
  state: HomeCheckGuideState | null,
  effects: HomeCheckGuideEffect[],
  landlordPhone: string | null,
) {
  let next = state
  for (const effect of effects) {
    if (effect.type === 'text_tenant') {
      const conversationId = await textPhone(db, {
        landlordId,
        to: effect.phone,
        body: effect.body,
        unitId: next?.unitId,
        identityType: 'resident',
      })
      if (!conversationId) {
        throw new HomeCheckDeliveryError(
          'Ulo could not text the tenant to arrange the visit. No contractor link was sent. Please try the visit time again or reply CANCEL.',
          false,
        )
      }
      if (conversationId && next) {
        next = { ...next, tenantConversationId: conversationId }
        const intake = await loadIntake(db, conversationId)
        intake.home_check_tenant_reply = { at: new Date().toISOString() }
        await db.from('sms_conversations').update({ intake_state: intake }).eq('id', conversationId)
      }
      await recordActivityLog(db, {
        landlordId,
        eventType: 'home_check.tenant_time_requested',
        source: 'sms',
        actorType: 'system',
        propertyId: next?.propertyId,
        unitId: next?.unitId,
        metadata: { message: 'Asked the tenant for a time before texting the contractor.' },
      }).catch(() => undefined)
    }
    if (effect.type === 'start_tenant') {
      const result = await createHomeCheck(db, {
        landlordId,
        propertyId: effect.propertyId,
        unitId: effect.unitId,
        role: 'tenant',
        authorizedBy: 'sms_guide',
        sendSms: true,
      })
      requireCaptureDelivery(result, 'your tenant')
    }
    if (effect.type === 'start_self') {
      const result = await createHomeCheck(db, {
        landlordId,
        propertyId: effect.propertyId,
        unitId: effect.unitId,
        role: 'landlord',
        authorizedBy: 'sms_guide',
        sendSms: true,
        selfCapturePhone: landlordPhone ?? undefined,
      })
      requireCaptureDelivery(result, 'your phone')
    }
    if (effect.type === 'send_contractor') {
      const result = await createHomeCheck(db, {
        landlordId,
        propertyId: effect.propertyId,
        unitId: effect.unitId,
        role: 'contractor',
        vendorId: effect.vendorId,
        jobWindowEnd: effect.windowEnd,
        authorizedBy: 'sms_guide',
        sendSms: true,
      })
      requireCaptureDelivery(result, 'the contractor')
      if (effect.tenantBody && effect.tenantPhone) {
        await textPhone(db, {
          landlordId,
          to: effect.tenantPhone,
          body: effect.tenantBody,
          unitId: effect.unitId,
          identityType: 'resident',
        })
      }
      if (effect.landlordBody && landlordPhone) {
        await textPhone(db, {
          landlordId,
          to: landlordPhone,
          body: effect.landlordBody,
          identityType: 'landlord',
        })
      }
      await recordActivityLog(db, {
        landlordId,
        eventType: 'home_check.contractor_link_sent',
        source: 'sms',
        actorType: 'system',
        propertyId: effect.propertyId,
        unitId: effect.unitId,
        vendorId: effect.vendorId,
        metadata: {
          message: 'Sent the contractor the equipment-check link after a visit time was set.',
        },
      }).catch(() => undefined)
    }
    if (effect.type === 'cancel' && effect.checkId) {
      await db.from('home_checks').update({ status: 'expired' }).eq('id', effect.checkId).eq(
        'landlord_id',
        landlordId,
      )
    }
  }
  return next
}

async function runHomeCheckGuide(
  db: SupabaseClient,
  landlordId: string,
  input: {
    body: string
    conversationId: string
    sender: 'landlord' | 'tenant'
    initiatorPhone: string
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  const intake = await loadIntake(db, input.conversationId)
  let state = readHomeCheckGuide(intake)
  const priorTenantConversation = state?.tenantConversationId ?? null
  const scope = { propertyId: state?.propertyId, unitId: state?.unitId }
  const catalog = await loadCatalog(db, landlordId, scope)
  const clock = input.sender === 'tenant'
    ? { state, replies: [] as string[], effects: [] as HomeCheckGuideEffect[] }
    : tickHomeCheckGuide(state, catalog, now)
  state = await applyEffects(
    db,
    landlordId,
    clock.state,
    clock.effects,
    input.initiatorPhone || catalog.landlordPhone,
  )
  const turn = reduceHomeCheckGuide({
    state,
    body: input.body,
    catalog: await loadCatalog(db, landlordId, {
      propertyId: state?.propertyId,
      unitId: state?.unitId,
    }),
    now,
    sender: input.sender,
  })
  const saved = await applyEffects(
    db,
    landlordId,
    turn.state,
    turn.effects,
    input.initiatorPhone || catalog.landlordPhone,
  )
  if (priorTenantConversation && saved?.tenantConversationId !== priorTenantConversation) {
    const tenantIntake = await loadIntake(db, priorTenantConversation)
    delete tenantIntake.home_check_tenant_reply
    await db.from('sms_conversations').update({ intake_state: tenantIntake }).eq(
      'id',
      priorTenantConversation,
    )
  }
  await writeGuide(db, input.conversationId, saved)
  if (saved) await clearOtherGuides(db, landlordId, input.conversationId)
  const replies = turn.replies.length ? turn.replies : clock.replies
  return { reply: replies.filter(Boolean).join('\n\n') }
}

export async function actHomeCheckGuide(
  db: SupabaseClient,
  landlordId: string,
  input: Parameters<typeof runHomeCheckGuide>[2],
) {
  try {
    return await runHomeCheckGuide(db, landlordId, input)
  } catch (error) {
    if (!(error instanceof HomeCheckDeliveryError)) throw error
    if (error.clearGuide) await writeGuide(db, input.conversationId, null)
    return { reply: error.message }
  }
}

export async function sweepHomeCheckGuides(
  db: SupabaseClient,
  landlordId: string,
  now = new Date(),
) {
  const { data } = await db.from('sms_conversations').select('id, intake_state').eq(
    'landlord_id',
    landlordId,
  )
  let reminders = 0
  let handoffs = 0
  for (const row of data ?? []) {
    const guide = readHomeCheckGuide(row.intake_state)
    if (!guide || guide.step !== 'awaiting_tenant') continue
    const catalog = await loadCatalog(db, landlordId, {
      propertyId: guide.propertyId,
      unitId: guide.unitId,
    })
    const turn = tickHomeCheckGuide(guide, catalog, now)
    if (!turn.effects.length && turn.state === guide && !turn.replies.length) continue
    if (turn.replies.length && catalog.landlordPhone) {
      await textPhone(db, {
        landlordId,
        to: catalog.landlordPhone,
        body: turn.replies.join('\n\n'),
        identityType: 'landlord',
      })
      handoffs += 1
    }
    await applyEffects(db, landlordId, turn.state, turn.effects, catalog.landlordPhone)
    if (turn.effects.some((effect) => effect.type === 'text_tenant')) reminders += 1
    await writeGuide(db, row.id, turn.state)
  }
  return { reminders, handoffs }
}
