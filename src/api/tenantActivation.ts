import { getErrorMessage } from '@/lib/errorMessage'
/**
 * Post-onboarding tenant activation SMS trigger.
 * Uses the same ADMIN_REASSIGN_SECRET as other admin Edge calls.
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { normalizePhoneForDb } from '@/lib/phoneFormat'
import { supabase } from '@/lib/supabase'
import { recordActivityLog } from '@/lib/recordActivityLog'

function functionUrl(): string | undefined {
  const explicit = import.meta.env.VITE_SEND_TENANT_ACTIVATION_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base ? `${base}/functions/v1/send-tenant-activation` : undefined
}


export type TenantActivationSummary = {
  ok: boolean
  /** False only when the client is missing the function URL/secret/landlord. */
  configured: boolean
  attempted?: number
  sent?: number
  skipped?: number
  failed?: number
  /** Populated on transport/HTTP failure so callers can surface it. */
  error?: string
}

/**
 * Fire the activation/welcome SMS for newly onboarded residents.
 * Best-effort: never throws into the caller, but always returns a structured
 * result so failures can be surfaced instead of silently swallowed.
 */
export async function sendTenantActivationSms(params: {
  landlordId?: string
  residentIds?: string[]
  companyName?: string | null
  resend?: boolean
}): Promise<TenantActivationSummary> {
  const url = functionUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    return { ok: false, configured: false, error: 'Tenant activation SMS is not configured.' }
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
        residentIds: params.residentIds,
        companyName: params.companyName ?? null,
        resend: params.resend === true,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.warn('[tenantActivation]', url, res.status, text.slice(0, 300))
      return {
        ok: false,
        configured: true,
        error: `Activation request failed (${res.status}).`,
      }
    }

    const summary = (await res.json()) as Partial<TenantActivationSummary>
    return { configured: true, ...summary, ok: summary.ok !== false }
  } catch (err) {
    const message = getErrorMessage(err, 'Something went wrong. Please try again.')
    console.warn('[tenantActivation]', message)
    return { ok: false, configured: true, error: message }
  }
}

async function loadLandlordCompanyName(landlordId: string): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase
    .from('landlords')
    .select('name')
    .eq('id', landlordId)
    .maybeSingle()
  const name = typeof data?.name === 'string' ? data.name.trim() : ''
  return name || null
}

/**
 * After a resident is added post-onboarding: send the same welcome / YES
 * activation SMS used at setup complete. Best-effort — never throws.
 *
 * Also use when a phone is added later to a resident who was created without one
 * (`phoneNewlyAdded`). Edge send is idempotent via `activation_sms_sent_at`.
 */
export async function activateTenantAfterAdd(params: {
  landlordId?: string
  residentId: string
  phone?: string | null
  companyName?: string | null
}): Promise<TenantActivationSummary> {
  const phone = params.phone?.trim() ?? ''
  if (!phone) {
    return { ok: true, configured: true, attempted: 0, sent: 0, skipped: 1 }
  }

  const residentId = params.residentId.trim()
  if (!residentId) {
    return { ok: false, configured: true, error: 'Missing resident id.' }
  }

  const landlordId = params.landlordId?.trim() || getActiveLandlordId()
  let companyName = params.companyName?.trim() || null
  if (!companyName && landlordId) {
    try {
      companyName = await loadLandlordCompanyName(landlordId)
    } catch {
      companyName = null
    }
  }

  return sendTenantActivationSms({
    landlordId,
    residentIds: [residentId],
    companyName,
  })
}

/** True when phone goes from empty → non-empty (first usable contact). */
export function phoneNewlyAdded(
  previousPhone: string | null | undefined,
  nextPhone: string | null | undefined,
): boolean {
  return !(previousPhone?.trim()) && Boolean(nextPhone?.trim())
}

function normalizedPhone(value: string | null | undefined): string {
  return normalizePhoneForDb(value) ?? ''
}

/** True when the stored phone number changed to a different value. */
export function phoneChanged(
  previousPhone: string | null | undefined,
  nextPhone: string | null | undefined,
): boolean {
  const prev = normalizedPhone(previousPhone)
  const next = normalizedPhone(nextPhone)
  if (!next) return false
  return prev !== next
}

/** Offer restart when replacing a number that already received (or was meant to receive) welcome SMS. */
export function shouldOfferRestartTenantOnboarding(
  previousPhone: string | null | undefined,
  nextPhone: string | null | undefined,
): boolean {
  if (!normalizedPhone(previousPhone)) return false
  return phoneChanged(previousPhone, nextPhone)
}

const ACTIVATION_RESET_PATCH = {
  activation_status: 'not_started',
  sms_consent_status: 'pending',
  last_delivery_error: null,
  activation_attempt_count: 0,
  first_activation_attempt_at: null,
  last_activation_attempt_at: null,
  activation_sms_sent_at: null,
  activation_phone_normalized: null,
} as const

/**
 * Phone change invalidates prior welcome/consent (that applied to the old number).
 * Does not send SMS — the landlord must opt in via Start onboarding again.
 */
export async function resetTenantActivationForPhoneChange(params: {
  landlordId?: string
  residentId: string
}): Promise<void> {
  if (!supabase) return
  const landlordId = params.landlordId?.trim() || getActiveLandlordId()
  const residentId = params.residentId.trim()
  if (!landlordId || !residentId) return

  await supabase
    .from('users')
    .update({ ...ACTIVATION_RESET_PATCH })
    .eq('id', residentId)
    .eq('landlord_id', landlordId)

  await recordActivityLog({
    landlordId,
    eventType: 'tenant.activation_reset_phone_changed',
    source: 'dashboard',
    actorType: 'landlord',
    residentId,
    metadata: {
      message: 'Tenant phone updated. Welcome text for the previous number was cleared.',
      reason: 'phone_changed',
    },
  })
}

/**
 * After the landlord updates a resident phone following a delivery failure:
 * clear failure state and mark the in-app alert resolved. Does not auto-resend
 * unless the caller also invokes activate/resend.
 */
export async function clearActivationFailureOnPhoneUpdate(params: {
  landlordId?: string
  residentId: string
}): Promise<void> {
  await resetTenantActivationForPhoneChange(params)
}

/**
 * Landlord chose to start tenant onboarding again after correcting the phone.
 * Resets prior activation/consent, then sends the welcome text to the new number.
 */
export async function restartTenantOnboardingAfterPhoneChange(params: {
  landlordId?: string
  residentId: string
  companyName?: string | null
}): Promise<TenantActivationSummary> {
  await resetTenantActivationForPhoneChange({
    landlordId: params.landlordId,
    residentId: params.residentId,
  })
  const summary = await resendTenantActivationSms(params)
  const landlordId = params.landlordId?.trim() || getActiveLandlordId()
  if (landlordId && summary.ok && (summary.sent ?? 0) > 0) {
    await recordActivityLog({
      landlordId,
      eventType: 'tenant.onboarding_restarted',
      source: 'dashboard',
      actorType: 'landlord',
      residentId: params.residentId,
      metadata: {
        message: 'Welcome text sent to the updated tenant number.',
      },
    })
  }
  return summary
}

/** Plain-language warning for toast / banner when activation SMS fails. */
export function tenantActivationWarningMessage(
  summary: TenantActivationSummary,
): string | null {
  if (!summary.configured) return null
  if (summary.error) {
    return `Resident saved, but the welcome text could not be sent (${summary.error}).`
  }
  if ((summary.failed ?? 0) > 0) {
    return 'Resident saved, but the welcome text could not be delivered.'
  }
  return null
}

/**
 * Landlord-initiated first welcome send. Best-effort — never throws.
 */
export async function sendTenantWelcomeSms(params: {
  landlordId?: string
  residentId: string
  companyName?: string | null
}): Promise<TenantActivationSummary> {
  const residentId = params.residentId.trim()
  if (!residentId) {
    return { ok: false, configured: true, error: 'Missing resident id.' }
  }

  const landlordId = params.landlordId?.trim() || getActiveLandlordId()
  let companyName = params.companyName?.trim() || null
  if (!companyName && landlordId) {
    try {
      companyName = await loadLandlordCompanyName(landlordId)
    } catch {
      companyName = null
    }
  }

  return sendTenantActivationSms({
    landlordId,
    residentIds: [residentId],
    companyName,
  })
}

/**
 * Landlord-initiated resend. Restarts the automatic retry sequence after a
 * successful send (attempt 1 again). Best-effort — never throws.
 */
export async function resendTenantActivationSms(params: {
  landlordId?: string
  residentId: string
  companyName?: string | null
}): Promise<TenantActivationSummary> {
  const residentId = params.residentId.trim()
  if (!residentId) {
    return { ok: false, configured: true, error: 'Missing resident id.' }
  }

  const landlordId = params.landlordId?.trim() || getActiveLandlordId()
  let companyName = params.companyName?.trim() || null
  if (!companyName && landlordId) {
    try {
      companyName = await loadLandlordCompanyName(landlordId)
    } catch {
      companyName = null
    }
  }

  return sendTenantActivationSms({
    landlordId,
    residentIds: [residentId],
    companyName,
    resend: true,
  })
}
