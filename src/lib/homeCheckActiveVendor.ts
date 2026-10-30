import type { HomeCheckVendor } from '@/api/homeCheck'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { supabase } from '@/lib/supabase'
import { isVendorMatchable, type VendorCapacityChipInput } from '@/lib/vendorStatusChip'

export function selectActiveHomeCheckVendors(
  vendors: readonly HomeCheckVendor[],
  activationById: ReadonlyMap<string, VendorCapacityChipInput>,
): HomeCheckVendor[] {
  return vendors.filter((vendor) => {
    const activation = activationById.get(vendor.id)
    return Boolean(activation && isVendorMatchable(activation))
  })
}

/** Keeps contractors whose status is Active. Everyone else must be set up before a home check. */
export async function loadActiveHomeCheckVendors(
  vendors: readonly HomeCheckVendor[],
): Promise<HomeCheckVendor[]> {
  if (!vendors.length) return []
  if (!supabase) throw new Error('Connect Supabase to use Home Check.')
  const landlordId = getActiveLandlordId()
  const ids = vendors.map((vendor) => vendor.id)
  const [vendorResult, verificationResult] = await Promise.all([
    supabase
      .from('vendors')
      .select('id, active, roster_status, onboarding_overridden_at')
      .eq('landlord_id', landlordId)
      .in('id', ids),
    supabase
      .from('vendor_verifications')
      .select('vendor_id, status, availability, updated_at')
      .eq('landlord_id', landlordId)
      .in('vendor_id', ids)
      .order('updated_at', { ascending: false }),
  ])
  if (vendorResult.error) throw new Error(vendorResult.error.message)
  if (verificationResult.error) throw new Error(verificationResult.error.message)

  const verificationByVendor = new Map<string, { status: string | null; availability: string | null }>()
  for (const row of verificationResult.data ?? []) {
    const vendorId = typeof row.vendor_id === 'string' ? row.vendor_id : ''
    if (!vendorId || verificationByVendor.has(vendorId)) continue
    verificationByVendor.set(vendorId, {
      status: typeof row.status === 'string' ? row.status : null,
      availability: typeof row.availability === 'string' ? row.availability : null,
    })
  }

  const activationById = new Map<string, VendorCapacityChipInput>()
  for (const row of vendorResult.data ?? []) {
    const id = typeof row.id === 'string' ? row.id : ''
    if (!id) continue
    const verification = verificationByVendor.get(id)
    activationById.set(id, {
      verificationStatus: verification?.status ?? null,
      vendorActive: row.active !== false,
      availability: verification?.availability ?? null,
      rosterStatus: typeof row.roster_status === 'string' ? row.roster_status : null,
      onboardingOverriddenAt: typeof row.onboarding_overridden_at === 'string'
        ? row.onboarding_overridden_at
        : null,
    })
  }
  return selectActiveHomeCheckVendors(vendors, activationById)
}
