/**
 * POST send-proxied-message — landlord/admin SMS to the assigned vendor (or resident)
 * on a work-order thread. Uses ADMIN_REASSIGN_SECRET (same as other admin Edge calls).
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'

export type ProxiedRecipientType = 'vendor' | 'resident'

function sendProxiedMessageUrl(): string | null {
  const explicit = import.meta.env.VITE_SEND_PROXIED_MESSAGE_URL?.trim()
  if (explicit) return explicit

  const reassign = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (reassign) {
    return reassign.replace(/admin-reassign-vendor\/?$/, 'send-proxied-message')
  }

  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) return null
  return `${base}/functions/v1/send-proxied-message`
}

export type SendProxiedMessageResult = {
  ok: true
  conversationId: string
  messageId: string
}

export async function sendLandlordProxiedMessage(input: {
  maintenanceRequestId: string
  body: string
  recipientType?: ProxiedRecipientType
}): Promise<SendProxiedMessageResult> {
  const url = sendProxiedMessageUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    throw new Error(
      'Messaging is not configured (admin Edge URL/secret).',
    )
  }

  const maintenanceRequestId = input.maintenanceRequestId.trim()
  const body = input.body.trim()
  if (!maintenanceRequestId) {
    throw new Error('Missing work order id.')
  }
  if (!body) {
    throw new Error('Message cannot be empty.')
  }

  const landlordId = getActiveLandlordId()
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      maintenance_request_id: maintenanceRequestId,
      sender_type: 'landlord',
      sender_id: landlordId,
      body,
      recipient_type: input.recipientType ?? 'vendor',
    }),
  })

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string
    ok?: boolean
    conversation_id?: string
    message_id?: string
  }

  if (!res.ok || !payload.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error
        : `Could not send message (${res.status}).`,
    )
  }

  return {
    ok: true,
    conversationId: String(payload.conversation_id ?? ''),
    messageId: String(payload.message_id ?? ''),
  }
}
