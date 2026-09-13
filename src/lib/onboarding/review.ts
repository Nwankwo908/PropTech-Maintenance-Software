/**
 * Onboarding review data assembly.
 */
import { ensureLandlordSmsOnboarding } from '@/api/landlordSmsOnboarding'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { formatPhoneNational } from '@/lib/phoneFormat'
import { resolveSmsIntakeNumber } from '@shared/landlordCapabilities'
import { normalizeOnboardingApprovalRules, type OnboardingApprovalRules } from '@/lib/onboardingApprovalRules'
import { supabase } from '@/lib/supabase'
import { fetchAccountSetupCounts } from './persist/account'
import { fetchOnboardingResidents, type OnboardingResident } from './persist/residents'
import {
  mergeFastTrackReviewResidents,
  type ImportExtractedResidentRow,
} from './persist/importResidents'
import { fetchOnboardingVendors, type OnboardingVendor } from './persist/vendors'
import {
  loadImportedOpsRecords,
  type ImportedOnboardingFinancialRecord,
  type ImportedOnboardingMaintenanceIssue,
} from './persist/importedOpsRecords'
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
  maintenanceIssues: ImportedOnboardingMaintenanceIssue[]
  financialRecords: ImportedOnboardingFinancialRecord[]
}

export function buildOnboardingReviewMetrics(
  state: LandlordOnboardingState,
  vendors: OnboardingVendor[],
  residents: OnboardingResident[],
  dbCounts?: AccountSetupCounts,
): AccountSetupCounts {
  const draftUnits = state.properties.reduce((sum, property) => {
    const labels = property.unitLabels?.filter((label) => label.trim()).length ?? 0
    return sum + (labels > 0 ? labels : property.unitCount)
  }, 0)
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
  extractedResidents?: ImportExtractedResidentRow[],
  importedOps?: {
    financialRecords?: ImportedOnboardingFinancialRecord[]
    maintenanceIssues?: ImportedOnboardingMaintenanceIssue[]
  },
): OnboardingReviewData {
  const normalized = resolveSmsIntakeNumber({
    landlordId: state.landlordId,
    phone: smsIntakeNumber,
  })
  const mergedResidents =
    state.setupPath === 'fast_track' && extractedResidents?.length
      ? mergeFastTrackReviewResidents(residents, extractedResidents)
      : residents
  return {
    accountSetup: state.accountSetup,
    properties: state.properties,
    vendors,
    residents: mergedResidents,
    approvalRules: normalizeOnboardingApprovalRules(state.approvalRules),
    metrics: buildOnboardingReviewMetrics(state, vendors, mergedResidents, dbCounts),
    smsIntakeNumber: normalized,
    smsIntakeNumberDisplay: normalized ? formatPhoneNational(normalized) : null,
    maintenanceIssues: importedOps?.maintenanceIssues ?? [],
    financialRecords: importedOps?.financialRecords ?? [],
  }
}

/** Active landlord_main SMS line used for resident maintenance intake. */
export async function fetchLandlordSmsIntakeNumber(
  landlordId: string = getActiveLandlordId(),
): Promise<string> {
  const fallback = resolveSmsIntakeNumber({ landlordId })
  if (!supabase) return fallback

  const { data, error } = await supabase
    .from('sms_numbers')
    .select('phone_number, provider')
    .eq('landlord_id', landlordId)
    .eq('purpose', 'landlord_main')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!error) {
    const phone = typeof data?.phone_number === 'string' ? data.phone_number.trim() : ''
    const provider = typeof data?.provider === 'string' ? data.provider : ''
    const usable = resolveSmsIntakeNumber({ landlordId, phone, provider })
    if (usable) return usable
  } else {
    console.warn('[landlordOnboarding] sms intake lookup', error.message)
  }

  try {
    const ensured = await ensureLandlordSmsOnboarding(landlordId)
    const phone = ensured?.mainPhoneNumber?.trim() ?? ''
    const usable = resolveSmsIntakeNumber({ landlordId, phone })
    try {
      await supabase
        .from('landlord_onboarding')
        .update({
          ulo_phone_number: usable,
          updated_at: new Date().toISOString(),
        })
        .eq('landlord_id', landlordId)
    } catch {
      // best-effort mirror
    }
    return usable
  } catch (err) {
    console.warn('[landlordOnboarding] ensure sms intake failed', err)
  }

  return fallback
}

export async function fetchOnboardingReviewSupplement(
  state: LandlordOnboardingState,
  landlordId: string = getActiveLandlordId(),
): Promise<{
  vendors: OnboardingVendor[]
  residents: OnboardingResident[]
  dbCounts?: AccountSetupCounts
  smsIntakeNumber: string
  financialRecords: ImportedOnboardingFinancialRecord[]
  maintenanceIssues: ImportedOnboardingMaintenanceIssue[]
}> {
  const [vendors, residents, smsIntakeNumber] = await Promise.all([
    fetchOnboardingVendors(landlordId),
    fetchOnboardingResidents(landlordId),
    fetchLandlordSmsIntakeNumber(landlordId),
  ])
  const importedOps = loadImportedOpsRecords(landlordId)

  if (state.properties.length > 0) {
    return {
      vendors,
      residents,
      smsIntakeNumber,
      financialRecords: importedOps.financialRecords,
      maintenanceIssues: importedOps.maintenanceIssues,
    }
  }

  const dbCounts = await fetchAccountSetupCounts(landlordId)
  return {
    vendors,
    residents,
    dbCounts,
    smsIntakeNumber,
    financialRecords: importedOps.financialRecords,
    maintenanceIssues: importedOps.maintenanceIssues,
  }
}

export async function fetchOnboardingReviewData(
  landlordId: string = getActiveLandlordId(),
  extractedResidents?: ImportExtractedResidentRow[],
): Promise<OnboardingReviewData> {
  const onboarding = await readLandlordOnboardingDraft(landlordId)
  const supplement = await fetchOnboardingReviewSupplement(onboarding, landlordId)
  return buildOnboardingReviewData(
    onboarding,
    supplement.vendors,
    supplement.residents,
    supplement.dbCounts,
    supplement.smsIntakeNumber,
    extractedResidents,
    {
      financialRecords: supplement.financialRecords,
      maintenanceIssues: supplement.maintenanceIssues,
    },
  )
}
