import { fetchAdminEdgeFunction } from '@/lib/adminEdgeAuth'
import { adminSessionInvokeHeaders } from '@/lib/adminSessionHeaders'
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
  if (!url) {
    return { ok: false, error: 'Admin workflow configuration is missing.' }
  }

  let headers: Record<string, string>
  try {
    // Phase 1 defaults to sending both session and legacy header so this
    // frontend can ship before the two session-only Edge guards.
    headers = await adminSessionInvokeHeaders(import.meta.env.VITE_INSPECTION_ACTIVATION_LEGACY_COMPAT !== 'false')
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Please sign in again to continue.' }
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers,
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
