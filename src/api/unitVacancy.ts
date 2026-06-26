/**
 * Unit vacancy + activation Edge Functions (admin secret).
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getActiveLandlordId } from '@/lib/activeLandlord'

export type UnitRecord = {
  id: string
  landlord_id: string
  unit_label: string
  building: string | null
  status: 'vacant' | 'active' | 'inactive'
  skip_tenant_registration: boolean
}

function supabaseFunctionsBase(): string | undefined {
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  return base || undefined
}

function adminSecret(): string | undefined {
  return import.meta.env.VITE_ADMIN_REASSIGN_SECRET?.trim() || undefined
}

function defaultLandlordId(): string | undefined {
  return getActiveLandlordId()
}

function functionUrl(name: 'mark-unit-vacant' | 'activate-unit'): string | undefined {
  const base = supabaseFunctionsBase()
  return base ? `${base}/functions/v1/${name}` : undefined
}

async function postAdminFunction<T>(
  url: string | undefined,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const secret = adminSecret()
  if (!url || !secret) {
    return { ok: false, error: 'Admin SMS configuration is missing.' }
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let parsed: { error?: string; promptMessage?: string } & Record<string, unknown> = {}
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    parsed = {}
  }

  if (!res.ok) {
    return { ok: false, error: parsed.error ?? (text.slice(0, 200) || `Request failed (${res.status})`) }
  }

  return { ok: true, data: parsed as T }
}

export async function markUnitVacant(params: {
  unitId?: string
  unitLabel?: string
  building?: string | null
  landlordId?: string
}): Promise<
  | {
      ok: true
      unitId: string
      promptMessage: string
    }
  | { ok: false; error: string }
> {
  const result = await postAdminFunction<{
    ok: boolean
    unitId: string
    promptMessage: string
  }>(functionUrl('mark-unit-vacant'), {
    landlordId: params.landlordId?.trim() || defaultLandlordId(),
    unitId: params.unitId,
    unitLabel: params.unitLabel,
    building: params.building ?? null,
  })

  if (!result.ok) return result
  return {
    ok: true,
    unitId: result.data.unitId,
    promptMessage: result.data.promptMessage,
  }
}

export type ActivateUnitPayload = {
  unitId: string
  landlordId?: string
  skipTenantRegistration?: boolean
  tenantName?: string
  tenantPhone?: string
  tenantEmail?: string
  moveInDate?: string
  residentId?: string
}

export async function activateUnit(
  payload: ActivateUnitPayload,
): Promise<{ ok: true; unitId: string; residentId: string | null } | { ok: false; error: string }> {
  const result = await postAdminFunction<{
    ok: boolean
    unitId: string
    residentId: string | null
  }>(functionUrl('activate-unit'), {
    landlordId: payload.landlordId?.trim() || defaultLandlordId(),
    unitId: payload.unitId,
    skipTenantRegistration: payload.skipTenantRegistration === true,
    tenantName: payload.tenantName,
    tenantPhone: payload.tenantPhone,
    tenantEmail: payload.tenantEmail,
    moveInDate: payload.moveInDate,
    residentId: payload.residentId,
  })

  if (!result.ok) return result
  return {
    ok: true,
    unitId: result.data.unitId,
    residentId: result.data.residentId,
  }
}

export async function loadUnitsFromDb(landlordId?: string): Promise<UnitRecord[]> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const scopedLandlordId = landlordId?.trim() || defaultLandlordId()
  let query = supabase
    .from('units')
    .select('id, landlord_id, unit_label, building, status, skip_tenant_registration')
    .order('unit_label', { ascending: true })

  if (scopedLandlordId) {
    query = query.eq('landlord_id', scopedLandlordId)
  }

  const { data, error } = await query

  if (error) {
    console.warn('[unitVacancy] load units', error.message)
    return []
  }

  return (data ?? []) as UnitRecord[]
}

export async function ensureUnitsInDb(
  units: Array<{ unitLabel: string; building: string | null }>,
): Promise<boolean> {
  const landlordId = defaultLandlordId()
  const secret = adminSecret()
  if (!landlordId || !secret || units.length === 0) return false

  const { registerPropertyUnitsSms } = await import('@/api/landlordSmsOnboarding')
  return registerPropertyUnitsSms({
    landlordId,
    units: units.map((u) => ({ unitLabel: u.unitLabel, building: u.building })),
  })
}
