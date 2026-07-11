import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
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

function adminSecret(): string | undefined {
  return import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim() || undefined
}

export async function postTriggerMoveOutFromLeaseRenewal(
  leaseRenewalRunId: string,
  landlordId?: string,
): Promise<TriggerMoveOutFromLeaseRenewalResult> {
  const url = functionUrl()
  const secret = adminSecret()
  if (!url || !secret) {
    return { ok: false, error: 'Admin workflow configuration is missing.' }
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
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
