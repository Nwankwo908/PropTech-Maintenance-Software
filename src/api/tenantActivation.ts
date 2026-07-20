/**
 * Post-onboarding tenant activation SMS trigger.
 * Uses the same ADMIN_REASSIGN_SECRET as other admin Edge calls.
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getActiveLandlordId } from '@/lib/activeLandlord'

function functionUrl(): string | undefined {
  const explicit = import.meta.env.VITE_SEND_TENANT_ACTIVATION_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base ? `${base}/functions/v1/send-tenant-activation` : undefined
}

function adminSecret(): string | undefined {
  return import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim() || undefined
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
  const secret = adminSecret()
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
    console.warn('[tenantActivation] send failed', err)
    return {
      ok: false,
      configured: true,
      error: err instanceof Error ? err.message : 'Activation request failed.',
    }
  }
}
