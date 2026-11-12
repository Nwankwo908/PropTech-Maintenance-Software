/**
 * Property-detail emergency Review: stop a job when there is no pending estimate.
 * Soft-terminates via terminate-work-order Edge Function (vendor notify + audit).
 */
import { fetchAdminEdgeFunction } from '@/lib/adminEdgeAuth'
import { adminSessionInvokeHeaders, ADMIN_SESSION_REQUIRED } from '@/lib/adminSessionHeaders'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { recordActivityLog } from '@/lib/recordActivityLog'

function terminateWorkOrderUrl(): string | null {
  const explicit = import.meta.env.VITE_TERMINATE_WORK_ORDER_URL?.trim()
  if (explicit) return explicit

  const reassign = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (reassign) {
    return reassign.replace(/admin-reassign-vendor\/?$/, 'terminate-work-order')
  }

  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) return null
  return `${base}/functions/v1/terminate-work-order`
}

export async function cancelEmergencyWorkOrder(input: {
  ticketId: string
  workflowRunId?: string | null
  propertyId?: string | null
  vendorId?: string | null
}): Promise<void> {
  const ticketId = input.ticketId.trim()
  if (!ticketId) throw new Error('Missing work order id.')

  const url = terminateWorkOrderUrl()
  if (!url) {
    throw new Error(
      'Work order cancel is not configured (admin Edge URL).',
    )
  }

  const landlordId = getActiveLandlordId()
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: await adminSessionInvokeHeaders(),
    body: JSON.stringify({
      landlordId,
      ticketId,
      workflowRunId: input.workflowRunId ?? undefined,
      mode: 'cancel',
      source: 'emergency_decline',
      reason: 'Emergency work declined by the property team',
    }),
  })

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string
    ok?: boolean
  }

  if (!res.ok) {
    throw new Error(res.status === 401 ? ADMIN_SESSION_REQUIRED : payload.error ?? `Cancel failed (${res.status})`)
  }

  void recordActivityLog({
    landlordId,
    eventType: 'maintenance.emergency_declined',
    source: 'dashboard',
    actorType: 'landlord',
    maintenanceRequestId: ticketId,
    propertyId: input.propertyId ?? null,
    vendorId: input.vendorId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    metadata: {
      message: 'Property team declined emergency work and closed the work order.',
    },
  })
}

export async function acknowledgeEmergencyWorkProceed(input: {
  ticketId: string
  workflowRunId?: string | null
  propertyId?: string | null
  vendorId?: string | null
}): Promise<void> {
  const landlordId = getActiveLandlordId()
  await recordActivityLog({
    landlordId,
    eventType: 'maintenance.emergency_approved',
    source: 'dashboard',
    actorType: 'landlord',
    maintenanceRequestId: input.ticketId,
    propertyId: input.propertyId ?? null,
    vendorId: input.vendorId ?? null,
    workflowRunId: input.workflowRunId ?? null,
    metadata: {
      message: 'Property team approved continuing emergency work.',
    },
  })
}
