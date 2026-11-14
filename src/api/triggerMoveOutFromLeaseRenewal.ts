import {
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { adminSessionInvokeHeaders, ADMIN_SESSION_REQUIRED } from '@/lib/adminSessionHeaders'
import { getActiveLandlordId } from '@/lib/activeLandlord'

export type TriggerMoveOutFromLeaseRenewalResult =
  | {
      ok: true
      leaseRenewalRunId: string
      moveOutRunId: string
      conversationId: string | null
    }
  | { ok: false; error: string }

function functionUrl(): string | undefined {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base ? `${base}/functions/v1/trigger-move-out-from-lease-renewal` : undefined
}


export async function postTriggerMoveOutFromLeaseRenewal(
  leaseRenewalRunId: string,
  landlordId?: string,
): Promise<TriggerMoveOutFromLeaseRenewalResult> {
  const url = functionUrl()
  if (!url) {
    return { ok: false, error: 'Admin workflow configuration is missing.' }
  }

  let headers: Record<string, string>
  try { headers = await adminSessionInvokeHeaders(false) } catch { return { ok: false, error: ADMIN_SESSION_REQUIRED } }
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      leaseRenewalRunId,
      landlordId: landlordId?.trim() || getActiveLandlordId(),
    }),
  })

  const text = await res.text()
  let parsed: {
    ok?: boolean
    error?: string
    lease_renewal_run_id?: string
    move_out_run_id?: string
    conversation_id?: string | null
  } = {}
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    parsed = {}
  }

  if (res.status === 401) return { ok: false, error: ADMIN_SESSION_REQUIRED }
  if (!res.ok || parsed.ok === false) {
    return {
      ok: false,
      error: parsed.error ?? (text.slice(0, 200) || `Request failed (${res.status})`),
    }
  }

  const moveOutRunId = parsed.move_out_run_id
  if (!moveOutRunId) {
    return { ok: false, error: 'Invalid response from move-out trigger.' }
  }

  return {
    ok: true,
    leaseRenewalRunId: parsed.lease_renewal_run_id ?? leaseRenewalRunId,
    moveOutRunId,
    conversationId: parsed.conversation_id ?? null,
  }
}
