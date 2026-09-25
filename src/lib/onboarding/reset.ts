/**
 * Reset / purge onboarding portfolio for the New Landlord account.
 */
import { EMPTY_LANDLORD_ID, getActiveLandlordId } from '@/lib/activeLandlord'
import { landlordHasPayments } from '@shared/landlordCapabilities'
import { getErrorMessage } from '@/lib/errorMessage'
import { recordActivityLog } from '@/lib/recordActivityLog'
import { deleteResidentsForLandlord } from '@/lib/residentDeletion'
import { clearVendorSetupInboxForLandlord } from '@/lib/vendorSetupConversation'
import { supabase } from '@/lib/supabase'
import { clearLandlordStripeConnect } from '@/api/landlordStripeConnect'
import { clearLimitedAlphaPostOnboardingWelcomeSeen } from '@/lib/postOnboardingWelcome'
import {
  clearSetupSuccessCardDismissed,
  clearSetupSuccessTestDelivery,
  clearSetupSuccessNavPercentBaseline,
} from '@/lib/setupSuccessChecklist'
import { clearSetupSuccessCheckboxGuide } from '@/lib/setupSuccessGuide'
import {
  assertFactoryResetAccountShape,
  expectedFactoryResetAccountShape,
  factoryResetOnboardingClearRow,
  type FactoryResetShapeSnapshot,
} from './factoryResetAccountShape'
import {
  emptyFactoryResetActivityFeed,
  isFactoryResetActivityFeedEmpty,
  type FactoryResetActivityFeed,
  type FactoryResetResult,
  type OpsPurgePath,
} from './factoryResetOutcome'
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

export type { FactoryResetActivityFeed, FactoryResetResult, OpsPurgePath } from './factoryResetOutcome'

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
): Promise<{ ok: boolean; error?: string; opsPurgePath: OpsPurgePath }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) return { ...scope, opsPurgePath: 'unknown' }
  if (!supabase) {
    return {
      ok: false,
      error: 'We can\'t reach the server right now. Please try again in a moment.',
      opsPurgePath: 'unknown',
    }
  }

  const useEmptyLandlordPurgeRpc = scope.landlordId === EMPTY_LANDLORD_ID

  // Full Alpha + Limited Alpha: portfolio purge via staff RPC when not preserving.
  // purge_landlord_portfolio allowlists 5 ids (Demo …0001, New Landlord …0002,
  // Full Alpha 068daf53-…, Limited Alpha 1 …0003, Limited Alpha 2 …0004), but
  // only Alpha 1/2 are ONBOARDING_LANDLORD_IDS / Factory Reset UI targets — the
  // other three are ops-script-only and retired from onboarding scope.
  // Never call purge_empty_landlord_operations for those ids — that RPC is scoped to New Landlord only.
  if (!useEmptyLandlordPurgeRpc && !preservePortfolioSms) {
    const { error: alphaPurgeError } = await supabase.rpc('purge_landlord_portfolio', {
      p_landlord_id: scope.landlordId,
    })
    if (!alphaPurgeError) {
      const remaining = await countLandlordOps(scope.landlordId)
      if (remaining.tickets > 0 || remaining.activeWorkflowRuns > 0) {
        return {
          ok: false,
          error: `Could not clear imported tasks (${remaining.activeWorkflowRuns} runs, ${remaining.tickets} tickets remain).`,
          opsPurgePath: 'purge_landlord_portfolio',
        }
      }
      return { ok: true, opsPurgePath: 'purge_landlord_portfolio' }
    }
    if (!/Could not find the function|PGRST202|404/i.test(alphaPurgeError.message)) {
      console.warn('[landlordOnboarding] purge_landlord_portfolio', alphaPurgeError.message)
    }
    // Full portfolio RPC often times out on huge activity-feed tables. Clear the
    // bell sources with the dedicated batched RPC before client_fallback continues.
    const { error: feedRpcError } = await supabase.rpc('purge_landlord_activity_feed', {
      p_landlord_id: scope.landlordId,
    })
    if (feedRpcError && !/Could not find the function|PGRST202|404/i.test(feedRpcError.message)) {
      console.warn('[landlordOnboarding] purge_landlord_activity_feed after portfolio fail', feedRpcError.message)
    }
    // RPC missing or failed — fall through to scoped client deletes below.
  } else if (useEmptyLandlordPurgeRpc) {
    // New Landlord (empty): prefer fail-closed SECURITY DEFINER RPC (bypasses missing DELETE RLS on runs).
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
          opsPurgePath: 'purge_empty_landlord_operations',
        }
      }
      return { ok: true, opsPurgePath: 'purge_empty_landlord_operations' }
    }

    // RPC missing (migration not applied yet) — fall back to client deletes / cancel.
    if (!/Could not find the function|PGRST202|404/i.test(rpcError.message)) {
      console.warn('[landlordOnboarding] purge_empty_landlord_operations', rpcError.message)
    }
  }

  const opsPurgePath: OpsPurgePath = 'client_fallback'

  const { data: ticketRows, error: ticketLoadError } = await supabase
    .from('maintenance_requests')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (ticketLoadError) {
    return {
      ok: false,
      error: getErrorMessage(ticketLoadError, 'Something went wrong. Please try again.'),
      opsPurgePath,
    }
  }

  const ticketIds = (ticketRows ?? []).map((row) => String((row as { id: string }).id))
  const childDelete = await deleteInScopedRows('vendor_status_events', 'ticket_id', ticketIds)
  if (!childDelete.ok) return { ...childDelete, opsPurgePath }

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
      await deleteLandlordScopedRowsBatched('operations_graph_events', scope.landlordId),
      await deleteLandlordScopedRowsBatched('property_operations_graph', scope.landlordId),
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
  if (failed) return { ...failed, opsPurgePath }

  // Staff historically lacked DELETE on workflow_runs; UPDATE is allowed — retire leftovers
  // so Active tasks / Needs attention go empty for guided portfolios.
  const cancelled = await cancelLandlordWorkflowRuns(scope.landlordId)
  if (!cancelled.ok) return { ...cancelled, opsPurgePath }

  const remaining = await countLandlordOps(scope.landlordId)
  if (remaining.tickets > 0 || remaining.activeWorkflowRuns > 0) {
    return {
      ok: false,
      error: `Could not clear imported tasks (${remaining.activeWorkflowRuns} active workflow runs still remain). Apply migration 20260716120000_onboarding_ops_purge_staff, then reset again.`,
      opsPurgePath,
    }
  }

  return { ok: true, opsPurgePath }
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
  return { tickets: tickets.count ?? 0, workflowRuns: runs.count ?? 0, activeWorkflowRuns: activeRuns.count ?? 0 }
}

const CLEARED_LANDLORD_PAYOUTS = {
  stripe_connect_account_id: null,
  stripe_connect_charges_enabled: false,
  stripe_connect_payouts_enabled: false,
  stripe_connect_details_submitted: false,
}

/**
 * Extra landlord-scoped tables wiped on factory reset (beyond tickets/runs/roster).
 * Missing tables are ignored so older environments still reset.
 * Graph tables are first so mid-path client deletes clear the bell sources even
 * when the staff portfolio RPC already wiped them (or failed and fell through).
 */
const FACTORY_RESET_SCOPED_TABLES = [
  'operations_graph_events',
  'property_operations_graph',
  'insight_scheduling_requests',
  'inspector_day_holds',
  'home_data_graph_ingest',
  'home_data_graph',
  'thumbtack_vendor_threads',
  'landlord_thumbtack_oauth',
  'thumbtack_oauth_states',
  'tenant_activation_attempts',
  'broadcast_notification_log',
  'broadcast_notifications',
  'property_inspection_assessments',
  'property_access_profiles',
  'vendor_feedback_requests',
  'vendor_incident_reports',
  'vendor_onboarding_override_acks',
  'unit_inspections',
  'inspections',
  'ask_ulo_conversations',
] as const

async function deleteLandlordScopedRowsBatched(
  table: string,
  landlordId: string,
  batchSize = 2000,
  maxBatches = 500,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }
  }

  for (let batch = 0; batch < maxBatches; batch++) {
    const { data, error: selectError } = await supabase
      .from(table)
      .select('id')
      .eq('landlord_id', landlordId)
      .limit(batchSize)

    if (selectError) {
      if (/does not exist|Could not find the table/i.test(selectError.message)) {
        return { ok: true }
      }
      return {
        ok: false,
        error: getErrorMessage(selectError, `Could not clear ${table}.`),
      }
    }

    const ids = ((data ?? []) as { id: string }[]).map((row) => String(row.id)).filter(Boolean)
    if (ids.length === 0) return { ok: true }

    const { error: deleteError } = await supabase.from(table).delete().in('id', ids)
    if (deleteError) {
      if (/does not exist|Could not find the table/i.test(deleteError.message)) {
        return { ok: true }
      }
      return {
        ok: false,
        error: getErrorMessage(deleteError, `Could not clear ${table}.`),
      }
    }
  }

  return {
    ok: false,
    error: `Could not finish clearing ${table} (still had rows after ${maxBatches} batches).`,
  }
}

/**
 * Wipe Ulo Activity Feed sources. Prefer security-definer batched RPC (handles
 * 100k+ rows without statement_timeout); fall back to client batched deletes.
 */
async function clearFactoryResetActivityFeed(
  landlordId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'We can\'t reach the server right now. Please try again in a moment.' }
  }

  const { error: rpcError } = await supabase.rpc('purge_landlord_activity_feed', {
    p_landlord_id: landlordId,
  })
  if (!rpcError) return { ok: true }

  if (!/Could not find the function|PGRST202|404/i.test(rpcError.message)) {
    console.warn('[landlordOnboarding] purge_landlord_activity_feed', rpcError.message)
  }

  const ops = await deleteLandlordScopedRowsBatched('operations_graph_events', landlordId)
  if (!ops.ok) return ops
  return deleteLandlordScopedRowsBatched('property_operations_graph', landlordId)
}

/**
 * Count remaining rows in every durable source the Ulo Activity bell reads.
 * Does not trust delete return values — SELECT count is the assert.
 * On statement_timeout, probe for any remaining row so we do not report "unknown"
 * when leftover feed data is still clearly present.
 */
async function countFactoryResetActivityFeed(
  landlordId: string,
): Promise<FactoryResetActivityFeed> {
  if (!supabase) {
    return emptyFactoryResetActivityFeed('Supabase is not configured.')
  }

  async function countOne(
    table: 'operations_graph_events' | 'property_operations_graph',
  ): Promise<{ count: number | null; error?: string }> {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId)

    if (!error) return { count: count ?? 0 }
    if (/does not exist|Could not find the table/i.test(error.message)) {
      return { count: 0 }
    }

    // Timeout / overload: prove emptiness with a cheap existence probe.
    if (/timeout|canceling statement/i.test(error.message)) {
      const probe = await supabase.from(table).select('id').eq('landlord_id', landlordId).limit(1)
      if (probe.error) {
        return { count: null, error: `${table}: ${error.message}` }
      }
      if ((probe.data ?? []).length === 0) return { count: 0 }
      return {
        count: null,
        error: `${table}: count timed out; rows still present`,
      }
    }

    return { count: null, error: `${table}: ${error.message}` }
  }

  const [operations, propertyOps] = await Promise.all([
    countOne('operations_graph_events'),
    countOne('property_operations_graph'),
  ])

  const errors = [operations.error, propertyOps.error].filter(Boolean) as string[]

  return {
    remainingOperationsGraph: operations.count,
    remainingPropertyOperationsGraph: propertyOps.count,
    ...(errors.length > 0 ? { countError: errors.join('; ') } : {}),
  }
}

/**
 * Fail closed unless both bell sources count as 0.
 * Separate from wipe — delete ok:true alone is not proof the feed is empty.
 */
async function assertFactoryResetActivityFeedEmpty(
  landlordId: string,
): Promise<{ ok: boolean; error?: string; activityFeed: FactoryResetActivityFeed }> {
  const activityFeed = await countFactoryResetActivityFeed(landlordId)
  if (activityFeed.countError) {
    return {
      ok: false,
      error: 'Activity feed count could not be verified after reset.',
      activityFeed,
    }
  }
  if (!isFactoryResetActivityFeedEmpty(activityFeed)) {
    return {
      ok: false,
      error: `Activity feed still has rows after reset (operations_graph_events: ${activityFeed.remainingOperationsGraph}, property_operations_graph: ${activityFeed.remainingPropertyOperationsGraph}).`,
      activityFeed,
    }
  }
  return { ok: true, activityFeed }
}

async function clearLandlordPayoutsOnOnboardingReset(
  landlordId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await clearLandlordStripeConnect(landlordId)
    return { ok: true }
  } catch (err) {
    console.warn('[landlordOnboarding] clear payouts via Stripe', err)
  }
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }
  const { error } = await supabase
    .from('landlords')
    .update({
      ...CLEARED_LANDLORD_PAYOUTS,
      stripe_connect_updated_at: new Date().toISOString(),
    })
    .eq('id', landlordId)
  if (error) {
    return {
      ok: false,
      error: getErrorMessage(error, 'Could not clear the rent payout account.'),
    }
  }
  void recordActivityLog({
    landlordId,
    eventType: 'landlord.stripe_connect_cleared',
    source: 'dashboard',
    actorType: 'landlord',
    metadata: {
      message: 'Rent payout account was removed so onboarding can start over.',
    },
  })
  return { ok: true }
}

async function loadFactoryResetShapeSnapshot(
  landlordId: string,
): Promise<FactoryResetShapeSnapshot | null> {
  if (!supabase) return null
  const [landlordRes, onboardingRes] = await Promise.all([
    supabase
      .from('landlords')
      .select('name, email, contact_name, phone')
      .eq('id', landlordId)
      .maybeSingle(),
    supabase
      .from('landlord_onboarding')
      .select(
        'onboarding_status, current_step, account_settings, emergency_contact, draft_state, auto_approval_threshold, notification_preference, notification_channel, communication_style',
      )
      .eq('landlord_id', landlordId)
      .maybeSingle(),
  ])
  if (!landlordRes.data || !onboardingRes.data) return null
  const landlord = landlordRes.data as {
    name: string | null
    email: string | null
    contact_name: string | null
    phone: string | null
  }
  const onboarding = onboardingRes.data as {
    onboarding_status: string | null
    current_step: string | null
    account_settings: unknown
    emergency_contact: unknown
    draft_state: unknown
    auto_approval_threshold: unknown
    notification_preference: unknown
    notification_channel: unknown
    communication_style: unknown
  }
  return {
    landlord: {
      name: landlord.name,
      email: landlord.email,
      contact_name: landlord.contact_name,
      phone: landlord.phone,
    },
    onboarding: {
      onboarding_status: onboarding.onboarding_status,
      current_step: onboarding.current_step,
      account_settings: onboarding.account_settings,
      emergency_contact: onboarding.emergency_contact,
      draft_state: onboarding.draft_state,
      auto_approval_threshold: onboarding.auto_approval_threshold,
      notification_preference: onboarding.notification_preference,
      notification_channel: onboarding.notification_channel,
      communication_style: onboarding.communication_style,
    },
  }
}

/**
 * Restore the expected Limited Alpha blank Account Setup shape (landlords +
 * landlord_onboarding account_settings / emergency_contact / notification cols)
 * and assert the post-reset row matches.
 */
async function resetLandlordProfileForFactoryReset(
  landlordId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: "We can't reach the server right now. Please try again in a moment." }
  }
  const expected = expectedFactoryResetAccountShape(landlordId)
  if (!expected) return { ok: true }

  const { error } = await supabase
    .from('landlords')
    .update({
      name: expected.landlord.name,
      email: expected.landlord.email,
      contact_name: expected.landlord.contact_name,
      phone: expected.landlord.phone,
    })
    .eq('id', landlordId)

  if (error && /contact_name|phone|column .* does not exist/i.test(error.message)) {
    const { error: nameEmail } = await supabase
      .from('landlords')
      .update({
        name: expected.landlord.name,
        email: expected.landlord.email,
      })
      .eq('id', landlordId)
    if (nameEmail) {
      return {
        ok: false,
        error: getErrorMessage(nameEmail, 'Could not reset the account profile.'),
      }
    }
  } else if (error) {
    return {
      ok: false,
      error: getErrorMessage(error, 'Could not reset the account profile.'),
    }
  }

  // Apply the full blank onboarding clear (not just account_settings {}).
  const clearRow = factoryResetOnboardingClearRow(expected)
  let settingsError = (
    await supabase.from('landlord_onboarding').update(clearRow).eq('landlord_id', landlordId)
  ).error

  if (settingsError && /onboarding_session|column .* does not exist/i.test(settingsError.message)) {
    const {
      onboarding_session_id: _dropSessionId,
      onboarding_session_started_at: _dropSessionStarted,
      ...withoutSession
    } = clearRow
    settingsError = (
      await supabase
        .from('landlord_onboarding')
        .update(withoutSession)
        .eq('landlord_id', landlordId)
    ).error
  }

  if (
    settingsError &&
    !/account_settings|emergency_contact|column .* does not exist|does not exist|Could not find the table/i.test(
      settingsError.message,
    )
  ) {
    return {
      ok: false,
      error: getErrorMessage(settingsError, 'Could not clear saved account settings.'),
    }
  }

  // If some columns are missing on older DBs, still force account_settings wipe.
  if (settingsError && /account_settings|emergency_contact|column/i.test(settingsError.message)) {
    const { error: fallback } = await supabase
      .from('landlord_onboarding')
      .update({
        account_settings: {},
        updated_at: new Date().toISOString(),
      })
      .eq('landlord_id', landlordId)
    if (
      fallback &&
      !/account_settings|column .* does not exist|does not exist|Could not find the table/i.test(
        fallback.message,
      )
    ) {
      return {
        ok: false,
        error: getErrorMessage(fallback, 'Could not clear saved account settings.'),
      }
    }
  }

  const snapshot = await loadFactoryResetShapeSnapshot(landlordId)
  if (snapshot) {
    const asserted = assertFactoryResetAccountShape(expected, snapshot)
    if (!asserted.ok) {
      console.warn('[landlordOnboarding] factory reset shape assert', asserted.error)
      return { ok: false, error: asserted.error }
    }
  }

  return { ok: true }
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

/**
 * Full portfolio wipe used by factory reset (Reset onboarding).
 * Deletes properties, units, residents, vendors, tickets, SMS, and related ops.
 */
export async function resetOnboardingPortfolio(
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string; opsPurgePath: OpsPurgePath }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    // Non-onboarding accounts: no-op (never wipe demo/default).
    return { ok: true, opsPurgePath: 'unknown' }
  }
  if (!supabase) {
    return {
      ok: false,
      error: 'We can\'t reach the server right now. Please try again in a moment.',
      opsPurgePath: 'unknown',
    }
  }

  if (landlordHasPayments(scope.landlordId)) {
    const payoutsCleared = await clearLandlordPayoutsOnOnboardingReset(scope.landlordId)
    if (!payoutsCleared.ok) return { ...payoutsCleared, opsPurgePath: 'unknown' }
  }

  const { data: vendorRows, error: vendorLoadError } = await supabase
    .from('vendors')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (vendorLoadError) {
    return {
      ok: false,
      error: getErrorMessage(vendorLoadError, 'Something went wrong. Please try again.'),
      opsPurgePath: 'unknown',
    }
  }

  const vendorIds = (vendorRows ?? []).map((row) => String((row as { id: string }).id))

  const { data: unitRows, error: unitLoadError } = await supabase
    .from('units')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (unitLoadError) {
    return {
      ok: false,
      error: getErrorMessage(unitLoadError, 'Something went wrong. Please try again.'),
      opsPurgePath: 'unknown',
    }
  }

  const unitIds = (unitRows ?? []).map((row) => String((row as { id: string }).id))

  // Clear progress statuses before any vendor FK SET NULL can trip the check constraint.
  const detached = await detachVendorsFromMaintenanceRequests(scope.landlordId, vendorIds)
  if (!detached.ok) return { ...detached, opsPurgePath: 'unknown' }

  // Tickets + workflow runs (RPC when available; verifies leftovers).
  const purged = await purgeOnboardingImportedOperations(scope.landlordId)
  const opsPurgePath = purged.opsPurgePath
  if (!purged.ok) return purged

  // Occupancy references users with ON DELETE RESTRICT — clear it before residents.
  const occupancyCleared = unitIds.length
    ? await deleteInScopedRows('occupancy', 'unit_id', unitIds)
    : await deleteLandlordScopedRows('occupancy', scope.landlordId)
  if (!occupancyCleared.ok) return { ...occupancyCleared, opsPurgePath }

  const { data: residentRows, error: residentLoadError } = await supabase
    .from('users')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (residentLoadError) {
    return {
      ok: false,
      error: getErrorMessage(residentLoadError, 'Something went wrong. Please try again.'),
      opsPurgePath,
    }
  }

  const residentIds = (residentRows ?? []).map((row) => String((row as { id: string }).id))
  if (residentIds.length > 0) {
    const removedResidents = await deleteResidentsForLandlord({
      landlordId: scope.landlordId,
      residentIds,
    })
    if (!removedResidents.ok) {
      // Soft-archive leftovers when hard delete is blocked (FK / RESTRICT).
      const { error: archiveError } = await supabase
        .from('users')
        .update({ archived_at: new Date().toISOString() })
        .eq('landlord_id', scope.landlordId)
        .in('id', residentIds)
      if (archiveError && !/archived_at|column/i.test(archiveError.message)) {
        return { ok: false, error: removedResidents.error, opsPurgePath }
      }
      if (archiveError) {
        return { ok: false, error: removedResidents.error, opsPurgePath }
      }
    }
  }

  // Clear phone→identity map so the next run can reuse the same numbers.
  const identitiesCleared = await deleteLandlordScopedRows(
    'sms_identities',
    scope.landlordId,
  )
  if (!identitiesCleared.ok) return { ...identitiesCleared, opsPurgePath }

  // Drop unfinished verification invites tied to this landlord’s roster wipe.
  const verificationsCleared = await deleteLandlordScopedRows(
    'vendor_verifications',
    scope.landlordId,
  )
  if (!verificationsCleared.ok) return { ...verificationsCleared, opsPurgePath }

  // Insight / home-data / Thumbtack leftovers (RPC may already have cleared some).
  for (const table of FACTORY_RESET_SCOPED_TABLES) {
    if (table === 'ask_ulo_conversations') {
      // Messages reference conversations; delete children first when the table exists.
      const { data: askRows, error: askLoadError } = await supabase
        .from('ask_ulo_conversations')
        .select('id')
        .eq('landlord_id', scope.landlordId)
      if (askLoadError && !/does not exist|Could not find the table/i.test(askLoadError.message)) {
        return {
          ok: false,
          error: getErrorMessage(askLoadError, 'Something went wrong. Please try again.'),
          opsPurgePath,
        }
      }
      const askIds = (askRows ?? []).map((row) => String((row as { id: string }).id))
      if (askIds.length > 0) {
        const messagesCleared = await deleteInScopedRows('ask_ulo_messages', 'conversation_id', askIds)
        if (!messagesCleared.ok) return { ...messagesCleared, opsPurgePath }
      }
    }
    const cleared = await deleteLandlordScopedRows(table, scope.landlordId)
    if (!cleared.ok) return { ...cleared, opsPurgePath }
  }

  const afterOps = [
    await deleteLandlordScopedRows('preventive_maintenance_tasks', scope.landlordId),
    await deleteLandlordScopedRows('unit_assets', scope.landlordId),
    await deleteInScopedRows('vendors', 'id', vendorIds),
    await deleteLandlordScopedRows('vendors', scope.landlordId),
  ]
  const afterFailed = afterOps.find((result) => !result.ok)
  if (afterFailed) return { ...afterFailed, opsPurgePath }

  const removed = await deleteUnitsByIds(unitIds)
  if (!removed.ok) return { ...removed, opsPurgePath }

  const unitsScoped = await deleteLandlordScopedRows('units', scope.landlordId)
  if (!unitsScoped.ok) return { ...unitsScoped, opsPurgePath }

  // Client fallback must delete properties even when the staff RPC is missing.
  const propertiesCleared = await deleteLandlordScopedRows('properties', scope.landlordId)
  if (!propertiesCleared.ok) return { ...propertiesCleared, opsPurgePath }

  const profileReset = await resetLandlordProfileForFactoryReset(scope.landlordId)
  if (!profileReset.ok) return { ...profileReset, opsPurgePath }

  return { ok: true, opsPurgePath }
}

/**
 * Factory reset: wipe portfolio + onboarding progress and return to the welcome hub.
 * Triggered by **Reset onboarding**.
 */
export async function restartNewLandlordOnboarding(
  landlordId: string = getActiveLandlordId(),
): Promise<FactoryResetResult> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    return {
      ok: false,
      error: scope.error,
      opsPurgePath: 'unknown',
      activityFeed: emptyFactoryResetActivityFeed(),
    }
  }

  // Block beforeunload flushes from the still-mounted wizard while we navigate away.
  markOnboardingResetInProgress()

  // Clear wizard status first so the guard cannot bounce on stale "completed" localStorage
  // even if portfolio deletes partially fail.
  clearLocalOnboardingStorage(scope.landlordId)
  clearVendorSetupInboxForLandlord(scope.landlordId)
  clearLimitedAlphaPostOnboardingWelcomeSeen(scope.landlordId)
  clearSetupSuccessCardDismissed(scope.landlordId)
  clearSetupSuccessTestDelivery(scope.landlordId)
  clearSetupSuccessNavPercentBaseline(scope.landlordId)
  clearSetupSuccessCheckboxGuide(scope.landlordId)

  const cleared: LandlordOnboardingState = {
    ...defaultOnboardingState(scope.landlordId),
    onboardingStatus: 'not_started',
    currentStep: 'entry',
    setupPath: null,
    properties: [],
    formDraft: undefined,
  }
  await saveLandlordOnboarding(cleared, { clearAccountSettings: true })
  // Ensure a late beforeunload cannot resurrect the previous step.
  clearLocalOnboardingStorage(scope.landlordId)
  writeLocalOnboarding(cleared)

  const reset = await resetOnboardingPortfolio(scope.landlordId)
  if (!reset.ok) {
    // Keep welcome hub state even when portfolio wipe is partial.
    await saveLandlordOnboarding(cleared, { clearAccountSettings: true })
    clearLocalOnboardingStorage(scope.landlordId)
    writeLocalOnboarding(cleared)
    const activityFeed = await countFactoryResetActivityFeed(scope.landlordId)
    return {
      ok: false,
      error: reset.error ?? 'Could not clear previous portfolio data.',
      state: cleared,
      opsPurgePath: reset.opsPurgePath,
      activityFeed,
    }
  }

  // Re-assert welcome hub after portfolio deletes (some paths rewrite draft_state).
  await saveLandlordOnboarding(cleared, { clearAccountSettings: true })
  // Profile + account_settings wipe after the final upsert so leftovers cannot stick.
  const profileReset = await resetLandlordProfileForFactoryReset(scope.landlordId)
  if (!profileReset.ok) {
    clearLocalOnboardingStorage(scope.landlordId)
    writeLocalOnboarding(cleared)
    const activityFeed = await countFactoryResetActivityFeed(scope.landlordId)
    return {
      ok: false,
      error: profileReset.error ?? 'Could not reset the account profile.',
      state: cleared,
      opsPurgePath: reset.opsPurgePath,
      activityFeed,
    }
  }
  clearLocalOnboardingStorage(scope.landlordId)
  writeLocalOnboarding(cleared)

  // Final activity-feed wipe: catches mid-reset graph writes (e.g. Stripe unlink)
  // after the portfolio path already deleted feed tables. Do not recordActivityLog
  // after this — a factory_reset graph row would reappear in the bell.
  const feedCleared = await clearFactoryResetActivityFeed(scope.landlordId)
  if (!feedCleared.ok) {
    const activityFeed = await countFactoryResetActivityFeed(scope.landlordId)
    return {
      ok: false,
      error: feedCleared.error ?? 'Could not clear the activity feed.',
      state: cleared,
      opsPurgePath: reset.opsPurgePath,
      activityFeed,
    }
  }

  // Assert emptiness via SELECT count — delete ok:true alone is not proof.
  const feedAssert = await assertFactoryResetActivityFeedEmpty(scope.landlordId)
  if (!feedAssert.ok) {
    return {
      ok: false,
      error: feedAssert.error ?? 'Activity feed was not empty after reset.',
      state: cleared,
      opsPurgePath: reset.opsPurgePath,
      activityFeed: feedAssert.activityFeed,
    }
  }

  return {
    ok: true,
    state: cleared,
    opsPurgePath: reset.opsPurgePath,
    activityFeed: feedAssert.activityFeed,
  }
}

/** Alias — Reset onboarding is a full factory reset. */
export const factoryResetLandlordOnboarding = restartNewLandlordOnboarding

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
