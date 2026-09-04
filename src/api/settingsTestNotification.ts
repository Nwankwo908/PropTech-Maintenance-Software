import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getErrorMessage } from '@/lib/errorMessage'

export type SettingsTestNotificationResult = {
  ok: boolean
  channel: 'email' | 'sms'
  message?: string
  error?: string
}

function functionUrl(): string | undefined {
  const explicit = import.meta.env.VITE_SEND_SETTINGS_TEST_NOTIFICATION_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base ? `${base}/functions/v1/send-settings-test-notification` : undefined
}

export async function sendSettingsTestNotification(params: {
  channel: 'email' | 'sms'
  landlordId?: string
  /** Address shown in Settings — used for test email instead of the login mailbox. */
  toEmail?: string
}): Promise<SettingsTestNotificationResult> {
  const url = functionUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    return {
      ok: false,
      channel: params.channel,
      error: 'Test notifications are not configured for this environment.',
    }
  }

  const landlordId = params.landlordId?.trim() || getActiveLandlordId()
  try {
    const res = await fetchAdminEdgeFunction(url, {
      method: 'POST',
      headers: adminEdgeInvokeHeaders(secret),
      body: JSON.stringify({
        landlordId,
        channel: params.channel,
        toEmail: params.toEmail?.trim() || undefined,
      }),
    })
    const payload = (await res.json()) as { ok?: boolean; message?: string; error?: string }
    if (!res.ok || payload.ok === false) {
      return {
        ok: false,
        channel: params.channel,
        error: payload.error ?? `Request failed (${res.status})`,
      }
    }
    return {
      ok: true,
      channel: params.channel,
      message: payload.message ?? 'Test notification sent.',
    }
  } catch (err) {
    return {
      ok: false,
      channel: params.channel,
      error: getErrorMessage(err, 'Could not send test notification.'),
    }
  }
}
