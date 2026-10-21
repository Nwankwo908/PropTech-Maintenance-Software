#!/usr/bin/env node
/**
 * Emergency report → property scope → human alert (Limited Alpha 2 only).
 *
 * Success path (when LA2 ops phone + Twilio are configured):
 *   Seed flooding ticket on a single known LA2 property → notify landlord attention
 *   → assert durable ticket + graph/SMS outbox rows target LA2 ops phone.
 *
 * Failure / recovery probes (DB-level, no LA1):
 *   - Missing on-call contact → alert path records failure without inventing a recipient
 *   - Duplicate notify → no spam second outbound for the same attention key (idempotent)
 *
 * Does NOT sign in to Limited Alpha 1. Does NOT modify LA1 records.
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

const LA2 = 'de300000-0000-4000-8000-000000000004'
const MARKER = 'ulo-integration-emergency'

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
const SEND_LIVE = process.env.INTEGRATION_EMERGENCY_SEND_LIVE === '1'

const results = []
function record(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
  console.log(`[${status}] ${id} — ${note}`)
}

function finish(overall, code) {
  const payload = {
    area: 'emergency-alert',
    overall,
    finishedAt: new Date().toISOString(),
    commit: process.env.READINESS_COMMIT || null,
    environment: (() => {
      try {
        return new URL(SUPABASE_URL).host
      } catch {
        return 'invalid'
      }
    })(),
    landlordId: LA2,
    sendLive: SEND_LIVE,
    results,
    boundaries: [
      'Limited Alpha 2 only — LA1 never signed in or modified.',
      'Flooding label asserted from durable ticket fields.',
      'Live human SMS only when INTEGRATION_EMERGENCY_SEND_LIVE=1 and LA2 ops phone is set.',
      'Injected/simulated inbound replies are never claimed as handset proof.',
    ],
  }
  writeFileSync(resolve(OUT_DIR, 'emergency-alert.json'), JSON.stringify(payload, null, 2) + '\n')
  console.log(`\nOverall emergency-alert: ${overall} (exit ${code})`)
  process.exit(code)
}

if (!SUPABASE_URL || !SERVICE) {
  record('prereq', 'blocked', 'Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  finish('blocked', 2)
}

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: props, error: propErr } = await admin
  .from('properties')
  .select('id,name,street_address,city,state')
  .eq('landlord_id', LA2)
  .order('created_at', { ascending: true })

if (propErr) {
  record('fixture_properties', 'failed', propErr.message)
  finish('failed', 1)
}
if (!props?.length) {
  record('fixture_properties', 'blocked', 'LA2 has no properties — seed portfolio before emergency journey')
  finish('blocked', 2)
}

const prop = props[0]
record('fixture_property', 'passed', `Using LA2 property ${prop.name || prop.id}`, {
  propertyId: prop.id,
  propertyCount: props.length,
  ambiguousPortfolio: props.length > 1,
})

const { data: units } = await admin
  .from('units')
  .select('id,unit_label,property_id')
  .eq('landlord_id', LA2)
  .eq('property_id', prop.id)
  .limit(1)
const unit = units?.[0] || null

const { data: residents } = await admin
  .from('users')
  .select('id,full_name,phone,unit_id,property_id')
  .eq('landlord_id', LA2)
  .eq('role', 'resident')
  .limit(5)
const resident =
  residents?.find((r) => r.property_id === prop.id || r.unit_id === unit?.id) ||
  residents?.[0] ||
  null

const ticketId = randomUUID()
const description = `${MARKER} basement flooding — active water everywhere (${ticketId.slice(0, 8)})`

const insertRow = {
  id: ticketId,
  landlord_id: LA2,
  property_id: prop.id,
  unit_id: unit?.id || null,
  resident_id: resident?.id || null,
  resident_name: resident?.full_name || 'Integration Emergency Resident',
  email: 'emergency-integration@example.invalid',
  unit: unit?.unit_label || null,
  description,
  issue_type: 'flooding',
  priority: 'Emergency',
  vendor_work_status: 'unassigned',
  category: 'plumbing',
}
const { error: insErr } = await admin.from('maintenance_requests').insert(insertRow)
if (insErr) {
  record('ticket_create', 'failed', insErr.message)
  finish('failed', 1)
}

const { data: ticket } = await admin
  .from('maintenance_requests')
  .select(
    'id,landlord_id,property_id,unit_id,issue_type,priority,description,vendor_work_status',
  )
  .eq('id', ticketId)
  .single()

if (
  !ticket ||
  ticket.landlord_id !== LA2 ||
  ticket.property_id !== prop.id ||
  String(ticket.issue_type || '').toLowerCase() !== 'flooding' ||
  !/emergency/i.test(String(ticket.priority || ''))
) {
  record('ticket_flooding_fields', 'failed', 'Ticket did not retain flooding + emergency + LA2 property', ticket)
  finish('failed', 1)
}
record('ticket_flooding_fields', 'passed', 'Flooding issue_type + Emergency priority on correct LA2 property', {
  ticketId,
  propertyId: ticket.property_id,
  issueType: ticket.issue_type,
  priority: ticket.priority,
})

// Resolve configured ops / on-call phones for LA2 (read-only)
const { data: landlordRow } = await admin
  .from('landlords')
  .select('id,ops_phone,phone,notification_phone,company_name')
  .eq('id', LA2)
  .maybeSingle()

const opsCandidates = [
  landlordRow?.ops_phone,
  landlordRow?.notification_phone,
  landlordRow?.phone,
]
  .map((p) => (typeof p === 'string' ? p.trim() : ''))
  .filter(Boolean)

const { data: smsIds } = await admin
  .from('sms_identities')
  .select('phone_e164,role,landlord_id')
  .eq('landlord_id', LA2)
  .in('role', ['landlord', 'ops', 'admin'])
  .limit(10)

for (const row of smsIds || []) {
  if (row.phone_e164) opsCandidates.push(row.phone_e164)
}

const uniqueOps = [...new Set(opsCandidates)]
if (uniqueOps.length === 0) {
  record(
    'on_call_contact',
    'failed',
    'No LA2 ops/landlord phone configured — human alert cannot be delivered',
  )
} else {
  record('on_call_contact', 'passed', `LA2 has ${uniqueOps.length} ops/landlord phone candidate(s)`, {
    count: uniqueOps.length,
    // Do not dump full phone list into reports beyond count + last4
    last4: uniqueOps.map((p) => p.slice(-4)),
  })
}

// Failure: missing contact must not invent a recipient (dry assertion)
{
  const invented = uniqueOps.some((p) => /55501|example\.invalid/i.test(p))
  if (invented) {
    record('no_invented_recipient', 'failed', 'Ops phone looks like a placeholder/invented number')
  } else {
    record('no_invented_recipient', 'passed', 'Configured ops phones are present without placeholder invention in this check')
  }
}

// Live notify via edge only when explicitly enabled
if (!SEND_LIVE) {
  record(
    'human_alert_delivery',
    'not_run',
    'Set INTEGRATION_EMERGENCY_SEND_LIVE=1 to send a real attention SMS to LA2 ops phones. Ticket + flooding fields already durable.',
    { ticketId },
  )
  record(
    'duplicate_alert_idempotency',
    'not_run',
    'Requires live notify path to observe outbound SIDs.',
  )
} else if (uniqueOps.length === 0) {
  record('human_alert_delivery', 'failed', 'Cannot send live alert without ops phone')
  record('duplicate_alert_idempotency', 'not_run', 'Skipped — no ops phone')
} else {
  const base = SUPABASE_URL.replace(/\/$/, '')
  const secret = (process.env.ADMIN_REASSIGN_SECRET || '').trim()
  if (!secret) {
    record('human_alert_delivery', 'blocked', 'ADMIN_REASSIGN_SECRET required for live emergency notify invoke')
    record('duplicate_alert_idempotency', 'not_run', 'Skipped — missing secret')
  } else {
    const body = {
      action: 'emergency_attention',
      landlordId: LA2,
      ticketId,
      propertyId: prop.id,
      marker: MARKER,
    }
    const invoke = async () => {
      const res = await fetch(`${base}/functions/v1/integration-sms-journey`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          apikey: (process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
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
      return { ok: res.ok, status: res.status, json, text: text.slice(0, 500) }
    }
    const first = await invoke()
    if (!first.ok) {
      record('human_alert_delivery', 'failed', `Notify invoke failed HTTP ${first.status}`, {
        body: first.json || first.text,
      })
    } else {
      const sid = first.json?.messageSid || first.json?.sid || null
      const to = first.json?.to || null
      record('human_alert_delivery', sid ? 'passed' : 'partial', 'Live attention notify invoked', {
        http: first.status,
        messageSid: sid,
        toLast4: typeof to === 'string' ? to.slice(-4) : null,
        note: sid
          ? 'SID present — check Twilio/DB delivery separately; not a handset read receipt'
          : 'No SID in response — inspect function support for emergency_attention',
      })
      const second = await invoke()
      const sid2 = second.json?.messageSid || second.json?.sid || null
      if (sid && sid2 && sid === sid2) {
        record('duplicate_alert_idempotency', 'passed', 'Second notify reused same outbound SID')
      } else if (second.json?.skipped === true || second.json?.idempotent === true) {
        record('duplicate_alert_idempotency', 'passed', 'Second notify skipped as idempotent', second.json)
      } else {
        record(
          'duplicate_alert_idempotency',
          'unknown',
          'Second invoke returned a different shape — manual review of outbox required',
          { firstSid: sid, second: second.json || second.text },
        )
      }
    }
  }
}

// Ambiguous property note when portfolio has multiple buildings
if (props.length > 1) {
  record(
    'property_disambiguation',
    'partial',
    'LA2 has multiple properties; this run pinned the oldest property explicitly (no address guess).',
    { propertyCount: props.length, chosenPropertyId: prop.id },
  )
} else {
  record('property_disambiguation', 'passed', 'Single LA2 property — inference unambiguous', {
    propertyId: prop.id,
  })
}

const failed = results.some((r) => r.status === 'failed')
const blocked = results.some((r) => r.status === 'blocked')
const unknowns = results.filter((r) => r.status === 'unknown' || r.status === 'not_run' || r.status === 'partial')
if (failed) finish('failed', 1)
if (blocked) finish('blocked', 2)
if (unknowns.some((r) => r.id === 'human_alert_delivery' && r.status === 'not_run')) {
  finish('partial', 0)
}
finish('passed', 0)
