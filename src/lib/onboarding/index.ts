/**
 * Landlord onboarding public API — focused modules under src/lib/onboarding/.
 * Prefer importing from `@/lib/onboarding` (shim: `@/lib/landlordOnboarding`).
 */

export type { OnboardingApprovalRules } from './types'
export type {
  OnboardingStatus,
  OnboardingStep,
  OnboardingSetupPath,
  OnboardingProperty,
  OnboardingAccountSetup,
  PropertyFormRow,
  VendorFormRow,
  OnboardingOccupancyStatus,
  RentDueDayChoice,
  ResidentFormRow,
  OnboardingFormDraft,
  LandlordOnboardingState,
  AccountSetupCounts,
} from './types'
export {
  ONBOARDING_OCCUPANCY_STATUS_OPTIONS,
  normalizeOnboardingOccupancyStatus,
  onboardingOccupancyStatusLabel,
} from './types'

export {
  GUIDED_ONBOARDING_STEPS,
  FAST_TRACK_ONBOARDING_STEPS,
  getOnboardingStepsForPath,
  getOnboardingStepOrder,
  resolveOnboardingStepForPath,
  normalizeOnboardingStep,
  getPreviousOnboardingStep,
  getActiveOnboardingStepIndex,
} from './steps'

export {
  isOnboardingLandlordAccount,
  requireOnboardingLandlord,
} from './scope'

export {
  markOnboardingResetInProgress,
  clearOnboardingResetGuard,
  isOnboardingResetInProgress,
  clearLocalOnboardingStorage,
  defaultOnboardingState,
  readLocalOnboardingState,
  writeLocalOnboarding,
  fetchLandlordOnboarding,
  saveLandlordOnboarding,
  persistOnboardingWizardLocally,
  saveOnboardingWizardDraft,
  hasOnboardingAccountDraft,
  hasOnboardingDraft,
  isAccountEmpty,
  reconcileNewLandlordOnboarding,
  shouldBlockDashboard,
  readLandlordOnboardingDraft,
} from './draftStorage'

export {
  persistLandlordAccountProfile,
  persistLandlordCommunicationStyle,
  fetchAccountSetupCounts,
} from './persist/account'

export {
  generateUnitLabels,
  uniqueOnboardingUnitLabels,
  resolveOnboardingUnitLabels,
  collectExtractedUnitLabels,
  listOnboardingUnitOptions,
  deleteLandlordBuildings,
  persistOnboardingProperties,
  createPropertyId,
} from './persist/properties'

export type { OnboardingVendor } from './persist/vendors'
export { fetchOnboardingVendors } from './persist/vendors'

export type { OnboardingResident } from './persist/residents'
export {
  fetchOnboardingResidents,
  parseMonthlyRentInput,
  parseRentDueDayInput,
  parseLeaseDateInput,
} from './persist/residents'

export {
  onboardingResidentIdPrefix,
  maxOnboardingResidentSequence,
  nextOnboardingResidentIdFromSequence,
  nextOnboardingResidentId,
  allocateOnboardingResidentId,
} from './residentIds'

export type { OnboardingReviewData } from './review'
export {
  buildOnboardingReviewMetrics,
  buildOnboardingReviewData,
  fetchLandlordSmsIntakeNumber,
  fetchOnboardingReviewSupplement,
  fetchOnboardingReviewData,
} from './review'

export type { OnboardingDashboardSync } from './reset'
export {
  purgeOnboardingImportedOperations,
  ensureOnboardingDashboardMatchesPortfolio,
  resetOnboardingPortfolio,
  restartNewLandlordOnboarding,
  clearOnboardingPortfolioSession,
} from './reset'

export { importMockExtraction } from './importPortfolio'

export {
  isLandlordStripePayoutsReady,
  canCompleteOnboarding,
  completeOnboarding,
} from './complete'

export { commitFastTrackImport } from './fastTrackImport'
export type { CommitFastTrackImportInput } from './fastTrackImport'
export {
  loadCanonicalOnboardingProperties,
  propertyRecordToOnboardingProperty,
} from './hydrateProperties'
export {
  buildOnboardingFormDraft,
  readPersistedExtractionReview,
  readPersistedUploadDocuments,
} from './wizardDraft'
export { hydratePropertyFormsFromOnboarding } from './wizardHydrate'
export {
  mergeOnboardingStep,
  resolveWizardDisplayStep,
  SETUP_COMPLETE_TRANSITION_MS,
} from './wizardNavigation'
