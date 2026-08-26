/**
 * POST admin-conversation-sms — take over / release / send on a Communication SMS thread.
 * Auth: VITE_ADMIN_REASSIGN_SECRET (same as other admin Edge calls).
 */
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'

function adminConversationSmsUrl(): string | null {
  const explicit = import.meta.env.VITE_ADMIN_CONVERSATION_SMS_URL?.trim()
  if (explicit) return explicit

  const reassign = import.meta.env.VITE_ADMIN_REASSIGN_URL?.trim()
  if (reassign) {
    return reassign.replace(/admin-reassign-vendor\/?$/, 'admin-conversation-sms')
  }

  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (!base) return null
  return `${base}/functions/v1/admin-conversation-sms`
}

export type AdminConversationSmsResult = {
  ok: true
  conversationId: string
  messageId?: string
  adminTakeoverActive: boolean
}

async function invokeAdminConversationSms(input: {
  action: 'takeover' | 'release' | 'send'
  conversationId: string
  body?: string
}): Promise<AdminConversationSmsResult> {
  const url = adminConversationSmsUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    throw new Error(
      'Communication messaging is not configured (admin Edge URL/secret).',
    )
  }

  const conversationId = input.conversationId.trim()
  if (!conversationId) {
    throw new Error('Missing conversation id.')
  }

  const landlordId = getActiveLandlordId()
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      action: input.action,
      conversation_id: conversationId,
      landlord_id: landlordId,
      body: input.body ?? '',
    }),
  })

  const payload = (await res.json().catch(() => ({}))) as {
    error?: string
    ok?: boolean
    conversation_id?: string
    message_id?: string
    admin_takeover_active?: boolean
  }

  if (!res.ok || !payload.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error
        : `Could not update conversation (${res.status}).`,
    )
  }

  return {
    ok: true,
    conversationId: String(payload.conversation_id ?? conversationId),
    messageId: payload.message_id ? String(payload.message_id) : undefined,
    adminTakeoverActive: payload.admin_takeover_active === true,
  }
}

export function takeOverConversation(conversationId: string) {
  return invokeAdminConversationSms({ action: 'takeover', conversationId })
}

export function releaseConversationTakeover(conversationId: string) {
  return invokeAdminConversationSms({ action: 'release', conversationId })
}

export function sendConversationSms(conversationId: string, body: string) {
  const trimmed = body.trim()
  if (!trimmed) throw new Error('Message cannot be empty.')
  return invokeAdminConversationSms({
    action: 'send',
    conversationId,
    body: trimmed,
  })
}
