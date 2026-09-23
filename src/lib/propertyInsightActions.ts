/**
 * Property Insights card CTAs — dispatch to operational flows.
 */

import {
  postStartInsightInspectionScheduling,
  resolveStartInsightInspectionSchedulingUrl,
} from '@/api/startInsightInspectionScheduling'
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  entersInspectorSchedulingFlow,
  flagForReviewHref,
  isFlagForReviewAction,
  type InsightRecommendationActionType,
  type InsightSchedulingCardState,
  type SynthesizedInsightCard,
} from '@shared/portfolioIntelligence'

export type InsightDiagnosticPayload = {
  unitId: string
  unitLabel?: string | null
  building?: string | null
  categoryLabel?: string | null
  description: string
  ticketIds: string[]
}

export type InsightSchedulingStartResult = {
  status: 'probing' | 'needs_external'
  requestId: string
  ticketId: string
  targetDay: string
  holdId?: string | null
  vendorId?: string | null
  message: string
}

export type PropertyInsightActionDeps = {
  /** Inspector soft-offer scheduling (all schedule_* + request_diagnostic). */
  startInspectorScheduling: (input: {
    landlordId: string
    insightCardId: string
    actionType: InsightRecommendationActionType
    unitId?: string | null
    unitLabel?: string | null
    building?: string | null
    categoryLabel?: string | null
    issueSummary?: string | null
  }) => Promise<{ ok: true; result: InsightSchedulingStartResult } | { ok: false; error: string }>
  nudgeVendorSchedule: (input: {
    landlordId: string
    ticketIds: string[]
  }) => Promise<{ ok: boolean; error?: string }>
  resolveWorkOrderPath: (ticketId: string) => string
  /** Resolve assigned vendor for flag_for_review navigation. */
  resolveAssignedVendorId?: (ticketIds: string[]) => Promise<string | null>
}

export type PropertyInsightActionResult =
  | {
      ok: true
      kind: InsightRecommendationActionType
      detail?: string
      scheduling?: InsightSchedulingStartResult
      navigateTo?: string
    }
  | { ok: false; kind: InsightRecommendationActionType; error: string }

function defaultNudgeVendorSchedule(input: {
  landlordId: string
  ticketIds: string[]
}): Promise<{ ok: boolean; error?: string }> {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  const secret = getAdminEdgeSecret()
  if (!base || !secret) {
    return Promise.resolve({ ok: false, error: 'Admin configuration is missing.' })
  }
  const url = `${base}/functions/v1/check-schedule-fsm-ttl`
  return fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: {
      ...adminEdgeInvokeHeaders(secret),
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      landlord_id: input.landlordId,
      ticket_ids: input.ticketIds,
      force: true,
    }),
  }).then(async (res) => {
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: text.slice(0, 200) || `Nudge failed (${res.status})` }
    }
    return { ok: true }
  })
}

async function defaultStartInspectorScheduling(input: {
  landlordId: string
  insightCardId: string
  actionType: InsightRecommendationActionType
  unitId?: string | null
  unitLabel?: string | null
  building?: string | null
  categoryLabel?: string | null
  issueSummary?: string | null
}): Promise<{ ok: true; result: InsightSchedulingStartResult } | { ok: false; error: string }> {
  const url = resolveStartInsightInspectionSchedulingUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    return { ok: false, error: 'Admin configuration is missing.' }
  }
  try {
    const result = await postStartInsightInspectionScheduling({
      url,
      secret,
      ...input,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    return {
      ok: true,
      result: {
        status: result.status,
        requestId: result.requestId,
        ticketId: result.ticketId,
        targetDay: result.targetDay,
        holdId: result.holdId,
        vendorId: result.vendorId,
        message: result.message,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not start scheduling.',
    }
  }
}

export const defaultPropertyInsightActionDeps: PropertyInsightActionDeps = {
  startInspectorScheduling: defaultStartInspectorScheduling,
  nudgeVendorSchedule: defaultNudgeVendorSchedule,
  resolveWorkOrderPath: (ticketId) =>
    `/admin/workflows?ticket=${encodeURIComponent(ticketId)}`,
}

/**
 * Run the CTA for a synthesized insight card.
 * Returns which flow was targeted so tests can assert wiring without UI.
 */
export async function runPropertyInsightAction(
  card: Pick<
    SynthesizedInsightCard,
    | 'id'
    | 'actionType'
    | 'unitId'
    | 'unitLabel'
    | 'categoryLabel'
    | 'building'
    | 'ticketIds'
    | 'text'
  >,
  deps: PropertyInsightActionDeps = defaultPropertyInsightActionDeps,
): Promise<PropertyInsightActionResult> {
  const kind = card.actionType

  if (kind === 'none') {
    return { ok: false, kind, error: 'No action for this insight.' }
  }

  if (isFlagForReviewAction(kind)) {
    const assignedVendorId = deps.resolveAssignedVendorId
      ? await deps.resolveAssignedVendorId(card.ticketIds)
      : null
    return {
      ok: true,
      kind,
      navigateTo: flagForReviewHref({ assignedVendorId }),
    }
  }

  if (kind === 'nudge_vendor') {
    if (card.ticketIds.length === 0) {
      return { ok: false, kind, error: 'No work orders to nudge.' }
    }
    const nudge = await deps.nudgeVendorSchedule({
      landlordId: getActiveLandlordId(),
      ticketIds: card.ticketIds,
    })
    if (!nudge.ok) return { ok: false, kind, error: nudge.error ?? 'Nudge failed.' }
    return { ok: true, kind }
  }

  if (entersInspectorSchedulingFlow(kind)) {
    const started = await deps.startInspectorScheduling({
      landlordId: getActiveLandlordId(),
      insightCardId: card.id,
      actionType: kind,
      unitId: card.unitId,
      unitLabel: card.unitLabel,
      building: card.building,
      categoryLabel: card.categoryLabel,
      issueSummary: card.text,
    })
    if (!started.ok) return { ok: false, kind, error: started.error }
    return {
      ok: true,
      kind,
      detail: started.result.ticketId,
      scheduling: started.result,
    }
  }

  return { ok: false, kind, error: 'Unknown action.' }
}

export function workOrderLinksForInsight(
  card: Pick<SynthesizedInsightCard, 'ticketIds'>,
  deps: Pick<PropertyInsightActionDeps, 'resolveWorkOrderPath'> = defaultPropertyInsightActionDeps,
): Array<{ ticketId: string; href: string }> {
  return card.ticketIds.map((ticketId) => ({
    ticketId,
    href: deps.resolveWorkOrderPath(ticketId),
  }))
}

export function schedulingStateFromActionResult(
  scheduling: InsightSchedulingStartResult,
): InsightSchedulingCardState {
  if (scheduling.status === 'needs_external') {
    return {
      status: 'needs_external',
      ticketId: scheduling.ticketId,
      targetDay: scheduling.targetDay,
      inspectorName: null,
      confirmedWindow: null,
      holdId: null,
      requestId: scheduling.requestId,
    }
  }
  return {
    status: 'probing',
    ticketId: scheduling.ticketId,
    targetDay: scheduling.targetDay,
    inspectorName: null,
    confirmedWindow: null,
    holdId: scheduling.holdId ?? null,
    requestId: scheduling.requestId,
  }
}
