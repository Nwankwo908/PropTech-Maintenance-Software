#!/usr/bin/env node
/**
 * One-shot Factory Reset for Limited Alpha 2 with structured verification.
 * Archive-first (terminate semantics) for import-lineage HARD_DELETE_FORBIDDEN
 * tickets, then portfolio purge. Fail-closed — does not re-run on failure.
 *
 * Usage: node scripts/factory-reset-limited-alpha-2.verify.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const LIMITED_ALPHA_2_LANDLORD_ID = 'de300000-0000-4000-8000-000000000004'
const ONBOARDING_IMPORT_SOURCE = 'onboarding_import'

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
const PROJECT_REF =
  process.env.SUPABASE_PROJECT_REF?.trim() || 'mzpqwuizhiaczxcnmxbt'

async function resolveServiceRoleKey() {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (fromEnv) return fromEnv
  const { execSync } = await import('node:child_process')
  const json = execSync(
    `supabase projects api-keys --project-ref ${PROJECT_REF} -o json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const keys = JSON.parse(json)
  const sr = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')
  if (!sr?.api_key) throw new Error('Could not resolve Supabase service_role key')
  return sr.api_key
}

if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL / VITE_SUPABASE_URL in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, await resolveServiceRoleKey(), {
  auth: { autoRefreshToken: false, persistSession: false },
})

const landlordId = LIMITED_ALPHA_2_LANDLORD_ID

function isImportSource(metadata) {
  return (
    metadata &&
    typeof metadata === 'object' &&
    typeof metadata.source === 'string' &&
    metadata.source.trim() === ONBOARDING_IMPORT_SOURCE
  )
}

async function countExact(table, extra = (q) => q) {
  let q = supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('landlord_id', landlordId)
  q = extra(q)
  const { count, error } = await q
  if (error) {
    if (/does not exist|Could not find the table/i.test(error.message)) {
      return { count: 0, error: null }
    }
    return { count: null, error: error.message }
  }
  return { count: count ?? 0, error: null }
}

async function countOps() {
  const [tickets, activeRuns, opsGraph, propGraph] = await Promise.all([
    countExact('maintenance_requests'),
    countExact('workflow_runs', (q) => q.in('status', ['active', 'escalated'])),
    countExact('operations_graph_events'),
    countExact('property_operations_graph'),
  ])
  return {
    remainingTickets: tickets.count,
    ticketsError: tickets.error,
    remainingActiveWorkflowRuns: activeRuns.count,
    activeRunsError: activeRuns.error,
    remainingOperationsGraph: opsGraph.count,
    opsGraphError: opsGraph.error,
    remainingPropertyOperationsGraph: propGraph.count,
    propGraphError: propGraph.error,
  }
}

async function loadImportTicketIds() {
  const [runsRes, invoicesRes, graphRes] = await Promise.all([
    supabase.from('workflow_runs').select('id, entity_id, metadata').eq('landlord_id', landlordId),
    supabase
      .from('maintenance_invoices')
      .select('maintenance_request_id, metadata')
      .eq('landlord_id', landlordId),
    supabase
      .from('operations_graph_events')
      .select('maintenance_request_id, event_type, metadata')
      .eq('landlord_id', landlordId)
      .in('event_type', ['maintenance.imported', 'maintenance.expense_imported']),
  ])
  if (runsRes.error) throw new Error(runsRes.error.message)
  const ids = new Set()
  for (const run of runsRes.data ?? []) {
    if (!isImportSource(run.metadata)) continue
    if (run.entity_id) ids.add(String(run.entity_id))
  }
  for (const inv of invoicesRes.data ?? []) {
    if (!isImportSource(inv.metadata)) continue
    if (inv.maintenance_request_id) ids.add(String(inv.maintenance_request_id))
  }
  for (const ev of graphRes.data ?? []) {
    const type = ev.event_type
    if (
      type === 'maintenance.imported' ||
      type === 'maintenance.expense_imported' ||
      isImportSource(ev.metadata)
    ) {
      if (ev.maintenance_request_id) ids.add(String(ev.maintenance_request_id))
    }
  }
  return [...ids]
}

/**
 * Mirror terminateWorkOrder(archive) + prepareForHardDelete unlock for every
 * ticket that would hit HARD_DELETE_FORBIDDEN (Factory Reset portfolio wipe).
 */
async function archiveHardDeleteRisksForFactoryReset() {
  const { data: tickets, error } = await supabase
    .from('maintenance_requests')
    .select('id, assigned_vendor_id, previous_vendor_id, vendor_work_status')
    .eq('landlord_id', landlordId)
    .or('assigned_vendor_id.not.is.null,previous_vendor_id.not.is.null')
  if (error) throw new Error(error.message)

  const risk = tickets ?? []
  const archiveFailed = { count: 0, ticketIds: [] }

  for (const ticket of risk) {
    const ticketId = String(ticket.id)
    const previousVendorId = ticket.assigned_vendor_id || ticket.previous_vendor_id
    const previousStatus = ticket.vendor_work_status
    const status = String(previousStatus ?? '').toLowerCase()

    if (status !== 'cancelled' && status !== 'archived') {
      const { error: termErr } = await supabase.from('work_order_terminations').insert({
        ticket_id: ticketId,
        landlord_id: landlordId,
        mode: 'archive',
        source: 'cleanup',
        actor_type: 'system',
        reason: 'Factory reset — hard-delete prep',
        previous_vendor_id: previousVendorId,
        previous_vendor_work_status: previousStatus,
        notify_status: 'not_required',
      })
      if (termErr && termErr.code !== '23505') {
        archiveFailed.count += 1
        archiveFailed.ticketIds.push(ticketId)
        continue
      }
      const { error: updErr } = await supabase
        .from('maintenance_requests')
        .update({
          vendor_work_status: 'archived',
          assigned_vendor_id: null,
          previous_vendor_id: previousVendorId,
          cancelled_at: new Date().toISOString(),
          cancelled_by: 'system',
          cancellation_reason: 'Factory reset — hard-delete prep',
        })
        .eq('id', ticketId)
        .eq('landlord_id', landlordId)
      if (updErr) {
        archiveFailed.count += 1
        archiveFailed.ticketIds.push(ticketId)
        continue
      }
    }

    await supabase.from('work_order_terminate_notify_attempts').delete().eq('ticket_id', ticketId)
    await supabase.from('work_order_terminations').delete().eq('ticket_id', ticketId)
    const { error: clearErr } = await supabase
      .from('maintenance_requests')
      .update({ assigned_vendor_id: null, previous_vendor_id: null })
      .eq('id', ticketId)
      .eq('landlord_id', landlordId)
    if (clearErr) {
      archiveFailed.count += 1
      archiveFailed.ticketIds.push(ticketId)
    }
  }

  return {
    archiveFailed,
    riskTicketIds: risk.map((t) => String(t.id)),
  }
}

async function deleteLandlordScoped(table) {
  const { error } = await supabase.from(table).delete().eq('landlord_id', landlordId)
  if (error && !/does not exist|Could not find the table/i.test(error.message)) {
    return { ok: false, error: `${table}: ${error.message}` }
  }
  return { ok: true }
}

async function clientFallbackPurge() {
  const { data: ticketRows, error: ticketLoadError } = await supabase
    .from('maintenance_requests')
    .select('id')
    .eq('landlord_id', landlordId)
  if (ticketLoadError) return { ok: false, error: ticketLoadError.message }
  const ticketIds = (ticketRows ?? []).map((r) => String(r.id))
  if (ticketIds.length > 0) {
    await supabase.from('vendor_status_events').delete().in('ticket_id', ticketIds)
  }
  for (const table of [
    'vendor_feedback',
    'maintenance_invoices',
    'operations_graph_events',
    'property_operations_graph',
    'sms_messages',
    'sms_conversations',
    'workflow_events',
    'workflow_runs',
    'maintenance_requests',
  ]) {
    const cleared = await deleteLandlordScoped(table)
    if (!cleared.ok) return cleared
  }
  await supabase
    .from('workflow_runs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('landlord_id', landlordId)
    .in('status', ['active', 'escalated'])
  return { ok: true }
}

function buildResult(opsPurgePath, counts, extras = {}) {
  const activityFeed = {
    remainingOperationsGraph: counts.remainingOperationsGraph,
    remainingPropertyOperationsGraph: counts.remainingPropertyOperationsGraph,
    ...(counts.opsGraphError || counts.propGraphError
      ? {
          countError: [counts.opsGraphError, counts.propGraphError].filter(Boolean).join('; '),
        }
      : {}),
  }
  const opsCounts = {
    remainingTickets: counts.remainingTickets,
    remainingActiveWorkflowRuns: counts.remainingActiveWorkflowRuns,
    ...(counts.ticketsError || counts.activeRunsError
      ? {
          countError: [counts.ticketsError, counts.activeRunsError].filter(Boolean).join('; '),
        }
      : {}),
    ...(extras.archiveFailed?.count ? { archiveFailed: extras.archiveFailed } : {}),
    ...(extras.hardDeleteBlocked?.count
      ? { hardDeleteBlocked: extras.hardDeleteBlocked }
      : {}),
  }

  const checks = {
    okTrue: true,
    opsPurgePathKnown:
      opsPurgePath === 'purge_landlord_portfolio' ||
      opsPurgePath === 'purge_empty_landlord_operations' ||
      opsPurgePath === 'client_fallback',
    activityFeedOpsGraphZero: activityFeed.remainingOperationsGraph === 0,
    activityFeedPropGraphZero: activityFeed.remainingPropertyOperationsGraph === 0,
    activityFeedNoCountError: !activityFeed.countError,
    remainingTicketsZero: opsCounts.remainingTickets === 0,
    remainingActiveRunsZero: opsCounts.remainingActiveWorkflowRuns === 0,
    opsCountsNoCountError: !opsCounts.countError,
    wipeSucceeded: !extras.wipeError,
    archiveSucceeded: !extras.archiveFailed?.count,
  }

  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)

  const ok = failedChecks.length === 0
  return {
    ok,
    error:
      extras.wipeError ||
      (extras.archiveFailed?.count
        ? `archiveFailed: ${extras.archiveFailed.ticketIds.join(', ')}`
        : undefined) ||
      (ok ? undefined : `Incomplete reset — failed: ${failedChecks.join(', ')}`),
    opsPurgePath,
    activityFeed,
    opsCounts,
    checks,
    failedChecks,
  }
}

async function main() {
  console.log(`[pre] Limited Alpha 2 = ${landlordId}`)
  const before = await countOps()
  console.log('[pre] counts', {
    tickets: before.remainingTickets,
    activeRuns: before.remainingActiveWorkflowRuns,
    operations_graph_events: before.remainingOperationsGraph,
    property_operations_graph: before.remainingPropertyOperationsGraph,
  })

  console.log('[prep] archive-first HARD_DELETE risks (full portfolio)…')
  const prep = await archiveHardDeleteRisksForFactoryReset()
  console.log('[prep] risk tickets', prep.riskTicketIds.length, 'archiveFailed', prep.archiveFailed)

  if (prep.archiveFailed.count > 0) {
    const result = buildResult('unknown', await countOps(), {
      archiveFailed: prep.archiveFailed,
      wipeError: `archiveFailed: ${prep.archiveFailed.ticketIds.join(', ')}`,
    })
    console.log('\n=== Factory reset structured result (Limited Alpha 2) ===')
    console.log(JSON.stringify(result, null, 2))
    console.error('\nINCOMPLETE — archiveFailed.')
    process.exit(1)
  }

  // Detach any remaining assignments (mirrors resetOnboardingPortfolio).
  await supabase
    .from('maintenance_requests')
    .update({
      assigned_vendor_id: null,
      vendor_work_status: 'unassigned',
      assigned_at: null,
    })
    .eq('landlord_id', landlordId)

  let opsPurgePath = 'unknown'
  let wipeError

  const { error: alphaPurgeError } = await supabase.rpc('purge_landlord_portfolio', {
    p_landlord_id: landlordId,
  })
  if (!alphaPurgeError) {
    opsPurgePath = 'purge_landlord_portfolio'
  } else if (!/Could not find the function|PGRST202|404/i.test(alphaPurgeError.message)) {
    console.warn('[purge_landlord_portfolio]', alphaPurgeError.message)
  }

  await supabase.rpc('purge_landlord_activity_feed', { p_landlord_id: landlordId })

  let mid = await countOps()
  const needsFallback =
    opsPurgePath === 'unknown' ||
    (mid.remainingTickets ?? 0) > 0 ||
    (mid.remainingActiveWorkflowRuns ?? 0) > 0 ||
    (mid.remainingOperationsGraph ?? 0) > 0 ||
    (mid.remainingPropertyOperationsGraph ?? 0) > 0

  if (needsFallback) {
    const fallback = await clientFallbackPurge()
    if (!fallback.ok) wipeError = fallback.error
    if (opsPurgePath === 'unknown') opsPurgePath = 'client_fallback'
  }

  for (const table of [
    'tenant_activation_attempts',
    'vendor_feedback_requests',
    'vendor_onboarding_override_acks',
    'ask_ulo_conversations',
  ]) {
    await deleteLandlordScoped(table)
  }

  await supabase.from('landlord_onboarding').upsert({
    landlord_id: landlordId,
    status: 'not_started',
    current_step: 'entry',
    setup_path: null,
    completed_at: null,
    updated_at: new Date().toISOString(),
  })

  const after = await countOps()

  // Diagnose hardDeleteBlocked on leftovers
  let hardDeleteBlocked
  if ((after.remainingTickets ?? 0) > 0) {
    const { data } = await supabase
      .from('maintenance_requests')
      .select('id, assigned_vendor_id, previous_vendor_id')
      .eq('landlord_id', landlordId)
      .or('assigned_vendor_id.not.is.null,previous_vendor_id.not.is.null')
    const blocked = (data ?? []).map((t) => String(t.id))
    if (blocked.length) {
      hardDeleteBlocked = { count: blocked.length, ticketIds: blocked }
    }
  }

  const result = buildResult(opsPurgePath, after, {
    wipeError,
    hardDeleteBlocked,
  })

  console.log('\n=== Factory reset structured result (Limited Alpha 2) ===')
  console.log(JSON.stringify(result, null, 2))

  if (!result.ok) {
    console.error('\nINCOMPLETE — do not treat tickets as cleared.')
    console.error('Failed checks:', result.failedChecks.join(', '))
    process.exit(1)
  }

  console.log('\nOK — all structured checks passed. Treat the 344 as cleared.')
}

main().catch((err) => {
  console.error('FAIL', err)
  process.exit(1)
})
