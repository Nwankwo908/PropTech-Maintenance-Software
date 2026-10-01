#!/usr/bin/env node
/**
 * Remediates overwritten vendor-probe pending-asks for HQS report 8ac8ee35.
 *
 * Rebuilds awaiting_vendor_probes[] on the vendor thread from open tickets and
 * sends one consolidated WO list (not 12 individual re-probes).
 *
 * Usage:
 *   node scripts/remediate-hqs-vendor-probes.mjs
 *   DRY_RUN=1 node scripts/remediate-hqs-vendor-probes.mjs
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const REPORT_ID = process.env.HQS_REPORT_ID?.trim() ||
  '8ac8ee35-9f78-44ec-85a8-97b90442e54c'
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
const SEND_REMINDER = process.env.SEND_REMINDER === '1' || process.env.SEND_REMINDER === 'true'

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

function woRef(ticketId) {
  return `WO-${ticketId.replace(/-/g, '').slice(0, 4).toUpperCase()}`
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
      'id, description, assigned_vendor_id, vendor_notify_error, awaiting_vendor_availability_at',
    )
    .eq('inspection_report_id', REPORT_ID)
    .order('created_at', { ascending: true })
  if (error) throw error
  if (!tickets?.length) {
    console.log('No tickets for report', REPORT_ID)
    return
  }

  const open = tickets.filter((t) =>
    String(t.vendor_notify_error ?? '').includes(
      'Awaiting vendor availability before landlord choice',
    )
  )
  const vendorId = open[0]?.assigned_vendor_id
  console.log({
    report: REPORT_ID,
    total: tickets.length,
    still_awaiting_probe: open.length,
    vendorId,
    dry_run: DRY_RUN,
  })

  if (!vendorId || open.length === 0) {
    console.log('Nothing to remediate')
    return
  }

  const { data: vendor } = await sb
    .from('vendors')
    .select('id, name, phone')
    .eq('id', vendorId)
    .maybeSingle()

  const { data: convos } = await sb
    .from('sms_conversations')
    .select(
      'id, intake_state, external_phone_number, vendor_id, landlord_id, updated_at',
    )
    .eq('external_phone_number', vendor?.phone ?? '')
    .eq('conversation_type', 'vendor_alert')
    .order('updated_at', { ascending: false })
    .limit(1)

  const conv = convos?.[0]
  if (!conv) {
    console.error('No vendor_alert conversation for', vendor?.phone)
    return
  }

  const probes = open.map((t) => ({
    ticket_id: t.id,
    vendor_id: vendorId,
    sent_at: new Date().toISOString(),
    work_order_ref: woRef(t.id),
    issue_headline: String(t.description ?? '').split('\n')[0]?.trim() || null,
  }))

  const prior =
    conv.intake_state && typeof conv.intake_state === 'object' ? { ...conv.intake_state } : {}
  const nextIntake = {
    ...prior,
    awaiting_vendor_probes: probes,
    awaiting_vendor_probe: probes[probes.length - 1],
  }
  delete nextIntake.awaiting_vendor_probe_clarify

  console.log(
    'Will sync probes:',
    probes.map((p) => `${p.work_order_ref} ${(p.issue_headline ?? '').slice(0, 40)}`),
  )

  if (DRY_RUN) {
    console.log('DRY_RUN — no writes / no SMS')
    return
  }

  const { error: upErr } = await sb
    .from('sms_conversations')
    .update({
      intake_state: nextIntake,
      vendor_id: vendorId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conv.id)
  if (upErr) throw upErr

  console.log('Synced awaiting_vendor_probes on conversation', conv.id)

  if (!SEND_REMINDER) {
    console.log(
      'Recommendation: consolidated reminder (not 12 individual re-probes). Re-run with SEND_REMINDER=1 after sms-inbound deploy.',
    )
    return
  }

  const vendorName = typeof vendor?.name === 'string' && vendor.name.trim()
    ? vendor.name.trim()
    : 'there'
  const lines = [
    `Hi ${vendorName} — quick follow-up.`,
    '',
    `We still need availability on ${probes.length} open jobs:`,
    '',
  ]
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i]
    const issue = (p.issue_headline ?? '').trim()
    lines.push(
      issue
        ? `${i + 1} — ${p.work_order_ref} · ${issue}`
        : `${i + 1} — ${p.work_order_ref}`,
    )
  }
  lines.push(
    '',
    'Reply with the WO code + earliest day/window (e.g. WO-D154 Wed 9am–12pm), or NO + WO code if you can\'t take that one.',
  )
  const reminderBody = lines.join('\n')

  const adminSecret = process.env.VITE_ADMIN_REASSIGN_SECRET?.trim() ||
    process.env.ADMIN_REASSIGN_SECRET?.trim()
  if (!adminSecret) {
    throw new Error('SEND_REMINDER requires VITE_ADMIN_REASSIGN_SECRET')
  }
  const landlordId = typeof conv.landlord_id === 'string'
    ? conv.landlord_id
    : null
  // Fetch landlord_id if the select above didn't include it on older runs.
  let resolvedLandlordId = landlordId
  if (!resolvedLandlordId) {
    const { data: convFull } = await sb
      .from('sms_conversations')
      .select('landlord_id')
      .eq('id', conv.id)
      .maybeSingle()
    resolvedLandlordId = convFull?.landlord_id ?? null
  }
  if (!resolvedLandlordId) {
    throw new Error('conversation missing landlord_id')
  }

  const fnUrl = `${url.replace(/\/$/, '')}/functions/v1/admin-conversation-sms`
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-reassign-secret': adminSecret,
    },
    body: JSON.stringify({
      action: 'send',
      conversation_id: conv.id,
      landlord_id: resolvedLandlordId,
      body: reminderBody,
    }),
  })
  const text = await res.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { raw: text }
  }
  if (!res.ok) {
    console.error('Reminder SMS failed', res.status, payload)
    throw new Error(`admin-conversation-sms failed: ${res.status}`)
  }
  console.log('Consolidated reminder sent', payload)

  // Admin send arms takeover; release so inbound probe replies still auto-route.
  const releaseRes = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-reassign-secret': adminSecret,
    },
    body: JSON.stringify({
      action: 'release',
      conversation_id: conv.id,
      landlord_id: resolvedLandlordId,
    }),
  })
  const releaseText = await releaseRes.text()
  if (!releaseRes.ok) {
    console.warn('Could not release admin takeover after reminder', releaseRes.status, releaseText)
  } else {
    console.log('Released admin takeover so probe replies auto-route')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
