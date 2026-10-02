#!/usr/bin/env node
/**
 * Full orphan-ticket remediation via Edge:
 *   1) ensure maintenance_request workflow run (Active Tasks)
 *   2) optional resident close-the-loop SMS
 *   3) normal confirmed dispatch (vendor probe / landlord choice / nearby)
 *
 * The Oct 2 Shahita oven backfill was an ad-hoc ticket insert that skipped
 * the workflow. Conversation-identity corrections (Rashae, Jessie, Sarah,
 * Ganaia) only rewrote conversation links — they did not mint tickets — so
 * they do not need this path. Any future ticket backfill must use this
 * (or ensure-maintenance-request-workflow.mjs at minimum).
 *
 * Usage:
 *   node scripts/remediate-orphaned-maintenance-ticket.mjs --ticket <uuid>
 *   SKIP_SMS=1 node scripts/remediate-orphaned-maintenance-ticket.mjs --ticket <uuid>
 *   SKIP_DISPATCH=1 node scripts/remediate-orphaned-maintenance-ticket.mjs --ticket <uuid>
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  const argIdx = process.argv.indexOf('--ticket')
  const ticketId =
    (argIdx >= 0 ? process.argv[argIdx + 1] : null)?.trim() ||
    process.env.TICKET_ID?.trim()
  if (!ticketId) {
    console.error(
      'Usage: node scripts/remediate-orphaned-maintenance-ticket.mjs --ticket <uuid>',
    )
    process.exit(2)
  }

  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(
    /\/$/,
    '',
  )
  const adminSecret =
    process.env.VITE_ADMIN_REASSIGN_SECRET?.trim() ||
    process.env.ADMIN_REASSIGN_SECRET?.trim()
  if (!url || !adminSecret) {
    throw new Error('Missing SUPABASE_URL or VITE_ADMIN_REASSIGN_SECRET')
  }

  const fnUrl = `${url}/functions/v1/remediate-maintenance-ticket`
  const payload = {
    ticket_id: ticketId,
    skip_resident_sms: process.env.SKIP_SMS === '1' || process.env.SKIP_SMS === 'true',
    skip_dispatch:
      process.env.SKIP_DISPATCH === '1' || process.env.SKIP_DISPATCH === 'true',
  }
  if (process.env.RESIDENT_SMS_BODY?.trim()) {
    payload.resident_close_loop_sms = process.env.RESIDENT_SMS_BODY.trim()
  }

  console.log('Invoking', fnUrl, payload)
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-reassign-secret': adminSecret,
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text }
  }
  console.log(JSON.stringify(body, null, 2))
  if (!res.ok || body?.ok === false) {
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
