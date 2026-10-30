import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  beginHomeCheckPhotoVisit,
  homeCheckVendorAcceptanceSms,
  homeCheckVisitPhotoDue,
  homeCheckVisitPhotoSms,
  homeCheckWorkflowStep,
  mightBeHomeCheckVisitReply,
  readHomeCheckVisit,
  reduceHomeCheckVisit,
  type HomeCheckVisit,
  type HomeCheckVisitEvent,
} from '../../../../shared/homeCheckVisit.ts'
import { updateWorkflowRun } from '../engine/workflowRuns.ts'
import { recordActivityLog } from '../graph/recordActivityLog.ts'
import { normalizeSmsPhone } from '../sms/inbound_db.ts'
import type { InboundSmsHandlerContext } from '../sms/inboundHandlerTypes.ts'
import { parseAvailabilityResolved } from '../vendor_availability_parse.ts'
import {
  checkLocation,
  checked,
  homeCheckEvent,
  loadHomeCheck,
  sendHomeCheckSms,
  type HomeCheckRow,
} from './service.ts'

type VisitCheck = HomeCheckRow & { visit?: unknown }

function placeOf(check: HomeCheckRow): string {
  return checkLocation(check).replace(/ · /g, ', ')
}

async function vendorName(db: SupabaseClient, check: HomeCheckRow): Promise<string> {
  if (!check.vendor_id) return 'The vendor'
  const { data } = await db.from('vendors').select('name').eq('id', check.vendor_id).eq(
    'landlord_id',
    check.landlord_id,
  ).maybeSingle()
  const name = typeof data?.name === 'string' ? data.name.trim() : ''
  return name || 'The vendor'
}

async function landlordPhone(db: SupabaseClient, landlordId: string): Promise<string | null> {
  const { data } = await db.from('landlords').select('phone').eq('id', landlordId).maybeSingle()
  return typeof data?.phone === 'string' && data.phone.trim() ? data.phone : null
}

async function companyName(db: SupabaseClient, landlordId: string): Promise<string> {
  const { data } = await db.from('landlords').select('name').eq('id', landlordId).maybeSingle()
  return typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : 'your property team'
}

async function resolveTenant(db: SupabaseClient, check: HomeCheckRow): Promise<{
  id: string
  phone: string
} | null> {
  let query = db.from('occupancy').select('resident_id').eq('landlord_id', check.landlord_id).eq(
    'property_id',
    check.property_id,
  ).eq('status', 'active')
  if (check.unit_id) query = query.eq('unit_id', check.unit_id)
  const { data, error } = await query
  if (error || !Array.isArray(data) || data.length !== 1) return null
  const residentId = typeof data[0]?.resident_id === 'string' ? data[0].resident_id : ''
  if (!residentId) return null
  const resident = await db.from('users').select('id, phone, sms_consent_status').eq('id', residentId).eq(
    'landlord_id',
    check.landlord_id,
  ).maybeSingle()
  if (resident.error || resident.data?.sms_consent_status === 'opted_out') return null
  const phone = typeof resident.data?.phone === 'string' ? resident.data.phone.trim() : ''
  if (!phone) return null
  return { id: residentId, phone }
}

async function persistVisit(
  db: SupabaseClient,
  check: HomeCheckRow,
  visit: HomeCheckVisit,
  close: boolean,
) {
  await checked(db.from('home_checks').update({
    visit,
    ...(close ? { status: 'expired' } : {}),
  }).eq('id', check.id).eq('landlord_id', check.landlord_id))
  await updateWorkflowRun(db, check.workflow_run_id, close
    ? {
      status: 'cancelled',
      currentStep: homeCheckWorkflowStep('declined'),
      completedAt: new Date().toISOString(),
    }
    : { currentStep: homeCheckWorkflowStep(visit.phase) }).catch(() => null)
  if (close && check.ticket_id) {
    await db.from('maintenance_requests').update({
      vendor_work_status: 'declined',
      assigned_vendor_id: null,
    }).eq('id', check.ticket_id).eq('landlord_id', check.landlord_id)
  }
}

function parseWindow(body: string, now: Date): { window: string; visitAt: string } | null {
  const parsed = parseAvailabilityResolved(body, now)
  if (!parsed?.scheduledAt) return null
  const at = Date.parse(parsed.scheduledAt)
  if (!Number.isFinite(at) || at <= now.getTime()) return null
  if (at > now.getTime() + 7 * 24 * 60 * 60 * 1000) return null
  return {
    window: parsed.windowLabel?.trim() || body.trim(),
    visitAt: new Date(at).toISOString(),
  }
}

export function homeCheckVisitEventFromReply(input: {
  visit: HomeCheckVisit
  sender: 'vendor' | 'tenant'
  body: string
  replyId: string
  at: string
  now: Date
  tenantReady: boolean
}): HomeCheckVisitEvent | 'clarify_acceptance' | null {
  const text = input.body.trim()
  const yes = /^yes\b/i.test(text)
  const no = /^no\b/i.test(text)
  if (input.visit.phase === 'awaiting_acceptance') {
    if (input.sender !== 'vendor') return null
    if (yes) {
      return {
        type: 'vendor_yes',
        at: input.at,
        replyId: input.replyId,
        tenantReady: input.tenantReady,
      }
    }
    if (no) return { type: 'vendor_no', at: input.at, replyId: input.replyId }
    return 'clarify_acceptance'
  }
  if (input.visit.phase !== 'scheduling') return null
  const window = parseWindow(text, input.now)
  if (input.sender === 'tenant') {
    if (yes && !window && input.visit.awaiting === 'tenant_confirm') {
      return { type: 'tenant_yes', at: input.at, replyId: input.replyId }
    }
    if (no && !window && input.visit.awaiting === 'tenant_confirm') {
      return { type: 'tenant_no', at: input.at, replyId: input.replyId }
    }
    if (window) {
      return {
        type: 'tenant_window',
        at: input.at,
        replyId: input.replyId,
        window: window.window,
        visitAt: window.visitAt,
      }
    }
    return null
  }
  if (yes && input.visit.awaiting === 'vendor_confirm') {
    return {
      type: 'vendor_yes',
      at: input.at,
      replyId: input.replyId,
      tenantReady: input.tenantReady,
    }
  }
  if (window && (input.visit.awaiting === 'vendor_window' || input.visit.awaiting === 'vendor_confirm')) {
    return {
      type: 'vendor_window',
      at: input.at,
      replyId: input.replyId,
      window: window.window,
      visitAt: window.visitAt,
    }
  }
  if (input.visit.awaiting === 'vendor_window' || input.visit.awaiting === 'vendor_confirm') {
    return { type: 'vendor_unparsed', replyId: input.replyId }
  }
  return null
}

async function checksForVisit(ctx: InboundSmsHandlerContext): Promise<VisitCheck[]> {
  const { data } = await ctx.supabase.from('home_checks').select('*').eq(
    'landlord_id',
    ctx.landlordId,
  ).eq('status', 'collecting').gt('expires_at', new Date().toISOString())
  return (Array.isArray(data) ? data : []) as VisitCheck[]
}

export async function prepareHomeCheckVisitReply(
  ctx: InboundSmsHandlerContext,
): Promise<
  | { kind: 'visit_reply'; check: HomeCheckRow; event: HomeCheckVisitEvent }
  | { kind: 'clarify'; reply: string }
  | null
> {
  const body = ctx.inbound.body.trim()
  if (ctx.inbound.mediaUrls.length || !mightBeHomeCheckVisitReply(body)) return null
  const from = normalizeSmsPhone(ctx.inbound.from)
  const rows = await checksForVisit(ctx)
  const vendorCheck = rows.find((row) => {
    const visit = readHomeCheckVisit(row.visit)
    return visit && row.recipient_phone && normalizeSmsPhone(row.recipient_phone) === from
  })
  const tenantCheck = vendorCheck ? null : rows.find((row) => {
    const visit = readHomeCheckVisit(row.visit)
    return visit?.tenantPhone && normalizeSmsPhone(visit.tenantPhone) === from
  })
  const check = vendorCheck || tenantCheck
  const visit = check ? readHomeCheckVisit(check.visit) : null
  if (!check || !visit) return null
  if (visit.phase === 'scheduled') {
    return {
      kind: 'clarify',
      reply: visit.confirmedWindow
        ? `This Home Check is already set for ${visit.confirmedWindow}. Photo instructions arrive when it’s time for the visit.`
        : 'This Home Check visit is already set. Photo instructions arrive when it’s time for the visit.',
    }
  }
  const tenant = visit.phase === 'awaiting_acceptance' ? await resolveTenant(ctx.supabase, check) : null
  const event = homeCheckVisitEventFromReply({
    visit,
    sender: vendorCheck ? 'vendor' : 'tenant',
    body,
    replyId: ctx.messageId,
    at: new Date().toISOString(),
    now: new Date(),
    tenantReady: Boolean(tenant) || Boolean(visit.tenantReady),
  })
  if (event === 'clarify_acceptance') {
    return {
      kind: 'clarify',
      reply: 'Reply YES to accept the Home Check or NO if you can’t take it. Photo instructions come after the visit time is confirmed.',
    }
  }
  if (!event) return null
  if (tenant && !visit.tenantPhone) {
    check.visit = { ...visit, tenantPhone: normalizeSmsPhone(tenant.phone), tenantReady: true }
  }
  return { kind: 'visit_reply', check, event }
}

async function sendVisitMessage(
  db: SupabaseClient,
  check: VisitCheck,
  to: 'vendor' | 'tenant' | 'landlord',
  body: string,
) {
  const visit = readHomeCheckVisit(check.visit)
  const phone = to === 'vendor'
    ? check.recipient_phone
    : to === 'tenant'
    ? visit?.tenantPhone || null
    : await landlordPhone(db, check.landlord_id)
  if (!phone) return
  const residentId = to === 'tenant' ? check.resident_id : null
  await sendHomeCheckSms(db, check, phone, body, residentId)
}

export async function applyHomeCheckVisitReply(
  db: SupabaseClient,
  check: VisitCheck,
  event: HomeCheckVisitEvent,
): Promise<string> {
  const visit = readHomeCheckVisit(check.visit)
  if (!visit) return 'This Home Check is not waiting for a visit reply.'
  const name = await vendorName(db, check)
  const result = reduceHomeCheckVisit({
    visit: { ...visit, ...(readHomeCheckVisit(check.visit) ?? {}) },
    event,
    location: placeOf(check),
    vendorName: name,
  })
  const storedTenant = readHomeCheckVisit(check.visit)
  result.visit.tenantPhone = result.visit.tenantPhone || storedTenant?.tenantPhone || null
  await persistVisit(db, check, result.visit, result.close)
  const nextCheck = { ...check, visit: result.visit }
  const sender = event.type.startsWith('tenant') ? 'tenant' : 'vendor'
  for (const message of result.messages) {
    if (message.to === sender) continue
    try {
      await sendVisitMessage(db, nextCheck, message.to, message.body)
    } catch (error) {
      console.error(
        '[home-check] visit text failed',
        message.to,
        error instanceof Error ? error.message : 'failed',
      )
    }
  }
  const logged = result.close
    ? 'home_check.vendor_declined'
    : result.visit.phase === 'scheduled'
    ? 'home_check.visit_scheduled'
    : result.visit.phase === 'scheduling' && visit.phase === 'awaiting_acceptance'
    ? 'home_check.vendor_accepted'
    : null
  if (logged) {
    await recordActivityLog(db, {
      landlordId: check.landlord_id,
      eventType: logged,
      source: 'sms',
      actorType: logged === 'home_check.vendor_declined' ? 'vendor' : 'system',
      propertyId: check.property_id,
      unitId: check.unit_id,
      vendorId: check.vendor_id,
      residentId: check.resident_id,
      maintenanceRequestId: check.ticket_id,
      workflowRunId: check.workflow_run_id,
      workflowTemplateId: 'home_check',
      metadata: {
        message: logged === 'home_check.vendor_declined'
          ? `${name} can’t take this home check. Choose another vendor.`
          : logged === 'home_check.vendor_accepted'
          ? `${name} accepted the home check. Ulo is scheduling the visit.`
          : `The home check at ${placeOf(check)} is set for ${result.visit.confirmedWindow}.`,
      },
    }).catch(() => null)
  }
  await homeCheckEvent(db, check, result.close ? 'vendor_declined' : 'visit_reply', {
    phase: result.visit.phase,
  }).catch(() => null)
  return result.messages.find((message) => message.to === sender)?.body || ''
}

export async function sendHomeCheckVendorAcceptance(
  db: SupabaseClient,
  check: VisitCheck,
): Promise<{ deliveryError: string | null; alreadySent: boolean }> {
  const existing = readHomeCheckVisit(check.visit)
  if (existing?.inviteSentAt) return { deliveryError: null, alreadySent: true }
  const location = placeOf(check)
  const destination = check.recipient_phone
  if (!destination) return { deliveryError: 'The vendor needs a phone number.', alreadySent: false }
  const tenant = await resolveTenant(db, check)
  await updateWorkflowRun(db, check.workflow_run_id, {
    currentStep: homeCheckWorkflowStep('awaiting_acceptance'),
  }).catch(() => null)
  const sentAt = new Date().toISOString()
  try {
    await sendHomeCheckSms(
      db,
      check,
      destination,
      homeCheckVendorAcceptanceSms(location),
    )
  } catch (error) {
    return {
      deliveryError: error instanceof Error ? error.message : 'Text delivery failed',
      alreadySent: false,
    }
  }
  const visit: HomeCheckVisit = {
    phase: 'awaiting_acceptance',
    inviteSentAt: sentAt,
    tenantPhone: tenant ? normalizeSmsPhone(tenant.phone) : null,
    tenantReady: Boolean(tenant),
  }
  await persistVisit(db, { ...check, resident_id: tenant?.id ?? check.resident_id }, visit, false)
  if (tenant) {
    await db.from('home_checks').update({ resident_id: tenant.id }).eq('id', check.id).eq(
      'landlord_id',
      check.landlord_id,
    )
  }
  return { deliveryError: null, alreadySent: false }
}

export async function startDueHomeCheckPhotoPrompts(
  db: SupabaseClient,
  landlordId: string,
  now = new Date(),
): Promise<number> {
  const { data } = await db.from('home_checks').select('*').eq('landlord_id', landlordId).eq(
    'status',
    'collecting',
  ).gt('expires_at', now.toISOString())
  let started = 0
  for (const row of (Array.isArray(data) ? data : []) as VisitCheck[]) {
    const visit = readHomeCheckVisit(row.visit)
    if (!homeCheckVisitPhotoDue(visit, now.getTime()) || !visit) continue
    const claimed = beginHomeCheckPhotoVisit(visit, now.toISOString())
    const { data: saved } = await db.from('home_checks').update({ visit: claimed }).eq('id', row.id).eq(
      'landlord_id',
      landlordId,
    ).eq('status', 'collecting').select('id')
    if (!saved || (Array.isArray(saved) && saved.length === 0)) continue
    try {
      if (!row.recipient_phone) throw new Error('Vendor phone missing')
      const company = await companyName(db, landlordId)
      await sendHomeCheckSms(db, row, row.recipient_phone, homeCheckVisitPhotoSms({
        location: placeOf(row),
        company,
        filled: [],
      }))
      await updateWorkflowRun(db, row.workflow_run_id, {
        currentStep: homeCheckWorkflowStep('in_progress'),
      }).catch(() => null)
      started += 1
    } catch (error) {
      await db.from('home_checks').update({ visit }).eq('id', row.id).eq('landlord_id', landlordId)
      console.error(
        '[home-check] photo prompt failed',
        row.id,
        error instanceof Error ? error.message : 'failed',
      )
    }
  }
  return started
}
