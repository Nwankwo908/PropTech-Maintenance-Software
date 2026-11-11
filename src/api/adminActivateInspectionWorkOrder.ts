/**
 * POST admin-activate-inspection-work-order (ADMIN_REASSIGN_SECRET).
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
  requireAdminEdgeSecret,
} from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'

export function resolveAdminActivateInspectionWorkOrderUrl(): string | null {
  const reassign = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (reassign) {
    return reassign.replace(
      /admin-reassign-vendor\/?$/,
      'admin-activate-inspection-work-order',
    )
  }
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/admin-activate-inspection-work-order`
  return null
}

export type AdminActivateInspectionWorkOrderOk = {
  ok: true
  ticketId: string
  requestRef: string
  alreadyActivated: boolean
  vendorAssigned: boolean
}

export async function postAdminActivateInspectionWorkOrder(input: {
  inspectionReportId: string
}): Promise<AdminActivateInspectionWorkOrderOk> {
  const url = resolveAdminActivateInspectionWorkOrderUrl()
  const secret = requireAdminEdgeSecret('Activate work order')
  if (!url) {
    throw new Error('Activate work order is not configured (admin Edge URL).')
  }

  const landlordId = getActiveLandlordId()
  if (!landlordId) {
    throw new Error('No active landlord selected.')
  }

  const reportId = input.inspectionReportId.trim()
  if (!reportId) {
    throw new Error('Missing inspection notice id.')
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: await adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      landlordId,
      inspectionReportId: reportId,
    }),
  })

  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    json = {}
  }

  if (!res.ok) {
    throw new Error(
      typeof json.error === 'string'
        ? json.error
        : text.slice(0, 200) || `Failed (${res.status})`,
    )
  }

  if (json.ok !== true || typeof json.ticketId !== 'string' || !json.ticketId.trim()) {
    throw new Error(
      typeof json.error === 'string' ? json.error : 'Unexpected activate response',
    )
  }

  return {
    ok: true,
    ticketId: json.ticketId.trim(),
    requestRef:
      typeof json.requestRef === 'string' && json.requestRef.trim()
        ? json.requestRef.trim()
        : '',
    alreadyActivated: json.alreadyActivated === true,
    vendorAssigned: json.vendorAssigned === true,
  }
}
