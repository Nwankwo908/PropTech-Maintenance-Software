#!/usr/bin/env node
/**
 * Backfill missing maintenance_request workflow_runs for HQS tickets that were
 * created/dispatched without Active Tasks runs (report 8ac8ee35 collision batch).
 *
 * Usage:
 *   DRY_RUN=1 node scripts/backfill-hqs-workflow-runs.mjs
 *   node scripts/backfill-hqs-workflow-runs.mjs
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const VENDOR_ID = process.env.VENDOR_ID?.trim() ||
  '3cb13258-187f-42c7-a715-61ff47365f22'
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

async function main() {
  const url = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
  if (!url) throw new Error('Missing VITE_SUPABASE_URL')
  const json = execSync(
    `supabase projects api-keys --project-ref ${PROJECT_REF} -o json`,
    { encoding: 'utf8' },
  )
  const sr = JSON.parse(json).find((k) => k.name === 'service_role' || k.id === 'service_role')
  const sb = createClient(url, sr.api_key, { auth: { persistSession: false } })

  const { data: tickets, error } = await sb
    .from('maintenance_requests')
    .select(
      'id, landlord_id, property_id, unit_id, resident_id, description, issue_category, urgency, priority, due_at, assigned_vendor_id, vendor_work_status, vendor_notify_error, created_at',
    )
    .eq('assigned_vendor_id', VENDOR_ID)
    .ilike('description', 'HQS fail%')
    .order('created_at', { ascending: true })
  if (error) throw error

  const open = (tickets ?? []).filter((t) =>
    String(t.vendor_notify_error ?? '').includes(
      'Awaiting vendor availability before landlord choice',
    ) ||
    String(t.vendor_work_status ?? '').toLowerCase() === 'pending_accept'
  )

  console.log({ vendorId: VENDOR_ID, candidates: open.length, dry_run: DRY_RUN })

  let created = 0
  let skipped = 0
  for (const t of open) {
    const { data: existing } = await sb
      .from('workflow_runs')
      .select('id')
      .eq('template_id', 'maintenance_request')
      .eq('entity_type', 'maintenance_request')
      .eq('entity_id', t.id)
      .limit(1)
      .maybeSingle()
    if (existing?.id) {
      skipped += 1
      continue
    }

    // Prefer ticket.resident_id; if null (legacy HQS inserts), resolve from unit occupancy.
    let residentId = t.resident_id ?? null
    if (!residentId && t.unit_id && t.landlord_id) {
      const { data: occupancy } = await sb
        .from('occupancy')
        .select('resident_id')
        .eq('unit_id', t.unit_id)
        .eq('landlord_id', t.landlord_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (typeof occupancy?.resident_id === 'string' && occupancy.resident_id.trim()) {
        residentId = occupancy.resident_id.trim()
      }
    }

    const wo = `WO-${String(t.id).replace(/-/g, '').slice(0, 4).toUpperCase()}`
    const vendorAssigned =
      Boolean(t.assigned_vendor_id) ||
      String(t.vendor_work_status ?? '').toLowerCase() === 'pending_accept'
    const currentStep = vendorAssigned ? 'pending_accept' : 'unassigned'
    const metadata = {
      landlord_id: t.landlord_id,
      trigger_type: 'sms_inbound',
      due_at: t.due_at ?? t.created_at,
      issue_category: t.issue_category ?? 'general',
      severity: t.urgency ?? t.priority ?? 'normal',
      source: 'hqs_letter',
      vendor_assigned: vendorAssigned,
      assigned_vendor_id: t.assigned_vendor_id ?? null,
      backfilled_active_tasks: true,
    }

    console.log(`Create run ${wo} step=${currentStep} resident=${residentId ?? 'null'}`)
    if (DRY_RUN) continue

    const { data: run, error: insErr } = await sb
      .from('workflow_runs')
      .insert({
        template_id: 'maintenance_request',
        landlord_id: t.landlord_id,
        trigger_type: 'sms_inbound',
        status: 'active',
        entity_type: 'maintenance_request',
        entity_id: t.id,
        property_id: t.property_id ?? null,
        resident_id: residentId,
        unit_id: t.unit_id ?? null,
        current_stage: currentStep,
        current_step: currentStep,
        metadata,
      })
      .select('id')
      .single()
    if (insErr || !run?.id) {
      console.error('insert failed', wo, insErr?.message)
      continue
    }

    await sb.from('workflow_events').insert([
      {
        workflow_run_id: run.id,
        event_type: 'workflow.classify',
        stage: 'classify',
        step: 'classify',
        message: 'Classified',
        metadata: { source: 'hqs_letter', backfill: true },
      },
      {
        workflow_run_id: run.id,
        event_type: 'workflow.route',
        stage: 'route',
        step: 'route',
        message: 'Routed',
        metadata: { source: 'hqs_letter', backfill: true },
      },
      {
        workflow_run_id: run.id,
        event_type: 'workflow.act',
        stage: 'act',
        step: 'submitted',
        message: 'Ticket created from inspection letter',
        metadata: {
          maintenance_request_id: t.id,
          source: 'hqs_letter',
          backfill: true,
        },
      },
    ])

    created += 1
  }

  console.log({ created, skipped, dry_run: DRY_RUN })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
