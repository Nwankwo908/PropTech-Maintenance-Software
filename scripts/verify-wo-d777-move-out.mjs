#!/usr/bin/env node
/**
 * Verify lease renewal trigger creates Move-Out Preparation WO-D777 with kickoff.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const SHOWCASE_LANDLORD_ID = 'de300000-0000-4000-8000-000000000001'
const LEASE_RUN_ID = '1e050002-0000-4000-8000-000000000001'
const MOVE_OUT_RUN_ID = 'd7770000-0000-4000-8000-000000000001'

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
const ADMIN_SECRET = process.env.VITE_ADMIN_REASSIGN_SECRET?.trim()

async function main() {
  if (!SUPABASE_URL || !ADMIN_SECRET) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_ADMIN_REASSIGN_SECRET in .env')
  }

  const url = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/trigger-move-out-from-lease-renewal`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_SECRET}`,
      'x-admin-reassign-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({
      leaseRenewalRunId: LEASE_RUN_ID,
      landlordId: SHOWCASE_LANDLORD_ID,
    }),
  })

  const body = await res.json()
  if (!res.ok || body.ok === false) {
    throw new Error(body.error ?? `Trigger failed (${res.status})`)
  }

  if (body.move_out_run_id !== MOVE_OUT_RUN_ID) {
    throw new Error(
      `Expected move_out_run_id ${MOVE_OUT_RUN_ID}, got ${body.move_out_run_id}`,
    )
  }

  const { execSync } = await import('node:child_process')
  const json = execSync(
    'supabase projects api-keys --project-ref mzpqwuizhiaczxcnmxbt -o json',
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const keys = JSON.parse(json)
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve service_role key')

  const supabase = createClient(SUPABASE_URL, sr.api_key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: run, error } = await supabase
    .from('workflow_runs')
    .select('id, template_id, status, current_step, metadata')
    .eq('id', MOVE_OUT_RUN_ID)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!run) throw new Error('Move-out run not found after trigger')

  const meta = run.metadata ?? {}
  const milestones = meta.milestones ?? {}
  const checklist = meta.checklist ?? {}

  const checks = [
    ['template_id', run.template_id === 'move_out'],
    ['status', run.status === 'active'],
    ['current_step', run.current_step === 'inspection_scheduled'],
    ['kickoff_source', meta.kickoff_source === 'lease_renewal_escalation'],
    ['move_out_started', Boolean(milestones.move_out_started)],
    ['instructions_sent', Boolean(milestones.instructions_sent)],
    ['cleaning_scheduled', Boolean(milestones.cleaning_scheduled)],
    ['inspection_scheduled checklist', checklist.inspection_scheduled === true],
  ]

  const failed = checks.filter(([, ok]) => !ok)
  if (failed.length) {
    throw new Error(
      `Kickoff verification failed: ${failed.map(([k]) => k).join(', ')}`,
    )
  }

  console.log('WO-D777 move-out verification passed.')
  console.log(`  move_out_run_id: ${body.move_out_run_id}`)
  console.log(`  current_step:    ${run.current_step}`)
  console.log(`  WO ref:          WO-D777`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
