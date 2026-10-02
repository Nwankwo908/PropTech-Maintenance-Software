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
import { ensureMaintenanceRequestWorkflow } from './ensure-maintenance-request-workflow.mjs'

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
    const wo = `WO-${String(t.id).replace(/-/g, '').slice(0, 4).toUpperCase()}`
    try {
      const result = await ensureMaintenanceRequestWorkflow(sb, t.id, {
        dryRun: DRY_RUN,
        source: 'hqs_letter',
      })
      if (result.created) {
        console.log(
          `Create run ${wo}`,
          DRY_RUN ? '(dry-run)' : `id=${result.workflowRunId}`,
        )
        created += 1
      } else {
        skipped += 1
      }
    } catch (e) {
      console.error('ensure failed', wo, e instanceof Error ? e.message : e)
    }
  }

  console.log({ created, skipped, dry_run: DRY_RUN })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
