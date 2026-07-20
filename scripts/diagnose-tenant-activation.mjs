#!/usr/bin/env node
/**
 * Diagnose why a received tenant activation SMS is not reflected in the
 * profile / activity feed / conversation inbox. Prints the landlord scoping
 * for the resident, the graph event, the conversation, and the messages.
 *
 * Usage:
 *   TENANT_PHONE=+19088843069 node scripts/diagnose-tenant-activation.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../.env')

try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
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
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value
    }
  }
} catch {
  // optional .env
}

const TENANT_PHONE = (process.env.TENANT_PHONE || '+19088843069').trim()
const digits = TENANT_PHONE.replace(/[^0-9]/g, '')
const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

async function resolveServiceRoleKey() {
  if (SERVICE_ROLE_KEY) return SERVICE_ROLE_KEY
  const { execSync } = await import('node:child_process')
  const json = execSync(
    `supabase projects api-keys --project-ref ${PROJECT_REF} -o json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const keys = JSON.parse(json)
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve Supabase service_role key')
  return sr.api_key
}

function h(title) {
  console.log(`\n=== ${title} ===`)
}

async function main() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL / VITE_SUPABASE_URL')
  const supabase = createClient(SUPABASE_URL, await resolveServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  h(`Resident(s) matching phone ${TENANT_PHONE}`)
  const { data: residents, error: rErr } = await supabase
    .from('users')
    .select('id, full_name, phone, landlord_id, unit, building, status, sms_consent_status, activation_sms_sent_at, created_at')
    .or(`phone.ilike.%${digits.slice(-10)}%,phone.eq.${TENANT_PHONE}`)
  if (rErr) console.log('users error:', rErr.message)
  console.table(residents ?? [])

  const residentIds = (residents ?? []).map((r) => r.id)
  const landlordIds = [...new Set((residents ?? []).map((r) => r.landlord_id))]

  h('sms_identities for phone')
  const { data: ids } = await supabase
    .from('sms_identities')
    .select('id, landlord_id, phone_number, identity_type, resident_id, vendor_id, verified')
    .ilike('phone_number', `%${digits.slice(-10)}%`)
  console.table(ids ?? [])

  h('sms_numbers (landlord_main lines)')
  const { data: nums } = await supabase
    .from('sms_numbers')
    .select('id, phone_number, provider, purpose, status, landlord_id')
    .eq('purpose', 'landlord_main')
  console.table(nums ?? [])

  h('operations_graph_events: tenant.activation_sms_sent')
  const { data: evts } = await supabase
    .from('operations_graph_events')
    .select('id, landlord_id, event_type, resident_id, conversation_id, message_id, created_at')
    .eq('event_type', 'tenant.activation_sms_sent')
    .order('created_at', { ascending: false })
    .limit(20)
  console.table(evts ?? [])

  h('sms_conversations for resident(s)')
  if (residentIds.length) {
    const { data: convs } = await supabase
      .from('sms_conversations')
      .select('id, landlord_id, conversation_type, status, resident_id, unit_id, external_phone_number, created_at, updated_at')
      .in('resident_id', residentIds)
      .order('updated_at', { ascending: false })
    console.table(convs ?? [])
  }

  h('sms_messages to/from phone')
  const { data: msgs } = await supabase
    .from('sms_messages')
    .select('id, landlord_id, conversation_id, direction, from_number, to_number, provider_status, created_at')
    .or(`to_number.ilike.%${digits.slice(-10)}%,from_number.ilike.%${digits.slice(-10)}%`)
    .order('created_at', { ascending: false })
    .limit(20)
  console.table(msgs ?? [])

  h('SUMMARY')
  console.log('resident landlord_id(s):', landlordIds)
  console.log('activation event landlord_id(s):', [...new Set((evts ?? []).map((e) => e.landlord_id))])
  console.log('landlord_main line landlord_id(s):', [...new Set((nums ?? []).map((n) => n.landlord_id))])
}

main().catch((err) => {
  console.error('FAIL', err.message)
  process.exit(1)
})
