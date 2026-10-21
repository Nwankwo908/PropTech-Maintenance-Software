#!/usr/bin/env node
/**
 * Invoke integration-sms-journey against designated LA2 test phones.
 *
 * Defaults — handset-strict (no inject):
 *   INTEGRATION_SMS_TENANT_PHONE=+15715028158
 *   INTEGRATION_SMS_VENDOR_PHONE=+19737358072
 *   INTEGRATION_SMS_INJECT_YES=0
 *   INTEGRATION_SMS_WAIT_MS=120000
 *
 * After the edge wait, optionally keeps polling DB for a real Twilio inbound YES
 * (INTEGRATION_SMS_EXTRA_WAIT_MS, default 180000).
 *
 * Check prior SIDs only:
 *   INTEGRATION_SMS_CHECK_SIDS=SM…,SM… npm run verify:sms-journey
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OUT_DIR = resolve(ROOT, '.readiness/integration')
mkdirSync(OUT_DIR, { recursive: true })

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
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ADMIN = (process.env.VITE_ADMIN_REASSIGN_SECRET || process.env.ADMIN_REASSIGN_SECRET || '').trim()
const TENANT = (process.env.INTEGRATION_SMS_TENANT_PHONE || '+15715028158').trim()
const VENDOR = (process.env.INTEGRATION_SMS_VENDOR_PHONE || '+19737358072').trim()
const WAIT = Number(process.env.INTEGRATION_SMS_WAIT_MS || '120000')
const EXTRA = Number(process.env.INTEGRATION_SMS_EXTRA_WAIT_MS || '180000')
const DELIVERY_WAIT = Number(process.env.INTEGRATION_SMS_DELIVERY_WAIT_MS || '60000')
const INJECT = process.env.INTEGRATION_SMS_INJECT_YES === '1'
const CHECK_SIDS = (process.env.INTEGRATION_SMS_CHECK_SIDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (!SUPABASE_URL || !ANON || !ADMIN) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_ADMIN_REASSIGN_SECRET')
  process.exit(2)
}

const base = SUPABASE_URL.replace(/\/$/, '')
const url = `${base}/functions/v1/integration-sms-journey`

async function invoke(payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'x-admin-reassign-secret': ADMIN,
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let payloadOut
  try {
    payloadOut = JSON.parse(text)
  } catch {
    payloadOut = { raw: text }
  }
  return { res, payload: payloadOut }
}

function isTwilioSid(sid) {
  return typeof sid === 'string' && /^SM[0-9a-f]{32}$/i.test(sid.trim())
}

if (CHECK_SIDS.length) {
  console.log(`Checking delivery for ${CHECK_SIDS.length} SID(s)`)
  const { res, payload } = await invoke({ action: 'check_delivery', sids: CHECK_SIDS })
  writeFileSync(
    resolve(OUT_DIR, 'P3-sms-delivery-check.json'),
    JSON.stringify({ finishedAt: new Date().toISOString(), httpStatus: res.status, result: payload }, null, 2) +
      '\n',
  )
  console.log(JSON.stringify({ httpStatus: res.status, ...payload }, null, 2))
  process.exit(res.ok && payload?.ok ? 0 : 1)
}

console.log(`Invoking ${url}`)
console.log(
  `tenant=${TENANT} vendor=${VENDOR} waitMs=${WAIT} extraMs=${EXTRA} deliveryWaitMs=${DELIVERY_WAIT} injectYes=${INJECT}`,
)
console.log(`Handset action required: from ${VENDOR} reply YES to Ulo after the vendor job SMS arrives.`)

const { res, payload } = await invoke({
  tenantPhone: TENANT,
  vendorPhone: VENDOR,
  waitForInboundMs: WAIT,
  waitForDeliveryMs: DELIVERY_WAIT,
  injectVendorYes: INJECT,
})

let finalPayload = payload
let handsetFromExtraPoll = null

if (
  !INJECT &&
  payload?.replySource !== 'handset' &&
  payload?.ticketId &&
  SERVICE &&
  EXTRA > 0
) {
  const vendorConvo = (payload.steps || []).find((s) => s.step === 'vendor_outbound')?.conversationId
  const uloPhone = payload.uloPhone
  console.log(
    `\nEdge wait ended without handset YES. Polling DB up to ${EXTRA}ms for Twilio inbound from ${VENDOR}…`,
  )
  if (vendorConvo) {
    const sb = createClient(SUPABASE_URL, SERVICE)
    const since = new Date(Date.now() - WAIT - 30_000).toISOString()
    const deadline = Date.now() + EXTRA
    while (Date.now() < deadline) {
      const { data: inbound } = await sb
        .from('sms_messages')
        .select('id,body,provider_message_sid,created_at,raw_payload,from_number,to_number')
        .eq('conversation_id', vendorConvo)
        .eq('direction', 'inbound')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20)
      const hit = (inbound || []).find((m) => {
        if (!/^\s*(yes|y|accept)\b/i.test(String(m.body || ''))) return false
        if (m.raw_payload?.integration === true) return false
        return isTwilioSid(m.provider_message_sid)
      })
      if (hit) {
        handsetFromExtraPoll = hit
        const { data: ticketAfter } = await sb
          .from('maintenance_requests')
          .select('id,vendor_work_status,assigned_vendor_id')
          .eq('id', payload.ticketId)
          .maybeSingle()
        finalPayload = {
          ...payload,
          ok: true,
          handsetVerified: true,
          replySource: 'handset',
          deliveryVerified: payload.deliveryVerified === true,
          steps: [
            ...(payload.steps || []).filter((s) => s.step !== 'vendor_reply' && s.step !== 'ticket_after_reply'),
            {
              step: 'vendor_reply',
              status: 'passed',
              source: 'handset',
              messageId: hit.id,
              body: hit.body,
              providerMessageSid: hit.provider_message_sid,
              note: 'Observed during client extra poll after edge wait',
            },
            {
              step: 'ticket_after_reply',
              vendor_work_status: ticketAfter?.vendor_work_status ?? null,
              assigned_vendor_id: ticketAfter?.assigned_vendor_id ?? null,
            },
          ],
        }
        console.log(`Handset YES received: sid=${hit.provider_message_sid} body=${JSON.stringify(hit.body)}`)
        break
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
    if (!handsetFromExtraPoll) {
      console.log(`No handset YES within extra poll. Reply YES from ${VENDOR} to ${uloPhone}.`)
    }
  }
}

writeFileSync(
  resolve(OUT_DIR, 'P3-sms-journey.json'),
  JSON.stringify(
    {
      finishedAt: new Date().toISOString(),
      httpStatus: res.status,
      tenantPhone: TENANT,
      vendorPhone: VENDOR,
      injectYes: INJECT,
      handsetFromExtraPoll: handsetFromExtraPoll
        ? {
            id: handsetFromExtraPoll.id,
            sid: handsetFromExtraPoll.provider_message_sid,
            body: handsetFromExtraPoll.body,
          }
        : null,
      result: finalPayload,
    },
    null,
    2,
  ) + '\n',
)

const summary = {
  httpStatus: res.status,
  ok: finalPayload?.ok,
  deliveryVerified: finalPayload?.deliveryVerified,
  handsetVerified: finalPayload?.handsetVerified,
  replySource: finalPayload?.replySource,
  steps: finalPayload?.steps,
}
console.log(JSON.stringify(summary, null, 2))

const deliveryOk = finalPayload?.deliveryVerified === true
const handsetOk = finalPayload?.handsetVerified === true

if (deliveryOk && handsetOk) {
  console.log('\nOverall P3 SMS journey: passed (delivered + handset YES)')
  process.exit(0)
}
if (deliveryOk && !handsetOk) {
  console.log('\nOverall P3 SMS journey: partial — outbound delivered; handset YES still unverified')
  process.exit(1)
}
console.log('\nOverall P3 SMS journey: failed')
process.exit(1)
