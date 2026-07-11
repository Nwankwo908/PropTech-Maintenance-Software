#!/usr/bin/env node
/**
 * Add (or reset) an escalated lease renewal under Awaiting Your Decision.
 * On the showcase account, "Trigger move-out prep" creates Move-Out Preparation WO-D777.
 *
 * Usage:
 *   node scripts/add-lease-renewal-escalation.mjs
 *   LEASE_ESCALATION_RESIDENT="Tessa Freeman" node scripts/add-lease-renewal-escalation.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const SHOWCASE_LANDLORD_ID = 'de300000-0000-4000-8000-000000000001'
const TARGET_LANDLORD_ID =
  process.env.LEASE_ESCALATION_LANDLORD?.trim() ||
  process.env.WO_D777_LANDLORD?.trim() ||
  SHOWCASE_LANDLORD_ID
const WORKFLOW_RUN_ID = '1e050002-0000-4000-8000-000000000001'
const DEFAULT_RESIDENT_NAME = process.env.LEASE_ESCALATION_RESIDENT?.trim() || "Liam O'Connor"

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

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()

async function resolveServiceRoleKey() {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (fromEnv) return fromEnv
  const { execSync } = await import('node:child_process')
  const json = execSync(
    'supabase projects api-keys --project-ref mzpqwuizhiaczxcnmxbt -o json',
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const keys = JSON.parse(json)
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve Supabase service_role key')
  return sr.api_key
}

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString()
}

function isoDateOnly(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

async function resolveResident(supabase, name) {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, unit, building, phone, lease_end_date')
    .eq('landlord_id', TARGET_LANDLORD_ID)
    .ilike('full_name', name)
    .maybeSingle()

  if (error) throw new Error(`users: ${error.message}`)
  if (!data?.id) {
    throw new Error(`Resident "${name}" not found on landlord ${TARGET_LANDLORD_ID}`)
  }
  return data
}

async function main() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL / VITE_SUPABASE_URL')

  const serviceRoleKey = await resolveServiceRoleKey()
  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const resident = await resolveResident(supabase, DEFAULT_RESIDENT_NAME)
  const building = resident.building?.trim()
  const unitLabel = resident.unit?.trim()
  if (!building || !unitLabel) {
    throw new Error(`Resident ${resident.full_name} is missing building/unit`)
  }

  const { data: unitRow, error: unitError } = await supabase
    .from('units')
    .select('id')
    .eq('landlord_id', TARGET_LANDLORD_ID)
    .eq('building', building)
    .eq('unit_label', unitLabel)
    .maybeSingle()
  if (unitError) throw new Error(`units: ${unitError.message}`)
  if (!unitRow?.id) throw new Error(`Unit ${building} · ${unitLabel} not found`)

  const { data: propertyId, error: propertyError } = await supabase.rpc(
    'derive_property_id',
    { p_landlord_id: TARGET_LANDLORD_ID, p_building: building },
  )
  if (propertyError) throw new Error(`derive_property_id: ${propertyError.message}`)

  const leaseEndDate =
    resident.lease_end_date?.slice(0, 10) ||
    isoDateOnly(new Date(Date.now() + 21 * 86_400_000))
  const escalatedAt = hoursAgo(6)
  const startedAt = hoursAgo(18 * 24)

  await supabase.from('workflow_events').delete().eq('workflow_run_id', WORKFLOW_RUN_ID)
  await supabase
    .from('property_operations_graph')
    .delete()
    .eq('workflow_run_id', WORKFLOW_RUN_ID)

  const metadata = {
    landlord_id: TARGET_LANDLORD_ID,
    unit_label: unitLabel,
    building,
    lease_end_date: leaseEndDate,
    notice_days: 60,
    reminders_sent: 3,
    escalation_reason: 'no_response',
    escalated_at: escalatedAt,
  }

  const { error: runError } = await supabase.from('workflow_runs').upsert(
    {
      id: WORKFLOW_RUN_ID,
      template_id: 'lease_renewal',
      status: 'escalated',
      entity_type: 'user',
      entity_id: resident.id,
      property_id: propertyId,
      unit_id: unitRow.id,
      resident_id: resident.id,
      landlord_id: TARGET_LANDLORD_ID,
      trigger_type: 'cron',
      workflow_type: 'leasing',
      current_stage: 'escalated',
      current_step: 'no_response',
      started_at: startedAt,
      completed_at: null,
      metadata,
    },
    { onConflict: 'id' },
  )
  if (runError) throw new Error(`workflow_runs: ${runError.message}`)

  const shortName = resident.full_name?.trim() || 'Tenant'
  const workflowEvents = [
    {
      id: '1e050010-0000-4000-8000-000000000001',
      workflow_run_id: WORKFLOW_RUN_ID,
      event_type: 'workflow.act',
      step: 'renewal_offer_sent',
      stage: 'act',
      actor_type: 'system',
      message: `Lease renewal offer sent to ${shortName} — lease ends ${leaseEndDate}.`,
      landlord_id: TARGET_LANDLORD_ID,
      workflow_type: 'leasing',
      created_at: hoursAgo(14 * 24),
    },
    {
      id: '1e050011-0000-4000-8000-000000000001',
      workflow_run_id: WORKFLOW_RUN_ID,
      event_type: 'workflow.act',
      step: 'renewal_reminder_sent',
      stage: 'act',
      actor_type: 'system',
      message: 'Third renewal reminder sent via SMS and email — no tenant response.',
      landlord_id: TARGET_LANDLORD_ID,
      workflow_type: 'leasing',
      created_at: hoursAgo(3 * 24),
    },
    {
      id: '1e050012-0000-4000-8000-000000000001',
      workflow_run_id: WORKFLOW_RUN_ID,
      event_type: 'workflow.escalate',
      step: 'no_response',
      stage: 'escalate',
      actor_type: 'system',
      message: `No response after 3 renewal reminders to ${shortName}. Escalated.`,
      landlord_id: TARGET_LANDLORD_ID,
      workflow_type: 'leasing',
      created_at: escalatedAt,
    },
  ]

  const { error: eventsError } = await supabase.from('workflow_events').upsert(workflowEvents)
  if (eventsError) throw new Error(`workflow_events: ${eventsError.message}`)

  const { error: graphError } = await supabase.from('property_operations_graph').upsert(
    {
      id: '1e050020-0000-4000-8000-000000000001',
      landlord_id: TARGET_LANDLORD_ID,
      property_id: propertyId,
      unit_id: unitRow.id,
      resident_id: resident.id,
      vendor_id: null,
      workflow_run_id: WORKFLOW_RUN_ID,
      event_type: 'workflow.escalate',
      event_source: 'automation',
      event_payload: {
        message: `Lease renewal escalated — no response from ${shortName}.`,
        unit_label: unitLabel,
        building,
        workflow_template_id: 'lease_renewal',
        lease_end_date: leaseEndDate,
      },
      created_at: escalatedAt,
    },
    { onConflict: 'id' },
  )
  if (graphError) throw new Error(`property_operations_graph: ${graphError.message}`)

  console.log('Lease renewal escalation added.')
  console.log(`  landlord_id:       ${TARGET_LANDLORD_ID}`)
  console.log(`  workflow_run_id:   ${WORKFLOW_RUN_ID}`)
  console.log(`  resident:          ${resident.full_name}`)
  console.log(`  location:          ${building} · ${unitLabel}`)
  console.log(`  lease_end_date:    ${leaseEndDate}`)
  console.log('Open Admin Overview → Awaiting Your Decision → Lease Renewal Escalated.')
  console.log('Trigger move-out prep → Move-Out Preparation WO-D777 in Active Tasks.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
