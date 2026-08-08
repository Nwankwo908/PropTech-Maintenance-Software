import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import type { MoveOutAdminAction } from '@/lib/moveOutWorkflow'

const ENGINE_ACTIONS = new Set<MoveOutAdminAction>([
  'send_reminder',
  'schedule_inspection',
  'mark_keys_returned',
  'complete_cleaning',
  'complete_move_out',
  'cancel_move_out',
])

function functionUrl(): string | undefined {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base ? `${base}/functions/v1/run-move-out-action` : undefined
}

export async function postMoveOutWorkflowAction(
  params: {
    workflowRunId: string
    action: MoveOutAdminAction
    landlordId?: string
    scheduledAt?: string | null
  },
): Promise<{ ok: true; inspectionRunId?: string | null } | { ok: false; error: string }> {
  if (!ENGINE_ACTIONS.has(params.action)) {
    return { ok: false, error: 'This action is not available yet.' }
  }

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
      scheduledAt: params.scheduledAt ?? null,
    }),
  })

  const text = await res.text()
  let parsed: {
    ok?: boolean
    error?: string
    inspection_run_id?: string | null
  } = {}
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

  return { ok: true, inspectionRunId: parsed.inspection_run_id ?? null }
}
