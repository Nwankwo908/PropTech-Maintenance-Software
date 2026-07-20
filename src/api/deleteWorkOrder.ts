/**
 * POST admin-delete-work-order Edge Function (ADMIN_REASSIGN_SECRET).
 * Permanently removes a maintenance work order + linked workflow runs.
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getActiveLandlordId } from '@/lib/activeLandlord'

function deleteWorkOrderUrl(): string | null {
  const explicit = import.meta.env.VITE_ADMIN_DELETE_WORK_ORDER_URL?.trim()
  if (explicit) return explicit

  const reassign = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (reassign) {
    return reassign.replace(/admin-reassign-vendor\/?$/, 'admin-delete-work-order')
  }

  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) return null
  return `${base}/functions/v1/admin-delete-work-order`
}

export type DeleteWorkOrderResult = {
  ok: true
  workflowRunId: string
  maintenanceRequestId: string | null
  deletedRunIds: string[]
}

export async function deleteWorkOrderPermanently(params: {
  workflowRunId: string
  maintenanceRequestId?: string | null
}): Promise<DeleteWorkOrderResult> {
  const url = deleteWorkOrderUrl()
  const secret = import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim()
  if (!url || !secret) {
    throw new Error(
      'Work order delete is not configured (admin Edge URL/secret).',
    )
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      landlordId: getActiveLandlordId(),
      workflowRunId: params.workflowRunId,
      maintenanceRequestId: params.maintenanceRequestId ?? undefined,
    }),
  })

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string
    ok?: boolean
    workflowRunId?: string
    maintenanceRequestId?: string | null
    deletedRunIds?: string[]
  }

  if (!res.ok) {
    throw new Error(payload.error ?? `Delete failed (${res.status})`)
  }

  return {
    ok: true,
    workflowRunId: payload.workflowRunId ?? params.workflowRunId,
    maintenanceRequestId: payload.maintenanceRequestId ?? null,
    deletedRunIds: Array.isArray(payload.deletedRunIds)
      ? payload.deletedRunIds
      : [],
  }
}
