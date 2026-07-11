#!/usr/bin/env node
/**
 * Reset and seed demo WO-D777 as Move-Out Preparation (showcase account only).
 *
 * Usage:
 *   node scripts/reescalate-wo-d777.mjs
 *
 * View in app as demo@ulohome.io → Active Tasks → WO-D777
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

/** Demo Property Management showcase account (demo@ulohome.io). */
const SHOWCASE_LANDLORD_ID = 'de300000-0000-4000-8000-000000000001'
const TARGET_LANDLORD_ID =
  process.env.WO_D777_LANDLORD?.trim() ||
  process.env.VITE_WO_D777_LANDLORD?.trim() ||
  SHOWCASE_LANDLORD_ID
const RESIDENT_NAME = process.env.WO_D777_RESIDENT?.trim() || "Liam O'Connor"

const MOVE_OUT_RUN_ID = 'd7770000-0000-4000-8000-000000000001'
const LEGACY_MAINTENANCE_RUN_ID = 'd7770001-0000-4000-8000-000000000001'
const LEGACY_MAINTENANCE_TICKET_ID = MOVE_OUT_RUN_ID
const LEASE_RUN_ID = '1e050002-0000-4000-8000-000000000001'

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

async function purgeRunArtifacts(supabase, runId) {
  await supabase.from('workflow_events').delete().eq('workflow_run_id', runId)
  await supabase.from('property_operations_graph').delete().eq('workflow_run_id', runId)
  await supabase.from('workflow_runs').delete().eq('id', runId)
}

async function resolveResident(supabase) {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, unit, building, lease_end_date')
    .eq('landlord_id', TARGET_LANDLORD_ID)
    .ilike('full_name', RESIDENT_NAME)
    .maybeSingle()
  if (error) throw new Error(`users: ${error.message}`)
  if (!data?.id) throw new Error(`Resident "${RESIDENT_NAME}" not found`)
  return data
}

async function main() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL / VITE_SUPABASE_URL')

  const serviceRoleKey = await resolveServiceRoleKey()
  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const resident = await resolveResident(supabase)
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

  const moveOutDate =
    resident.lease_end_date?.slice(0, 10) ||
    new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)
  const kickoffAt = hoursAgo(1)
  const startedAt = hoursAgo(3)

  await supabase.from('vendor_status_events').delete().eq('ticket_id', LEGACY_MAINTENANCE_TICKET_ID)
  await supabase.from('maintenance_requests').delete().eq('id', LEGACY_MAINTENANCE_TICKET_ID)
  await purgeRunArtifacts(supabase, LEGACY_MAINTENANCE_RUN_ID)
  await purgeRunArtifacts(supabase, MOVE_OUT_RUN_ID)

  const cancelNow = new Date().toISOString()
  const { data: staleMoveOuts, error: staleLookupError } = await supabase
    .from('workflow_runs')
    .select('id')
    .eq('landlord_id', TARGET_LANDLORD_ID)
    .eq('template_id', 'move_out')
    .eq('status', 'active')

  if (staleLookupError) throw new Error(`stale move_out lookup: ${staleLookupError.message}`)
  if (staleMoveOuts?.length) {
    await supabase
      .from('workflow_runs')
      .update({ status: 'cancelled', current_step: 'cancelled', completed_at: cancelNow })
      .eq('landlord_id', TARGET_LANDLORD_ID)
      .eq('template_id', 'move_out')
      .eq('status', 'active')
    console.log(`  cancelled active move_out runs: ${staleMoveOuts.map((r) => r.id).join(', ')}`)
  }

  const metadata = {
    landlord_id: TARGET_LANDLORD_ID,
    unit_label: unitLabel,
    building,
    move_out_date: moveOutDate,
    move_out_classification: 'lease_end',
    source_workflow: 'lease_renewal',
    source_workflow_run_id: LEASE_RUN_ID,
    source_workflow_template_id: 'lease_renewal',
    kickoff_source: 'lease_renewal_escalation',
    kickoff_completed_at: kickoffAt,
    milestones: {
      move_out_started: startedAt,
      instructions_sent: hoursAgo(2),
      cleaning_scheduled: kickoffAt,
    },
    checklist: {
      resident_notified: true,
      instructions_delivered: true,
      notice_received: true,
      cleaning_scheduled: true,
      inspection_scheduled: true,
    },
    step_state: {
      step: 'inspection_scheduled',
      move_out_date: moveOutDate,
    },
  }

  const { error: runError } = await supabase.from('workflow_runs').upsert(
    {
      id: MOVE_OUT_RUN_ID,
      template_id: 'move_out',
      status: 'active',
      entity_type: 'unit',
      entity_id: unitRow.id,
      property_id: propertyId,
      unit_id: unitRow.id,
      resident_id: resident.id,
      landlord_id: TARGET_LANDLORD_ID,
      trigger_type: 'dashboard',
      workflow_type: 'leasing',
      current_stage: 'inspection_scheduled',
      current_step: 'inspection_scheduled',
      started_at: startedAt,
      completed_at: null,
      metadata,
    },
    { onConflict: 'id' },
  )
  if (runError) throw new Error(`workflow_runs: ${runError.message}`)

  const workflowEvents = [
    {
      id: 'd7770030-0000-4000-8000-000000000001',
      workflow_run_id: MOVE_OUT_RUN_ID,
      event_type: 'move_out.started',
      step: 'initiated',
      stage: 'trigger',
      actor_type: 'system',
      message: 'Move-out workflow started from lease renewal escalation',
      landlord_id: TARGET_LANDLORD_ID,
      workflow_type: 'leasing',
      created_at: startedAt,
    },
    {
      id: 'd7770031-0000-4000-8000-000000000001',
      workflow_run_id: MOVE_OUT_RUN_ID,
      event_type: 'workflow.act',
      step: 'cleaning_scheduled',
      stage: 'act',
      actor_type: 'system',
      message: 'Turnover cleaning auto-scheduled from lease renewal escalation',
      landlord_id: TARGET_LANDLORD_ID,
      workflow_type: 'leasing',
      created_at: kickoffAt,
    },
    {
      id: 'd7770032-0000-4000-8000-000000000001',
      workflow_run_id: MOVE_OUT_RUN_ID,
      event_type: 'workflow.act',
      step: 'inspection_scheduled',
      stage: 'act',
      actor_type: 'system',
      message: 'Move-out inspection queued after automated kickoff',
      landlord_id: TARGET_LANDLORD_ID,
      workflow_type: 'leasing',
      created_at: kickoffAt,
    },
  ]

  const { error: eventsError } = await supabase.from('workflow_events').upsert(workflowEvents)
  if (eventsError) throw new Error(`workflow_events: ${eventsError.message}`)

  const { error: graphError } = await supabase.from('property_operations_graph').upsert(
    {
      id: 'd7770040-0000-4000-8000-000000000001',
      landlord_id: TARGET_LANDLORD_ID,
      property_id: propertyId,
      unit_id: unitRow.id,
      resident_id: resident.id,
      vendor_id: null,
      workflow_run_id: MOVE_OUT_RUN_ID,
      event_type: 'move_out.inspection_scheduled',
      event_source: 'automation',
      event_payload: {
        message: 'Move-out inspection queued during automated kickoff',
        source_workflow_run_id: LEASE_RUN_ID,
      },
      created_at: kickoffAt,
    },
    { onConflict: 'id' },
  )
  if (graphError) throw new Error(`property_operations_graph: ${graphError.message}`)

  console.log('WO-D777 Move-Out Preparation seeded.')
  console.log(`  landlord_id:     ${TARGET_LANDLORD_ID}`)
  console.log(`  workflow_run_id: ${MOVE_OUT_RUN_ID}`)
  console.log(`  work order ref:  WO-D777`)
  console.log(`  resident:        ${resident.full_name}`)
  console.log(`  location:        ${building} · ${unitLabel}`)
  console.log(`  current_step:    inspection_scheduled (stages 1–3 complete)`)
  console.log('')
  console.log('Open the app signed in as demo@ulohome.io')
  console.log('  Active Tasks → Move-Out Preparation → WO-D777')
  console.log('  Direct: /admin/workflows?run=d7770000-0000-4000-8000-000000000001')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
