/**
 * Start move_in, move_out, and inspection workflows from the admin dashboard.
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { getActiveLandlordId } from '@/lib/activeLandlord'

export type LifecycleWorkflowType = 'move_in' | 'move_out' | 'inspection'

export type InspectionType =
  | 'move_in'
  | 'move_out'
  | 'periodic'
  | 'annual'
  | 'common_area'

export type StartLifecycleWorkflowPayload = {
  workflow: LifecycleWorkflowType
  unitId: string
  landlordId?: string
  residentId?: string
  occupancyId?: string
  unitLabel?: string
  building?: string | null
  moveInDate?: string
  moveOutDate?: string
  scheduledAt?: string
  inspectionType?: InspectionType
  skipTenantRegistration?: boolean
}

export type StartLifecycleWorkflowResult =
  | { ok: true; workflow: LifecycleWorkflowType; workflow_run_id: string }
  | { ok: false; error: string }

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

function functionUrl(): string | undefined {
  const base = supabaseFunctionsBase()
  return base ? `${base}/functions/v1/start-lifecycle-workflow` : undefined
}

export async function startLifecycleWorkflow(
  payload: StartLifecycleWorkflowPayload,
): Promise<StartLifecycleWorkflowResult> {
  const url = functionUrl()
  const secret = adminSecret()
  if (!url || !secret) {
    return { ok: false, error: 'Admin workflow configuration is missing.' }
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({
      ...payload,
      landlordId: payload.landlordId?.trim() || defaultLandlordId(),
    }),
  })

  const text = await res.text()
  let parsed: { error?: string; workflow_run_id?: string; workflow?: string } = {}
  try {
    parsed = JSON.parse(text) as typeof parsed
  } catch {
    parsed = {}
  }

  if (!res.ok) {
    return {
      ok: false,
      error: parsed.error ?? (text.slice(0, 200) || `Request failed (${res.status})`),
    }
  }

  const workflowRunId = parsed.workflow_run_id
  const workflow = parsed.workflow as LifecycleWorkflowType | undefined
  if (!workflowRunId || !workflow) {
    return { ok: false, error: 'Invalid response from workflow starter.' }
  }

  return { ok: true, workflow, workflow_run_id: workflowRunId }
}

export type UnitOption = {
  id: string
  unit_label: string
  building: string | null
  status: string
}

export type ResidentOption = {
  id: string
  full_name: string
  unit: string | null
  building: string | null
}

export async function loadUnitsForWorkflowPicker(): Promise<UnitOption[]> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const { getActiveLandlordId } = await import('@/lib/activeLandlord')
  const landlordId = getActiveLandlordId()

  const { data, error } = await supabase
    .from('units')
    .select('id, unit_label, building, status')
    .eq('landlord_id', landlordId)
    .order('unit_label', { ascending: true })

  if (error) {
    console.warn('[lifecycleWorkflow] load units', error.message)
    return []
  }

  return (data ?? []) as UnitOption[]
}

export async function loadResidentsForUnit(unitId: string): Promise<ResidentOption[]> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return []

  const { data: occupancy, error: occError } = await supabase
    .from('occupancy')
    .select('resident_id')
    .eq('unit_id', unitId)
    .eq('status', 'active')

  if (occError) {
    console.warn('[lifecycleWorkflow] load occupancy', occError.message)
  }

  const residentIds = (occupancy ?? [])
    .map((row) => row.resident_id as string)
    .filter(Boolean)

  if (residentIds.length) {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, unit, building')
      .in('id', residentIds)

    if (!error && data?.length) {
      return data as ResidentOption[]
    }
  }

  const { data: unit } = await supabase
    .from('units')
    .select('unit_label, building')
    .eq('id', unitId)
    .maybeSingle()

  if (!unit?.unit_label) return []

  let query = supabase
    .from('users')
    .select('id, full_name, unit, building')
    .eq('unit', unit.unit_label)
    .eq('status', 'active')

  if (unit.building) {
    query = query.eq('building', unit.building)
  }

  const { data, error } = await query
  if (error) {
    console.warn('[lifecycleWorkflow] load residents', error.message)
    return []
  }

  return (data ?? []) as ResidentOption[]
}
