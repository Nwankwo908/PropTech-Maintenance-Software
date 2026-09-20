import { getActiveLandlordId } from '@/lib/activeLandlord'
import { readLocalOnboardingState } from '@/lib/onboarding'
import { loadPropertySetupModulesComplete } from '@/lib/propertyDetailsCompleteness'
import { listPropertiesForLandlord } from '@/lib/properties'
import {
  isSetupSuccessTestDeliveryComplete,
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
  const outreachStartedIds = new Set<string>()
  for (const row of vendorRows) {
    if (row.overridden && row.id) outreachStartedIds.add(row.id)
  }
  if (vendorIds.length > 0) {
    const { data: verificationRows } = await supabase
      .from('vendor_verifications')
      .select('vendor_id, status')
      .in('vendor_id', vendorIds)
    for (const row of (verificationRows ?? []) as Record<string, unknown>[]) {
      const id = asString(row.vendor_id)
      // Any verification row means invite/outreach started (mirrors tenant welcome sent).
      if (id) outreachStartedIds.add(id)
    }
  }

  const properties = propertiesResult.ok ? propertiesResult.properties : []
  const propertySetup = await loadPropertySetupModulesComplete(properties)
  const rules = readLocalOnboardingState()?.approvalRules

  return resolveSetupSuccessProgress({
    residents,
    vendorCount: vendorRows.length,
    vendorOutreachStartedCount: outreachStartedIds.size,
    propertyAccessComplete: propertySetup.access,
    propertyIntelligenceComplete: propertySetup.intelligence,
    propertyInsuranceComplete: propertySetup.insurance,
    hasMaintenancePreferences:
      Array.isArray(rules?.emergencyTypes) && rules.emergencyTypes.length > 0,
    maintenanceRequestCount: ticketsResult.count ?? 0,
    hasTestDelivery: isSetupSuccessTestDeliveryComplete(landlordId),
  })
}
