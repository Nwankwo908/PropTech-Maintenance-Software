#!/usr/bin/env node
/**
 * Post-deploy real-handset SMS identity routing probe (LA2).
 *
 * 1) Invokes integration-sms-journey (inject YES = 0) → texts tenant + vendor.
 * 2) Polls for real Twilio inbounds from:
 *    - +19088843069 (tenant) → must be landlord LA2
 *    - +14708880274 (vendor) → must be landlord LA2 (YES / scheduling)
 * 3) Confirms Demo/LA1 did not receive those inbounds.
 *
 * Evidence: .readiness/integration/sms-identity-routing-handset.json
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OUT = resolve(ROOT, '.readiness/integration')
mkdirSync(OUT, { recursive: true })

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (process.env[k] == null || process.env[k] === '') process.env[k] = v
  }
}
loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

const LA1 = 'de300000-0000-4000-8000-000000000003'
const LA2 = 'de300000-0000-4000-8000-000000000004'
const DEMO = 'de300000-0000-4000-8000-000000000001'
const TENANT = '+19088843069'
const VENDOR = '+14708880274'
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ADMIN = (process.env.VITE_ADMIN_REASSIGN_SECRET || process.env.ADMIN_REASSIGN_SECRET || '').trim()
const WAIT_MS = Number(process.env.INTEGRATION_SMS_WAIT_MS || '180000')
const POLL_MS = Number(process.env.INTEGRATION_SMS_EXTRA_WAIT_MS || '240000')

const results = []
function record(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
  console.log(`[${status}] ${id} — ${note}`)
}

if (!SUPABASE_URL || !ANON || !SERVICE || !ADMIN) {
  console.error('Missing URL / anon / service / admin secret')
  process.exit(2)
}

const sb = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const startedAt = new Date().toISOString()

console.log(`
=== REAL HANDSET ROUTING PROBE ===
Started: ${startedAt}
Tenant phone: ${TENANT}  → reply any short text (e.g. OK) after you receive the Ulo outbound
Vendor phone: ${VENDOR}  → reply YES (then day/time if asked)
LA2: ${LA2}
Inject YES: OFF (handset only)
`)

// Confirm Demo unlink
{
  const { data: demoUsers } = await sb
    .from('users')
    .select('id, phone')
    .eq('landlord_id', DEMO)
    .ilike('phone', `%${TENANT.slice(-10)}%`)
  record(
    'demo_phone_unlinked',
    (demoUsers ?? []).length === 0 ? 'passed' : 'failed',
    (demoUsers ?? []).length === 0
      ? 'Try Demo no longer holds tenant test phone'
      : `Demo still has phone binding (${demoUsers.length})`,
    { demoUsers },
  )
}

const journeyUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/integration-sms-journey`
console.log(`Invoking journey (wait ${WAIT_MS}ms edge + ${POLL_MS}ms poll)…`)
const journeyRes = await fetch(journeyUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: ANON,
    Authorization: `Bearer ${ANON}`,
    'x-admin-reassign-secret': ADMIN,
  },
  body: JSON.stringify({
    tenantPhone: TENANT,
    vendorPhone: VENDOR,
    injectYes: false,
    waitMs: WAIT_MS,
  }),
})
const journeyText = await journeyRes.text()
let journeyPayload
try {
  journeyPayload = JSON.parse(journeyText)
} catch {
  journeyPayload = { raw: journeyText }
}
record(
  'journey_invoke',
  journeyRes.ok ? 'passed' : 'failed',
  `integration-sms-journey HTTP ${journeyRes.status}`,
  { httpStatus: journeyRes.status, journeyPayload },
)

const ticketId =
  journeyPayload?.ticketId ||
  journeyPayload?.result?.ticketId ||
  null

async function latestInbound(phone, afterIso) {
  const { data } = await sb
    .from('sms_messages')
    .select(
      'id, landlord_id, conversation_id, body, created_at, from_number, provider_message_sid, direction',
    )
    .eq('direction', 'inbound')
    .ilike('from_number', `%${phone.slice(-10)}%`)
    .gte('created_at', afterIso)
    .order('created_at', { ascending: false })
    .limit(10)
  return data ?? []
}

const deadline = Date.now() + POLL_MS
let tenantHits = []
let vendorHits = []
while (Date.now() < deadline) {
  tenantHits = await latestInbound(TENANT, startedAt)
  vendorHits = await latestInbound(VENDOR, startedAt)
  const tenantOk =
    tenantHits.length > 0 && tenantHits.every((m) => m.landlord_id === LA2)
  const vendorOk =
    vendorHits.some((m) => /yes/i.test(m.body || '')) &&
    vendorHits.every((m) => m.landlord_id === LA2)
  if (tenantOk && vendorOk) break
  process.stdout.write('.')
  await new Promise((r) => setTimeout(r, 5000))
}
console.log('')

const tenantWrong = tenantHits.filter((m) => m.landlord_id !== LA2)
const vendorWrong = vendorHits.filter((m) => m.landlord_id !== LA2)
const tenantDemo = tenantHits.filter((m) => m.landlord_id === DEMO)
const tenantLa1 = tenantHits.filter((m) => m.landlord_id === LA1)

record(
  'tenant_inbound_routes_la2',
  tenantHits.length > 0 && tenantWrong.length === 0 ? 'passed' : 'failed',
  tenantHits.length === 0
    ? 'No tenant inbound observed after probe start — handset reply still needed'
    : tenantWrong.length === 0
      ? `Tenant inbound scoped to LA2 only (${tenantHits.length} msg)`
      : `Tenant inbound leaked (demo=${tenantDemo.length} la1=${tenantLa1.length} other=${tenantWrong.length})`,
  { tenantHits, ticketId },
)

const vendorYes = vendorHits.filter((m) => /yes/i.test(m.body || ''))
record(
  'vendor_inbound_routes_la2',
  vendorHits.length > 0 && vendorWrong.length === 0 && vendorYes.length > 0
    ? 'passed'
    : vendorHits.length > 0 && vendorWrong.length === 0
      ? 'partial'
      : 'failed',
  vendorHits.length === 0
    ? 'No vendor inbound observed — reply YES from …0274'
    : vendorWrong.length === 0 && vendorYes.length > 0
      ? `Vendor YES inbound scoped to LA2 (${vendorHits.length} msg)`
      : vendorWrong.length === 0
        ? 'Vendor inbound on LA2 but no YES body yet'
        : 'Vendor inbound leaked off LA2',
  { vendorHits, ticketId },
)

if (ticketId) {
  const { data: ticket } = await sb
    .from('maintenance_requests')
    .select('id, landlord_id, vendor_work_status, assigned_vendor_id, description')
    .eq('id', ticketId)
    .maybeSingle()
  record(
    'ticket_stays_la2',
    ticket?.landlord_id === LA2 ? 'passed' : 'failed',
    ticket
      ? `Ticket ${ticketId.slice(0, 8)} landlord=${ticket.landlord_id} status=${ticket.vendor_work_status}`
      : 'Ticket missing',
    { ticket },
  )
}

record('la1_untouched', 'passed', 'Probe did not modify LA1; checked inbound landlord ids only', {
  la1Touched: false,
})

const failed = results.some((r) => r.status === 'failed')
const overall = failed
  ? 'failed'
  : results.some((r) => r.status === 'partial' || r.status === 'blocked')
    ? 'partial'
    : 'passed'

const payload = {
  area: 'sms-identity-routing-handset',
  overall,
  kind: 'real_handset',
  finishedAt: new Date().toISOString(),
  startedAt,
  phones: { tenant: TENANT, vendor: VENDOR },
  landlords: { la1: LA1, la2: LA2, demo: DEMO },
  deployCommit: 'bd8fa35',
  results,
  journeyPayload,
}
writeFileSync(resolve(OUT, 'sms-identity-routing-handset.json'), JSON.stringify(payload, null, 2) + '\n')
console.log(`\nOverall: ${overall}`)
console.log(`Evidence: .readiness/integration/sms-identity-routing-handset.json`)
process.exit(failed ? 1 : 0)
