/**
 * Soft-archive a maintenance work order (replaces permanent hard-delete).
 * Uses terminate-work-order Edge Function — vendor is notified; row is preserved.
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'

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

export type DeleteWorkOrderResult = {
  ok: true
  workflowRunId: string
  maintenanceRequestId: string | null
  deletedRunIds: string[]
  archived?: boolean
  vendorNotify?: string
}

/** Soft-archive one or more tickets (bulk Request Management delete). */
export async function archiveWorkOrders(ticketIds: string[]): Promise<{
  ok: true
  archivedIds: string[]
  errors: Array<{ ticketId: string; error: string }>
}> {
  const url = terminateWorkOrderUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    throw new Error(
      'Work order archive is not configured (admin Edge URL/secret).',
    )
  }

  const landlordId = getActiveLandlordId()
  const archivedIds: string[] = []
  const errors: Array<{ ticketId: string; error: string }> = []

  for (const raw of ticketIds) {
    const ticketId = raw.trim()
    if (!ticketId) continue
    try {
      const res = await fetchAdminEdgeFunction(url, {
        method: 'POST',
        headers: adminEdgeInvokeHeaders(secret),
        body: JSON.stringify({
          landlordId,
          ticketId,
          mode: 'archive',
          source: 'dashboard',
          reason: 'Archived from Request Management',
        }),
      })
      const payload = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        errors.push({
          ticketId,
          error: payload.error ?? `Archive failed (${res.status})`,
        })
        continue
      }
      archivedIds.push(ticketId)
    } catch (e) {
      errors.push({
        ticketId,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return { ok: true, archivedIds, errors }
}

/** @deprecated Name kept for UI callers — now soft-archives via terminateWorkOrder. */
export async function deleteWorkOrderPermanently(params: {
  workflowRunId: string
  maintenanceRequestId?: string | null
}): Promise<DeleteWorkOrderResult> {
  const url = terminateWorkOrderUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    throw new Error(
      'Work order archive is not configured (admin Edge URL/secret).',
    )
  }

  const ticketId = params.maintenanceRequestId?.trim() || null
  if (!ticketId) {
    throw new Error('A work order id is required to archive.')
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      landlordId: getActiveLandlordId(),
      workflowRunId: params.workflowRunId,
      ticketId,
      mode: 'archive',
      source: 'admin_api',
      reason: 'Archived from the workflow pipeline',
    }),
  })

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string
    ok?: boolean
    workflowRunId?: string
    maintenanceRequestId?: string | null
    vendorNotify?: string
  }

  if (!res.ok) {
    throw new Error(payload.error ?? `Archive failed (${res.status})`)
  }

  return {
    ok: true,
    workflowRunId: payload.workflowRunId ?? params.workflowRunId,
    maintenanceRequestId: payload.maintenanceRequestId ?? ticketId,
    deletedRunIds: [],
    archived: true,
    vendorNotify: payload.vendorNotify,
  }
}
