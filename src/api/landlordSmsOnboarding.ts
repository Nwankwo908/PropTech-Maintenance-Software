/**
 * Landlord SMS onboarding + unit registration Edge Functions.
 * Uses the same ADMIN_REASSIGN_SECRET as other admin Edge calls.
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'

function supabaseFunctionsBase(): string | undefined {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base || undefined
}

function adminSecret(): string | undefined {
  return import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim() || undefined
}

function defaultLandlordId(): string | undefined {
  return import.meta.env.VITE_DEFAULT_LANDLORD_ID?.trim() || undefined
}

function functionUrl(name: 'landlord-sms-onboarding' | 'register-unit'): string | undefined {
  const base = supabaseFunctionsBase()
  return base ? `${base}/functions/v1/${name}` : undefined
}

async function postAdminFunction<T>(
  url: string | undefined,
  body: Record<string, unknown>,
): Promise<T | null> {
  const secret = adminSecret()
  if (!url || !secret) return null

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    console.warn('[landlordSms]', url, res.status, text.slice(0, 300))
    return null
  }

  return (await res.json()) as T
}

/** Ensure landlord has an active landlord_main SMS number (pool claim or env provision). */
export async function ensureLandlordSmsOnboarding(
  landlordId?: string,
): Promise<{ ok: boolean; mainPhoneNumber?: string } | null> {
  const resolvedLandlordId = landlordId?.trim() || defaultLandlordId()
  if (!resolvedLandlordId) return null

  const result = await postAdminFunction<{
    ok: boolean
    smsNumber?: { phone_number?: string }
  }>(functionUrl('landlord-sms-onboarding'), { landlordId: resolvedLandlordId })

  if (!result?.ok) return result
  return {
    ok: true,
    mainPhoneNumber: result.smsNumber?.phone_number,
  }
}

export async function registerUnitSms(params: {
  landlordId?: string
  unitLabel: string
  building?: string | null
  unitId?: string | null
  residentId?: string
  tenantPhone?: string | null
}): Promise<boolean> {
  const resolvedLandlordId = params.landlordId?.trim() || defaultLandlordId()
  if (!resolvedLandlordId) return false

  const result = await postAdminFunction<{ ok: boolean }>(
    functionUrl('register-unit'),
    {
      landlordId: resolvedLandlordId,
      unitLabel: params.unitLabel,
      building: params.building ?? null,
      unitId: params.unitId ?? null,
      residentId: params.residentId,
      tenantPhone: params.tenantPhone ?? null,
    },
  )

  return result?.ok === true
}

export async function registerPropertyUnitsSms(params: {
  landlordId?: string
  units: Array<{ unitLabel: string; building?: string | null }>
}): Promise<boolean> {
  const resolvedLandlordId = params.landlordId?.trim() || defaultLandlordId()
  if (!resolvedLandlordId || params.units.length === 0) return false

  const result = await postAdminFunction<{ ok: boolean }>(
    functionUrl('register-unit'),
    {
      landlordId: resolvedLandlordId,
      units: params.units,
    },
  )

  return result?.ok === true
}
