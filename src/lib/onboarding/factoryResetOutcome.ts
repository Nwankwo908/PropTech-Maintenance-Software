/**
 * Factory-reset outcome shape + human-visible alert / log helpers.
 *
 * The only product surface for reset outcomes is AdminLayout's window.alert.
 * Structured fields must be composed into that string (and console) — a correct
 * return object that never reaches the alert does not count as fixed.
 */
import type { LandlordOnboardingState } from './types'

export type OpsPurgePath =
  | 'purge_landlord_portfolio'
  | 'purge_empty_landlord_operations'
  | 'client_fallback'
  | 'unknown'

/** Post-wipe (or post-attempt) counts for Ulo Activity Feed sources. null = count query failed. */
export type FactoryResetActivityFeed = {
  remainingOperationsGraph: number | null
  remainingPropertyOperationsGraph: number | null
  /** Set when either count query failed — assert must fail closed. */
  countError?: string
}

/** Post-wipe Open Repairs / ticket table verification (Fast Track import leftovers). */
export type FactoryResetOpsCounts = {
  remainingTickets: number | null
  remainingActiveWorkflowRuns: number | null
  countError?: string
  /**
   * Import-lineage tickets that still trip HARD_DELETE_FORBIDDEN after archive prep.
   * Diagnosable without another manual DB trace.
   */
  hardDeleteBlocked?: { count: number; ticketIds: string[] }
  /** Import-lineage tickets where terminateWorkOrder/archive failed before purge. */
  archiveFailed?: { count: number; ticketIds: string[] }
}

export type FactoryResetResult = {
  ok: boolean
  error?: string
  state?: LandlordOnboardingState
  opsPurgePath: OpsPurgePath
  activityFeed: FactoryResetActivityFeed
  opsCounts?: FactoryResetOpsCounts
}

export function emptyFactoryResetActivityFeed(
  countError?: string,
): FactoryResetActivityFeed {
  return {
    remainingOperationsGraph: null,
    remainingPropertyOperationsGraph: null,
    ...(countError ? { countError } : {}),
  }
}

/** True only when both bell sources counted as exactly 0 with no count error. */
export function isFactoryResetActivityFeedEmpty(feed: FactoryResetActivityFeed): boolean {
  return (
    !feed.countError &&
    feed.remainingOperationsGraph === 0 &&
    feed.remainingPropertyOperationsGraph === 0
  )
}

/** True only when ticket + active workflow run counts are exactly 0. */
export function isFactoryResetOpsEmpty(ops: FactoryResetOpsCounts): boolean {
  return (
    !ops.countError &&
    ops.remainingTickets === 0 &&
    ops.remainingActiveWorkflowRuns === 0
  )
}

/**
 * Single-shot alert body for a failed factory reset.
 * Must include error, feed table names + counts (or count-verify failure), and opsPurgePath.
 */
export function formatFactoryResetFailureAlert(
  result: Pick<FactoryResetResult, 'error' | 'opsPurgePath' | 'activityFeed' | 'opsCounts'>,
): string {
  const lines: string[] = [
    result.error?.trim() || 'Could not fully clear portfolio data.',
  ]

  const feed = result.activityFeed
  if (feed.countError) {
    lines.push(
      `Activity feed count could not be verified (${feed.countError}).`,
    )
  }
  lines.push(
    `operations_graph_events: ${formatRemaining(feed.remainingOperationsGraph)} remaining`,
  )
  lines.push(
    `property_operations_graph: ${formatRemaining(feed.remainingPropertyOperationsGraph)} remaining`,
  )
  const ops = result.opsCounts
  if (ops) {
    if (ops.countError) {
      lines.push(`Ticket count could not be verified (${ops.countError}).`)
    }
    lines.push(`maintenance_requests: ${formatRemaining(ops.remainingTickets)} remaining`)
    lines.push(
      `active workflow_runs: ${formatRemaining(ops.remainingActiveWorkflowRuns)} remaining`,
    )
    if (ops.archiveFailed && ops.archiveFailed.count > 0) {
      lines.push(
        `archiveFailed: ${ops.archiveFailed.count} — ${ops.archiveFailed.ticketIds.join(', ')}`,
      )
    }
    if (ops.hardDeleteBlocked && ops.hardDeleteBlocked.count > 0) {
      lines.push(
        `hardDeleteBlocked: ${ops.hardDeleteBlocked.count} — ${ops.hardDeleteBlocked.ticketIds.join(', ')}`,
      )
    }
  }
  lines.push(`Ops purge path: ${result.opsPurgePath}.`)
  lines.push('')
  lines.push('Returning to the setup choice screen.')
  return lines.join('\n')
}

function formatRemaining(value: number | null): string {
  return value == null ? 'unknown' : String(value)
}

/** Debugging trail for a successful reset (no alert today). */
export function factoryResetSuccessLogPayload(
  result: Pick<FactoryResetResult, 'ok' | 'opsPurgePath' | 'activityFeed' | 'opsCounts'>,
): {
  ok: boolean
  opsPurgePath: OpsPurgePath
  activityFeed: FactoryResetActivityFeed
  opsCounts?: FactoryResetOpsCounts
} {
  return {
    ok: result.ok,
    opsPurgePath: result.opsPurgePath,
    activityFeed: result.activityFeed,
    ...(result.opsCounts ? { opsCounts: result.opsCounts } : {}),
  }
}

type FailureReportDeps = {
  error: (...args: unknown[]) => void
  alert: (message: string) => void
}

/**
 * Persist the full structured result in the console, then show one forensic alert.
 * Order matters: dismiss loses the dialog text; console keeps the object.
 */
export function reportFactoryResetFailureToUser(
  result: FactoryResetResult,
  deps: FailureReportDeps = { error: console.error, alert: window.alert.bind(window) },
): string {
  deps.error('[AdminLayout] factory reset failed', result)
  const message = formatFactoryResetFailureAlert(result)
  deps.alert(message)
  return message
}

type SuccessReportDeps = {
  log: (...args: unknown[]) => void
}

/** Success has no alert — leave a structured console trail before navigation. */
export function reportFactoryResetSuccessToConsole(
  result: FactoryResetResult,
  deps: SuccessReportDeps = { log: console.log },
): void {
  deps.log('[AdminLayout] factory reset ok', factoryResetSuccessLogPayload(result))
}
