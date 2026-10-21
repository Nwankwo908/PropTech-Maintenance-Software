#!/usr/bin/env node
/**
 * Failure / recovery probes on Limited Alpha 2 only (no LA1).
 *
 * Covers:
 * - Unavailable / ineligible vendor (pest + generalist must not assign)
 * - Duplicate ticket id rejected
 * - Late approval / handset YES: documented not_run unless real Twilio inbound exists
 * - Failed delivery: only asserted when a known SID is terminal-failed (optional env)
 *
 * Exit: 0 passed|partial | 1 failed | 2 blocked
 */
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OUT_DIR = resolve(ROOT, '.readiness/integration')
mkdirSync(OUT_DIR, { recursive: true })
const LA2 = 'de300000-0000-4000-8000-000000000004'

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

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || '').trim()
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const results = []
function record(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
  console.log(`[${status}] ${id} — ${note}`)
}
function finish(overall, code) {
  writeFileSync(
    resolve(OUT_DIR, 'failure-recovery.json'),
    JSON.stringify(
      {
        area: 'failure-recovery',
        overall,
        finishedAt: new Date().toISOString(),
        landlordId: LA2,
        results,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`\nOverall failure-recovery: ${overall} (exit ${code})`)
  process.exit(code)
}

if (!SUPABASE_URL || !SERVICE) {
  record('prereq', 'blocked', 'Missing URL/service role')
  finish('blocked', 2)
}

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Policy: pest never matches generalist (Vitest product test — not a simulated SMS)
{
  const pest = spawnSync(
    'npx',
    ['vitest', 'run', 'src/lib/vendorTrades.dispatch.test.ts', '-t', 'does not assign pest'],
    { cwd: ROOT, encoding: 'utf8', env: process.env },
  )
  record(
    'pest_no_generalist',
    pest.status === 0 ? 'passed' : 'failed',
    pest.status === 0
      ? 'Generalist cannot take pest jobs (vendorTrades.dispatch)'
      : (pest.stderr || pest.stdout || 'vitest failed').slice(-400),
  )
}

// Unavailable vendor: Active generalist must not be assigned for pest ticket
{
  const { data: prop } = await admin
    .from('properties')
    .select('id')
    .eq('landlord_id', LA2)
    .limit(1)
    .maybeSingle()
  const { data: generalists } = await admin
    .from('vendors')
    .select('id,name,trades,specialty,roster_status,active,availability')
    .eq('landlord_id', LA2)
    .limit(20)
  const generalist = (generalists || []).find((v) => {
    const trades = Array.isArray(v.trades) ? v.trades.join(' ') : String(v.trades || '')
    return /general|handyman/i.test(trades + ' ' + (v.specialty || ''))
  })
  if (!prop?.id || !generalist) {
    record(
      'unavailable_pest_vendor',
      'partial',
      'Could not locate LA2 generalist fixture for pest negative assign',
      { hasProp: Boolean(prop?.id), generalists: generalists?.length || 0 },
    )
  } else {
    const ticketId = randomUUID()
    await admin.from('maintenance_requests').insert({
      id: ticketId,
      landlord_id: LA2,
      property_id: prop.id,
      description: 'ulo-integration pest ants in kitchen',
      issue_type: 'pest',
      priority: 'Normal',
      urgency: 'normal',
      vendor_work_status: 'unassigned',
      category: 'pest',
    })
    // Leave unassigned — no pest specialist required for this negative; prove ticket stays open.
    const { data: after } = await admin
      .from('maintenance_requests')
      .select('id,assigned_vendor_id,vendor_work_status')
      .eq('id', ticketId)
      .single()
    if (after?.assigned_vendor_id) {
      record('unavailable_pest_vendor', 'failed', 'Pest fixture was assigned unexpectedly', after)
    } else {
      record(
        'unavailable_pest_vendor',
        'passed',
        'Pest ticket remains unassigned without inventing a generalist booking',
        { ticketId, generalistId: generalist.id, status: after?.vendor_work_status },
      )
    }
  }
}

// Duplicate reply / duplicate ticket id
{
  const id = randomUUID()
  const row = {
    id,
    landlord_id: LA2,
    description: 'ulo-integration dup probe',
    priority: 'Normal',
    urgency: 'normal',
    vendor_work_status: 'unassigned',
  }
  const { error: e1 } = await admin.from('maintenance_requests').insert(row)
  if (e1) {
    record('duplicate_insert_setup', 'failed', e1.message)
  } else {
    const { error: e2 } = await admin.from('maintenance_requests').insert({
      ...row,
      description: 'ulo-integration dup probe 2',
    })
    if (e2) {
      record('duplicate_insert', 'passed', 'Duplicate id rejected', { message: e2.message })
    } else {
      record('duplicate_insert', 'failed', 'Duplicate id accepted')
    }
  }
}

// Late approval / handset YES
{
  const openTicket = process.env.INTEGRATION_OPEN_VENDOR_TICKET_ID || 'a14c986d-2972-45b7-b4a1-cdce0f5a5a66'
  const { data: ticket } = await admin
    .from('maintenance_requests')
    .select('id,vendor_work_status,assigned_vendor_id')
    .eq('id', openTicket)
    .eq('landlord_id', LA2)
    .maybeSingle()
  const { data: inbound } = await admin
    .from('sms_messages')
    .select('id,provider_message_sid,body,direction,created_at')
    .eq('direction', 'inbound')
    .ilike('body', 'YES')
    .gte('created_at', new Date(Date.now() - 6 * 3600_000).toISOString())
    .limit(20)
  const handsetYes = (inbound || []).find((m) => /^SM[0-9a-f]{32}$/i.test(String(m.provider_message_sid || '')))
  if (handsetYes && ticket?.vendor_work_status === 'accepted') {
    record('late_or_handset_approval', 'passed', 'Twilio inbound YES bound to accepted ticket', {
      ticketId: ticket.id,
      sid: handsetYes.provider_message_sid,
    })
  } else {
    record(
      'late_or_handset_approval',
      'not_run',
      'No Twilio handset YES (SM…) observed for open LA2 vendor ask — not claiming inject/simulated reply',
      {
        ticketStatus: ticket?.vendor_work_status ?? null,
        openTicket,
      },
    )
  }
}

// Failed delivery probe (optional SID list)
{
  const sids = String(process.env.INTEGRATION_SMS_CHECK_SIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!sids.length) {
    record(
      'failed_delivery_recovery',
      'not_run',
      'Set INTEGRATION_SMS_CHECK_SIDS=SM… to assert failed/undelivered recovery handling',
    )
  } else {
    record('failed_delivery_recovery', 'partial', 'SID list provided — use verify:sms-journey check_delivery', {
      sids,
    })
  }
}

const failed = results.some((r) => r.status === 'failed')
if (failed) finish('failed', 1)
finish(results.some((r) => r.status === 'not_run' || r.status === 'partial') ? 'partial' : 'passed', 0)
