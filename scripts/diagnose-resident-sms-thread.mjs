#!/usr/bin/env node
/**
 * Read-only: print a resident's SMS thread plus how Ulo interpreted it.
 *
 * Shows the conversation intake_state, every message in order, the
 * maintenance requests that came out of the thread, and the recognizer
 * diagnostics (sms.intent_recognized / sms.gate_miss) for the same window.
 *
 * Usage:
 *   RESIDENT_NAME="Adriana" node scripts/diagnose-resident-sms-thread.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  for (const line of readFileSync(resolve(__dirname, '../.env'), 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value
  }
} catch {
  // optional .env
}

const NAME = (process.env.RESIDENT_NAME || 'Adriana').trim()
const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()

async function serviceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  const { execSync } = await import('node:child_process')
  const keys = JSON.parse(
    execSync(`supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve Supabase service_role key')
  return sr.api_key
}

const clip = (s, n = 400) => (s == null ? '' : String(s).replace(/\s+/g, ' ').slice(0, n))
const stamp = (s) => (s ? new Date(s).toLocaleString('en-US', { timeZone: 'America/New_York' }) : '—')

const supabase = createClient(SUPABASE_URL, await serviceRoleKey(), {
  auth: { persistSession: false },
})

const { data: residents } = await supabase
  .from('users')
  .select('id, full_name, phone, landlord_id, unit, activation_status, created_at')
  .ilike('full_name', `%${NAME}%`)

if (!residents?.length) {
  console.log(`No resident matching "${NAME}"`)
  process.exit(0)
}

for (const r of residents) {
  console.log('\n' + '='.repeat(78))
  console.log(`RESIDENT ${r.full_name} | ${r.phone} | unit ${r.unit ?? '—'} | ${r.activation_status}`)
  console.log(`id ${r.id} | landlord ${r.landlord_id}`)

  const digits = (r.phone ?? '').replace(/[^0-9]/g, '').slice(-10)

  const { data: identities, error: idErr } = await supabase
    .from('sms_identities')
    .select('id, phone_number, identity_type, unit_id, landlord_id, resident_id')
    .like('phone_number', `%${digits}`)
  if (idErr) console.error('  identities error:', idErr.message)

  console.log(`\nSMS IDENTITIES (${identities?.length ?? 0}):`)
  for (const i of identities ?? []) {
    console.log(`  ${i.identity_type} | ${i.phone_number} | linked resident ${i.resident_id ?? 'NONE'}`)
  }

  const { data: convos, error: convErr } = await supabase
    .from('sms_conversations')
    .select(
      'id, external_phone_number, conversation_type, status, intake_state, resident_id, maintenance_request_id, created_at, updated_at',
    )
    .like('external_phone_number', `%${digits}`)
    .order('updated_at', { ascending: false })
  if (convErr) console.error('  conversations error:', convErr.message)

  for (const c of convos ?? []) {
    console.log('\n' + '-'.repeat(78))
    console.log(`CONVERSATION ${c.id} | ${c.conversation_type} | ${c.status} | updated ${stamp(c.updated_at)}`)
    console.log('INTAKE STATE:', JSON.stringify(c.intake_state, null, 2))

    const { data: msgs, error: msgErr } = await supabase
      .from('sms_messages')
      .select('id, direction, body, created_at, provider_status')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: true })
    if (msgErr) console.error('  messages error:', msgErr.message)

    console.log(`\nMESSAGES (${msgs?.length ?? 0}):`)
    for (const m of msgs ?? []) {
      const who = m.direction === 'inbound' ? 'RESIDENT' : 'ULO     '
      console.log(`  [${stamp(m.created_at)}] ${who} ${clip(m.body, 700)}`)
    }
  }

  const { data: tickets, error: tErr } = await supabase
    .from('maintenance_requests')
    .select('id, title, description, issue_type, urgency, status, vendor_work_status, created_at')
    .like('resident_phone', `%${digits}`)
    .order('created_at', { ascending: false })
    .limit(10)
  if (tErr) console.error('  tickets error:', tErr.message)

  console.log(`\nMAINTENANCE REQUESTS (${tickets?.length ?? 0}):`)
  for (const t of tickets ?? []) {
    console.log(`  [${stamp(t.created_at)}] ${t.issue_type ?? '—'} / ${t.urgency ?? '—'} / ${t.status}`)
    console.log(`     title: ${clip(t.title, 200)}`)
    console.log(`     desc : ${clip(t.description, 300)}`)
  }

  const { data: events } = await supabase
    .from('operations_graph_events')
    .select('event_type, created_at, metadata')
    .eq('resident_id', r.id)
    .in('event_type', ['sms.intent_recognized', 'sms.gate_miss'])
    .order('created_at', { ascending: false })
    .limit(40)

  console.log(`\nRECOGNIZER DIAGNOSTICS (${events?.length ?? 0}):`)
  for (const e of events ?? []) {
    console.log(`  [${stamp(e.created_at)}] ${e.event_type} ${JSON.stringify(e.metadata)}`)
  }
}
