import { getErrorMessage } from '@/lib/errorMessage'
import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'

function functionUrl(): string | undefined {
  const explicit = import.meta.env.VITE_SEND_LANDLORD_ONBOARDING_WELCOME_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base ? `${base}/functions/v1/send-landlord-onboarding-welcome` : undefined
}

export type LandlordOnboardingWelcomeSummary = {
  ok: boolean
  configured: boolean
  skipped?: boolean
  reason?: string
  smsSent?: string[]
  emailSent?: string[]
  errors?: string[]
  error?: string
}

/**
 * Send the landlord welcome SMS + email after onboarding completes.
 * Best-effort: never throws into the caller.
 */
export async function sendLandlordOnboardingWelcome(params: {
  landlordId?: string
  companyName?: string | null
  contactName?: string | null
}): Promise<LandlordOnboardingWelcomeSummary> {
  const url = functionUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    return {
      ok: false,
      configured: false,
      error: 'Landlord welcome message is not configured.',
    }
  }

  const landlordId = params.landlordId?.trim() || getActiveLandlordId()
  if (!landlordId) {
    return { ok: false, configured: false, error: 'No active landlord.' }
  }

  try {
    const res = await fetchAdminEdgeFunction(url, {
      method: 'POST',
      headers: adminEdgeInvokeHeaders(secret),
      body: JSON.stringify({
        landlordId,
        companyName: params.companyName ?? null,
        contactName: params.contactName ?? null,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.warn('[landlordOnboardingWelcome]', url, res.status, text.slice(0, 300))
      return {
        ok: false,
        configured: true,
        error: `Welcome message request failed (${res.status}).`,
      }
    }

    const summary = (await res.json()) as Partial<LandlordOnboardingWelcomeSummary>
    return { configured: true, ...summary, ok: summary.ok !== false }
  } catch (err) {
    const message = getErrorMessage(err, 'Something went wrong. Please try again.')
    console.warn('[landlordOnboardingWelcome]', message)
    return { ok: false, configured: true, error: message }
  }
}
