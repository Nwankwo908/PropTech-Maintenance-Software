import { getActiveLandlordId } from '@/lib/activeLandlord'
import { readLocalOnboardingState } from '@/lib/onboarding'
import { areAllPropertiesDetailsComplete } from '@/lib/propertyDetailsCompleteness'
import { listPropertiesForLandlord } from '@/lib/properties'
import {
  resolveSetupSuccessProgress,
  type SetupSuccessProgress,
} from '@/lib/setupSuccessChecklist'
import { supabase } from '@/lib/supabase'

function asString(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

/** Lightweight snapshot for the overlay card and the Settings nav hint. */
export async function loadSetupSuccessProgress(
  landlordId: string = getActiveLandlordId(),
): Promise<SetupSuccessProgress | null> {
  if (!supabase) return null

  const [residentsResult, vendorsResult, ticketsResult, propertiesResult] = await Promise.all([
    supabase
      .from('users')
      .select('phone, activation_status')
      .eq('landlord_id', landlordId)
      .neq('status', 'past_resident')
      .limit(2000),
    supabase
      .from('vendors')
      .select('id, onboarding_overridden_at')
      .eq('landlord_id', landlordId)
      .eq('active', true)
      .limit(500),
    supabase
      .from('maintenance_requests')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId),
    listPropertiesForLandlord(landlordId),
  ])

  const residents = ((residentsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
    phone: asString(row.phone) || null,
    activationStatus: asString(row.activation_status) || null,
  }))

  const vendorRows = ((vendorsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: asString(row.id),
    overridden: Boolean(row.onboarding_overridden_at),
  }))
  const vendorIds = vendorRows.map((row) => row.id).filter(Boolean)
  const verifiedIds = new Set<string>()
  if (vendorIds.length > 0) {
    const { data: verificationRows } = await supabase
      .from('vendor_verifications')
      .select('vendor_id, status')
      .in('vendor_id', vendorIds)
    for (const row of (verificationRows ?? []) as Record<string, unknown>[]) {
      if (asString(row.status) === 'verified') {
        const id = asString(row.vendor_id)
        if (id) verifiedIds.add(id)
      }
    }
  }

  const properties = propertiesResult.ok ? propertiesResult.properties : []
  const propertyDetailsComplete = await areAllPropertiesDetailsComplete(properties)
  const rules = readLocalOnboardingState()?.approvalRules

  return resolveSetupSuccessProgress({
    residents,
    vendorCount: vendorRows.length,
    verifiedVendorCount: vendorRows.filter((row) => row.overridden || verifiedIds.has(row.id))
      .length,
    propertyDetailsComplete,
    hasMaintenancePreferences: Number.isFinite(rules?.autoApprovalThreshold),
    maintenanceRequestCount: ticketsResult.count ?? 0,
  })
}
