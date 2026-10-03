#!/usr/bin/env node
/**
 * Ensure a maintenance_request workflow_run exists for a ticket (Active Tasks).
 *
 * Prefer the Edge remediator for full SMS + dispatch:
 *   node scripts/remediate-orphaned-maintenance-ticket.mjs --ticket <uuid>
 *
 * This helper is the DB-only half used by backfill scripts so ticket creation
 * never leaves an orphan row without a workflow run.
 *
 * Usage:
 *   TICKET_ID=... node scripts/ensure-maintenance-request-workflow.mjs
 *   node scripts/ensure-maintenance-request-workflow.mjs --ticket <uuid>
 *   DRY_RUN=1 node scripts/ensure-maintenance-request-workflow.mjs --ticket <uuid>
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

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
} catch {
  // optional
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} ticketId
 * @param {{ dryRun?: boolean, source?: string }} [opts]
 */
export async function ensureMaintenanceRequestWorkflow(sb, ticketId, opts = {}) {
  const dryRun = opts.dryRun === true
  const source = opts.source ?? 'backfill'

  const { data: ticket, error } = await sb
    .from('maintenance_requests')
    .select(
      'id, landlord_id, property_id, unit_id, unit, resident_user_id, resident_name, resident_phone, issue_category, urgency, priority, due_at, assigned_vendor_id, vendor_work_status, created_at',
    )
    .eq('id', ticketId)
    .maybeSingle()
  if (error) throw error
  if (!ticket?.id) throw new Error(`Ticket not found: ${ticketId}`)

  // Fail closed: unit_id must belong to property_id when both are set.
  if (ticket.unit_id && ticket.property_id) {
    const { data: unitRow, error: unitErr } = await sb
      .from('units')
      .select('id, property_id, building, unit_label')
      .eq('id', ticket.unit_id)
      .maybeSingle()
    if (unitErr) throw unitErr
    if (!unitRow?.id) {
      throw new Error(
        `Ticket ${ticketId} unit_id ${ticket.unit_id} not found — refuse backfill workflow`,
      )
    }
    if (unitRow.property_id && unitRow.property_id !== ticket.property_id) {
      throw new Error(
        `Ticket ${ticketId} unit/property disagree (unit.property_id=${unitRow.property_id}, ticket.property_id=${ticket.property_id})`,
      )
    }
  }

  const { data: existing } = await sb
    .from('workflow_runs')
    .select('id')
    .eq('template_id', 'maintenance_request')
    .eq('entity_type', 'maintenance_request')
    .eq('entity_id', ticket.id)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing?.id) {
    return { created: false, workflowRunId: existing.id, ticket }
  }

  let residentId = ticket.resident_user_id ?? null
  if (!residentId && ticket.unit_id && ticket.landlord_id) {
    const { data: occupancy } = await sb
      .from('occupancy')
      .select('resident_id')
      .eq('unit_id', ticket.unit_id)
      .eq('landlord_id', ticket.landlord_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (typeof occupancy?.resident_id === 'string' && occupancy.resident_id.trim()) {
      residentId = occupancy.resident_id.trim()
    }
  }
  if (!residentId && ticket.resident_phone && ticket.landlord_id) {
    const { data: byPhone } = await sb
      .from('users')
      .select('id')
      .eq('landlord_id', ticket.landlord_id)
      .eq('phone', ticket.resident_phone)
      .limit(1)
      .maybeSingle()
    if (byPhone?.id) residentId = byPhone.id
  }

  const vendorAssigned =
    Boolean(ticket.assigned_vendor_id) ||
    String(ticket.vendor_work_status ?? '').toLowerCase() === 'pending_accept'
  const currentStep = vendorAssigned ? 'pending_accept' : 'unassigned'
  const metadata = {
    landlord_id: ticket.landlord_id,
    trigger_type: 'automation',
    due_at: ticket.due_at ?? ticket.created_at,
    issue_category: ticket.issue_category ?? 'general',
    severity: ticket.urgency ?? ticket.priority ?? 'normal',
    unit_label: ticket.unit ?? undefined,
    source,
    vendor_assigned: vendorAssigned,
    assigned_vendor_id: ticket.assigned_vendor_id ?? null,
    backfilled_active_tasks: true,
  }

  if (dryRun) {
    return { created: true, workflowRunId: null, ticket, dryRun: true, currentStep, residentId }
  }

  const { data: run, error: insErr } = await sb
    .from('workflow_runs')
    .insert({
      template_id: 'maintenance_request',
      landlord_id: ticket.landlord_id,
      trigger_type: 'automation',
      status: 'active',
      entity_type: 'maintenance_request',
      entity_id: ticket.id,
      property_id: ticket.property_id ?? null,
      resident_id: residentId,
      unit_id: ticket.unit_id ?? null,
      current_stage: currentStep,
      current_step: currentStep,
      metadata,
    })
    .select('id')
    .single()
  if (insErr || !run?.id) {
    throw new Error(`workflow_runs insert failed: ${insErr?.message ?? 'unknown'}`)
  }

  await sb.from('workflow_events').insert([
    {
      workflow_run_id: run.id,
      event_type: 'workflow.classify',
      stage: 'classify',
      step: 'classify',
      message: 'Classified',
      metadata: { source, backfill: true },
    },
    {
      workflow_run_id: run.id,
      event_type: 'workflow.route',
      stage: 'route',
      step: 'route',
      message: 'Routed',
      metadata: { source, backfill: true },
    },
    {
      workflow_run_id: run.id,
      event_type: 'workflow.act',
      stage: 'act',
      step: 'submitted',
      message: 'Ticket workflow started from backfill remediation',
      metadata: {
        maintenance_request_id: ticket.id,
        source,
        backfill: true,
      },
    },
  ])

  if (residentId && !ticket.resident_user_id) {
    await sb
      .from('maintenance_requests')
      .update({ resident_user_id: residentId })
      .eq('id', ticket.id)
      .is('resident_user_id', null)
  }

  return { created: true, workflowRunId: run.id, ticket, residentId }
}

async function main() {
  const argIdx = process.argv.indexOf('--ticket')
  const ticketId =
    (argIdx >= 0 ? process.argv[argIdx + 1] : null)?.trim() ||
    process.env.TICKET_ID?.trim()
  if (!ticketId) {
    console.error('Usage: node scripts/ensure-maintenance-request-workflow.mjs --ticket <uuid>')
    process.exit(2)
  }

  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  if (!url) throw new Error('Missing SUPABASE_URL')
  const keys = JSON.parse(
    execSync(`supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, {
      encoding: 'utf8',
    }),
  )
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  const sb = createClient(url, sr.api_key, { auth: { persistSession: false } })

  const result = await ensureMaintenanceRequestWorkflow(sb, ticketId, { dryRun: DRY_RUN })
  console.log(JSON.stringify(result, null, 2))
}

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
