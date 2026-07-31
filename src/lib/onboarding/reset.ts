/**
 * Reset / purge onboarding portfolio for the New Landlord account.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'
import { deleteResidentsForLandlord } from '@/lib/residentDeletion'
import { clearVendorSetupInboxForLandlord } from '@/lib/vendorSetupConversation'
import { supabase } from '@/lib/supabase'
import {
  clearLocalOnboardingStorage,
  defaultOnboardingState,
  hasOnboardingAccountDraft,
  markOnboardingResetInProgress,
  readLandlordOnboardingDraft,
  readLocalOnboardingState,
  requireOnboardingLandlord,
  saveLandlordOnboarding,
  writeLocalOnboarding,
} from './draftStorage'
import { deleteUnitsByIds } from './persist/properties'
import type { LandlordOnboardingState } from './types'

async function deleteLandlordScopedRows(
  table: string,
  landlordId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }
  }
  const { error } = await supabase.from(table).delete().eq('landlord_id', landlordId)
  if (error && !/does not exist|Could not find the table/i.test(error.message)) {
    return { ok: false, error: getErrorMessage(error, 'Something went wrong. Please try again.') }
  }
  return { ok: true }
}

async function deleteInScopedRows(
  table: string,
  column: string,
  values: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase || values.length === 0) {
    return { ok: true }
  }
  const { error } = await supabase.from(table).delete().in(column, values)
  if (error && !/does not exist|Could not find the table/i.test(error.message)) {
    return { ok: false, error: getErrorMessage(error, 'Something went wrong. Please try again.') }
  }
  return { ok: true }
}

/**
 * Delete graph/SMS rows for a landlord that are NOT tied to a current portfolio
 * resident/vendor. Keeps legitimately-created rows (e.g. tenant activation welcome
 * texts) while stripping unscoped import leftovers. Client fallback mirror of the
 * purge_empty_landlord_operations RPC preserve branch.
 */
async function deletePortfolioMismatchedRows(
  table: string,
  landlordId: string,
  residentIds: Set<string>,
  vendorIds: Set<string>,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }
  }
  // Mirror of purge_empty_landlord_operations preserve logic: keep portfolio-tied
  // rows AND onboarding comms (tenant.*/vendor.* graph events, vendor_onboarding
  // SMS threads) so onboarding actions survive the dashboard refresh.
  const selectColumns =
    table === 'sms_conversations'
      ? 'id, resident_id, vendor_id, workflow_template_id'
      : 'id, resident_id, vendor_id, event_type'
  const { data, error } = await supabase
    .from(table)
    .select(selectColumns)
    .eq('landlord_id', landlordId)
  if (error) {
    if (/does not exist|Could not find the table/i.test(error.message)) return { ok: true }
    return { ok: false, error: getErrorMessage(error, 'Something went wrong. Please try again.') }
  }
  const idsToDelete = ((data ?? []) as Record<string, unknown>[])
    .filter((row) => {
      const residentId = row.resident_id ? String(row.resident_id) : null
      const vendorId = row.vendor_id ? String(row.vendor_id) : null
      const eventType = row.event_type ? String(row.event_type) : ''
      const templateId = row.workflow_template_id ? String(row.workflow_template_id) : ''
      const keepPortfolio =
        (residentId && residentIds.has(residentId)) || (vendorId && vendorIds.has(vendorId))
      const keepOnboarding =
        eventType.startsWith('vendor.') ||
        eventType.startsWith('tenant.') ||
        templateId === 'vendor_onboarding'
      return !(keepPortfolio || keepOnboarding)
    })
    .map((row) => String(row.id))
  return deleteInScopedRows(table, 'id', idsToDelete)
}

/**
 * Clear vendor assignment before deleting vendors.
 * `assigned_vendor_id` is ON DELETE SET NULL; that alone leaves pending_accept/accepted/…
 * rows invalid under require_vendor_for_progress.
 */
async function detachVendorsFromMaintenanceRequests(
  landlordId: string,
  vendorIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }
  }

  const cleared = {
    assigned_vendor_id: null,
    vendor_work_status: 'unassigned' as const,
    assigned_at: null,
  }

  const { error: byLandlord } = await supabase
    .from('maintenance_requests')
    .update(cleared)
    .eq('landlord_id', landlordId)

  if (byLandlord) {
    return { ok: false, error: `maintenance_requests: ${byLandlord.message}` }
  }

  if (vendorIds.length > 0) {
    // Also clear any tickets (any landlord) still pointing at these vendor rows.
    const { error: byVendor } = await supabase
      .from('maintenance_requests')
      .update(cleared)
      .in('assigned_vendor_id', vendorIds)

    if (byVendor) {
      return { ok: false, error: `maintenance_requests: ${byVendor.message}` }
    }
  }

  return { ok: true }
}

/**
 * Remove tickets + workflow runs created by fast-track document import.
 * Keeps properties, units, residents, and vendors (guided portfolio).
 */
export async function purgeOnboardingImportedOperations(
  landlordId: string = getActiveLandlordId(),
  preservePortfolioSms = false,
): Promise<{ ok: boolean; error?: string }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) return scope
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }
  }

  // Prefer fail-closed SECURITY DEFINER RPC (bypasses missing DELETE RLS on runs).
  // preservePortfolioSms keeps SMS threads + graph events tied to current portfolio
  // residents/vendors (e.g. tenant activation welcome texts) while stripping import junk.
  const { error: rpcError } = await supabase.rpc('purge_empty_landlord_operations', {
    p_preserve_portfolio_sms: preservePortfolioSms,
  })
  if (!rpcError) {
    const remaining = await countLandlordOps(scope.landlordId)
    // In preserve mode the purge intentionally keeps vendor_onboarding runs, so a
    // remaining active run is expected — only gate on leftover imported tickets.
    const blocked = preservePortfolioSms
      ? remaining.tickets > 0
      : remaining.tickets > 0 || remaining.activeWorkflowRuns > 0
    if (blocked) {
      return {
        ok: false,
        error: `Could not clear imported tasks (${remaining.activeWorkflowRuns} runs, ${remaining.tickets} tickets remain).`,
      }
    }
    return { ok: true }
  }

  // RPC missing (migration not applied yet) — fall back to client deletes / cancel.
  if (!/Could not find the function|PGRST202|404/i.test(rpcError.message)) {
    console.warn('[landlordOnboarding] purge_empty_landlord_operations', rpcError.message)
  }

  const { data: ticketRows, error: ticketLoadError } = await supabase
    .from('maintenance_requests')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (ticketLoadError) {
    return { ok: false, error: getErrorMessage(ticketLoadError, 'Something went wrong. Please try again.') }
  }

  const ticketIds = (ticketRows ?? []).map((row) => String((row as { id: string }).id))
  const childDelete = await deleteInScopedRows('vendor_status_events', 'ticket_id', ticketIds)
  if (!childDelete.ok) return childDelete

  let graphSmsDeletes: { ok: boolean; error?: string }[]
  if (preservePortfolioSms) {
    const [residentRows, vendorRows] = await Promise.all([
      supabase.from('users').select('id').eq('landlord_id', scope.landlordId),
      supabase.from('vendors').select('id').eq('landlord_id', scope.landlordId),
    ])
    const residentIds = new Set(
      ((residentRows.data ?? []) as { id: string }[]).map((r) => String(r.id)),
    )
    const vendorIds = new Set(
      ((vendorRows.data ?? []) as { id: string }[]).map((r) => String(r.id)),
    )
    graphSmsDeletes = [
      await deletePortfolioMismatchedRows(
        'operations_graph_events',
        scope.landlordId,
        residentIds,
        vendorIds,
      ),
      await deletePortfolioMismatchedRows(
        'property_operations_graph',
        scope.landlordId,
        residentIds,
        vendorIds,
      ),
      // Messages cascade with their thread; delete mismatched threads only.
      await deletePortfolioMismatchedRows(
        'sms_conversations',
        scope.landlordId,
        residentIds,
        vendorIds,
      ),
    ]
  } else {
    graphSmsDeletes = [
      await deleteLandlordScopedRows('operations_graph_events', scope.landlordId),
      await deleteLandlordScopedRows('property_operations_graph', scope.landlordId),
      await deleteLandlordScopedRows('sms_messages', scope.landlordId),
      await deleteLandlordScopedRows('sms_conversations', scope.landlordId),
    ]
  }

  const ordered = [
    await deleteLandlordScopedRows('vendor_feedback', scope.landlordId),
    await deleteLandlordScopedRows('maintenance_invoices', scope.landlordId),
    ...graphSmsDeletes,
    await deleteLandlordScopedRows('workflow_events', scope.landlordId),
    await deleteLandlordScopedRows('workflow_runs', scope.landlordId),
    await deleteLandlordScopedRows('maintenance_requests', scope.landlordId),
  ]

  const failed = ordered.find((result) => !result.ok)
  if (failed) return failed

  // Staff historically lacked DELETE on workflow_runs; UPDATE is allowed — retire leftovers
  // so Active tasks / Needs attention go empty for guided portfolios.
  const cancelled = await cancelLandlordWorkflowRuns(scope.landlordId)
  if (!cancelled.ok) return cancelled

  const remaining = await countLandlordOps(scope.landlordId)
  if (remaining.tickets > 0 || remaining.activeWorkflowRuns > 0) {
    return {
      ok: false,
      error: `Could not clear imported tasks (${remaining.activeWorkflowRuns} active workflow runs still remain). Apply migration 20260716120000_onboarding_ops_purge_staff, then reset again.`,
    }
  }

  return { ok: true }
}

async function cancelLandlordWorkflowRuns(
  landlordId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }
  }
  const completedAt = new Date().toISOString()
  const { error } = await supabase
    .from('workflow_runs')
    .update({ status: 'cancelled', completed_at: completedAt })
    .eq('landlord_id', landlordId)
    .in('status', ['active', 'escalated'])

  if (error) {
    return { ok: false, error: `workflow_runs: ${error.message}` }
  }
  return { ok: true }
}

async function countLandlordOps(
  landlordId: string,
): Promise<{ tickets: number; workflowRuns: number; activeWorkflowRuns: number }> {
  if (!supabase) {
    return { tickets: 0, workflowRuns: 0, activeWorkflowRuns: 0 }
  }
  const [tickets, runs, activeRuns] = await Promise.all([
    supabase
      .from('maintenance_requests')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId),
    supabase
      .from('workflow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId),
    supabase
      .from('workflow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId)
      .in('status', ['active', 'escalated']),
  ])
  return {
    tickets: tickets.count ?? 0,
    workflowRuns: runs.count ?? 0,
    activeWorkflowRuns: activeRuns.count ?? 0,
  }
}

/**
 * New Landlord dashboard sync.
 *
 * Live SMS/web tickets and workflow runs are never deleted on dashboard load.
 * Destructive wipe of workflow runs / tickets only happens when the user clicks
 * **Reset onboarding** (`resetOnboardingPortfolio` / `restartNewLandlordOnboarding`).
 */
export type OnboardingDashboardSync = {
  landlordId: string
  /** Always true — dashboards load real ops for New Landlord. */
  allowImportedOperations: boolean
  purged: boolean
  error?: string
}

export async function ensureOnboardingDashboardMatchesPortfolio(
  landlordId: string = getActiveLandlordId(),
): Promise<OnboardingDashboardSync> {
  // Do not call purge_empty_landlord_operations here. That RPC deleted every
  // maintenance ticket + non-onboarding workflow run on each Overview/Comms load,
  // which wiped real SMS work orders (e.g. WO-3466). Reset is explicit-only.
  return { landlordId, allowImportedOperations: true, purged: false }
}

export async function resetOnboardingPortfolio(
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    // Non-onboarding accounts: no-op (never wipe demo/default).
    return { ok: true }
  }
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }
  }

  const { data: vendorRows, error: vendorLoadError } = await supabase
    .from('vendors')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (vendorLoadError) {
    return { ok: false, error: getErrorMessage(vendorLoadError, 'Something went wrong. Please try again.') }
  }

  const vendorIds = (vendorRows ?? []).map((row) => String((row as { id: string }).id))

  const { data: unitRows, error: unitLoadError } = await supabase
    .from('units')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (unitLoadError) {
    return { ok: false, error: getErrorMessage(unitLoadError, 'Something went wrong. Please try again.') }
  }

  const unitIds = (unitRows ?? []).map((row) => String((row as { id: string }).id))

  // Clear progress statuses before any vendor FK SET NULL can trip the check constraint.
  const detached = await detachVendorsFromMaintenanceRequests(scope.landlordId, vendorIds)
  if (!detached.ok) return detached

  // Tickets + workflow runs (RPC when available; verifies leftovers).
  const purged = await purgeOnboardingImportedOperations(scope.landlordId)
  if (!purged.ok) return purged

  // Occupancy references users with ON DELETE RESTRICT — clear it before residents.
  const occupancyCleared = unitIds.length
    ? await deleteInScopedRows('occupancy', 'unit_id', unitIds)
    : await deleteLandlordScopedRows('occupancy', scope.landlordId)
  if (!occupancyCleared.ok) return occupancyCleared

  const { data: residentRows, error: residentLoadError } = await supabase
    .from('users')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (residentLoadError) {
    return { ok: false, error: getErrorMessage(residentLoadError, 'Something went wrong. Please try again.') }
  }

  const residentIds = (residentRows ?? []).map((row) => String((row as { id: string }).id))
  if (residentIds.length > 0) {
    const removedResidents = await deleteResidentsForLandlord({
      landlordId: scope.landlordId,
      residentIds,
    })
    if (!removedResidents.ok) {
      return { ok: false, error: removedResidents.error }
    }
  }

  // Clear phone→identity map so the next run can reuse the same numbers.
  const identitiesCleared = await deleteLandlordScopedRows(
    'sms_identities',
    scope.landlordId,
  )
  if (!identitiesCleared.ok) return identitiesCleared

  // Drop unfinished verification invites tied to this landlord’s roster wipe.
  const verificationsCleared = await deleteLandlordScopedRows(
    'vendor_verifications',
    scope.landlordId,
  )
  if (!verificationsCleared.ok) return verificationsCleared

  const afterOps = [
    await deleteLandlordScopedRows('preventive_maintenance_tasks', scope.landlordId),
    await deleteLandlordScopedRows('unit_assets', scope.landlordId),
    await deleteInScopedRows('vendors', 'id', vendorIds),
    await deleteLandlordScopedRows('vendors', scope.landlordId),
  ]
  const afterFailed = afterOps.find((result) => !result.ok)
  if (afterFailed) return afterFailed

  const removed = await deleteUnitsByIds(unitIds)
  if (!removed.ok) return removed

  const unitsScoped = await deleteLandlordScopedRows('units', scope.landlordId)
  if (!unitsScoped.ok) return unitsScoped

  return { ok: true }
}

/** Wipe portfolio + onboarding progress and return to the welcome hub. */
export async function restartNewLandlordOnboarding(
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string; state?: LandlordOnboardingState }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    return { ok: false, error: scope.error }
  }

  // Block beforeunload flushes from the still-mounted wizard while we navigate away.
  markOnboardingResetInProgress()

  // Clear wizard status first so the guard cannot bounce on stale "completed" localStorage
  // even if portfolio deletes partially fail.
  clearLocalOnboardingStorage(scope.landlordId)
  clearVendorSetupInboxForLandlord(scope.landlordId)

  const cleared: LandlordOnboardingState = {
    ...defaultOnboardingState(scope.landlordId),
    onboardingStatus: 'not_started',
    currentStep: 'entry',
    setupPath: null,
    properties: [],
    formDraft: undefined,
  }
  await saveLandlordOnboarding(cleared)
  // Ensure a late beforeunload cannot resurrect the previous step.
  clearLocalOnboardingStorage(scope.landlordId)
  writeLocalOnboarding(cleared)

  const reset = await resetOnboardingPortfolio(scope.landlordId)
  if (!reset.ok) {
    // Keep welcome hub state even when portfolio wipe is partial.
    await saveLandlordOnboarding(cleared)
    clearLocalOnboardingStorage(scope.landlordId)
    writeLocalOnboarding(cleared)
    return {
      ok: false,
      error: reset.error ?? 'Could not clear previous portfolio data.',
      state: cleared,
    }
  }

  // Re-assert welcome hub after portfolio deletes (some paths rewrite draft_state).
  await saveLandlordOnboarding(cleared)
  clearLocalOnboardingStorage(scope.landlordId)
  writeLocalOnboarding(cleared)
  return { ok: true, state: cleared }
}

/** Wipe units/vendors/residents and clear property draft; optionally keep account setup fields. */
export async function clearOnboardingPortfolioSession(
  options: { keepAccountSetup?: boolean; landlordId?: string } = {},
): Promise<{ ok: boolean; error?: string; state: LandlordOnboardingState }> {
  const landlordId = options.landlordId ?? getActiveLandlordId()
  const keepAccountSetup = options.keepAccountSetup !== false

  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    return {
      ok: false,
      error: scope.error,
      state: defaultOnboardingState(landlordId),
    }
  }

  const reset = await resetOnboardingPortfolio(scope.landlordId)
  if (!reset.ok) {
    return {
      ok: false,
      error: reset.error,
      state: readLocalOnboardingState(scope.landlordId) ?? defaultOnboardingState(scope.landlordId),
    }
  }

  const draft = await readLandlordOnboardingDraft(scope.landlordId)
  const accountSetup =
    keepAccountSetup && hasOnboardingAccountDraft(draft)
      ? draft.accountSetup
      : defaultOnboardingState(scope.landlordId).accountSetup

  const cleared: LandlordOnboardingState = {
    ...defaultOnboardingState(scope.landlordId),
    accountSetup,
    onboardingStatus: 'not_started',
    currentStep: 'entry',
    setupPath: null,
    properties: [],
  }

  await saveLandlordOnboarding(cleared)
  return { ok: true, state: cleared }
}
