#!/usr/bin/env node
/**
 * Diagnose why a roster vendor was not notified for the latest maintenance request.
 *
 * Usage:
 *   node scripts/diagnose-vendor-notify.mjs
 *   TICKET_ID=... node scripts/diagnose-vendor-notify.mjs
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
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
  // optional
}

const SUPABASE_URL =
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()
const LANDLORD_ID =
  process.env.VITE_DEFAULT_LANDLORD_ID?.trim() ||
  '068daf53-07e4-4493-bd7f-6106e3c8c62f'

async function resolveServiceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  }
  const json = execSync(
    `supabase projects api-keys --project-ref ${PROJECT_REF} -o json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const keys = JSON.parse(json)
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve service_role key')
  return sr.api_key
}

function shortId(id) {
  return typeof id === 'string' ? id.slice(0, 8) : id
}

async function main() {
  if (!SUPABASE_URL) throw new Error('Missing VITE_SUPABASE_URL')
  const key = await resolveServiceRoleKey()
  const sb = createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const ticketId = process.env.TICKET_ID?.trim()
  let ticket
  if (ticketId) {
    const { data, error } = await sb
      .from('maintenance_requests')
      .select(
        'id, created_at, landlord_id, unit, issue_category, priority, urgency, vendor_work_status, assigned_vendor_id, vendor_notified_at, vendor_notify_error, description, resident_name',
      )
      .eq('id', ticketId)
      .maybeSingle()
    if (error) throw error
    ticket = data
  } else {
    const { data, error } = await sb
      .from('maintenance_requests')
      .select(
        'id, created_at, landlord_id, unit, issue_category, priority, urgency, vendor_work_status, assigned_vendor_id, vendor_notified_at, vendor_notify_error, description, resident_name',
      )
      .order('created_at', { ascending: false })
      .limit(5)
    if (error) throw error
    console.log('\n=== Recent tickets ===')
    for (const row of data ?? []) {
      console.log(
        `- ${shortId(row.id)} | ${row.created_at} | ${row.resident_name ?? '?'} | ${row.issue_category ?? '?'} | status=${row.vendor_work_status} | assigned=${shortId(row.assigned_vendor_id) ?? 'null'} | notified=${row.vendor_notified_at ?? 'null'} | err=${row.vendor_notify_error ?? '—'}`,
      )
    }
    ticket = data?.[0] ?? null
  }

  if (!ticket) {
    console.log('No ticket found')
    return
  }

  console.log('\n=== Focus ticket ===')
  console.log(JSON.stringify(ticket, null, 2))
  console.log(`WO-${String(ticket.id).slice(0, 4).toUpperCase()}`)

  const landlordId = ticket.landlord_id || LANDLORD_ID

  const { data: vendors, error: vErr } = await sb
    .from('vendors')
    .select(
      'id, name, phone, email, active, landlord_id, notification_channel, last_assigned_at, created_at',
    )
    .eq('landlord_id', landlordId)
    .order('created_at', { ascending: true })
  if (vErr) throw vErr

  const vendorIds = (vendors ?? []).map((v) => v.id)
  const { data: verifs } = vendorIds.length
    ? await sb
        .from('vendor_verifications')
        .select('vendor_id, status, availability, business_name, trade_categories')
        .in('vendor_id', vendorIds)
    : { data: [] }

  const verifByVendor = new Map(
    (verifs ?? []).map((v) => [v.vendor_id, v]),
  )

  console.log('\n=== Roster vendors (this landlord) ===')
  for (const v of vendors ?? []) {
    const ver = verifByVendor.get(v.id)
    const trade = Array.isArray(ver?.trade_categories)
      ? ver.trade_categories.join(',')
      : '—'
    console.log(
      `- ${shortId(v.id)} | ${v.name} | active=${v.active} | channel=${v.notification_channel ?? '—'} | phone=${v.phone ? 'yes' : 'NO'} | email=${v.email ? 'yes' : 'NO'} | trade=${trade} | verif=${ver?.status ?? 'none'} | avail=${ver?.availability ?? '—'}`,
    )
  }

  const active = (vendors ?? []).filter((v) => v.active === true)
  console.log(`\nActive count: ${active.length} / ${(vendors ?? []).length}`)

  if (ticket.assigned_vendor_id) {
    const assigned = (vendors ?? []).find((v) => v.id === ticket.assigned_vendor_id)
    console.log('\n=== Assigned vendor ===')
    console.log(
      assigned
        ? JSON.stringify(
            {
              id: assigned.id,
              name: assigned.name,
              active: assigned.active,
              phone: assigned.phone,
              notification_channel: assigned.notification_channel,
              verification: verifByVendor.get(assigned.id) ?? null,
            },
            null,
            2,
          )
        : `Assigned id ${ticket.assigned_vendor_id} not in landlord roster query`,
    )
  } else {
    console.log('\n=== Diagnosis ===')
    console.log('Ticket has NO assigned_vendor_id — notify never targeted a vendor.')
    if (active.length === 0) {
      console.log(
        'ROOT CAUSE CANDIDATE: no vendors with active=true for this landlord (paused / needs_review / inactive).',
      )
    } else {
      console.log(
        'There are active vendors — check landlord_id mismatch on ticket, assign persist failure, or early draft never finalized.',
      )
    }
  }

  const { data: logs } = await sb
    .from('vendor_notification_log')
    .select('id, created_at, ticket_id, vendor_id, channel, error, provider_message_id')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: false })
    .limit(20)

  console.log('\n=== vendor_notification_log ===')
  if (!logs?.length) console.log('(none)')
  else console.log(JSON.stringify(logs, null, 2))

  const { data: smsNums } = await sb
    .from('sms_numbers')
    .select('id, phone_number, purpose, status, provider')
    .eq('landlord_id', landlordId)

  console.log('\n=== landlord SMS numbers ===')
  console.log(JSON.stringify(smsNums ?? [], null, 2))

  const { data: graph } = await sb
    .from('operations_graph_events')
    .select('event_type, created_at, vendor_id, metadata')
    .eq('maintenance_request_id', ticket.id)
    .in('event_type', [
      'vendor.alert_sent',
      'vendor.assigned',
      'maintenance.created',
      'workflow.act',
    ])
    .order('created_at', { ascending: false })
    .limit(20)

  console.log('\n=== related graph events ===')
  if (!graph?.length) console.log('(none matching)')
  else {
    for (const g of graph) {
      console.log(
        `- ${g.created_at} | ${g.event_type} | vendor=${shortId(g.vendor_id) ?? '—'}`,
      )
    }
  }

  console.log('\n=== Verdict hints ===')
  if (ticket.vendor_notify_error) {
    console.log(`vendor_notify_error: ${ticket.vendor_notify_error}`)
  }
  if (!ticket.assigned_vendor_id && active.length === 0) {
    console.log(
      'Likely: all on-file vendors are active=false (UI may still show them as Pending/on file).',
    )
  }
  if (ticket.assigned_vendor_id && !ticket.vendor_notified_at) {
    console.log('Likely: assigned but notify path failed before stamping notified_at.')
  }
  if (ticket.assigned_vendor_id && ticket.vendor_notified_at && ticket.vendor_notify_error) {
    console.log('Likely: notify attempted with channel/provider errors.')
  }
  const main = (smsNums ?? []).find(
    (n) => n.role === 'landlord_main' || n.role === 'main',
  )
  if (!main) {
    console.log('Likely: no landlord_main SMS number — sendVendorJobAlert cannot send.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
