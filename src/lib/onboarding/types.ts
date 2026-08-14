/**
 * Landlord onboarding — shared types and occupancy helpers.
 */
import type {
  OnboardingExtractionReview,
  OnboardingUploadedDocument,
} from '@/lib/onboardingDocumentUpload'
import type { OnboardingApprovalRules } from '@/lib/onboardingApprovalRules'

export type { OnboardingApprovalRules } from '@/lib/onboardingApprovalRules'

export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed'

export type OnboardingStep =
  | 'entry'
  | 'account_setup'
  | 'property'
  | 'document_upload'
  | 'ai_review'
  | 'approval'
  | 'vendors'
  | 'residents'
  | 'payouts'
  | 'review'

export type OnboardingSetupPath = 'guided' | 'fast_track' | null

export type OnboardingProperty = {
  id: string
  name: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
  unitCount: number
  /** Real unit numbers from documents / inventory. When set, persist these instead of 101…N. */
  unitLabels?: string[]
  /** Property type collected in the wizard (multifamily, etc.). */
  propertyType?: string
  /** Optional on-site / assigned property manager for this building. */
  propertyManagerName?: string
  propertyManagerPhone?: string
}

export type OnboardingAccountSetup = {
  companyName: string
  contactName: string
  email: string
  phone: string
  /** Optional secondary contact for escalations when the primary contact is unavailable. */
  backupContactName: string
  backupContactPhone: string
  /** ISO timestamp when SMS consent was accepted (Account setup). */
  smsConsentAcceptedAt?: string | null
}

/** Wizard property row — also the shape persisted in formDraft.propertyForms. */
export type PropertyFormRow = {
  id: string
  name: string
  address: string
  city: string
  state: string
  zipCode: string
  propertyType: string
  unitCount: string
  propertyManagerName: string
  propertyManagerPhone: string
}

/** Wizard vendor row — also the shape persisted in formDraft.vendorForms. */
export type VendorFormRow = {
  id: string
  name: string
  category: string
  email: string
  phone: string
  preferredEmergency: boolean
}

/** Resident occupancy / account status collected during onboarding. */
export type OnboardingOccupancyStatus =
  | 'active'
  | 'pending'
  | 'past_resident'
  | 'suspended'

export const ONBOARDING_OCCUPANCY_STATUS_OPTIONS: {
  value: OnboardingOccupancyStatus
  label: string
}[] = [
  { value: 'active', label: 'Occupied' },
  { value: 'pending', label: 'Pending move-in' },
  { value: 'past_resident', label: 'Past resident' },
  { value: 'suspended', label: 'Suspended' },
]

export function normalizeOnboardingOccupancyStatus(
  raw: unknown,
): OnboardingOccupancyStatus {
  const v = String(raw ?? '').trim().toLowerCase()
  if (v === 'pending' || v === 'pending_move_in' || v === 'pending move-in') {
    return 'pending'
  }
  if (v === 'past_resident' || v === 'vacant' || v === 'moved_out') {
    return 'past_resident'
  }
  if (v === 'suspended') return 'suspended'
  if (v === 'occupied' || v === 'active') return 'active'
  return 'active'
}

export function onboardingOccupancyStatusLabel(
  status: OnboardingOccupancyStatus,
): string {
  return (
    ONBOARDING_OCCUPANCY_STATUS_OPTIONS.find((option) => option.value === status)
      ?.label ?? 'Occupied'
  )
}

export type RentDueDayChoice = '' | '1' | '5' | 'custom'

/** Wizard resident row — also the shape persisted in formDraft.residentForms. */
export type ResidentFormRow = {
  id: string
  residentId?: string
  fullName: string
  unit: string
  building: string
  email: string
  phone: string
  monthlyRent: string
  rentDueDayMode: RentDueDayChoice
  rentDueDay: string
  leaseStart: string
  leaseEnd: string
  maintenanceResponsibilitiesClause: string
  occupancyStatus: OnboardingOccupancyStatus
}

export type OnboardingFormDraft = {
  propertyForms?: PropertyFormRow[]
  vendorForms?: VendorFormRow[]
  residentForms?: ResidentFormRow[]
  uploadDocuments?: OnboardingUploadedDocument[]
  extractionReview?: OnboardingExtractionReview
}

export type LandlordOnboardingState = {
  landlordId: string
  onboardingStatus: OnboardingStatus
  currentStep: OnboardingStep
  setupPath: OnboardingSetupPath
  accountSetup: OnboardingAccountSetup
  properties: OnboardingProperty[]
  /** Maintenance approval rules (threshold, emergencies, after-hours, marketplace). */
  approvalRules: OnboardingApprovalRules
  formDraft?: OnboardingFormDraft
  completedAt: string | null
}

export type AccountSetupCounts = {
  properties: number
  units: number
  residents: number
  vendors: number
  workflowRuns: number
}
