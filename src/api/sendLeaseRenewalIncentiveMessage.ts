import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getActiveLandlordId } from '@/lib/activeLandlord'

export type SendLeaseRenewalIncentiveMessageResult =
  | {
      ok: true
      conversationId: string | null
      messageId: string | null
    }
  | { ok: false; error: string }

function functionUrl(): string | undefined {
  const explicit = import.meta.env.VITE_SEND_LEASE_RENEWAL_INCENTIVE_MESSAGE_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base ? `${base}/functions/v1/send-lease-renewal-incentive-message` : undefined
}

function adminSecret(): string | undefined {
  return import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim() || undefined
}

export async function postSendLeaseRenewalIncentiveMessage(params: {
  workflowRunId: string
  residentId: string
  residentPhone: string
  message: string
  incentiveAmountLabel?: string
  landlordId?: string
}): Promise<SendLeaseRenewalIncentiveMessageResult> {
  const url = functionUrl()
  const secret = adminSecret()
  if (!url || !secret) {
    return { ok: false, error: 'Admin SMS configuration is missing.' }
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      workflowRunId: params.workflowRunId,
      residentId: params.residentId,
      residentPhone: params.residentPhone,
      message: params.message,
      incentiveAmountLabel: params.incentiveAmountLabel,
      landlordId: params.landlordId?.trim() || getActiveLandlordId(),
    }),
  })

  const text = await res.text()
  let parsed: {
    ok?: boolean
    error?: string
    conversation_id?: string | null
    message_id?: string | null
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

  return {
    ok: true,
    conversationId: parsed.conversation_id ?? null,
    messageId: parsed.message_id ?? null,
  }
}
