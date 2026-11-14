/**
 * POST start-insight-inspection-scheduling (account session).
 */
import {
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { adminSessionInvokeHeaders, ADMIN_SESSION_REQUIRED } from '@/lib/adminSessionHeaders'
import type { InsightRecommendationActionType } from '@shared/portfolioIntelligence'

export type StartInsightInspectionSchedulingOk = {
  ok: true
  status: 'probing' | 'needs_external'
  requestId: string
  ticketId: string
  targetDay: string
  holdId?: string | null
  vendorId?: string | null
  inspectorName: null
  message: string
}

export function resolveStartInsightInspectionSchedulingUrl(): string | null {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) return null
  return `${base}/functions/v1/start-insight-inspection-scheduling`
}

export async function postStartInsightInspectionScheduling(input: {
  url: string
  secret?: string
  landlordId: string
  insightCardId: string
  actionType: InsightRecommendationActionType
  unitId?: string | null
  unitLabel?: string | null
  building?: string | null
  categoryLabel?: string | null
  issueSummary?: string | null
  targetDay?: string | null
  propertyState?: string | null
  timeZone?: string | null
}): Promise<StartInsightInspectionSchedulingOk> {
  const res = await fetchAdminEdgeFunction(input.url, {
    method: 'POST',
    headers: await adminSessionInvokeHeaders(true),
    body: JSON.stringify({
      landlordId: input.landlordId,
      insightCardId: input.insightCardId,
      actionType: input.actionType,
      unitId: input.unitId ?? null,
      unitLabel: input.unitLabel ?? null,
      building: input.building ?? null,
      categoryLabel: input.categoryLabel ?? null,
      issueSummary: input.issueSummary ?? null,
      targetDay: input.targetDay ?? null,
      propertyState: input.propertyState ?? null,
      timeZone: input.timeZone ?? null,
    }),
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    json = {}
  }
  if (res.status === 401) throw new Error(ADMIN_SESSION_REQUIRED)
  if (!res.ok) {
    throw new Error(
      typeof json.error === 'string' ? json.error : text.slice(0, 200) || `Failed (${res.status})`,
    )
  }
  if (json.ok !== true || (json.status !== 'probing' && json.status !== 'needs_external')) {
    throw new Error(typeof json.error === 'string' ? json.error : 'Unexpected scheduling response')
  }
  return {
    ok: true,
    status: json.status,
    requestId: String(json.requestId ?? ''),
    ticketId: String(json.ticketId ?? ''),
    targetDay: String(json.targetDay ?? ''),
    holdId: typeof json.holdId === 'string' ? json.holdId : null,
    vendorId: typeof json.vendorId === 'string' ? json.vendorId : null,
    inspectorName: null,
    message: typeof json.message === 'string' ? json.message : '',
  }
}
