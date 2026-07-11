import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
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

function adminSecret(): string | undefined {
  return import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim() || undefined
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
