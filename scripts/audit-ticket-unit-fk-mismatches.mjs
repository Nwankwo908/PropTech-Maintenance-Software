#!/usr/bin/env node
/**
 * Audit (and optionally heal) tickets / conversations where unit_id or
 * property_id points at a different property than the resident's occupancy.
 *
 * This is the write-time corruption pattern from the Oct 2 Shahita backfill:
 * unit label "1" was trusted without property agreement.
 *
 * Standing check: daily cron `ulo-ticket-unit-fk-audit` →
 * `check-ticket-unit-fk-mismatches` (report-only). Use this script to review
 * or heal after the cron flags mismatches.
 *
 * Usage:
 *   node scripts/audit-ticket-unit-fk-mismatches.mjs
 *   LANDLORD_ID=... node scripts/audit-ticket-unit-fk-mismatches.mjs
 *   HEAL=1 node scripts/audit-ticket-unit-fk-mismatches.mjs
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const PROJECT_REF = 'mzpqwuizhiaczxcnmxbt'
const HEAL = process.env.HEAL === '1' || process.env.HEAL === 'true'
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

async function serviceRoleKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
  }
  const keys = JSON.parse(
    execSync(`supabase projects api-keys --project-ref ${PROJECT_REF} -o json`, {
      encoding: 'utf8',
    }),
  )
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve service_role key')
  return sr.api_key
}

function woRef(id) {
  return `WO-${String(id).replace(/-/g, '').slice(0, 4).toUpperCase()}`
}

const supabase = createClient(
  process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim(),
  await serviceRoleKey(),
  { auth: { persistSession: false } },
)

const landlordId =
  process.env.LANDLORD_ID?.trim() || 'de300000-0000-4000-8000-000000000003'

const [{ data: units }, { data: occupancy }, { data: residents }, { data: tickets }, { data: convos }] =
  await Promise.all([
    supabase
      .from('units')
      .select('id, unit_label, building, property_id')
      .eq('landlord_id', landlordId),
    supabase
      .from('occupancy')
      .select('unit_id, resident_id, status')
      .eq('landlord_id', landlordId)
      .eq('status', 'active'),
    supabase
      .from('users')
      .select('id, full_name, unit, building, email')
      .eq('landlord_id', landlordId),
    supabase
      .from('maintenance_requests')
      .select(
        'id, unit, unit_id, property_id, email, issue_category, description, vendor_work_status, created_at, resident_user_id',
      )
      .eq('landlord_id', landlordId)
      .order('created_at', { ascending: false })
      .limit(800),
    supabase
      .from('sms_conversations')
      .select('id, resident_id, unit_id, maintenance_request_id, conversation_type')
      .eq('landlord_id', landlordId)
      .not('resident_id', 'is', null)
      .not('unit_id', 'is', null)
      .limit(800),
  ])

const unitById = new Map((units ?? []).map((u) => [u.id, u]))
const occByResident = new Map()
for (const row of occupancy ?? []) {
  const list = occByResident.get(row.resident_id) ?? []
  list.push(row.unit_id)
  occByResident.set(row.resident_id, list)
}
const residentById = new Map((residents ?? []).map((r) => [r.id, r]))
const residentByEmail = new Map(
  (residents ?? [])
    .filter((r) => r.email)
    .map((r) => [String(r.email).toLowerCase(), r]),
)

function expectedUnitsForResident(resident) {
  const ids = new Set(occByResident.get(resident.id) ?? [])
  for (const unit of units ?? []) {
    if (
      String(unit.unit_label ?? '').trim() === String(resident.unit ?? '').trim() &&
      String(unit.building ?? '').trim().toLowerCase() ===
        String(resident.building ?? '').trim().toLowerCase()
    ) {
      ids.add(unit.id)
    }
  }
  return [...ids]
}

function resolveTicketResident(ticket, runResidentId) {
  if (runResidentId && residentById.get(runResidentId)) return residentById.get(runResidentId)
  if (ticket.resident_user_id && residentById.get(ticket.resident_user_id)) {
    return residentById.get(ticket.resident_user_id)
  }
  if (ticket.email && residentByEmail.get(String(ticket.email).toLowerCase())) {
    return residentByEmail.get(String(ticket.email).toLowerCase())
  }
  return null
}

const ticketIds = (tickets ?? []).map((t) => t.id)
const { data: runs } = ticketIds.length
  ? await supabase
      .from('workflow_runs')
      .select('id, entity_id, property_id, unit_id, resident_id, metadata, status')
      .eq('landlord_id', landlordId)
      .eq('template_id', 'maintenance_request')
      .in('entity_id', ticketIds)
  : { data: [] }
const runByTicket = new Map((runs ?? []).map((r) => [r.entity_id, r]))

const ticketMismatches = []
for (const ticket of tickets ?? []) {
  const run = runByTicket.get(ticket.id)
  const resident = resolveTicketResident(ticket, run?.resident_id)
  if (!resident) continue
  const expected = expectedUnitsForResident(resident)
  if (!expected.length) continue
  const reasons = []
  if (ticket.unit_id && !expected.includes(ticket.unit_id)) {
    reasons.push('ticket.unit_id not resident occupancy/roster unit')
  }
  const expectedProps = new Set(
    expected.map((id) => unitById.get(id)?.property_id).filter(Boolean),
  )
  if (ticket.property_id && expectedProps.size && !expectedProps.has(ticket.property_id)) {
    reasons.push('ticket.property_id not resident property')
  }
  if (run?.unit_id && !expected.includes(run.unit_id)) {
    reasons.push('run.unit_id not resident occupancy/roster unit')
  }
  if (!reasons.length) continue
  ticketMismatches.push({
    ticketId: ticket.id,
    wo: woRef(ticket.id),
    resident: resident.full_name,
    residentBuilding: resident.building,
    ticketUnit: unitById.get(ticket.unit_id)
      ? `${unitById.get(ticket.unit_id).building} #${unitById.get(ticket.unit_id).unit_label}`
      : ticket.unit_id,
    expected: expected.map((id) => {
      const u = unitById.get(id)
      return u ? `${u.building} #${u.unit_label}` : id
    }),
    reasons,
    backfillDesc: /Opened via backfill/i.test(ticket.description || ''),
    status: ticket.vendor_work_status,
  })
}

const convoMismatches = []
for (const convo of convos ?? []) {
  const expected = occByResident.get(convo.resident_id) ?? []
  if (!expected.length || expected.includes(convo.unit_id)) continue
  const resident = residentById.get(convo.resident_id)
  const wrong = unitById.get(convo.unit_id)
  convoMismatches.push({
    conversationId: convo.id,
    resident: resident?.full_name,
    residentBuilding: resident?.building,
    convoUnit: wrong ? `${wrong.building} #${wrong.unit_label}` : convo.unit_id,
    expected: expected.map((id) => {
      const u = unitById.get(id)
      return u ? `${u.building} #${u.unit_label}` : id
    }),
    expectedUnitId: expected[0],
    ticketId: convo.maintenance_request_id,
  })
}

console.log(JSON.stringify({
  landlordId,
  ticketMismatches: ticketMismatches.length,
  conversationMismatches: convoMismatches.length,
  tickets: ticketMismatches,
  conversations: convoMismatches,
}, null, 2))

if (HEAL) {
  let healed = 0
  for (const row of convoMismatches) {
    if (!row.expectedUnitId) continue
    const { error } = await supabase
      .from('sms_conversations')
      .update({ unit_id: row.expectedUnitId })
      .eq('id', row.conversationId)
    if (error) {
      console.error('heal convo failed', row.conversationId, error.message)
      continue
    }
    healed += 1
    console.log('healed convo', row.conversationId, '->', row.expected[0])
  }
  for (const row of ticketMismatches) {
    const resident = [...residentById.values()].find((r) => r.full_name === row.resident)
    if (!resident) continue
    const expectedIds = expectedUnitsForResident(resident)
    if (expectedIds.length !== 1) {
      console.warn('skip ticket heal (ambiguous expected units)', row.wo, expectedIds)
      continue
    }
    const unitId = expectedIds[0]
    const unit = unitById.get(unitId)
    const { error } = await supabase
      .from('maintenance_requests')
      .update({
        unit_id: unitId,
        property_id: unit?.property_id ?? null,
        unit: unit?.unit_label ?? undefined,
      })
      .eq('id', row.ticketId)
    if (error) {
      console.error('heal ticket failed', row.wo, error.message)
      continue
    }
    const run = runByTicket.get(row.ticketId)
    if (run?.id) {
      await supabase
        .from('workflow_runs')
        .update({
          unit_id: unitId,
          property_id: unit?.property_id ?? null,
        })
        .eq('id', run.id)
    }
    healed += 1
    console.log('healed ticket', row.wo, '->', row.expected[0])
  }
  console.log(`healed ${healed} rows`)
}
