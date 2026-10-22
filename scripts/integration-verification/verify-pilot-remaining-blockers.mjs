#!/usr/bin/env node
/**
 * Audit remaining pilot blockers against durable evidence (no LA1 writes).
 * Evidence: .readiness/integration/pilot-remaining-blockers.json
 *
 * Does not import TypeScript modules — gate statuses are asserted via vitest
 * (shared/pilotGate.test.ts). This script audits on-disk readiness artifacts +
 * optional live DB spot-checks.
 */
import { createClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = resolve(ROOT, '.readiness/integration')

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
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
}
loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

const LA2 = 'de300000-0000-4000-8000-000000000004'
const LA1 = 'de300000-0000-4000-8000-000000000003'

function readJson(rel) {
  const p = resolve(ROOT, rel)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

const handset = readJson('.readiness/integration/sms-identity-routing-handset.json')
const failureRecovery = readJson('.readiness/integration/sms-failure-recovery.json')
const liveAi = readJson('.readiness/integration/live-ai-workflows.json')
const connected = readJson('.readiness/connected-workflows.json')
const connectedSub = existsSync(resolve(ROOT, '.readiness/connected-workflows.subchecks.jsonl'))
  ? readFileSync(resolve(ROOT, '.readiness/connected-workflows.subchecks.jsonl'), 'utf8')
  : ''

const results = []
function add(id, status, note, evidence = {}) {
  results.push({ id, status, note, evidence })
}

const vendorStep = handset?.journeyPayload?.steps?.find((s) => s.step === 'vendor_reply')
const ticketAfter = handset?.journeyPayload?.steps?.find((s) => s.step === 'ticket_after_reply')
const vendorOk =
  vendorStep?.source === 'handset' &&
  /^SM[0-9a-f]{32}$/i.test(String(vendorStep?.providerMessageSid || '')) &&
  ticketAfter?.vendor_work_status === 'accepted' &&
  handset?.results?.some((r) => r.id === 'vendor_inbound_routes_la2' && r.status === 'passed')

add(
  'vendor_assignment_handset',
  vendorOk ? 'passed' : 'failed',
  vendorOk
    ? 'Real vendor YES + schedule reply accepted ticket on LA2'
    : 'Missing durable handset assign→accept evidence',
  {
    vendorStep,
    ticketAfter,
    evidenceFile: '.readiness/integration/sms-identity-routing-handset.json',
  },
)

const lateHandset = failureRecovery?.results?.find((r) => r.id === 'late_approval_handset')
add(
  'approvals_handset',
  lateHandset?.status === 'passed' ? 'passed' : 'failed',
  lateHandset?.status === 'passed'
    ? 'Landlord handset approval proven'
    : `Landlord estimate APPROVE/DECLINE from handset not proven (late_approval_handset=${lateHandset?.status ?? 'missing'})`,
  {
    lateHandset,
    injectOnly: failureRecovery?.results?.find((r) => r.id === 'late_approval_inject_simulation'),
    evidenceFile: '.readiness/integration/sms-failure-recovery.json',
  },
)

const leaseExtract = liveAi?.results?.find((r) => r.id === 'lease_extract')
add(
  'lease_imports_gap',
  'excluded',
  'Fixture extract passed historically; pilot scopes out live multi-lease / rent-roll precedence re-proof',
  { leaseExtractStatus: leaseExtract?.status ?? null, liveAiOverall: liveAi?.overall ?? null },
)

add(
  'ask_ulo_priorities_gap',
  'excluded',
  'Routing unit-covered; cross-system retrieval + action binding not proven for pilot',
  { liveAiOverall: liveAi?.overall ?? null },
)

const homeBlocked =
  /home_check_sql.*blocked/i.test(connectedSub) ||
  /home_check_sql=blocked/.test(JSON.stringify(connected ?? {}))
add(
  'home_checks_gap',
  'excluded',
  'Home Check SQL/browser prerequisites blocked/not_run in readiness connected-workflows',
  { homeBlocked, connectedStatus: connected?.status ?? null },
)

let approvalInbound = []
let la1Hits = 0
const url = process.env.VITE_SUPABASE_URL?.trim()
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (url && key) {
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data } = await sb
    .from('sms_messages')
    .select('id, landlord_id, body, created_at, from_number, provider_message_sid')
    .eq('direction', 'inbound')
    .eq('landlord_id', LA2)
    .or('body.ilike.APPROVE%,body.ilike.approve%')
    .order('created_at', { ascending: false })
    .limit(5)
  approvalInbound = data ?? []

  const { data: la1Touch } = await sb
    .from('sms_messages')
    .select('id')
    .eq('landlord_id', LA1)
    .gte('created_at', '2026-10-22T13:00:00Z')
    .limit(1)
  la1Hits = (la1Touch ?? []).length
  add(
    'la1_untouched_today_probe_window',
    la1Hits === 0 ? 'passed' : 'failed',
    'No LA1 SMS rows in today probe window (spot check)',
    { la1Hits },
  )
} else {
  add('la1_untouched_today_probe_window', 'blocked', 'Missing Supabase credentials for spot check', {})
}

const hasApproveSid = approvalInbound.some((m) =>
  /^SM[0-9a-f]{32}$/i.test(String(m.provider_message_sid || '')),
)
add(
  'approvals_db_spot_check',
  hasApproveSid ? 'passed' : 'failed',
  'Durable Twilio inbound APPROVE on LA2 (spot check)',
  { sample: approvalInbound.slice(0, 3) },
)

const criticalFailed = results.some(
  (r) =>
    r.status === 'failed' &&
    (r.id === 'vendor_assignment_handset' || r.id === 'la1_untouched_today_probe_window'),
)
const approvalsStillOpen =
  results.find((r) => r.id === 'approvals_handset')?.status !== 'passed' &&
  results.find((r) => r.id === 'approvals_db_spot_check')?.status !== 'passed'

const payload = {
  area: 'pilot-remaining-blockers',
  finishedAt: new Date().toISOString(),
  results,
  summary: {
    vendorAssignment: vendorOk ? 'verified_by_handset_evidence' : 'not_verified',
    approvals: approvalsStillOpen ? 'still_open' : 'verified',
    leaseImports: 'excluded_pilot_gap',
    askUloPriorities: 'excluded_pilot_gap',
    homeChecks: 'excluded_pilot_gap',
    rentPayments: 'hard_disabled_in_pilotGate',
  },
  overall: criticalFailed ? 'failed' : approvalsStillOpen ? 'blocked' : 'passed',
}

mkdirSync(OUT, { recursive: true })
writeFileSync(resolve(OUT, 'pilot-remaining-blockers.json'), JSON.stringify(payload, null, 2) + '\n')
console.log(JSON.stringify(payload, null, 2))
process.exit(criticalFailed ? 1 : 0)
