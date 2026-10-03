#!/usr/bin/env node
/**
 * Report-only: maintenance.vendor_choice_selected without a confirming inbound
 * sms_messages row in the preceding ~2 minutes (WO-E6F7 class).
 *
 * Standing check: daily cron `ulo-vendor-choice-trigger-audit` →
 * `check-vendor-choice-trigger-audit`.
 *
 *   node scripts/audit-vendor-choice-triggers.mjs
 *   LANDLORD_ID=... node scripts/audit-vendor-choice-triggers.mjs
 *   SINCE=2026-09-23T03:39:10Z node scripts/audit-vendor-choice-triggers.mjs
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import {
  findPhantomVendorChoiceSelected,
  VENDOR_CHOICE_TRIGGER_WINDOW_MS,
} from '../shared/ops/vendorChoiceTriggerAudit.ts'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const __dirname = dirname(fileURLToPath(import.meta.url))
try {
  for (const line of readFileSync(resolve(__dirname, '../.env'), 'utf8').split('\n')) {
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
} catch {}

async function serviceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  }
  const keys = JSON.parse(
    execSync(`supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, {
      encoding: 'utf8',
    }),
  )
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve service_role key')
  return sr.api_key
}

const landlordId = process.env.LANDLORD_ID?.trim() || null
const since = process.env.SINCE?.trim() || null

const supabase = createClient(
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim(),
  await serviceRoleKey(),
  { auth: { persistSession: false } },
)

let query = supabase
  .from('operations_graph_events')
  .select(
    'id, created_at, landlord_id, conversation_id, message_id, maintenance_request_id, metadata',
  )
  .eq('event_type', 'maintenance.vendor_choice_selected')
  .order('created_at', { ascending: true })
  .limit(2000)

if (landlordId) query = query.eq('landlord_id', landlordId)
if (since) query = query.gte('created_at', since)

const { data: events, error } = await query
if (error) throw error

const rows = events ?? []
if (rows.length === 0) {
  console.log(JSON.stringify({ eventsScanned: 0, phantoms: 0, since, landlordId }, null, 2))
  process.exit(0)
}

const earliest = rows[0].created_at
const latest = rows[rows.length - 1].created_at
const windowStart = new Date(
  new Date(earliest).getTime() - VENDOR_CHOICE_TRIGGER_WINDOW_MS,
).toISOString()

let inboundQuery = supabase
  .from('sms_messages')
  .select('id, created_at, conversation_id, landlord_id, direction')
  .eq('direction', 'inbound')
  .gte('created_at', windowStart)
  .lte('created_at', latest)
  .limit(5000)
if (landlordId) inboundQuery = inboundQuery.eq('landlord_id', landlordId)

const { data: inbound, error: inboundErr } = await inboundQuery
if (inboundErr) throw inboundErr

const phantoms = findPhantomVendorChoiceSelected({
  events: rows,
  inboundMessages: inbound ?? [],
})

console.log(
  JSON.stringify(
    {
      eventsScanned: rows.length,
      phantoms: phantoms.length,
      since,
      landlordId,
      phantomRows: phantoms,
    },
    null,
    2,
  ),
)
