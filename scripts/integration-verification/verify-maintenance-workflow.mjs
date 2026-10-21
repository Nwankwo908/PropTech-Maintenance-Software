#!/usr/bin/env node
/**
 * P2 — Complete maintenance workflow on Limited Alpha 2 test fixtures only.
 *
 * - Seeds an integration-only resident + Active vendor (non-routable phones).
 * - Creates a ticket with a photo via service role (same tables as submit path).
 * - Assigns vendor, advances accept → in_progress → completed via status API/DB.
 * - Verifies LA2 can see the ticket; LA1 cannot.
 * - Retries an idempotent duplicate insert check.
 *
 * Does NOT SMS real customer phones. Outbound notify to non-routable numbers is
 * skipped; assignment is verified in records.
 *
 * Exit: 0 passed | 1 failed | 2 blocked
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OUT_DIR = resolve(ROOT, '.readiness/integration')
mkdirSync(OUT_DIR, { recursive: true })

const LA1 = 'de300000-0000-4000-8000-000000000003'
const LA2 = 'de300000-0000-4000-8000-000000000004'
const LA1_EMAIL = 'limitedalpha1@ulohome.io'
const LA2_EMAIL = 'limitedalpha2@ulohome.io'
/** Non-routable test phones — never real customer numbers. */
const INTEGRATION_RESIDENT_PHONE = '+15555550101'
const INTEGRATION_VENDOR_PHONE = '+15555550102'
const MARKER = 'ulo-integration-maintenance'

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value
  }
}

loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const LA1_PASSWORD = (process.env.INTEGRATION_LA1_PASSWORD || '').trim()
const LA2_PASSWORD = (process.env.INTEGRATION_LA2_PASSWORD || '').trim()

const results = []
function record(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
  console.log(`[${status}] ${id} — ${note}`)
}

function finish(overall, code) {
  const payload = {
    area: 'P2-maintenance-workflow',
    overall,
    finishedAt: new Date().toISOString(),
    environment: (() => {
      try {
        return new URL(SUPABASE_URL).host
      } catch {
        return 'invalid'
      }
    })(),
    results,
    boundaries: [
      'Uses LA2 designated test property + integration-only resident/vendor.',
      'Non-routable phones only — no SMS to real customers.',
      'Vendor receive verified via assignment records; carrier delivery not claimed.',
      'Status progression via DB/token path equivalent to vendor portal actions.',
    ],
  }
  writeFileSync(resolve(OUT_DIR, 'P2-maintenance-workflow.json'), JSON.stringify(payload, null, 2) + '\n')
  console.log(`\nOverall P2: ${overall} (exit ${code})`)
  process.exit(code)
}

/** Default: never sign in to Limited Alpha 1. Set INTEGRATION_INCLUDE_LA1=1 to enable cross-tenant login probe. */
const INCLUDE_LA1 = process.env.INTEGRATION_INCLUDE_LA1 === '1'

if (!SUPABASE_URL || !SERVICE || !ANON) {
  record('prereq', 'blocked', 'Need VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY')
  finish('blocked', 2)
}
if (!LA2_PASSWORD) {
  record('prereq', 'blocked', 'Need INTEGRATION_LA2_PASSWORD')
  finish('blocked', 2)
}
if (INCLUDE_LA1 && !LA1_PASSWORD) {
  record('prereq', 'blocked', 'INTEGRATION_INCLUDE_LA1=1 requires INTEGRATION_LA1_PASSWORD')
  finish('blocked', 2)
}

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function signIn(email, password) {
  const c = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(error?.message || 'no session')
  return c
}

// --- Ensure fixtures on LA2 ---
const { data: prop, error: propErr } = await admin
  .from('properties')
  .select('id,name,street_address')
  .eq('landlord_id', LA2)
  .limit(1)
  .maybeSingle()
if (propErr || !prop?.id) {
  record('fixture_property', 'failed', propErr?.message || 'LA2 has no property')
  finish('failed', 1)
}
record('fixture_property', 'passed', `Using LA2 property ${prop.name}`, { propertyId: prop.id })

let { data: unit } = await admin
  .from('units')
  .select('id,unit_label,property_id,status')
  .eq('landlord_id', LA2)
  .eq('property_id', prop.id)
  .limit(1)
  .maybeSingle()

if (!unit?.id) {
  const { data: created, error } = await admin
    .from('units')
    .insert({
      landlord_id: LA2,
      property_id: prop.id,
      unit_label: '1',
      status: 'active',
      city: 'Testville',
      state: 'NJ',
      zip_code: '07000',
    })
    .select('id,unit_label,property_id,status')
    .single()
  if (error) {
    record('fixture_unit', 'failed', error.message)
    finish('failed', 1)
  }
  unit = created
} else {
  await admin.from('units').update({ status: 'active' }).eq('id', unit.id)
}
record('fixture_unit', 'passed', `Unit ${unit.unit_label}`, { unitId: unit.id })

let { data: resident } = await admin
  .from('users')
  .select('id,full_name,phone,email,unit,landlord_id')
  .eq('landlord_id', LA2)
  .eq('phone', INTEGRATION_RESIDENT_PHONE)
  .maybeSingle()

if (!resident?.id) {
  const { data: created, error } = await admin
    .from('users')
    .insert({
      landlord_id: LA2,
      role: 'resident',
      full_name: 'Ulo Integration Tenant',
      name: 'Ulo Integration Tenant',
      email: 'ulo.integration.tenant@example.invalid',
      phone: INTEGRATION_RESIDENT_PHONE,
      unit: unit.unit_label === 'Home' ? '' : unit.unit_label,
      building: prop.name,
      activation_status: 'activated',
      is_active: true,
      status: 'active',
    })
    .select('id,full_name,phone,email,unit,landlord_id')
    .single()
  if (error) {
    record('fixture_resident', 'failed', error.message)
    finish('failed', 1)
  }
  resident = created
}
record('fixture_resident', 'passed', 'Integration resident ready', {
  residentId: resident.id,
  phone: INTEGRATION_RESIDENT_PHONE,
})

// occupancy
{
  const { data: occ } = await admin
    .from('occupancy')
    .select('id')
    .eq('landlord_id', LA2)
    .eq('resident_id', resident.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!occ?.id) {
    await admin.from('occupancy').insert({
      landlord_id: LA2,
      resident_id: resident.id,
      unit_id: unit.id,
      property_id: prop.id,
      status: 'active',
    })
  }
}

let { data: vendor } = await admin
  .from('vendors')
  .select('id,name,phone,category,roster_status,active,onboarding_overridden_at')
  .eq('landlord_id', LA2)
  .eq('phone', INTEGRATION_VENDOR_PHONE)
  .maybeSingle()

if (!vendor?.id) {
  const { data: created, error } = await admin
    .from('vendors')
    .insert({
      landlord_id: LA2,
      name: 'Ulo Integration Plumbing',
      phone: INTEGRATION_VENDOR_PHONE,
      email: 'ulo.integration.vendor@example.invalid',
      category: 'plumbing',
      active: true,
      // roster_status check: null | suspended | banned (null = not suspended)
      roster_status: null,
      onboarding_overridden_at: new Date().toISOString(),
      state: 'NJ',
      city: 'Testville',
      preferred_emergency: true,
    })
    .select('id,name,phone,category,roster_status,active,onboarding_overridden_at')
    .single()
  if (error) {
    record('fixture_vendor', 'failed', error.message)
    finish('failed', 1)
  }
  vendor = created
} else {
  await admin
    .from('vendors')
    .update({
      active: true,
      roster_status: null,
      onboarding_overridden_at: vendor.onboarding_overridden_at || new Date().toISOString(),
      category: 'plumbing',
    })
    .eq('id', vendor.id)
}
record('fixture_vendor', 'passed', 'Integration Active vendor ready', {
  vendorId: vendor.id,
  overridden: true,
})

// --- Create ticket + photo ---
const ticketId = randomUUID()
const actionToken = randomUUID()
const description = `[${MARKER}] Kitchen sink leaking under cabinet — integration workflow ${new Date().toISOString()}`

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const photoPath = `${LA2}/${ticketId}/integration-leak.png`

const { error: upErr } = await admin.storage
  .from('maintenance-uploads')
  .upload(photoPath, tinyPng, { contentType: 'image/png', upsert: true })
if (upErr) {
  // bucket name variants
  const { error: upErr2 } = await admin.storage
    .from('maintenance_uploads')
    .upload(photoPath, tinyPng, { contentType: 'image/png', upsert: true })
  if (upErr2) {
    record('photo_upload', 'failed', upErr.message + ' / ' + upErr2.message)
    // continue without photo file — still attach path claim? fail closed on photo requirement
    finish('failed', 1)
  } else {
    record('photo_upload', 'passed', 'Uploaded to maintenance_uploads', { photoPath })
  }
} else {
  record('photo_upload', 'passed', 'Uploaded to maintenance-uploads', { photoPath })
}

const ticketPayload = {
  id: ticketId,
  landlord_id: LA2,
  property_id: prop.id,
  unit_id: unit.id,
  resident_id: resident.id,
  resident_name: resident.full_name || 'Ulo Integration Tenant',
  email: resident.email || 'ulo.integration.tenant@example.invalid',
  unit: unit.unit_label === 'Home' ? '1' : unit.unit_label,
  description,
  priority: 'Normal',
  urgency: 'normal',
  issue_category: 'plumbing',
  vendor_work_status: 'unassigned',
  photo_paths: [photoPath],
  vendor_action_token: actionToken,
}
let { error: insErr } = await admin.from('maintenance_requests').insert(ticketPayload)
if (insErr && /vendor_action_token|issue_category|urgency|photo_paths/i.test(insErr.message)) {
  // Retry with minimal columns
  const minimal = { ...ticketPayload }
  delete minimal.vendor_action_token
  delete minimal.issue_category
  delete minimal.urgency
  ;({ error: insErr } = await admin.from('maintenance_requests').insert(minimal))
}
if (insErr) {
  record('ticket_create', 'failed', insErr.message)
  finish('failed', 1)
}
record('ticket_create', 'passed', 'Ticket created with photo path + correct FKs', {
  ticketId,
  propertyId: prop.id,
  unitId: unit.id,
  residentId: resident.id,
})

// Assign vendor (simulates landlord choice / dispatch without SMS to real phones)
const { error: asgErr } = await admin
  .from('maintenance_requests')
  .update({
    assigned_vendor_id: vendor.id,
    vendor_work_status: 'pending_accept',
    assigned_at: new Date().toISOString(),
  })
  .eq('id', ticketId)
if (asgErr) {
  record('vendor_assign', 'failed', asgErr.message)
  finish('failed', 1)
}
record('vendor_assign', 'passed', 'Eligible integration vendor assigned (pending_accept)', {
  vendorId: vendor.id,
})

// Accept → in_progress → completed
async function setStatus(next) {
  const { error } = await admin
    .from('maintenance_requests')
    .update({ vendor_work_status: next })
    .eq('id', ticketId)
  return error
}
{
  let e = await setStatus('accepted')
  if (e) {
    record('status_accept', 'failed', e.message)
    finish('failed', 1)
  }
  record('status_accept', 'passed', 'Vendor accepted')

  // Schedule window on ticket (visit coordination seed)
  const windowStart = new Date(Date.now() + 24 * 3600 * 1000)
  windowStart.setMinutes(0, 0, 0)
  const { error: schErr } = await admin
    .from('maintenance_requests')
    .update({
      scheduled_at: windowStart.toISOString(),
      vendor_work_status: 'in_progress',
    })
    .eq('id', ticketId)
  if (schErr) {
    // scheduled_at may not exist — still progress status
    e = await setStatus('in_progress')
    if (e) {
      record('status_schedule', 'failed', schErr.message + ' / ' + e.message)
      finish('failed', 1)
    }
    record('status_schedule', 'passed', 'In progress (scheduled_at column unavailable)')
  } else {
    record('status_schedule', 'passed', 'Visit window set + in_progress', {
      scheduled_at: windowStart.toISOString(),
    })
  }

  e = await setStatus('completed')
  if (e) {
    // some schemas use completed via different path
    const { error: e2 } = await admin
      .from('maintenance_requests')
      .update({
        vendor_work_status: 'completed',
        completed_at: new Date().toISOString(),
        spend_status: 'awaiting_invoice',
      })
      .eq('id', ticketId)
    if (e2) {
      record('status_complete', 'failed', e.message + ' / ' + e2.message)
      finish('failed', 1)
    }
  }
  record('status_complete', 'passed', 'Vendor work completed')
}

// Landlord visibility
{
  const la2 = await signIn(LA2_EMAIL, LA2_PASSWORD)
  const { data, error } = await la2
    .from('maintenance_requests')
    .select('id,vendor_work_status,assigned_vendor_id,photo_paths,property_id,unit_id,resident_id,landlord_id')
    .eq('id', ticketId)
    .maybeSingle()
  if (error || !data) {
    record('landlord_visibility', 'failed', error?.message || 'LA2 cannot read ticket')
  } else if (data.vendor_work_status !== 'completed') {
    record('landlord_visibility', 'failed', `Expected completed, got ${data.vendor_work_status}`)
  } else {
    record('landlord_visibility', 'passed', 'LA2 landlord sees completed ticket with photos', {
      status: data.vendor_work_status,
      photos: (data.photo_paths || []).length,
    })
  }
  await la2.auth.signOut()
}

// Resident-facing: ticket linked to resident_id (portal may differ; record proof)
{
  const { data } = await admin
    .from('maintenance_requests')
    .select('id,resident_id,vendor_work_status')
    .eq('id', ticketId)
    .single()
  if (data?.resident_id === resident.id && data.vendor_work_status === 'completed') {
    record('resident_final_status', 'passed', 'Ticket linked to integration resident with completed status')
  } else {
    record('resident_final_status', 'failed', 'Resident link or status mismatch', data)
  }
}

// Cross-tenant: LA1 must not see LA2 ticket (opt-in only — readiness runs skip LA1)
{
  if (!INCLUDE_LA1) {
    const { data: scoped } = await admin
      .from('maintenance_requests')
      .select('id,landlord_id')
      .eq('id', ticketId)
      .maybeSingle()
    if (scoped?.landlord_id === LA2) {
      record(
        'cross_tenant_ticket',
        'not_run',
        'LA1 login probe skipped (INTEGRATION_INCLUDE_LA1 unset). Ticket landlord_id is LA2 only.',
        { landlordId: scoped.landlord_id },
      )
    } else {
      record('cross_tenant_ticket', 'failed', 'Integration ticket landlord_id is not LA2', scoped)
    }
  } else {
    const la1 = await signIn(LA1_EMAIL, LA1_PASSWORD)
    const { data } = await la1
      .from('maintenance_requests')
      .select('id')
      .eq('id', ticketId)
      .maybeSingle()
    if (data?.id) {
      record('cross_tenant_ticket', 'failed', 'LA1 can read LA2 integration ticket')
    } else {
      record('cross_tenant_ticket', 'passed', 'LA1 cannot read LA2 integration ticket')
    }
    await la1.auth.signOut()
  }
}

// Duplicate: second insert with same natural key should not silently create twin when using same id
{
  const { error } = await admin.from('maintenance_requests').insert({
    id: ticketId,
    landlord_id: LA2,
    property_id: prop.id,
    unit_id: unit.id,
    resident_id: resident.id,
    resident_name: 'dup',
    email: 'dup@example.invalid',
    unit: unit.unit_label,
    description: description + ' DUP',
    priority: 'Normal',
    vendor_work_status: 'unassigned',
  })
  if (error && /duplicate|unique/i.test(error.message)) {
    record('duplicate_ticket', 'passed', 'Duplicate id insert rejected', { message: error.message })
  } else if (error) {
    record('duplicate_ticket', 'passed', 'Duplicate insert failed closed', { message: error.message })
  } else {
    record('duplicate_ticket', 'failed', 'Duplicate id insert succeeded unexpectedly')
  }
}

// Cleanup optional: leave ticket for audit evidence (marker in description)
record('sms_boundary', 'not_run', 'Carrier SMS to vendor/resident not sent (non-routable phones; no real-customer SMS)')

const failed = results.some((r) => r.status === 'failed')
const blocked = results.some((r) => r.status === 'blocked')
if (failed) finish('failed', 1)
if (blocked) finish('blocked', 2)
finish('passed', 0)
