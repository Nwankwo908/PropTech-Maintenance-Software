import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'

export type InspectionAdminAction =
  | 'send_reminder'
  | 'mark_no_show'
  | 'record_outcome'
  | 'complete_inspection'
  | 'cancel_inspection'

function functionUrl(): string | undefined {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base ? `${base}/functions/v1/run-inspection-action` : undefined
}

export async function postInspectionWorkflowAction(
  params: {
    workflowRunId: string
    action: InspectionAdminAction
    landlordId?: string
    outcome?: string | null
    notes?: string | null
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = functionUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    return { ok: false, error: 'Admin workflow configuration is missing.' }
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      workflowRunId: params.workflowRunId,
      action: params.action,
      landlordId: params.landlordId?.trim() || getActiveLandlordId(),
      outcome: params.outcome ?? null,
      notes: params.notes ?? null,
    }),
  })

  const text = await res.text()
  let parsed: { ok?: boolean; error?: string } = {}
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    parsed = {}
  }

  if (!res.ok || parsed.ok === false) {
    return {
      ok: false,
      error: parsed.error ?? (text.slice(0, 200) || `Request failed (${res.status})`),
    }
  }

  return { ok: true }
}
