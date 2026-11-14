/**
 * Landlord SMS onboarding + unit registration Edge Functions.
 * Every caller requires a user session; onboarding temporarily retains a rollout header.
 */

import {
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { adminSessionInvokeHeaders, ADMIN_SESSION_REQUIRED } from '@/lib/adminSessionHeaders'
import { getActiveLandlordId } from '@/lib/activeLandlord'

function supabaseFunctionsBase(): string | undefined {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base || undefined
}


function defaultLandlordId(): string | undefined {
  return getActiveLandlordId()
}

function functionUrl(
  name: 'landlord-sms-onboarding' | 'register-unit' | 'sync-sms-identity',
): string | undefined {
  const base = supabaseFunctionsBase()
  return base ? `${base}/functions/v1/${name}` : undefined
}

async function postAdminFunction<T>(
  url: string | undefined,
  body: Record<string, unknown>,
): Promise<T | null> {
  if (!url) return null

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: await adminSessionInvokeHeaders(false),
    body: JSON.stringify(body),
  })

  if (res.status === 401) throw new Error(ADMIN_SESSION_REQUIRED)
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

export async function syncSmsIdentity(params: {
  landlordId?: string
  phone: string
  identityType: 'resident' | 'vendor'
  residentId?: string
  vendorId?: string
  unitId?: string | null
  unitLabel?: string | null
  building?: string | null
}): Promise<boolean> {
  const phone = params.phone.trim()
  if (!phone) return false

  const resolvedLandlordId = params.landlordId?.trim() || defaultLandlordId()
  if (!resolvedLandlordId) return false

  const url = functionUrl('sync-sms-identity')
  if (!url) return false
  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: await adminSessionInvokeHeaders(false),
    body: JSON.stringify({
      landlordId: resolvedLandlordId,
      phone,
      identityType: params.identityType,
      residentId: params.residentId ?? null,
      vendorId: params.vendorId ?? null,
      unitId: params.unitId ?? null,
      unitLabel: params.unitLabel ?? null,
      building: params.building ?? null,
    }),
  })
  if (res.status === 401) throw new Error(ADMIN_SESSION_REQUIRED)
  if (!res.ok) return false
  const result = (await res.json()) as { ok?: boolean }
  return result.ok === true
}
