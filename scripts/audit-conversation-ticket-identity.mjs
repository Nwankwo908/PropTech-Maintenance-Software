#!/usr/bin/env node
/**
 * Standing audit: sms_conversations ↔ maintenance_requests identity mismatch.
 *
 * For every conversation with a linked/referenced ticket, confirm the ticket's
 * resident / unit / property aligns with the conversation's resolved identity.
 *
 * Usage:
 *   node scripts/audit-conversation-ticket-identity.mjs
 *   STRICT=1 node scripts/audit-conversation-ticket-identity.mjs   # exit 1 on mismatches
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  for (const line of readFileSync(resolve(__dirname, '../.env'), 'utf8').split('\n')) {
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
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value
  }
} catch {
  // optional .env
}

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim()

async function serviceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  }
  const { execSync } = await import('node:child_process')
  const keys = JSON.parse(
    execSync(`supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve Supabase service_role key')
  return sr.api_key
}

const supabase = createClient(SUPABASE_URL, await serviceRoleKey(), {
  auth: { persistSession: false },
})

const clip = (s, n = 80) => (s == null ? '' : String(s).replace(/\s+/g, ' ').slice(0, n))

/**
 * SQL-equivalent standing check (run via Management API or psql):
 *
 * with linked as (
 *   select
 *     c.id as conversation_id,
 *     c.landlord_id,
 *     c.resident_id as conv_resident_id,
 *     c.unit_id as conv_unit_id,
 *     c.external_phone_number as conv_phone,
 *     c.maintenance_request_id as linked_ticket_id,
 *     c.conversation_type,
 *     t.id as ticket_id,
 *     t.resident_user_id as ticket_resident_user_id,
 *     t.resident_name as ticket_resident_name,
 *     t.resident_phone as ticket_phone,
 *     t.unit_id as ticket_unit_id,
 *     t.property_id as ticket_property_id,
 *     t.unit as ticket_unit_label,
 *     left(t.description, 120) as ticket_description
 *   from public.sms_conversations c
 *   join public.maintenance_requests t on t.id = c.maintenance_request_id
 *   where c.maintenance_request_id is not null
 * )
 * select *
 * from linked l
 * left join public.users u on u.id = l.conv_resident_id
 * left join public.units cu on cu.id = l.conv_unit_id
 * left join public.units tu on tu.id = l.ticket_unit_id
 * where
 *   -- phone mismatch when both present
 *   (
 *     nullif(regexp_replace(coalesce(l.conv_phone, ''), '\D', '', 'g'), '') is not null
 *     and nullif(regexp_replace(coalesce(l.ticket_phone, ''), '\D', '', 'g'), '') is not null
 *     and right(regexp_replace(l.conv_phone, '\D', '', 'g'), 10)
 *       <> right(regexp_replace(l.ticket_phone, '\D', '', 'g'), 10)
 *   )
 *   or (
 *     l.conv_unit_id is not null
 *     and l.ticket_unit_id is not null
 *     and l.conv_unit_id <> l.ticket_unit_id
 *   )
 *   or (
 *     cu.property_id is not null
 *     and l.ticket_property_id is not null
 *     and cu.property_id <> l.ticket_property_id
 *   )
 *   or (
 *     u.full_name is not null
 *     and l.ticket_resident_name is not null
 *     and lower(trim(u.full_name)) <> lower(trim(l.ticket_resident_name))
 *   );
 */

function digits10(phone) {
  const d = String(phone ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : ''
}

function normName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

const { data: conversations, error: convErr } = await supabase
  .from('sms_conversations')
  .select(
    'id, landlord_id, resident_id, unit_id, external_phone_number, maintenance_request_id, conversation_type, updated_at',
  )
  .not('maintenance_request_id', 'is', null)

if (convErr) {
  console.error('Failed to load conversations', convErr)
  process.exit(1)
}

const ticketIds = [
  ...new Set(
    (conversations ?? [])
      .map((c) => c.maintenance_request_id)
      .filter((id) => typeof id === 'string' && id),
  ),
]

const ticketsById = new Map()
for (let i = 0; i < ticketIds.length; i += 200) {
  const chunk = ticketIds.slice(i, i + 200)
  const { data, error } = await supabase
    .from('maintenance_requests')
    .select(
      'id, landlord_id, resident_user_id, resident_name, resident_phone, unit_id, property_id, unit, description, issue_headline, issue_category, created_at',
    )
    .in('id', chunk)
  if (error) {
    console.error('Failed to load tickets', error)
    process.exit(1)
  }
  for (const t of data ?? []) ticketsById.set(t.id, t)
}

const residentIds = [
  ...new Set(
    (conversations ?? [])
      .map((c) => c.resident_id)
      .filter((id) => typeof id === 'string' && id),
  ),
]
const usersById = new Map()
for (let i = 0; i < residentIds.length; i += 200) {
  const chunk = residentIds.slice(i, i + 200)
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, phone, unit, landlord_id')
    .in('id', chunk)
  if (error) {
    console.error('Failed to load users', error)
    process.exit(1)
  }
  for (const u of data ?? []) usersById.set(u.id, u)
}

const unitIds = [
  ...new Set(
    [
      ...(conversations ?? []).map((c) => c.unit_id),
      ...[...ticketsById.values()].map((t) => t.unit_id),
    ].filter((id) => typeof id === 'string' && id),
  ),
]
const unitsById = new Map()
for (let i = 0; i < unitIds.length; i += 200) {
  const chunk = unitIds.slice(i, i + 200)
  const { data, error } = await supabase
    .from('units')
    .select('id, unit_label, property_id, landlord_id, building')
    .in('id', chunk)
  if (error) {
    console.error('Failed to load units', error)
    process.exit(1)
  }
  for (const u of data ?? []) unitsById.set(u.id, u)
}

const mismatches = []

for (const c of conversations ?? []) {
  const ticket = ticketsById.get(c.maintenance_request_id)
  if (!ticket) {
    mismatches.push({
      conversation_id: c.id,
      ticket_id: c.maintenance_request_id,
      reasons: ['linked_ticket_missing'],
      conv: {
        resident_id: c.resident_id,
        unit_id: c.unit_id,
        phone: c.external_phone_number,
      },
      ticket: null,
    })
    continue
  }

  const reasons = []
  const user = c.resident_id ? usersById.get(c.resident_id) : null
  const convUnit = c.unit_id ? unitsById.get(c.unit_id) : null
  const ticketUnit = ticket.unit_id ? unitsById.get(ticket.unit_id) : null

  const convPhone = digits10(c.external_phone_number) || digits10(user?.phone)
  const ticketPhone = digits10(ticket.resident_phone)

  if (convPhone && ticketPhone && convPhone !== ticketPhone) {
    reasons.push('phone_mismatch')
  }

  if (c.unit_id && ticket.unit_id && c.unit_id !== ticket.unit_id) {
    reasons.push('unit_id_mismatch')
  }

  const convProperty = convUnit?.property_id ?? null
  if (convProperty && ticket.property_id && convProperty !== ticket.property_id) {
    reasons.push('property_id_mismatch')
  }

  const convName = normName(user?.full_name)
  const ticketName = normName(ticket.resident_name)
  if (convName && ticketName && convName !== ticketName) {
    reasons.push('resident_name_mismatch')
  }

  if (c.landlord_id && ticket.landlord_id && c.landlord_id !== ticket.landlord_id) {
    reasons.push('landlord_id_mismatch')
  }

  // Strong signal: conversation has a resident, ticket names someone else + different phone
  if (
    reasons.includes('resident_name_mismatch') &&
    (reasons.includes('phone_mismatch') || reasons.includes('unit_id_mismatch'))
  ) {
    reasons.push('cross_resident_link')
  }

  if (reasons.length === 0) continue

  mismatches.push({
    conversation_id: c.id,
    ticket_id: ticket.id,
    conversation_type: c.conversation_type,
    reasons,
    conv: {
      resident_id: c.resident_id,
      resident_name: user?.full_name ?? null,
      unit_id: c.unit_id,
      unit_label: convUnit?.unit_label ?? null,
      property_id: convProperty,
      phone: c.external_phone_number,
    },
    ticket: {
      resident_name: ticket.resident_name,
      phone: ticket.resident_phone,
      unit_id: ticket.unit_id,
      unit_label: ticket.unit,
      property_id: ticket.property_id,
      headline: ticket.issue_headline,
      category: ticket.issue_category,
      description: clip(ticket.description, 100),
    },
  })
}

console.log('='.repeat(78))
console.log('CONVERSATION ↔ TICKET IDENTITY AUDIT')
console.log(`Checked ${conversations?.length ?? 0} conversations with maintenance_request_id`)
console.log(`Mismatches: ${mismatches.length}`)
console.log('='.repeat(78))

for (const row of mismatches) {
  console.log('')
  console.log(`CONV ${row.conversation_id}`)
  console.log(`  TICKET ${row.ticket_id}`)
  console.log(`  REASONS: ${row.reasons.join(', ')}`)
  console.log(
    `  CONV  resident=${row.conv.resident_name ?? '—'} (${row.conv.resident_id ?? '—'}) phone=${row.conv.phone ?? '—'} unit=${row.conv.unit_label ?? '—'} (${row.conv.unit_id ?? '—'}) property=${row.conv.property_id ?? '—'}`,
  )
  if (row.ticket) {
    console.log(
      `  TICKET resident=${row.ticket.resident_name ?? '—'} phone=${row.ticket.phone ?? '—'} unit=${row.ticket.unit_label ?? '—'} (${row.ticket.unit_id ?? '—'}) property=${row.ticket.property_id ?? '—'}`,
    )
    console.log(
      `  TICKET ${row.ticket.category ?? '—'} / ${row.ticket.headline ?? '—'} :: ${row.ticket.description}`,
    )
  } else {
    console.log('  TICKET missing')
  }
}

console.log('')
console.log(
  JSON.stringify(
    {
      checked: conversations?.length ?? 0,
      mismatch_count: mismatches.length,
      by_reason: mismatches.reduce((acc, m) => {
        for (const r of m.reasons) acc[r] = (acc[r] ?? 0) + 1
        return acc
      }, {}),
      mismatches: mismatches.map((m) => ({
        conversation_id: m.conversation_id,
        ticket_id: m.ticket_id,
        reasons: m.reasons,
        conv_resident: m.conv.resident_name,
        ticket_resident: m.ticket?.resident_name ?? null,
      })),
    },
    null,
    2,
  ),
)

if (process.env.STRICT === '1' && mismatches.length > 0) process.exit(1)
