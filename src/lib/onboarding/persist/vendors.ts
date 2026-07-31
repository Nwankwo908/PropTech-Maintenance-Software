/**
 * Fetch onboarding vendors for review / complete.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { dedupeVendorsByName } from '@/lib/vendorDedup'
import { supabase } from '@/lib/supabase'

export type OnboardingVendor = {
  id: string
  name: string
  category: string
  email: string
  phone: string
  preferredEmergency: boolean
}

export async function fetchOnboardingVendors(
  landlordId: string = getActiveLandlordId(),
): Promise<OnboardingVendor[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('vendors')
    .select('id, name, category, email, phone, preferred_emergency')
    .eq('landlord_id', landlordId)
    .eq('active', true)
    .order('created_at', { ascending: true })

  if (error) {
    console.warn('[landlordOnboarding] fetch vendors', error.message)
    return []
  }

  const rows = (data ?? []).map((row) => ({
    id: String((row as { id: string }).id),
    name: String((row as { name: string }).name ?? ''),
    category: String((row as { category?: string | null }).category ?? ''),
    email: String((row as { email?: string | null }).email ?? ''),
    phone: String((row as { phone?: string | null }).phone ?? ''),
    preferredEmergency: Boolean(
      (row as { preferred_emergency?: boolean | null }).preferred_emergency,
    ),
    createdAt: String((row as { created_at?: string | null }).created_at ?? '') || null,
  }))

  return dedupeVendorsByName(rows).map(
    ({ id, name, category, email, phone, preferredEmergency }) => ({
      id,
      name,
      category,
      email,
      phone,
      preferredEmergency,
    }),
  )
}
