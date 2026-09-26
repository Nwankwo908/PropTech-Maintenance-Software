/**
 * Start-setup purge of leftover Fast Track / document-import tickets & runs.
 *
 * Independent of factory reset and of Start/Back permission soft-fail paths.
 * Scoped to onboarding landlords and to import lineage only — never deletes
 * legitimate SMS / live intake tickets.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabase'
import { requireOnboardingLandlord } from './scope'

/** Durable marker written on workflow_runs / invoices / graph events from Fast Track import. */
export const ONBOARDING_IMPORT_SOURCE = 'onboarding_import'

export type PurgeLeftoverImportOpsResult = {
  ok: boolean
  error?: string
  /** True when landlord is outside ONBOARDING_LANDLORD_IDS — purge intentionally skipped. */
  skipped?: boolean
  purgedTicketIds: string[]
  purgedRunIds: string[]
}

function isImportSourceMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false
  const source = (metadata as { source?: unknown }).source
  return typeof source === 'string' && source.trim() === ONBOARDING_IMPORT_SOURCE
}

/**
 * Collect maintenance_request ids that Fast Track / document import created.
 * Lineage signals (any one is enough):
 * - workflow_runs.metadata.source = onboarding_import (entity_id → ticket)
 * - maintenance_invoices.metadata.source = onboarding_import
 * - operations_graph_events maintenance.imported / maintenance.expense_imported
 */
export function collectOnboardingImportTicketIds(input: {
  workflowRuns: Array<{ id?: string; entity_id?: string | null; metadata?: unknown }>
  invoices: Array<{ maintenance_request_id?: string | null; metadata?: unknown }>
  graphEvents: Array<{
    maintenance_request_id?: string | null
    event_type?: string | null
    metadata?: unknown
  }>
}): { ticketIds: string[]; runIds: string[] } {
  const ticketIds = new Set<string>()
  const runIds = new Set<string>()

  for (const run of input.workflowRuns) {
    if (!isImportSourceMetadata(run.metadata)) continue
    const runId = typeof run.id === 'string' ? run.id.trim() : ''
    if (runId) runIds.add(runId)
    const entityId = typeof run.entity_id === 'string' ? run.entity_id.trim() : ''
    if (entityId) ticketIds.add(entityId)
  }

  for (const invoice of input.invoices) {
    if (!isImportSourceMetadata(invoice.metadata)) continue
    const ticketId =
      typeof invoice.maintenance_request_id === 'string'
        ? invoice.maintenance_request_id.trim()
        : ''
    if (ticketId) ticketIds.add(ticketId)
  }

  for (const event of input.graphEvents) {
    const eventType = typeof event.event_type === 'string' ? event.event_type.trim() : ''
    const fromImportEvent =
      eventType === 'maintenance.imported' || eventType === 'maintenance.expense_imported'
    if (!fromImportEvent && !isImportSourceMetadata(event.metadata)) continue
    const ticketId =
      typeof event.maintenance_request_id === 'string'
        ? event.maintenance_request_id.trim()
        : ''
    if (ticketId) ticketIds.add(ticketId)
  }

  return { ticketIds: [...ticketIds], runIds: [...runIds] }
}

/**
 * Delete only import-lineage tickets/runs for an onboarding (Limited Alpha) landlord.
 * No-op for non-onboarding landlords. Does not call purge_landlord_portfolio.
 */
export async function purgeLeftoverOnboardingImportOps(
  landlordId: string = getActiveLandlordId(),
): Promise<PurgeLeftoverImportOpsResult> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    return {
      ok: true,
      skipped: true,
      purgedTicketIds: [],
      purgedRunIds: [],
    }
  }
  if (!supabase) {
    return {
      ok: false,
      error: "We can't reach the server right now. Please try again in a moment.",
      purgedTicketIds: [],
      purgedRunIds: [],
    }
  }

  const [runsRes, invoicesRes, graphRes] = await Promise.all([
    supabase
      .from('workflow_runs')
      .select('id, entity_id, metadata')
      .eq('landlord_id', scope.landlordId),
    supabase
      .from('maintenance_invoices')
      .select('maintenance_request_id, metadata')
      .eq('landlord_id', scope.landlordId),
    supabase
      .from('operations_graph_events')
      .select('maintenance_request_id, event_type, metadata')
      .eq('landlord_id', scope.landlordId)
      .in('event_type', ['maintenance.imported', 'maintenance.expense_imported']),
  ])

  if (runsRes.error) {
    return {
      ok: false,
      error: getErrorMessage(runsRes.error, 'Could not load imported workflow runs.'),
      purgedTicketIds: [],
      purgedRunIds: [],
    }
  }
  if (invoicesRes.error && !/does not exist|Could not find the table/i.test(invoicesRes.error.message)) {
    return {
      ok: false,
      error: getErrorMessage(invoicesRes.error, 'Could not load imported invoices.'),
      purgedTicketIds: [],
      purgedRunIds: [],
    }
  }
  if (graphRes.error && !/does not exist|Could not find the table/i.test(graphRes.error.message)) {
    // Graph table may be huge / missing — continue with runs + invoices only.
    console.warn('[onboarding] import graph lineage probe', graphRes.error.message)
  }

  const { ticketIds, runIds } = collectOnboardingImportTicketIds({
    workflowRuns: (runsRes.data ?? []) as Array<{
      id?: string
      entity_id?: string | null
      metadata?: unknown
    }>,
    invoices: (invoicesRes.data ?? []) as Array<{
      maintenance_request_id?: string | null
      metadata?: unknown
    }>,
    graphEvents: (graphRes.data ?? []) as Array<{
      maintenance_request_id?: string | null
      event_type?: string | null
      metadata?: unknown
    }>,
  })

  if (ticketIds.length === 0 && runIds.length === 0) {
    return { ok: true, purgedTicketIds: [], purgedRunIds: [] }
  }

  // Child rows first.
  if (ticketIds.length > 0) {
    const { error: statusErr } = await supabase
      .from('vendor_status_events')
      .delete()
      .in('ticket_id', ticketIds)
    if (statusErr && !/does not exist|Could not find the table/i.test(statusErr.message)) {
      console.warn('[onboarding] import vendor_status_events purge', statusErr.message)
    }

    const { error: invoiceErr } = await supabase
      .from('maintenance_invoices')
      .delete()
      .eq('landlord_id', scope.landlordId)
      .in('maintenance_request_id', ticketIds)
    if (invoiceErr && !/does not exist|Could not find the table/i.test(invoiceErr.message)) {
      console.warn('[onboarding] import invoices purge', invoiceErr.message)
    }
  }

  if (runIds.length > 0) {
    const { error: eventsErr } = await supabase
      .from('workflow_events')
      .delete()
      .in('workflow_run_id', runIds)
    if (eventsErr && !/does not exist|Could not find the table/i.test(eventsErr.message)) {
      console.warn('[onboarding] import workflow_events purge', eventsErr.message)
    }

    const { error: runsErr } = await supabase
      .from('workflow_runs')
      .delete()
      .eq('landlord_id', scope.landlordId)
      .in('id', runIds)
    if (runsErr) {
      return {
        ok: false,
        error: getErrorMessage(runsErr, 'Could not clear imported workflow runs.'),
        purgedTicketIds: [],
        purgedRunIds: [],
      }
    }
  }

  if (ticketIds.length > 0) {
    const { error: ticketsErr } = await supabase
      .from('maintenance_requests')
      .delete()
      .eq('landlord_id', scope.landlordId)
      .in('id', ticketIds)
    if (ticketsErr) {
      return {
        ok: false,
        error: getErrorMessage(ticketsErr, 'Could not clear imported maintenance tickets.'),
        purgedTicketIds: [],
        purgedRunIds: runIds,
      }
    }
  }

  return { ok: true, purgedTicketIds: ticketIds, purgedRunIds: runIds }
}

export type OnboardingStartPrepDeps = {
  purgeLeftoverImportOps: (landlordId: string) => Promise<PurgeLeftoverImportOpsResult>
  /**
   * Intentionally NOT the Start/Back permission soft-fail / wipe path.
   * Tests stub this away to prove purge still runs when wipe is removed.
   */
  wipePortfolioSession?: () => Promise<unknown>
}

const defaultStartPrepDeps: OnboardingStartPrepDeps = {
  purgeLeftoverImportOps: purgeLeftoverOnboardingImportOps,
}

/**
 * Side effects that must run when the landlord clicks Start (guided or Fast Track).
 * Kept separate from returnToWelcomeHub / clearOnboardingPortfolioSession so
 * permission soft-fails on wipe cannot disable the import-ticket purge again.
 */
export async function runOnboardingStartPrep(
  landlordId: string,
  deps: Partial<OnboardingStartPrepDeps> = {},
): Promise<PurgeLeftoverImportOpsResult> {
  const resolved: OnboardingStartPrepDeps = {
    ...defaultStartPrepDeps,
    ...deps,
  }
  // Never call wipePortfolioSession here — Start must not depend on full wipe.
  void resolved.wipePortfolioSession
  return resolved.purgeLeftoverImportOps(landlordId)
}
