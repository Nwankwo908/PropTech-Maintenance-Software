#!/usr/bin/env node
/**
 * Audit / remediate sticky needs_admin_vendor + stale pending_accept assignments.
 *
 * Audit (default):
 *   node scripts/remediate-stale-needs-admin-pending-accept.mjs
 *
 * Apply:
 *   APPLY=1 TICKET_ID=<uuid> node scripts/remediate-stale-needs-admin-pending-accept.mjs
 */

import { execSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

try {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
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

const APPLY = process.env.APPLY === '1'
const TICKET_ID = process.env.TICKET_ID?.trim() || null
const LANDLORD_ID = process.env.LANDLORD_ID?.trim() || null
const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()

async function serviceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  }
  const keys = JSON.parse(
    execSync(`npx supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve service_role key')
  return sr.api_key
}

function runDenoRemediate(ticketIds, url, key) {
  const helperUrl = new URL(
    '../supabase/functions/_shared/remediateStaleNeedsAdminPendingAccept.ts',
    import.meta.url,
  ).href
  const denoSrc = `
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { remediateStaleNeedsAdminPendingAccept } from "${helperUrl}"

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)
const ids = JSON.parse(Deno.env.get("TICKET_IDS_JSON") || "[]") as string[]
for (const id of ids) {
  const result = await remediateStaleNeedsAdminPendingAccept(sb, id)
  console.log(JSON.stringify({ ticketId: id, ...result }))
}
`
  const tmp = resolve(tmpdir(), `ulo-remediate-stale-${Date.now()}.ts`)
  writeFileSync(tmp, denoSrc)
  try {
    const result = spawnSync(
      'deno',
      ['run', '--allow-net', '--allow-env', '--allow-read', tmp],
      {
        encoding: 'utf8',
        cwd: ROOT,
        env: {
          ...process.env,
          SUPABASE_URL: url,
          SUPABASE_SERVICE_ROLE_KEY: key,
          TICKET_IDS_JSON: JSON.stringify(ticketIds),
        },
      },
    )
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.status !== 0) {
      throw new Error(`Deno remediate failed (exit ${result.status})`)
    }
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      // ignore
    }
  }
}

async function main() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL / VITE_SUPABASE_URL')
  const key = await serviceRoleKey()
  const sb = createClient(SUPABASE_URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let query = sb
    .from('maintenance_requests')
    .select(
      'id, landlord_id, unit, description, vendor_work_status, assigned_vendor_id, auto_reassign_last_outcome, stall_follow_up_sent_at, created_at, assigned_at, urgency, priority, due_at',
    )
    .like('auto_reassign_last_outcome', 'needs_admin_vendor|%')
    .eq('vendor_work_status', 'pending_accept')
    .not('assigned_vendor_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(100)

  if (TICKET_ID) query = query.eq('id', TICKET_ID)
  if (LANDLORD_ID) query = query.eq('landlord_id', LANDLORD_ID)

  const { data: tickets, error } = await query
  if (error) throw new Error(error.message)

  console.log(`Found ${tickets?.length ?? 0} sticky needs_admin + pending_accept + assigned`)
  for (const t of tickets ?? []) {
    const { data: vendor } = await sb
      .from('vendors')
      .select('name')
      .eq('id', t.assigned_vendor_id)
      .maybeSingle()
    console.log(
      [
        t.created_at?.slice(0, 10),
        (t.landlord_id || '').slice(-4),
        t.auto_reassign_last_outcome,
        t.stall_follow_up_sent_at ? 'stall_sent' : 'no_stall',
        vendor?.name ?? t.assigned_vendor_id?.slice(0, 8),
        t.id,
        (t.description || '').replace(/\s+/g, ' ').slice(0, 60),
      ].join(' | '),
    )
  }

  if (!APPLY) {
    console.log('\nDry run. Set APPLY=1 (and optional TICKET_ID / LANDLORD_ID) to remediate.')
    return
  }

  const ids = (tickets ?? []).map((t) => t.id)
  if (ids.length === 0) {
    console.log('Nothing to apply.')
    return
  }
  runDenoRemediate(ids, SUPABASE_URL, key)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
