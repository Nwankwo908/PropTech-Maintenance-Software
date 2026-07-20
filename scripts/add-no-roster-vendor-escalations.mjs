#!/usr/bin/env node
/**
 * Seed extra "Assign vendor — none on roster" items under Awaiting Your Decision
 * so external vendor search can be tested across different issue categories.
 *
 * Usage:
 *   node scripts/add-no-roster-vendor-escalations.mjs
 *
 * Idempotent: upserts fixed demo ticket + workflow run IDs on the showcase landlord.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const SHOWCASE_LANDLORD_ID = 'de300000-0000-4000-8000-000000000001'
const TARGET_LANDLORD_ID =
  process.env.NO_ROSTER_LANDLORD?.trim() ||
  process.env.LEASE_ESCALATION_LANDLORD?.trim() ||
  SHOWCASE_LANDLORD_ID

/** Deterministic demo UUIDs (same style as seed_demo_landlord_account.sql). */
function demoUuid(label) {
  const hex = createHash('md5').update(`ulo-demo-no-roster-${label}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Categories map to distinct external search trade terms
 * (see supabase/functions/_shared/external_vendor/trade_terms.ts).
 */
const CASES = [
  {
    key: 'plumbing',
    issueCategory: 'plumbing',
    urgency: 'urgent',
    reason: 'sla_expired_no_vendor',
    declinedVendor: null,
    residentName: 'Jordan Walker',
    description:
      'Kitchen main line clogged; standing water. No plumbing vendor available on roster for reassignment.',
    hoursAgoStarted: 30,
    hoursAgoEscalated: 6,
    dueHoursAgo: 4,
  },
  {
    key: 'electrical',
    issueCategory: 'electrical',
    urgency: 'high',
    reason: 'vendor_declined_no_vendor',
    declinedVendor: 'Brightline Electrical',
    residentName: 'Omar Haddad',
    description:
      'Panel hot to the touch after surge. Assigned electrician declined — no other electrical specialist on roster.',
    hoursAgoStarted: 20,
    hoursAgoEscalated: 3,
    dueHoursAgo: 2,
  },
  {
    key: 'hvac',
    issueCategory: 'hvac',
    urgency: 'urgent',
    reason: 'sla_expired_no_vendor',
    declinedVendor: null,
    residentName: 'Bianca Silva',
    description:
      'AC compressor failed during heat advisory. SLA expired with no HVAC vendor left on roster.',
    hoursAgoStarted: 28,
    hoursAgoEscalated: 5,
    dueHoursAgo: 8,
  },
  {
    key: 'appliance',
    issueCategory: 'appliance',
    urgency: 'normal',
    reason: 'vendor_declined_no_vendor',
    declinedVendor: 'Allied General Maintenance',
    residentName: 'Anita Patel',
    description:
      'Refrigerator not cooling; food spoiling. Generalist declined appliance work — none on roster for this trade.',
    hoursAgoStarted: 16,
    hoursAgoEscalated: 4,
    dueHoursAgo: 1,
  },
  {
    key: 'pest',
    issueCategory: 'pest_control',
    urgency: 'high',
    reason: 'sla_expired_no_vendor',
    declinedVendor: null,
    residentName: 'Grace Chen',
    description:
      'Active pest infestation reported in kitchen cabinets. No pest-control vendor on roster.',
    hoursAgoStarted: 22,
    hoursAgoEscalated: 2,
    dueHoursAgo: 3,
  },
]

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

async function resolveResident(supabase, name) {
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, unit, building, phone, email')
    .eq('landlord_id', TARGET_LANDLORD_ID)
    .ilike('full_name', name)
    .maybeSingle()

  if (error) throw new Error(`users (${name}): ${error.message}`)
  if (!data?.id) throw new Error(`Resident "${name}" not found on landlord ${TARGET_LANDLORD_ID}`)
  return data
}

async function main() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL / VITE_SUPABASE_URL')

  const serviceRoleKey = await resolveServiceRoleKey()
  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const seeded = []

  for (const spec of CASES) {
    const ticketId = demoUuid(`ticket-${spec.key}`)
    const runId = demoUuid(`run-${spec.key}`)
    const resident = await resolveResident(supabase, spec.residentName)
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

    const { data: propertyId, error: propertyError } = await supabase.rpc('derive_property_id', {
      p_landlord_id: TARGET_LANDLORD_ID,
      p_building: building,
    })
    if (propertyError) throw new Error(`derive_property_id: ${propertyError.message}`)

    const startedAt = hoursAgo(spec.hoursAgoStarted)
    const escalatedAt = hoursAgo(spec.hoursAgoEscalated)
    const dueAt = hoursAgo(spec.dueHoursAgo)
    const unitDisplay = `${building} · ${unitLabel}`

    await supabase.from('vendor_status_events').delete().eq('ticket_id', ticketId)
    await supabase.from('workflow_events').delete().eq('workflow_run_id', runId)
    await supabase.from('property_operations_graph').delete().eq('workflow_run_id', runId)
    await supabase.from('workflow_runs').delete().eq('id', runId)

    const { error: ticketError } = await supabase.from('maintenance_requests').upsert(
      {
        id: ticketId,
        landlord_id: TARGET_LANDLORD_ID,
        created_at: startedAt,
        priority: spec.urgency,
        urgency: spec.urgency,
        severity: spec.urgency,
        resident_name: resident.full_name,
        email: resident.email,
        resident_phone: resident.phone,
        unit: unitDisplay,
        description: spec.description,
        vendor_work_status: 'unassigned',
        issue_category: spec.issueCategory,
        assigned_vendor_id: null,
        assigned_at: null,
        due_at: dueAt,
      },
      { onConflict: 'id' },
    )
    if (ticketError) throw new Error(`maintenance_requests (${spec.key}): ${ticketError.message}`)

    const metadata = {
      landlord_id: TARGET_LANDLORD_ID,
      unit_label: unitLabel,
      building,
      maintenance_request_id: ticketId,
      issue_category: spec.issueCategory,
      urgency: spec.urgency,
      due_at: dueAt,
      escalation_reason: spec.reason,
      escalated_at: escalatedAt,
      sla_breached: true,
      ...(spec.declinedVendor ? { declined_vendor: spec.declinedVendor } : {}),
    }

    const { error: runError } = await supabase.from('workflow_runs').upsert(
      {
        id: runId,
        template_id: 'maintenance_intake',
        status: 'escalated',
        entity_type: 'maintenance_request',
        entity_id: ticketId,
        property_id: propertyId,
        unit_id: unitRow.id,
        resident_id: resident.id,
        landlord_id: TARGET_LANDLORD_ID,
        trigger_type: 'sms_inbound',
        workflow_type: 'maintenance',
        current_stage: 'escalated',
        current_step: 'needs_admin_vendor',
        started_at: startedAt,
        completed_at: null,
        metadata,
      },
      { onConflict: 'id' },
    )
    if (runError) throw new Error(`workflow_runs (${spec.key}): ${runError.message}`)

    const escalateMessage =
      spec.reason === 'vendor_declined_no_vendor'
        ? `${spec.declinedVendor ?? 'Vendor'} declined — no other ${spec.issueCategory} vendor on roster. Admin must assign or onboard.`
        : `SLA expired for ${spec.issueCategory} — no roster vendor available. Admin must assign or onboard.`

    const { error: eventError } = await supabase.from('workflow_events').insert([
      {
        id: demoUuid(`evt-${spec.key}-act`),
        workflow_run_id: runId,
        event_type: 'workflow.act',
        stage: 'vendor_dispatch',
        step: 'act',
        actor_type: 'system',
        message: `Dispatched ${spec.issueCategory} request for ${unitDisplay}.`,
        landlord_id: TARGET_LANDLORD_ID,
        workflow_type: 'maintenance',
        created_at: hoursAgo(spec.hoursAgoStarted - 1),
      },
      {
        id: demoUuid(`evt-${spec.key}-esc`),
        workflow_run_id: runId,
        event_type: 'workflow.escalate',
        stage: 'needs_admin_vendor',
        step: 'escalate',
        actor_type: 'system',
        message: escalateMessage,
        landlord_id: TARGET_LANDLORD_ID,
        workflow_type: 'maintenance',
        created_at: escalatedAt,
      },
    ])
    if (eventError) throw new Error(`workflow_events (${spec.key}): ${eventError.message}`)

    const graphType =
      spec.reason === 'vendor_declined_no_vendor'
        ? 'maintenance.vendor_declined_needs_vendor'
        : 'maintenance.sla_expired_needs_vendor'

    const { error: graphError } = await supabase.from('property_operations_graph').insert({
      id: demoUuid(`graph-${spec.key}`),
      landlord_id: TARGET_LANDLORD_ID,
      property_id: propertyId,
      unit_id: unitRow.id,
      resident_id: resident.id,
      workflow_run_id: runId,
      event_type: graphType,
      event_source: 'automation',
      event_payload: {
        message: escalateMessage,
        maintenance_request_id: ticketId,
        unit_label: unitLabel,
        building,
        issue_category: spec.issueCategory,
        escalation_reason: spec.reason,
      },
      created_at: escalatedAt,
    })
    if (graphError) throw new Error(`property_operations_graph (${spec.key}): ${graphError.message}`)

    seeded.push({
      category: spec.issueCategory,
      reason: spec.reason,
      ticketId,
      runId,
      location: unitDisplay,
      resident: resident.full_name,
    })
  }

  console.log(`Seeded ${seeded.length} none-on-roster assign-vendor escalations:`)
  for (const row of seeded) {
    console.log(
      `  · ${row.category.padEnd(14)} ${row.reason} @ ${row.location} (${row.resident})`,
    )
  }
  console.log('\nRefresh Admin Overview → Awaiting Your Decision → Assign vendor to test search.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
