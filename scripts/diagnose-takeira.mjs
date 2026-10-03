#!/usr/bin/env node
/**
 * Diagnose Takeira Chester: balance, open tickets, Oct 2 SMS thread.
 * LANDLORD_ID defaults to Limited Alpha (de300000-…0003).
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

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

const landlordId =
  process.env.LANDLORD_ID?.trim() || 'de300000-0000-4000-8000-000000000003'
const supabase = createClient(
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim(),
  await serviceRoleKey(),
  { auth: { persistSession: false } },
)

const { data: residents } = await supabase
  .from('users')
  .select(
    'id, full_name, unit, building, email, phone, balance_due, monthly_rent, rent_due_day, status, subsidy_type, section_8, hap_amount, tenant_rent_portion, housing_assistance',
  )
  .eq('landlord_id', landlordId)
  .ilike('full_name', '%takeira%')

// Column set may not all exist — retry lean if needed
let residentRows = residents
if (!residents) {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, full_name, unit, building, email, phone, balance_due, monthly_rent, rent_due_day, status',
    )
    .eq('landlord_id', landlordId)
    .ilike('full_name', '%takeira%')
  if (error) throw error
  residentRows = data
}

const takeira = (residentRows ?? [])[0]
if (!takeira) {
  console.log(JSON.stringify({ error: 'Takeira not found', landlordId }, null, 2))
  process.exit(1)
}

const [{ data: occupancy }, { data: tickets }, { data: rentRuns }, { data: convos }] =
  await Promise.all([
    supabase
      .from('occupancy')
      .select('unit_id, status, monthly_rent, tenant_portion, hap_amount, subsidy')
      .eq('landlord_id', landlordId)
      .eq('resident_id', takeira.id),
    supabase
      .from('maintenance_requests')
      .select(
        'id, issue_category, description, vendor_work_status, unit, unit_id, property_id, created_at, updated_at',
      )
      .eq('landlord_id', landlordId)
      .or(`resident_user_id.eq.${takeira.id},email.eq.${takeira.email || 'none'}`)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('workflow_runs')
      .select('id, template_id, status, current_step, metadata, unit_id, property_id, started_at')
      .eq('landlord_id', landlordId)
      .eq('resident_id', takeira.id)
      .order('started_at', { ascending: false })
      .limit(20),
    supabase
      .from('sms_conversations')
      .select('id, maintenance_request_id, unit_id, conversation_type, updated_at, intake_state')
      .eq('landlord_id', landlordId)
      .eq('resident_id', takeira.id)
      .order('updated_at', { ascending: false })
      .limit(10),
  ])

const convoIds = (convos ?? []).map((c) => c.id)
const { data: messages } = convoIds.length
  ? await supabase
      .from('sms_messages')
      .select('id, conversation_id, direction, body, created_at, source')
      .in('conversation_id', convoIds)
      .gte('created_at', '2026-10-01T00:00:00.000Z')
      .order('created_at', { ascending: true })
      .limit(200)
  : { data: [] }

// Also search messages mentioning paint / door / patched
const paintMsgs = (messages ?? []).filter((m) =>
  /paint|door|patched|ceiling|wall|repairs|did you see/i.test(m.body || ''),
)

console.log(
  JSON.stringify(
    {
      landlordId,
      resident: takeira,
      occupancy,
      tickets: (tickets ?? []).map((t) => ({
        ...t,
        wo: `WO-${String(t.id).replace(/-/g, '').slice(0, 4).toUpperCase()}`,
      })),
      rentRuns: rentRuns ?? [],
      conversations: convos ?? [],
      octMessages: messages ?? [],
      paintRelated: paintMsgs,
    },
    null,
    2,
  ),
)
