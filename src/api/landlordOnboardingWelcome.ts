import { getErrorMessage } from '@/lib/errorMessage'
import {
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { adminSessionInvokeHeaders, ADMIN_SESSION_REQUIRED } from '@/lib/adminSessionHeaders'
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
  email?: string | null
}): Promise<LandlordOnboardingWelcomeSummary> {
  const url = functionUrl()
  if (!url) {
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
      headers: await adminSessionInvokeHeaders(true),
      body: JSON.stringify({
        landlordId,
        companyName: params.companyName ?? null,
        contactName: params.contactName ?? null,
        email: params.email ?? null,
      }),
    })

    if (res.status === 401) return { ok: false, configured: true, error: ADMIN_SESSION_REQUIRED }
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
