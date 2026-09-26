/**
 * Factory-reset / ops-purge prep: archive import-lineage tickets that would hit
 * HARD_DELETE_FORBIDDEN, then unlock only those rows for hard-delete.
 *
 * Does NOT modify the prevent_hard_delete_assigned_work_orders trigger.
 * After terminateWorkOrder, previous_vendor_id + work_order_terminations FK still
 * block DELETE — so for import-lineage purge targets only we clear vendor columns
 * and remove termination child rows, then the normal delete path can succeed.
 * Non-import tickets are never touched.
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabase'
import {
  collectOnboardingImportTicketIds,
  ONBOARDING_IMPORT_SOURCE,
} from './purgeImportOps'

export type HardDeleteRiskTicket = {
  id: string
  assigned_vendor_id?: string | null
  previous_vendor_id?: string | null
}

/** Mirrors prevent_hard_delete_assigned_work_orders — vendor is or was assigned. */
export function wouldHitHardDeleteForbidden(ticket: HardDeleteRiskTicket): boolean {
  const assigned =
    typeof ticket.assigned_vendor_id === 'string' && ticket.assigned_vendor_id.trim()
  const previous =
    typeof ticket.previous_vendor_id === 'string' && ticket.previous_vendor_id.trim()
  return Boolean(assigned || previous)
}

export type TerminateImportTicketFn = (input: {
  landlordId: string
  ticketId: string
}) => Promise<{ ok: true } | { ok: false; error: string }>

export type ArchiveImportLineageResult = {
  ok: boolean
  error?: string
  /** Import-lineage ticket ids that needed archive (vendor assigned/had). */
  riskTicketIds: string[]
  archivedTicketIds: string[]
  archiveFailed: { count: number; ticketIds: string[] }
  unlockedTicketIds: string[]
}

function terminateWorkOrderUrl(): string | null {
  const explicit = import.meta.env.VITE_TERMINATE_WORK_ORDER_URL?.trim()
  if (explicit) return explicit
  const deleteUrl = import.meta.env.VITE_ADMIN_DELETE_WORK_ORDER_URL?.trim()
  if (deleteUrl) {
    return deleteUrl.replace(/admin-delete-work-order\/?$/, 'terminate-work-order')
  }
  const reassign = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (reassign) {
    return reassign.replace(/admin-reassign-vendor\/?$/, 'terminate-work-order')
  }
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) return null
  return `${base}/functions/v1/terminate-work-order`
}

/** Default: Edge terminate-work-order with notifyVendor=false (factory-reset cleanup). */
export async function terminateImportTicketViaEdge(input: {
  landlordId: string
  ticketId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = terminateWorkOrderUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    return {
      ok: false,
      error: 'Work order archive is not configured (admin Edge URL/secret).',
    }
  }
  try {
    const res = await fetchAdminEdgeFunction(url, {
      method: 'POST',
      headers: adminEdgeInvokeHeaders(secret),
      body: JSON.stringify({
        landlordId: input.landlordId,
        ticketId: input.ticketId,
        mode: 'archive',
        source: 'cleanup',
        reason: 'Factory reset — onboarding import cleanup',
        notifyVendor: false,
        prepareForHardDelete: true,
      }),
    })
    const payload = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean }
    if (!res.ok) {
      return { ok: false, error: payload.error ?? `Archive failed (${res.status})` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: getErrorMessage(error, 'Archive failed.') }
  }
}

export async function loadOnboardingImportTicketIds(
  landlordId: string,
): Promise<{ ok: true; ticketIds: string[] } | { ok: false; error: string }> {
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }
  const [runsRes, invoicesRes, graphRes] = await Promise.all([
    supabase
      .from('workflow_runs')
      .select('id, entity_id, metadata')
      .eq('landlord_id', landlordId),
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
  if (runsRes.error) {
    return { ok: false, error: getErrorMessage(runsRes.error, 'Could not load import workflow runs.') }
  }
  if (invoicesRes.error && !/does not exist|Could not find the table/i.test(invoicesRes.error.message)) {
    return { ok: false, error: getErrorMessage(invoicesRes.error, 'Could not load import invoices.') }
  }
  const { ticketIds } = collectOnboardingImportTicketIds({
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
  return { ok: true, ticketIds }
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++]!
      await worker(current)
    }
  })
  await Promise.all(runners)
}

/**
 * After terminateWorkOrder, remove FK/audit rows + clear vendor columns so the
 * existing HARD_DELETE_FORBIDDEN trigger allows DELETE — import-lineage only.
 */
export async function unlockImportTicketsForHardDelete(
  landlordId: string,
  ticketIds: string[],
): Promise<{ ok: boolean; error?: string; unlockedTicketIds: string[] }> {
  if (ticketIds.length === 0) return { ok: true, unlockedTicketIds: [] }
  if (!supabase) {
    return {
      ok: false,
      error: "We can't reach the server right now. Please try again in a moment.",
      unlockedTicketIds: [],
    }
  }

  const { error: attemptsErr } = await supabase
    .from('work_order_terminate_notify_attempts')
    .delete()
    .in('ticket_id', ticketIds)
  if (attemptsErr && !/does not exist|Could not find the table/i.test(attemptsErr.message)) {
    return {
      ok: false,
      error: getErrorMessage(attemptsErr, 'Could not clear terminate notify attempts.'),
      unlockedTicketIds: [],
    }
  }

  const { error: termErr } = await supabase
    .from('work_order_terminations')
    .delete()
    .in('ticket_id', ticketIds)
  if (termErr && !/does not exist|Could not find the table/i.test(termErr.message)) {
    return {
      ok: false,
      error: getErrorMessage(termErr, 'Could not clear work order terminations.'),
      unlockedTicketIds: [],
    }
  }

  const { error: clearErr } = await supabase
    .from('maintenance_requests')
    .update({
      assigned_vendor_id: null,
      previous_vendor_id: null,
    })
    .eq('landlord_id', landlordId)
    .in('id', ticketIds)
  if (clearErr) {
    return {
      ok: false,
      error: getErrorMessage(clearErr, 'Could not clear vendor assignment for purge.'),
      unlockedTicketIds: [],
    }
  }

  return { ok: true, unlockedTicketIds: [...ticketIds] }
}

/**
 * Archive import-lineage tickets that would hit HARD_DELETE_FORBIDDEN, then unlock
 * them for the subsequent hard-delete pass. Never touches non-import tickets.
 */
export async function archiveImportLineageTicketsForHardDelete(
  landlordId: string,
  deps: {
    terminateTicket?: TerminateImportTicketFn
    loadImportTicketIds?: typeof loadOnboardingImportTicketIds
    unlockTickets?: typeof unlockImportTicketsForHardDelete
    loadTicketRisk?: (ids: string[]) => Promise<
      { ok: true; tickets: HardDeleteRiskTicket[] } | { ok: false; error: string }
    >
  } = {},
): Promise<ArchiveImportLineageResult> {
  const emptyFailed = { count: 0, ticketIds: [] as string[] }
  const terminate = deps.terminateTicket ?? terminateImportTicketViaEdge
  const loadIds = deps.loadImportTicketIds ?? loadOnboardingImportTicketIds
  const unlock = deps.unlockTickets ?? unlockImportTicketsForHardDelete

  const loaded = await loadIds(landlordId)
  if (!loaded.ok) {
    return {
      ok: false,
      error: loaded.error,
      riskTicketIds: [],
      archivedTicketIds: [],
      archiveFailed: emptyFailed,
      unlockedTicketIds: [],
    }
  }
  if (loaded.ticketIds.length === 0) {
    return {
      ok: true,
      riskTicketIds: [],
      archivedTicketIds: [],
      archiveFailed: emptyFailed,
      unlockedTicketIds: [],
    }
  }

  let tickets: HardDeleteRiskTicket[]
  if (deps.loadTicketRisk) {
    const risk = await deps.loadTicketRisk(loaded.ticketIds)
    if (!risk.ok) {
      return {
        ok: false,
        error: risk.error,
        riskTicketIds: [],
        archivedTicketIds: [],
        archiveFailed: emptyFailed,
        unlockedTicketIds: [],
      }
    }
    tickets = risk.tickets
  } else {
    if (!supabase) {
      return {
        ok: false,
        error: "We can't reach the server right now. Please try again in a moment.",
        riskTicketIds: [],
        archivedTicketIds: [],
        archiveFailed: emptyFailed,
        unlockedTicketIds: [],
      }
    }
    const { data, error } = await supabase
      .from('maintenance_requests')
      .select('id, assigned_vendor_id, previous_vendor_id')
      .eq('landlord_id', landlordId)
      .in('id', loaded.ticketIds)
    if (error) {
      return {
        ok: false,
        error: getErrorMessage(error, 'Could not load import tickets for purge prep.'),
        riskTicketIds: [],
        archivedTicketIds: [],
        archiveFailed: emptyFailed,
        unlockedTicketIds: [],
      }
    }
    tickets = (data ?? []) as HardDeleteRiskTicket[]
  }

  const riskTicketIds = tickets
    .filter((t) => wouldHitHardDeleteForbidden(t))
    .map((t) => t.id)
    .filter(Boolean)

  if (riskTicketIds.length === 0) {
    return {
      ok: true,
      riskTicketIds: [],
      archivedTicketIds: [],
      archiveFailed: emptyFailed,
      unlockedTicketIds: [],
    }
  }

  const archivedTicketIds: string[] = []
  const failedIds: string[] = []

  await runPool(riskTicketIds, 8, async (ticketId) => {
    const result = await terminate({ landlordId, ticketId })
    if (result.ok) archivedTicketIds.push(ticketId)
    else failedIds.push(ticketId)
  })

  if (failedIds.length > 0) {
    return {
      ok: false,
      error: `Could not archive ${failedIds.length} import work order(s) before purge: ${failedIds.join(', ')}`,
      riskTicketIds,
      archivedTicketIds,
      archiveFailed: { count: failedIds.length, ticketIds: failedIds },
      unlockedTicketIds: [],
    }
  }

  const unlocked = await unlock(landlordId, archivedTicketIds)
  if (!unlocked.ok) {
    return {
      ok: false,
      error: unlocked.error ?? 'Could not unlock archived import tickets for hard-delete.',
      riskTicketIds,
      archivedTicketIds,
      archiveFailed: emptyFailed,
      unlockedTicketIds: [],
    }
  }

  return {
    ok: true,
    riskTicketIds,
    archivedTicketIds,
    archiveFailed: emptyFailed,
    unlockedTicketIds: unlocked.unlockedTicketIds,
  }
}

/** Classify remaining tickets that still trip HARD_DELETE_FORBIDDEN (import-lineage only). */
export function classifyHardDeleteBlockedImportTickets(input: {
  importTicketIds: string[]
  remainingTickets: HardDeleteRiskTicket[]
}): { count: number; ticketIds: string[] } {
  const importSet = new Set(input.importTicketIds)
  const blocked = input.remainingTickets
    .filter((t) => importSet.has(t.id) && wouldHitHardDeleteForbidden(t))
    .map((t) => t.id)
  return { count: blocked.length, ticketIds: blocked }
}

/**
 * Factory Reset: archive + unlock EVERY ticket on this landlord that would hit
 * HARD_DELETE_FORBIDDEN. Factory reset deletes the whole portfolio — not just
 * import lineage — so leftover archived SMS tickets with previous_vendor_id must
 * be prepared too. Start-setup leftover purge still uses lineage-only.
 */
export async function archiveHardDeleteRiskTicketsForFactoryReset(
  landlordId: string,
  deps: {
    terminateTicket?: TerminateImportTicketFn
    unlockTickets?: typeof unlockImportTicketsForHardDelete
    loadRiskTickets?: () => Promise<
      { ok: true; tickets: HardDeleteRiskTicket[] } | { ok: false; error: string }
    >
  } = {},
): Promise<ArchiveImportLineageResult> {
  const emptyFailed = { count: 0, ticketIds: [] as string[] }
  const terminate = deps.terminateTicket ?? terminateImportTicketViaEdge
  const unlock = deps.unlockTickets ?? unlockImportTicketsForHardDelete

  let tickets: HardDeleteRiskTicket[]
  if (deps.loadRiskTickets) {
    const loaded = await deps.loadRiskTickets()
    if (!loaded.ok) {
      return {
        ok: false,
        error: loaded.error,
        riskTicketIds: [],
        archivedTicketIds: [],
        archiveFailed: emptyFailed,
        unlockedTicketIds: [],
      }
    }
    tickets = loaded.tickets
  } else {
    if (!supabase) {
      return {
        ok: false,
        error: "We can't reach the server right now. Please try again in a moment.",
        riskTicketIds: [],
        archivedTicketIds: [],
        archiveFailed: emptyFailed,
        unlockedTicketIds: [],
      }
    }
    const { data, error } = await supabase
      .from('maintenance_requests')
      .select('id, assigned_vendor_id, previous_vendor_id')
      .eq('landlord_id', landlordId)
      .or('assigned_vendor_id.not.is.null,previous_vendor_id.not.is.null')
    if (error) {
      return {
        ok: false,
        error: getErrorMessage(error, 'Could not load hard-delete risk tickets.'),
        riskTicketIds: [],
        archivedTicketIds: [],
        archiveFailed: emptyFailed,
        unlockedTicketIds: [],
      }
    }
    tickets = (data ?? []) as HardDeleteRiskTicket[]
  }

  const riskTicketIds = tickets
    .filter((t) => wouldHitHardDeleteForbidden(t))
    .map((t) => t.id)
    .filter(Boolean)

  if (riskTicketIds.length === 0) {
    return {
      ok: true,
      riskTicketIds: [],
      archivedTicketIds: [],
      archiveFailed: emptyFailed,
      unlockedTicketIds: [],
    }
  }

  const archivedTicketIds: string[] = []
  const failedIds: string[] = []

  await runPool(riskTicketIds, 8, async (ticketId) => {
    const result = await terminate({ landlordId, ticketId })
    if (result.ok) archivedTicketIds.push(ticketId)
    else failedIds.push(ticketId)
  })

  if (failedIds.length > 0) {
    return {
      ok: false,
      error: `Could not archive ${failedIds.length} work order(s) before factory reset: ${failedIds.join(', ')}`,
      riskTicketIds,
      archivedTicketIds,
      archiveFailed: { count: failedIds.length, ticketIds: failedIds },
      unlockedTicketIds: [],
    }
  }

  const unlocked = await unlock(landlordId, archivedTicketIds)
  if (!unlocked.ok) {
    return {
      ok: false,
      error: unlocked.error ?? 'Could not unlock archived tickets for hard-delete.',
      riskTicketIds,
      archivedTicketIds,
      archiveFailed: emptyFailed,
      unlockedTicketIds: [],
    }
  }

  return {
    ok: true,
    riskTicketIds,
    archivedTicketIds,
    archiveFailed: emptyFailed,
    unlockedTicketIds: unlocked.unlockedTicketIds,
  }
}
