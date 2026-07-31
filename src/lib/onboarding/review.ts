/**
 * Onboarding review data assembly.
 */
import { ensureLandlordSmsOnboarding } from '@/api/landlordSmsOnboarding'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { formatPhoneNational } from '@/lib/phoneFormat'
import { normalizeOnboardingApprovalRules, type OnboardingApprovalRules } from '@/lib/onboardingApprovalRules'
import { supabase } from '@/lib/supabase'
import { fetchAccountSetupCounts } from './persist/account'
import { fetchOnboardingResidents, type OnboardingResident } from './persist/residents'
import { fetchOnboardingVendors, type OnboardingVendor } from './persist/vendors'
import { readLandlordOnboardingDraft } from './draftStorage'
import type {
  AccountSetupCounts,
  LandlordOnboardingState,
  OnboardingAccountSetup,
  OnboardingProperty,
} from './types'

export type OnboardingReviewData = {
  accountSetup: OnboardingAccountSetup
  properties: OnboardingProperty[]
  vendors: OnboardingVendor[]
  residents: OnboardingResident[]
  approvalRules: OnboardingApprovalRules
  metrics: AccountSetupCounts
  /** Landlord main SMS line residents text for maintenance intake. */
  smsIntakeNumber: string | null
  smsIntakeNumberDisplay: string | null
}

export function buildOnboardingReviewMetrics(
  state: LandlordOnboardingState,
  vendors: OnboardingVendor[],
  residents: OnboardingResident[],
  dbCounts?: AccountSetupCounts,
): AccountSetupCounts {
  const draftUnits = state.properties.reduce((sum, property) => sum + property.unitCount, 0)
  return {
    properties:
      state.properties.length > 0 ? state.properties.length : (dbCounts?.properties ?? 0),
    units: draftUnits > 0 ? draftUnits : (dbCounts?.units ?? 0),
    vendors: vendors.length,
    residents: residents.length,
    workflowRuns: dbCounts?.workflowRuns ?? 0,
  }
}

export function buildOnboardingReviewData(
  state: LandlordOnboardingState,
  vendors: OnboardingVendor[] = [],
  residents: OnboardingResident[] = [],
  dbCounts?: AccountSetupCounts,
  smsIntakeNumber: string | null = null,
): OnboardingReviewData {
  const normalized = smsIntakeNumber?.trim() || null
  return {
    accountSetup: state.accountSetup,
    properties: state.properties,
    vendors,
    residents,
    approvalRules: normalizeOnboardingApprovalRules(state.approvalRules),
    metrics: buildOnboardingReviewMetrics(state, vendors, residents, dbCounts),
    smsIntakeNumber: normalized,
    smsIntakeNumberDisplay: normalized ? formatPhoneNational(normalized) : null,
  }
}

/** Active landlord_main SMS line used for resident maintenance intake. */
export async function fetchLandlordSmsIntakeNumber(
  landlordId: string = getActiveLandlordId(),
): Promise<string | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('sms_numbers')
    .select('phone_number')
    .eq('landlord_id', landlordId)
    .eq('purpose', 'landlord_main')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!error) {
    const phone = typeof data?.phone_number === 'string' ? data.phone_number.trim() : ''
    if (phone) return phone
  } else {
    console.warn('[landlordOnboarding] sms intake lookup', error.message)
  }

  // Provision / claim a pool number when none is assigned yet.
  try {
    const ensured = await ensureLandlordSmsOnboarding(landlordId)
    const phone = ensured?.mainPhoneNumber?.trim()
    if (phone) {
      try {
        await supabase
          .from('landlord_onboarding')
          .update({
            ulo_phone_number: phone,
            updated_at: new Date().toISOString(),
          })
          .eq('landlord_id', landlordId)
      } catch {
        // best-effort mirror
      }
      return phone
    }
  } catch (err) {
    console.warn('[landlordOnboarding] ensure sms intake failed', err)
  }

  return null
}

export async function fetchOnboardingReviewSupplement(
  state: LandlordOnboardingState,
  landlordId: string = getActiveLandlordId(),
): Promise<{
  vendors: OnboardingVendor[]
  residents: OnboardingResident[]
  dbCounts?: AccountSetupCounts
  smsIntakeNumber: string | null
}> {
  const [vendors, residents, smsIntakeNumber] = await Promise.all([
    fetchOnboardingVendors(landlordId),
    fetchOnboardingResidents(landlordId),
    fetchLandlordSmsIntakeNumber(landlordId),
  ])

  if (state.properties.length > 0) {
    return { vendors, residents, smsIntakeNumber }
  }

  const dbCounts = await fetchAccountSetupCounts(landlordId)
  return { vendors, residents, dbCounts, smsIntakeNumber }
}

export async function fetchOnboardingReviewData(
  landlordId: string = getActiveLandlordId(),
): Promise<OnboardingReviewData> {
  const onboarding = await readLandlordOnboardingDraft(landlordId)
  const supplement = await fetchOnboardingReviewSupplement(onboarding, landlordId)
  return buildOnboardingReviewData(
    onboarding,
    supplement.vendors,
    supplement.residents,
    supplement.dbCounts,
    supplement.smsIntakeNumber,
  )
}
