import {
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { adminSessionInvokeHeaders, ADMIN_SESSION_REQUIRED } from '@/lib/adminSessionHeaders'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import type { LateRentMessageAction } from '@/lib/lateRentAccountMessaging'

export type SendLateRentAccountMessageResult =
  | {
      ok: true
      conversationId: string | null
      messageId: string | null
      balanceDueAfterWaiver?: number | null
      lateFeeWaived?: number | null
    }
  | { ok: false; error: string }

function functionUrl(): string | undefined {
  const explicit = import.meta.env.VITE_SEND_LATE_RENT_ACCOUNT_MESSAGE_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base ? `${base}/functions/v1/send-late-rent-account-message` : undefined
}


export async function postSendLateRentAccountMessage(params: {
  workflowRunId: string
  residentId: string
  residentPhone: string
  message: string
  action: LateRentMessageAction
  installments?: number
  lateFeeCents?: number
  landlordId?: string
}): Promise<SendLateRentAccountMessageResult> {
  const url = functionUrl()
  if (!url) {
    return { ok: false, error: 'Admin SMS configuration is missing.' }
  }

  let headers: Record<string, string>
  try { headers = await adminSessionInvokeHeaders(false) } catch { return { ok: false, error: ADMIN_SESSION_REQUIRED } }
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workflowRunId: params.workflowRunId,
      residentId: params.residentId,
      residentPhone: params.residentPhone,
      message: params.message,
      action: params.action,
      installments: params.installments,
      lateFeeCents: params.lateFeeCents,
      landlordId: params.landlordId?.trim() || getActiveLandlordId(),
    }),
  })

  const text = await res.text()
  let parsed: {
    ok?: boolean
    error?: string
    conversation_id?: string | null
    message_id?: string | null
    balance_due_after_waiver?: number | null
    late_fee_waived?: number | null
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

  return {
    ok: true,
    conversationId: parsed.conversation_id ?? null,
    messageId: parsed.message_id ?? null,
    balanceDueAfterWaiver: parsed.balance_due_after_waiver ?? null,
    lateFeeWaived: parsed.late_fee_waived ?? null,
  }
}
