#!/usr/bin/env node
/**
 * Late approvals + failed SMS delivery recovery (Limited Alpha 2 only).
 *
 * Modes:
 * 1) Default: seed/open vendor ask, wait for late handset YES (or INTEGRATION_SMS_INJECT_YES=1
 *    only as recovery simulation — labeled separately from handset proof).
 * 2) check_failed: INTEGRATION_SMS_CHECK_SIDS=SM… asserts failed/undelivered statuses.
 * 3) duplicate: re-send assignment SMS and assert idempotent conversation / no double-assign.
 *
 * Never touches Limited Alpha 1.
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OUT = resolve(ROOT, '.readiness/integration')
mkdirSync(OUT, { recursive: true })
const LA2 = 'de300000-0000-4000-8000-000000000004'
const VENDOR_PHONE = (process.env.INTEGRATION_SMS_VENDOR_PHONE || '+14708880274').trim()
const TENANT_PHONE = (process.env.INTEGRATION_SMS_TENANT_PHONE || '+19088843069').trim()

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

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const ANON = (process.env.VITE_SUPABASE_ANON_KEY || '').trim()
const SECRET = (
  process.env.ADMIN_REASSIGN_SECRET ||
  process.env.VITE_ADMIN_REASSIGN_SECRET ||
  ''
).trim()
const INJECT = process.env.INTEGRATION_SMS_INJECT_YES === '1'
const WAIT_MS = Math.min(Math.max(Number(process.env.INTEGRATION_SMS_WAIT_MS || 90000) || 90000, 0), 180000)

const results = []
function record(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
  console.log(`[${status}] ${id} — ${note}`)
}
function finish(overall, code) {
  writeFileSync(
    resolve(OUT, 'sms-failure-recovery.json'),
    JSON.stringify(
      {
        area: 'sms-failure-recovery',
        overall,
        finishedAt: new Date().toISOString(),
        landlordId: LA2,
        injectUsed: INJECT,
        results,
        boundaries: [
          'LA2 designated phones only.',
          'Injected YES is recovery simulation — never counted as handset proof.',
          'Failed delivery asserts Twilio/DB terminal failure statuses when SIDs provided.',
        ],
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`\nOverall sms-failure-recovery: ${overall} (exit ${code})`)
  process.exit(code)
}

if (!SUPABASE_URL || !SERVICE || !ANON || !SECRET) {
  record('prereq', 'blocked', 'Need URL, service role, anon, ADMIN_REASSIGN_SECRET')
  finish('blocked', 2)
}

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function invokeJourney(body) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/integration-sms-journey`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      apikey: ANON,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, json, text: text.slice(0, 800) }
}

// --- Failed delivery check ---
{
  const sids = String(process.env.INTEGRATION_SMS_CHECK_SIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!sids.length) {
    record(
      'failed_delivery_status',
      'not_run',
      'Provide INTEGRATION_SMS_CHECK_SIDS=SM… (failed/undelivered) to assert recovery handling',
    )
  } else {
    const check = await invokeJourney({ action: 'check_delivery', sids })
    const rows = check.json?.results || []
    const failed = rows.filter((r) =>
      ['failed', 'undelivered', 'canceled'].includes(String(r.twilioStatus || r.dbStatus || '').toLowerCase()),
    )
    const delivered = rows.filter((r) => r.delivered === true)
    if (!check.ok && failed.length === 0) {
      record('failed_delivery_status', 'failed', 'check_delivery invoke failed', check.json || check.text)
    } else if (failed.length) {
      record('failed_delivery_status', 'passed', `${failed.length} SID(s) in terminal failure`, {
        failed: failed.map((r) => ({
          sid: r.sid,
          twilio: r.twilioStatus,
          db: r.dbStatus,
        })),
      })
      // Retry: re-invoke journey outbound once and ensure a new SID (not reuse of failed)
      const retry = await invokeJourney({
        tenantPhone: TENANT_PHONE,
        vendorPhone: VENDOR_PHONE,
        injectVendorYes: false,
        waitForInboundMs: 5_000,
        waitForDeliveryMs: 45_000,
      })
      const vendorStep = (retry.json?.steps || []).find((s) => s.step === 'vendor_outbound')
      const newSid = vendorStep?.providerMessageSid
      if (newSid && !sids.includes(newSid)) {
        record('failed_delivery_retry', 'passed', 'Retry produced a new vendor outbound SID', {
          newSid,
          deliveryStatus: vendorStep.deliveryStatus,
        })
      } else {
        record('failed_delivery_retry', 'partial', 'Retry did not clearly mint a distinct SID', {
          retry: retry.json || retry.text,
        })
      }
    } else {
      record(
        'failed_delivery_status',
        'partial',
        'Provided SIDs are not in failed/undelivered — cannot prove failure path',
        { delivered: delivered.length, rows },
      )
      record('failed_delivery_retry', 'not_run', 'No terminal failure SID to recover from')
    }
  }
}

// --- Late approval + duplicate prevention ---
{
  const first = await invokeJourney({
    tenantPhone: TENANT_PHONE,
    vendorPhone: VENDOR_PHONE,
    injectVendorYes: INJECT,
    waitForInboundMs: WAIT_MS,
    waitForDeliveryMs: 60_000,
  })
  const steps = first.json?.steps || []
  const ticketStep = steps.find((s) => s.step === 'ticket_created')
  const vendorOut = steps.find((s) => s.step === 'vendor_outbound')
  const reply = steps.find((s) => s.step === 'vendor_reply')
  const after = steps.find((s) => s.step === 'ticket_after_reply')
  const ticketId = ticketStep?.ticketId || first.json?.ticketId

  if (!first.ok && !ticketId) {
    record('late_approval_setup', 'failed', 'Could not open vendor ask', first.json || first.text)
  } else {
    record('late_approval_setup', 'passed', 'Vendor ask opened', {
      ticketId,
      outboundSid: vendorOut?.providerMessageSid,
      delivery: vendorOut?.deliveryStatus,
    })
  }

  const handset =
    reply?.source === 'twilio' ||
    (typeof reply?.providerMessageSid === 'string' &&
      /^SM[0-9a-f]{32}$/i.test(reply.providerMessageSid))
  if (handset && after?.vendor_work_status === 'accepted') {
    record('late_approval_handset', 'passed', 'Twilio handset YES bound to accepted ticket', {
      ticketId,
      sid: reply.providerMessageSid,
    })
  } else if (INJECT && after?.vendor_work_status === 'accepted') {
    record(
      'late_approval_inject_simulation',
      'passed',
      'Injected YES accepted ticket (simulation only — not handset proof)',
      { ticketId },
    )
    record('late_approval_handset', 'not_run', 'Handset YES not used this run')
  } else {
    record(
      'late_approval_handset',
      'not_run',
      'No handset YES within wait — ticket may still be pending_accept for a late reply',
      { status: after?.vendor_work_status, reply },
    )
    // Poll for late YES without inject (skip long wait when inject already covered acceptance)
    if (ticketId && WAIT_MS > 0 && !INJECT) {
      const deadline = Date.now() + Math.min(Number(process.env.INTEGRATION_SMS_EXTRA_WAIT_MS || 120000) || 120000, 180000)
      let accepted = false
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5000))
        const { data: t } = await admin
          .from('maintenance_requests')
          .select('vendor_work_status')
          .eq('id', ticketId)
          .eq('landlord_id', LA2)
          .maybeSingle()
        if (t?.vendor_work_status === 'accepted') {
          const { data: inbound } = await admin
            .from('sms_messages')
            .select('provider_message_sid,body,created_at')
            .eq('direction', 'inbound')
            .ilike('body', 'YES')
            .gte('created_at', new Date(Date.now() - 3600_000).toISOString())
            .limit(10)
          const sm = (inbound || []).find((m) => /^SM[0-9a-f]{32}$/i.test(String(m.provider_message_sid || '')))
          if (sm) {
            record('late_approval_handset', 'passed', 'Late Twilio YES observed after extra poll', {
              ticketId,
              sid: sm.provider_message_sid,
            })
            accepted = true
            break
          }
        }
      }
      if (!accepted) {
        record(
          'late_approval_handset',
          'not_run',
          'Extra poll ended without Twilio handset YES',
          { ticketId },
        )
      }
    }
  }

  // Duplicate prevention: second journey should not create a second assignment on same open ask
  // or should skip duplicate outbound for same ticket.
  if (ticketId) {
    const before = await admin
      .from('maintenance_requests')
      .select('id,assigned_vendor_id,vendor_work_status')
      .eq('id', ticketId)
      .single()
    const { count: msgCountBefore } = await admin
      .from('sms_messages')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound')
      .gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString())

    const dup = await invokeJourney({
      tenantPhone: TENANT_PHONE,
      vendorPhone: VENDOR_PHONE,
      injectVendorYes: false,
      waitForInboundMs: 3_000,
      waitForDeliveryMs: 20_000,
    })
    const dupTicket = (dup.json?.steps || []).find((s) => s.step === 'ticket_created')?.ticketId
    const afterRow = await admin
      .from('maintenance_requests')
      .select('id,assigned_vendor_id,vendor_work_status')
      .eq('id', ticketId)
      .single()

    if (
      before.data?.assigned_vendor_id &&
      afterRow.data?.assigned_vendor_id &&
      before.data.assigned_vendor_id === afterRow.data.assigned_vendor_id &&
      dupTicket &&
      dupTicket !== ticketId
    ) {
      record(
        'duplicate_prevention',
        'passed',
        'Second journey minted a separate ticket rather than double-assigning the first',
        { firstTicket: ticketId, secondTicket: dupTicket },
      )
    } else if (dup.json?.skipped || dup.json?.idempotent) {
      record('duplicate_prevention', 'passed', 'Second journey reported idempotent skip', dup.json)
    } else {
      record(
        'duplicate_prevention',
        'partial',
        'Review outbound counts — second journey completed without explicit idempotent flag',
        {
          firstTicket: ticketId,
          secondTicket: dupTicket,
          msgCountBefore,
          firstStatus: before.data?.vendor_work_status,
          afterStatus: afterRow.data?.vendor_work_status,
        },
      )
    }
  } else {
    record('duplicate_prevention', 'not_run', 'No ticket id from first journey')
  }
}

const failed = results.some((r) => r.status === 'failed')
if (failed) finish('failed', 1)
finish(results.some((r) => r.status === 'not_run' || r.status === 'partial') ? 'partial' : 'passed', 0)
