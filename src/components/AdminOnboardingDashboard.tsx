import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  anyDocumentProcessing,
  buildOnboardingExtractionReview,
  createUploadedDocumentFromFile,
  emptyExtractionReview,
  isAcceptedUploadFile,
  runMockDocumentProcessing,
  setAllReviewSelections,
  toMockExtractionReview,
  countSelectedInReview,
  hasExtractionReviewData,
  type OnboardingExtractionReview,
  type OnboardingUploadedDocument,
} from '@/lib/onboardingDocumentUpload'
import { OnboardingWelcomeHub } from '@/components/onboarding/OnboardingWelcomeHub'
import { OnboardingStepIndicator } from '@/components/onboarding/OnboardingStepIndicator'
import { OnboardingReviewStep } from '@/components/onboarding/OnboardingReviewStep'
import { OnboardingAiReviewStep } from '@/components/onboarding/OnboardingAiReviewStep'
import { OnboardingDocumentUploadStep } from '@/components/onboarding/OnboardingDocumentUploadStep'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { TERMS_PRIVACY_SECTION_PATH } from '@/lib/legal/termsOfServiceContent'
import {
  buildOnboardingReviewData,
  canCompleteOnboarding,
  completeOnboarding,
  createPropertyId,
  defaultOnboardingState,
  fetchAccountSetupCounts,
  fetchLandlordOnboarding,
  fetchOnboardingReviewData,
  fetchOnboardingReviewSupplement,
  fetchOnboardingResidents,
  fetchOnboardingVendors,
  clearOnboardingPortfolioSession,
  hasOnboardingAccountDraft,
  getPreviousOnboardingStep,
  importMockExtraction,
  maxOnboardingResidentSequence,
  nextOnboardingResidentIdFromSequence,
  normalizeOnboardingStepId,
  persistOnboardingProperties,
  persistOnboardingWizardLocally,
  readLocalOnboardingState,
  resolveOnboardingStepForPath,
  saveLandlordOnboarding,
  saveOnboardingWizardDraft,
  type LandlordOnboardingState,
  type OnboardingAccountSetup,
  type OnboardingProperty,
  type OnboardingResident,
  type OnboardingReviewData,
  type OnboardingFormDraft,
  type OnboardingStep,
  type OnboardingVendor,
} from '@/lib/landlordOnboarding'
import { supabase } from '@/lib/supabase'
import { phoneForDbOrError } from '@/lib/phoneFormat'

const inputClass =
  'h-10 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[14px] text-[#101828] outline-none placeholder:text-[#9ca3af] focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

const fieldLabelClass = 'mb-1 block text-[13px] font-medium text-[#364153]'

const selectClass =
  'h-10 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-2 pl-3 pr-10 text-[14px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

const PROPERTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'multifamily', label: 'Multifamily' },
  { value: 'single_family', label: 'Single Family' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'student_housing', label: 'Student Housing' },
]

const VENDOR_TRADE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Select trade' },
  { value: 'plumbing', label: 'Plumbing' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'appliance', label: 'Appliances' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'general', label: 'General maintenance' },
  { value: 'landscaping', label: 'Landscaping' },
  { value: 'pest_control', label: 'Pest control' },
  { value: 'other', label: 'Other' },
]

function vendorTradeToDbCategory(trade: string): string | null {
  const value = trade.trim()
  if (value === 'plumbing' || value === 'electrical' || value === 'appliance') return value
  return null
}

function dbCategoryToVendorTrade(category: string): string {
  const value = category.trim()
  if (value === 'plumbing' || value === 'electrical' || value === 'appliance') return value
  return value ? 'other' : ''
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isPersistedVendorId(id: string): boolean {
  return UUID_RE.test(id)
}

type PropertyFormRow = {
  id: string
  name: string
  address: string
  propertyType: string
  unitCount: string
}

function createEmptyPropertyForm(): PropertyFormRow {
  return {
    id: createPropertyId(),
    name: '',
    address: '',
    propertyType: 'multifamily',
    unitCount: '',
  }
}

function formatPropertyAddress(property: OnboardingProperty): string {
  return [property.streetAddress, property.city, property.state, property.zipCode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
}

function propertyFormToOnboarding(form: PropertyFormRow): OnboardingProperty | null {
  const unitCount = Number.parseInt(form.unitCount, 10)
  if (!form.name.trim() || !form.address.trim() || !Number.isFinite(unitCount) || unitCount < 1) {
    return null
  }
  return {
    id: form.id,
    name: form.name.trim(),
    streetAddress: form.address.trim(),
    city: '',
    state: '',
    zipCode: '',
    unitCount,
  }
}

type VendorFormRow = {
  id: string
  name: string
  category: string
  email: string
  phone: string
}

function createEmptyVendorForm(): VendorFormRow {
  return {
    id: `vendor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    category: '',
    email: '',
    phone: '',
  }
}

function vendorToFormRow(vendor: OnboardingVendor): VendorFormRow {
  return {
    id: vendor.id,
    name: vendor.name,
    category: dbCategoryToVendorTrade(vendor.category),
    email: vendor.email,
    phone: vendor.phone,
  }
}

function propertyFormsFromState(properties: OnboardingProperty[]): PropertyFormRow[] {
  return properties.map((property) => ({
    id: property.id,
    name: property.name,
    address: formatPropertyAddress(property),
    propertyType: 'multifamily',
    unitCount: String(property.unitCount),
  }))
}

function dedupeVendorForms(forms: VendorFormRow[]): VendorFormRow[] {
  const seenIds = new Set<string>()
  const byName = new Map<string, VendorFormRow>()
  const unnamed: VendorFormRow[] = []

  for (const form of forms) {
    const id = form.id.trim()
    if (id && seenIds.has(id)) continue
    if (id) seenIds.add(id)

    const nameKey = form.name.trim().toLowerCase()
    if (!nameKey) {
      unnamed.push(form)
      continue
    }

    const existing = byName.get(nameKey)
    if (!existing) {
      byName.set(nameKey, form)
      continue
    }

    // Prefer the persisted database row when names collide.
    if (!isPersistedVendorId(existing.id) && isPersistedVendorId(form.id)) {
      byName.set(nameKey, form)
    }
  }

  const deduped = [...byName.values(), ...unnamed]
  return deduped.length > 0 ? deduped : [createEmptyVendorForm()]
}

function residentFormRowHasUserInput(form: ResidentFormRow): boolean {
  return (
    form.fullName.trim() !== '' ||
    form.unit.trim() !== '' ||
    form.phone.trim() !== '' ||
    form.email.trim() !== ''
  )
}

function residentFormsHaveData(forms: ResidentFormRow[] | undefined): boolean {
  return (forms ?? []).some(residentFormRowHasUserInput)
}

function pickResidentFormsForStep(
  preferred: ResidentFormRow[],
  reviewResidents: OnboardingResident[] | undefined,
): ResidentFormRow[] {
  if (residentFormsHaveData(preferred)) return preferred
  if (reviewResidents?.length) return reviewResidents.map(residentToFormRow)
  return preferred.length > 0 ? preferred : [createEmptyResidentForm()]
}

function readPersistedResidentForms(
  stateDraft: OnboardingFormDraft | undefined,
): ResidentFormRow[] | undefined {
  if (residentFormsHaveData(stateDraft?.residentForms)) {
    return stateDraft!.residentForms
  }
  const localDraft = readLocalOnboardingState()?.formDraft
  if (residentFormsHaveData(localDraft?.residentForms)) {
    return localDraft!.residentForms
  }
  return undefined
}

function buildFormDraft(
  propertyForms: PropertyFormRow[],
  vendorForms: VendorFormRow[],
  residentForms: ResidentFormRow[],
  fastTrack?: {
    uploadDocuments?: OnboardingUploadedDocument[]
    extractionReview?: OnboardingExtractionReview | null
  },
): OnboardingFormDraft {
  const draft: OnboardingFormDraft = { propertyForms, vendorForms, residentForms }
  if (fastTrack?.uploadDocuments?.length) {
    draft.uploadDocuments = fastTrack.uploadDocuments
  }
  if (fastTrack?.extractionReview && hasExtractionReviewData(fastTrack.extractionReview)) {
    draft.extractionReview = fastTrack.extractionReview
  }
  return draft
}

function readPersistedExtractionReview(
  stateDraft: OnboardingFormDraft | undefined,
): OnboardingExtractionReview | undefined {
  if (stateDraft?.extractionReview && hasExtractionReviewData(stateDraft.extractionReview)) {
    return stateDraft.extractionReview
  }
  const localDraft = readLocalOnboardingState()?.formDraft
  if (localDraft?.extractionReview && hasExtractionReviewData(localDraft.extractionReview)) {
    return localDraft.extractionReview
  }
  return undefined
}

function readPersistedUploadDocuments(
  stateDraft: OnboardingFormDraft | undefined,
): OnboardingUploadedDocument[] | undefined {
  if (stateDraft?.uploadDocuments?.length) {
    return stateDraft.uploadDocuments
  }
  const localDraft = readLocalOnboardingState()?.formDraft
  if (localDraft?.uploadDocuments?.length) {
    return localDraft.uploadDocuments
  }
  return undefined
}

function hydrateFormsFromOnboarding(
  onboarding: LandlordOnboardingState,
  setters: {
    setPropertyForms: (rows: PropertyFormRow[]) => void
    setVendorForms: (rows: VendorFormRow[]) => void
    setResidentForms: (rows: ResidentFormRow[]) => void
  },
): void {
  const draft = onboarding.formDraft

  if (draft?.propertyForms?.length) {
    setters.setPropertyForms(draft.propertyForms)
  } else if (onboarding.properties.length > 0) {
    setters.setPropertyForms(propertyFormsFromState(onboarding.properties))
  }
}

type ResidentFormRow = {
  id: string
  residentId?: string
  fullName: string
  unit: string
  email: string
  phone: string
}

function createEmptyResidentForm(): ResidentFormRow {
  return {
    id: `resident-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fullName: '',
    unit: '',
    email: '',
    phone: '',
  }
}

function residentToFormRow(resident: OnboardingResident): ResidentFormRow {
  return {
    id: resident.id,
    residentId: resident.residentId,
    fullName: resident.fullName,
    unit: resident.unit,
    email: resident.email.endsWith('@onboarding.local') ? '' : resident.email,
    phone: resident.phone,
  }
}

function residentEmailForDb(email: string, residentId: string): string {
  const trimmed = email.trim()
  if (trimmed) return trimmed
  return `${residentId.toLowerCase()}@onboarding.local`
}

const btnNav =
  'inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[14px] font-medium tracking-[-0.1504px] text-[#364153] outline-none transition-[color,background-color] duration-150 hover:bg-[#f3f4f6] hover:text-[#101828] active:bg-[#e5e7eb] focus-visible:ring-2 focus-visible:ring-[#101828]/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[#364153]'

const btnSecondary =
  'inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50'

function OnboardingBackButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={btnNav}>
      <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
        <path
          d="M15 18l-6-6 6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Back
    </button>
  )
}

function OnboardingContinueButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={btnNav}>
      {children}
      <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
        <path
          d="M9 18l6-6-6-6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

function OnboardingStepNav({
  showBack,
  onBack,
  saving,
  children,
}: {
  showBack: boolean
  onBack: () => void
  saving: boolean
  children: ReactNode
}) {
  return (
    <div className="mt-6 flex items-center justify-between gap-4">
      {showBack ? <OnboardingBackButton disabled={saving} onClick={onBack} /> : <span aria-hidden />}
      <div className="flex items-center gap-3">{children}</div>
    </div>
  )
}

const SETUP_COMPLETE_TRANSITION_MS = 5000

function OnboardingSetupTransition({
  title = 'Setting up your dashboard',
  subtitle = 'This will only take a moment…',
}: {
  title?: string
  subtitle?: string
}) {
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-16"
      aria-busy="true"
      aria-live="polite"
    >
      <div
        className="size-11 animate-spin rounded-full border-[3px] border-[#e5e7eb] border-t-[#187960]"
        role="status"
        aria-label="Loading"
      />
      <div className="text-center">
        <p className="text-[16px] font-semibold text-[#101828]">{title}</p>
        <p className="mt-1 text-[14px] text-[#6a7282]">{subtitle}</p>
      </div>
    </main>
  )
}

export function AdminOnboardingDashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<LandlordOnboardingState>(() => defaultOnboardingState())

  const [propertyForms, setPropertyForms] = useState<PropertyFormRow[]>(() => [createEmptyPropertyForm()])

  const [vendorForms, setVendorForms] = useState<VendorFormRow[]>(() => [createEmptyVendorForm()])

  const [residentForms, setResidentForms] = useState<ResidentFormRow[]>(() => [createEmptyResidentForm()])

  const [uploadDocuments, setUploadDocuments] = useState<OnboardingUploadedDocument[]>([])
  const [uploadProcessing, setUploadProcessing] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [extractionReview, setExtractionReview] = useState<OnboardingExtractionReview | null>(null)
  const [reviewData, setReviewData] = useState<OnboardingReviewData | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [completingSetup, setCompletingSetup] = useState(false)
  const [importingPortfolio, setImportingPortfolio] = useState(false)
  const [editingFromReview, setEditingFromReview] = useState(false)
  const [reviewEditStep, setReviewEditStep] = useState<OnboardingStep | null>(null)
  const [smsConsentAccepted, setSmsConsentAccepted] = useState(false)
  const smsConsentCheckboxId = useId()
  const editingFromReviewRef = useRef(false)
  const wizardRemoteSaveTimer = useRef<number | null>(null)
  const processingControllersRef = useRef<Map<string, AbortController>>(new Map())
  const formsHydratedRef = useRef(false)
  const wizardSnapshotRef = useRef({
    state: defaultOnboardingState(),
    propertyForms: [] as PropertyFormRow[],
    vendorForms: [] as VendorFormRow[],
    residentForms: [] as ResidentFormRow[],
    uploadDocuments: [] as OnboardingUploadedDocument[],
    extractionReview: null as OnboardingExtractionReview | null,
  })

  const storedStep = normalizeOnboardingStepId(state.currentStep)
  const step =
    editingFromReview && reviewEditStep != null
      ? reviewEditStep
      : resolveOnboardingStepForPath(storedStep, state.setupPath)
  wizardSnapshotRef.current = {
    state,
    propertyForms,
    vendorForms,
    residentForms,
    uploadDocuments,
    extractionReview,
  }
  const completionCheck = canCompleteOnboarding(
    reviewData
      ? { ...state, accountSetup: reviewData.accountSetup, properties: reviewData.properties }
      : state,
    reviewData?.vendors ?? [],
    reviewData?.residents ?? [],
    reviewData?.metrics,
  )
  const isWelcomeStep = step === 'entry'
  const isReviewStep = step === 'review'
  const isComplete = state.onboardingStatus === 'completed'
  const showBackButton =
    editingFromReview ||
    (step !== 'entry' && getPreviousOnboardingStep(step, state.setupPath) != null)
  const editContinueLabel = editingFromReview ? 'Save and return to review' : undefined

  function enterReviewEditMode(targetStep: OnboardingStep) {
    editingFromReviewRef.current = true
    setEditingFromReview(true)
    setReviewEditStep(targetStep)
  }

  function clearReviewEditMode() {
    editingFromReviewRef.current = false
    setEditingFromReview(false)
    setReviewEditStep(null)
  }

  useEffect(() => {
    return () => {
      if (wizardRemoteSaveTimer.current != null) {
        window.clearTimeout(wizardRemoteSaveTimer.current)
      }
    }
  }, [])

  function buildWizardFormDraft(
    propertyForms: PropertyFormRow[],
    vendorForms: VendorFormRow[],
    residentForms: ResidentFormRow[],
    snap?: {
      uploadDocuments?: OnboardingUploadedDocument[]
      extractionReview?: OnboardingExtractionReview | null
    },
  ): OnboardingFormDraft {
    const source = snap ?? wizardSnapshotRef.current
    return buildFormDraft(propertyForms, vendorForms, residentForms, {
      uploadDocuments: source.uploadDocuments,
      extractionReview: source.extractionReview,
    })
  }

  function scheduleWizardPersist() {
    const snap = wizardSnapshotRef.current
    const formDraft = buildWizardFormDraft(snap.propertyForms, snap.vendorForms, snap.residentForms, snap)
    persistOnboardingWizardLocally(snap.state, formDraft)

    if (wizardRemoteSaveTimer.current != null) {
      window.clearTimeout(wizardRemoteSaveTimer.current)
    }
    wizardRemoteSaveTimer.current = window.setTimeout(() => {
      const latest = wizardSnapshotRef.current
      const latestDraft = buildWizardFormDraft(
        latest.propertyForms,
        latest.vendorForms,
        latest.residentForms,
        latest,
      )
      void saveOnboardingWizardDraft(latest.state, latestDraft)
    }, 400)
  }

  useEffect(() => {
    if (loading || !formsHydratedRef.current) return
    scheduleWizardPersist()
  }, [loading, state, propertyForms, vendorForms, residentForms, uploadDocuments, extractionReview])

  useEffect(() => {
    if (loading) return

    const flush = () => {
      const snap = wizardSnapshotRef.current
      const formDraft = buildWizardFormDraft(snap.propertyForms, snap.vendorForms, snap.residentForms, snap)
      persistOnboardingWizardLocally(snap.state, formDraft)
    }

    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [loading])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const onboarding = await fetchLandlordOnboarding()
      if (cancelled) return

      const onWelcome = normalizeOnboardingStepId(onboarding.currentStep) === 'entry'
      const localSnapshot = readLocalOnboardingState()
      const localInProgress =
        localSnapshot != null &&
        localSnapshot.onboardingStatus === 'in_progress' &&
        normalizeOnboardingStepId(localSnapshot.currentStep) !== 'entry'
      const counts = onWelcome && !localInProgress ? await fetchAccountSetupCounts() : null
      const hasStalePortfolio =
        onWelcome &&
        !localInProgress &&
        (onboarding.properties.length > 0 ||
          (counts != null &&
            (counts.properties > 0 ||
              counts.units > 0 ||
              counts.residents > 0 ||
              counts.vendors > 0)))

      if (hasStalePortfolio) {
        const cleared = await clearOnboardingPortfolioSession({ keepAccountSetup: true })
        if (cancelled) return
        if (!cleared.ok) {
          setError(cleared.error ?? 'Could not clear previous portfolio data.')
          setState(onboarding)
        } else {
          setState(cleared.state)
        }
        setPropertyForms([createEmptyPropertyForm()])
        setVendorForms([createEmptyVendorForm()])
        setResidentForms([createEmptyResidentForm()])
        formsHydratedRef.current = true
        setLoading(false)
        return
      }

      const resolvedStep = resolveOnboardingStepForPath(
        normalizeOnboardingStepId(onboarding.currentStep),
        onboarding.setupPath,
      )
      const normalizedOnboarding =
        resolvedStep === normalizeOnboardingStepId(onboarding.currentStep)
          ? onboarding
          : { ...onboarding, currentStep: resolvedStep }
      setState(normalizedOnboarding)
      if (normalizedOnboarding !== onboarding) {
        void saveLandlordOnboarding(normalizedOnboarding)
      }
      hydrateFormsFromOnboarding(normalizedOnboarding, {
        setPropertyForms,
        setVendorForms,
        setResidentForms,
      })
      const persistedUploads = readPersistedUploadDocuments(normalizedOnboarding.formDraft)
      if (persistedUploads?.length) {
        setUploadDocuments(persistedUploads)
      }
      const persistedExtraction = readPersistedExtractionReview(normalizedOnboarding.formDraft)
      if (persistedExtraction) {
        setExtractionReview(persistedExtraction)
      }
      formsHydratedRef.current = true
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (loading || step !== 'property') return
    if (state.formDraft?.propertyForms?.length) {
      setPropertyForms(state.formDraft.propertyForms)
      return
    }
    if (state.properties.length > 0) {
      setPropertyForms(propertyFormsFromState(state.properties))
    }
  }, [loading, step, state.formDraft, state.properties])

  useEffect(() => {
    if (loading || step !== 'vendors') return

    let cancelled = false
    void (async () => {
      const dbVendors = await fetchOnboardingVendors()
      if (cancelled) return

      if (dbVendors.length > 0) {
        setVendorForms(dedupeVendorForms(dbVendors.map(vendorToFormRow)))
        return
      }

      if (state.formDraft?.vendorForms?.length) {
        setVendorForms(dedupeVendorForms(state.formDraft.vendorForms))
        return
      }

      setVendorForms([createEmptyVendorForm()])
    })()

    return () => {
      cancelled = true
    }
  }, [loading, step, state.formDraft])

  useEffect(() => {
    if (loading || step !== 'residents') return
    if (residentFormsHaveData(residentForms)) return

    let cancelled = false
    void (async () => {
      const dbResidents = await fetchOnboardingResidents()
      if (cancelled) return
      if (residentFormsHaveData(wizardSnapshotRef.current.residentForms)) return

      if (dbResidents.length > 0) {
        setResidentForms(dbResidents.map(residentToFormRow))
        return
      }

      const persistedForms = readPersistedResidentForms(state.formDraft)
      if (persistedForms) {
        setResidentForms(persistedForms)
        return
      }

      setResidentForms([createEmptyResidentForm()])
    })()

    return () => {
      cancelled = true
    }
  }, [loading, step, state.formDraft])

  useEffect(() => {
    if (loading || step !== 'document_upload') return
    if (uploadDocuments.length > 0) return
    const persistedUploads = readPersistedUploadDocuments(state.formDraft)
    if (persistedUploads?.length) {
      setUploadDocuments(persistedUploads)
    }
  }, [loading, step, uploadDocuments.length, state.formDraft])

  useEffect(() => {
    if (loading || step !== 'ai_review') return
    if (extractionReview && hasExtractionReviewData(extractionReview)) return
    const persistedExtraction = readPersistedExtractionReview(state.formDraft)
    if (persistedExtraction) {
      setExtractionReview(persistedExtraction)
      return
    }
    if (uploadDocuments.length > 0) {
      setExtractionReview(buildOnboardingExtractionReview(uploadDocuments))
      return
    }
    if (!extractionReview) {
      setExtractionReview(emptyExtractionReview())
    }
  }, [loading, step, extractionReview, uploadDocuments, state.formDraft])

  useEffect(() => {
    setUploadProcessing(anyDocumentProcessing(uploadDocuments))
  }, [uploadDocuments])

  useEffect(() => {
    return () => {
      for (const controller of processingControllersRef.current.values()) {
        controller.abort()
      }
      processingControllersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (loading || step !== 'review') {
      return
    }

    let cancelled = false
    setReviewData((prev) => prev ?? buildOnboardingReviewData(state))
    setReviewLoading(false)

    void (async () => {
      const supplement = await fetchOnboardingReviewSupplement(state)
      if (cancelled) return
      setReviewData(
        buildOnboardingReviewData(
          state,
          supplement.vendors,
          supplement.residents,
          supplement.dbCounts,
        ),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [loading, step, state])

  async function refreshCounts() {
    await fetchAccountSetupCounts()
  }

  function mergeOnboardingStep(
    prev: LandlordOnboardingState,
    nextStep: OnboardingStep,
    patch: Partial<LandlordOnboardingState> = {},
  ): LandlordOnboardingState {
    return {
      ...prev,
      ...patch,
      currentStep: nextStep,
      onboardingStatus:
        patch.onboardingStatus === 'completed'
          ? 'completed'
          : nextStep === 'entry' && patch.onboardingStatus == null
            ? prev.onboardingStatus
            : patch.onboardingStatus ?? 'in_progress',
    }
  }

  function updateAccountSetup(patch: Partial<OnboardingAccountSetup>) {
    setState((prev) => {
      const next: LandlordOnboardingState = {
        ...prev,
        accountSetup: { ...prev.accountSetup, ...patch },
      }
      const snap = wizardSnapshotRef.current
      const formDraft = buildWizardFormDraft(snap.propertyForms, snap.vendorForms, snap.residentForms, snap)
      persistOnboardingWizardLocally(next, formDraft)
      return next
    })
  }

  async function goTo(
    nextStep: OnboardingStep,
    patch: Partial<LandlordOnboardingState> = {},
    forms?: {
      propertyForms?: PropertyFormRow[]
      vendorForms?: VendorFormRow[]
      residentForms?: ResidentFormRow[]
    },
  ) {
    if (step === 'review' && nextStep !== 'review') {
      setReviewLoading(false)
      setReviewData(null)
    }

    const snap = wizardSnapshotRef.current
    const draftPropertyForms = forms?.propertyForms ?? snap.propertyForms
    const draftVendorForms = forms?.vendorForms ?? snap.vendorForms
    const draftResidentForms = pickResidentFormsForStep(
      forms?.residentForms ?? snap.residentForms,
      step === 'review' && nextStep === 'residents' ? reviewData?.residents : undefined,
    )

    let next!: LandlordOnboardingState
    setState((prev) => {
      next = mergeOnboardingStep(prev, nextStep, {
        ...patch,
        formDraft: buildWizardFormDraft(
          draftPropertyForms,
          draftVendorForms,
          draftResidentForms,
          snap,
        ),
      })
      return next
    })

    if (nextStep === 'residents') {
      setResidentForms(draftResidentForms)
    }

    setSaving(true)
    setError(null)
    try {
      await saveLandlordOnboarding(next!)
    } finally {
      setSaving(false)
    }
  }

  function resetOnboardingForms() {
    setPropertyForms([createEmptyPropertyForm()])
    setVendorForms([createEmptyVendorForm()])
    setResidentForms([createEmptyResidentForm()])
    setReviewData(null)
    setUploadDocuments([])
    setUploadError(null)
    setExtractionReview(null)
    setSmsConsentAccepted(false)
  }

  async function wipePortfolioSession(): Promise<LandlordOnboardingState | null> {
    setSaving(true)
    setError(null)
    const cleared = await clearOnboardingPortfolioSession({ keepAccountSetup: true })
    setSaving(false)
    if (!cleared.ok) {
      setError(cleared.error ?? 'Could not clear previous portfolio data.')
      return null
    }
    setState(cleared.state)
    resetOnboardingForms()
    return cleared.state
  }

  async function beginOnboarding(path: 'guided' | 'fast_track', targetStep: OnboardingStep) {
    const clearedState = await wipePortfolioSession()
    if (!clearedState) return

    setSaving(true)
    await goTo(targetStep, {
      onboardingStatus: 'in_progress',
      setupPath: path,
      accountSetup: clearedState.accountSetup,
      properties: [],
    })
    setSaving(false)
  }

  async function handleStartScratch() {
    await beginOnboarding('guided', 'account_setup')
  }

  async function handleStartFastTrack() {
    await beginOnboarding('fast_track', 'document_upload')
  }

  async function handleBack() {
    if (editingFromReviewRef.current) {
      setError(null)
      clearReviewEditMode()
      await goTo('review')
      return
    }
    const previous = getPreviousOnboardingStep(step, state.setupPath)
    if (!previous) return
    setError(null)
    if (previous === 'entry') {
      await wipePortfolioSession()
      return
    }
    if (step === 'review' && previous === 'residents' && state.setupPath !== 'fast_track') {
      const snap = wizardSnapshotRef.current
      await goTo(
        'residents',
        {},
        {
          residentForms: pickResidentFormsForStep(snap.residentForms, reviewData?.residents),
        },
      )
      return
    }
    await goTo(previous)
  }

  async function saveAccountSetup() {
    if (!state.accountSetup.companyName.trim() || !state.accountSetup.contactName.trim()) {
      setError('Enter your company and contact name.')
      return
    }
    if (!smsConsentAccepted) {
      setError('Please agree to the SMS terms to continue.')
      return
    }
    if (editingFromReviewRef.current) {
      await returnToReviewAfterEdit({ accountSetup: state.accountSetup })
      return
    }
    await goTo('property', { accountSetup: state.accountSetup })
  }

  async function saveProperty() {
    const properties = propertyForms
      .map(propertyFormToOnboarding)
      .filter((property): property is OnboardingProperty => property != null)

    if (properties.length !== propertyForms.length) {
      setError('Each property needs a name, address, and at least one unit.')
      return
    }

    setSaving(true)
    setError(null)
    const result = await persistOnboardingProperties(properties)
    if (!result.ok) {
      setSaving(false)
      setError(result.error ?? 'Could not register units.')
      return
    }

    if (editingFromReviewRef.current) {
      await returnToReviewAfterEdit({ properties })
      setSaving(false)
      return
    }

    await goTo('vendors', { properties })
    await refreshCounts()
    setSaving(false)
  }

  function updatePropertyForm(id: string, patch: Partial<PropertyFormRow>) {
    setPropertyForms((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function addPropertyForm() {
    setPropertyForms((prev) => [...prev, createEmptyPropertyForm()])
  }

  function removePropertyForm(id: string) {
    if (propertyForms.length <= 1) return
    setPropertyForms((prev) => prev.filter((row) => row.id !== id))
  }

  function queueDocumentUploads(files: FileList | File[]) {
    const errors: string[] = []
    const newDocs: OnboardingUploadedDocument[] = []

    for (const file of Array.from(files)) {
      const check = isAcceptedUploadFile(file)
      if (!check.ok) {
        errors.push(check.error)
        continue
      }
      newDocs.push(createUploadedDocumentFromFile(file))
    }

    if (errors.length > 0) {
      setUploadError(errors.join(' '))
    } else {
      setUploadError(null)
    }
    if (newDocs.length === 0) return

    setUploadDocuments((prev) => [...prev, ...newDocs])
    setUploadProcessing(true)

    for (const doc of newDocs) {
      const controller = new AbortController()
      processingControllersRef.current.set(doc.id, controller)
      void runMockDocumentProcessing(
        doc,
        (updated) => {
          setUploadDocuments((prev) =>
            prev.map((row) => (row.id === updated.id ? updated : row)),
          )
        },
        controller.signal,
      ).finally(() => {
        processingControllersRef.current.delete(doc.id)
      })
    }
  }

  function removeUploadDocument(id: string) {
    processingControllersRef.current.get(id)?.abort()
    processingControllersRef.current.delete(id)
    setUploadDocuments((prev) => prev.filter((doc) => doc.id !== id))
  }

  async function continueFromDocumentUpload() {
    if (uploadDocuments.length === 0) {
      setError('Upload at least one document, or choose Skip for now.')
      return
    }
    if (anyDocumentProcessing(uploadDocuments)) {
      return
    }
    setSaving(true)
    setError(null)
    setExtractionReview(buildOnboardingExtractionReview(uploadDocuments))
    await goTo('ai_review')
    setSaving(false)
  }

  async function skipDocumentUpload() {
    setError(null)
    setExtractionReview(emptyExtractionReview())
    await goTo('ai_review')
  }

  async function commitFastTrackImport(review: OnboardingExtractionReview): Promise<boolean> {
    setExtractionReview(review)
    setSaving(true)
    setError(null)

    const hasImport =
      review.properties.some((item) => item.selected) ||
      review.residents.some((item) => item.selected) ||
      review.vendors.some((item) => item.selected)

    let properties: OnboardingProperty[] = []

    if (hasImport) {
      const result = await importMockExtraction(toMockExtractionReview(review))
      if (!result.ok) {
        setSaving(false)
        setError(result.error ?? 'Import failed.')
        return false
      }

      properties = review.properties
        .filter((property) => property.selected)
        .map((property) => ({
          id: property.id,
          name: property.name,
          streetAddress: property.address.split(',')[0]?.trim() ?? property.address,
          city: 'East Orange',
          state: 'NJ',
          zipCode: '',
          unitCount: property.unitCount,
        }))

      await refreshCounts()
    }

    const [vendors, residents] = await Promise.all([
      fetchOnboardingVendors(),
      fetchOnboardingResidents(),
    ])
    const nextState: LandlordOnboardingState = { ...state, properties }
    setReviewData(buildOnboardingReviewData(nextState, vendors, residents))
    await goTo('review', { properties })
    setSaving(false)
    return true
  }

  async function importSelectedFromReview() {
    if (!extractionReview) return
    if (countSelectedInReview(extractionReview) === 0) {
      setError('Select at least one item to import.')
      return
    }
    setImportingPortfolio(true)
    setError(null)
    try {
      await commitFastTrackImport(extractionReview)
    } finally {
      setImportingPortfolio(false)
    }
  }

  async function importAllFromReview() {
    if (!extractionReview) return
    setImportingPortfolio(true)
    setError(null)
    try {
      await commitFastTrackImport(setAllReviewSelections(extractionReview, true))
    } finally {
      setImportingPortfolio(false)
    }
  }

  async function skipImportFromReview() {
    const snapshot = extractionReview
    const reviewForImport = snapshot
      ? setAllReviewSelections(snapshot, false)
      : emptyExtractionReview()
    const ok = await commitFastTrackImport(reviewForImport)
    if (ok && snapshot) {
      setExtractionReview(snapshot)
    }
  }

  async function saveVendorsAndContinue() {
    if (!supabase) {
      setError('Database unavailable.')
      return
    }

    const vendorsToSave = vendorForms.filter((form) => form.name.trim())
    for (const form of vendorForms) {
      const hasPartialData =
        form.name.trim() ||
        form.category.trim() ||
        form.email.trim() ||
        form.phone.trim()
      if (hasPartialData && !form.name.trim()) {
        setError('Each vendor needs a name, or clear empty vendor rows.')
        return
      }
    }

    setSaving(true)
    setError(null)

    const existingVendors = await fetchOnboardingVendors()
    const existingByName = new Map(
      existingVendors.map((vendor) => [vendor.name.trim().toLowerCase(), vendor]),
    )

    const vendorPhones: Array<{ phone: string | null }> = []
    for (const form of vendorsToSave) {
      const phoneResult = phoneForDbOrError(form.phone)
      if (phoneResult.error) {
        setSaving(false)
        setError(`${form.name.trim()}: ${phoneResult.error}`)
        return
      }
      vendorPhones.push({ phone: phoneResult.phone })
    }

    for (let i = 0; i < vendorsToSave.length; i++) {
      const form = vendorsToSave[i]!
      const payload = {
        name: form.name.trim(),
        category: vendorTradeToDbCategory(form.category),
        email: form.email.trim() || null,
        phone: vendorPhones[i]!.phone,
        notification_channel: 'both' as const,
        active: true,
      }

      if (isPersistedVendorId(form.id)) {
        const { error: updateError } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', form.id)
          .eq('landlord_id', getActiveLandlordId())
        if (updateError) {
          setSaving(false)
          setError(updateError.message)
          return
        }
        continue
      }

      const existing = existingByName.get(form.name.trim().toLowerCase())
      if (existing) {
        const { error: updateError } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', existing.id)
          .eq('landlord_id', getActiveLandlordId())
        if (updateError) {
          setSaving(false)
          setError(updateError.message)
          return
        }
        continue
      }

      const { error: insertError } = await supabase.from('vendors').insert({
        ...payload,
        landlord_id: getActiveLandlordId(),
      })
      if (insertError) {
        setSaving(false)
        setError(insertError.message)
        return
      }
    }

    await refreshCounts()
    const savedVendors = await fetchOnboardingVendors()
    const savedVendorForms = dedupeVendorForms(
      savedVendors.length > 0 ? savedVendors.map(vendorToFormRow) : [createEmptyVendorForm()],
    )
    setVendorForms(savedVendorForms)
    setSaving(false)
    if (editingFromReviewRef.current) {
      await returnToReviewAfterEdit()
      return
    }
    await goTo('residents', {}, { vendorForms: savedVendorForms })
  }

  function updateVendorForm(id: string, patch: Partial<VendorFormRow>) {
    setVendorForms((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function addVendorForm() {
    setVendorForms((prev) => [...prev, createEmptyVendorForm()])
  }

  function removeVendorForm(id: string) {
    if (vendorForms.length <= 1) return
    setVendorForms((prev) => prev.filter((row) => row.id !== id))
    if (isPersistedVendorId(id) && supabase) {
      void supabase
        .from('vendors')
        .delete()
        .eq('id', id)
        .eq('landlord_id', getActiveLandlordId())
        .then(({ error: deleteError }) => {
          if (deleteError) {
            setError(deleteError.message)
            return
          }
          void refreshCounts()
        })
    }
  }

  async function saveResidentsAndContinue() {
    if (!supabase) {
      setError('Database unavailable.')
      return
    }

    const residentsToSave = residentForms.filter((form) => form.fullName.trim())
    for (const form of residentForms) {
      const hasPartialData =
        form.fullName.trim() ||
        form.unit.trim() ||
        form.email.trim() ||
        form.phone.trim()
      if (hasPartialData && !form.fullName.trim()) {
        setError('Each resident needs a name, or clear empty resident rows.')
        return
      }
    }

    setSaving(true)
    setError(null)

    const building = state.properties[0]?.name ?? propertyForms[0]?.name.trim() ?? ''
    const landlordId = getActiveLandlordId()
    const existingResidents = await fetchOnboardingResidents(landlordId)
    let nextResidentSequence = maxOnboardingResidentSequence(existingResidents)
    const residentPhones: Array<{ phone: string | null }> = []
    for (const form of residentsToSave) {
      const phoneResult = phoneForDbOrError(form.phone)
      if (phoneResult.error) {
        setSaving(false)
        setError(`${form.fullName.trim()}: ${phoneResult.error}`)
        return
      }
      residentPhones.push({ phone: phoneResult.phone })
    }

    for (let i = 0; i < residentsToSave.length; i++) {
      const form = residentsToSave[i]!
      const phone = residentPhones[i]!.phone
      const unit = form.unit.trim() || null

      if (isPersistedVendorId(form.id)) {
        const { error: updateError } = await supabase
          .from('users')
          .update({
            full_name: form.fullName.trim(),
            email: residentEmailForDb(form.email, form.residentId ?? 'ONB-000'),
            phone,
            unit,
            building: building || null,
          })
          .eq('id', form.id)
          .eq('landlord_id', landlordId)
        if (updateError) {
          setSaving(false)
          setError(updateError.message)
          return
        }
        continue
      }

      nextResidentSequence += 1
      const residentId = nextOnboardingResidentIdFromSequence(nextResidentSequence)
      const { error: insertError } = await supabase.from('users').insert({
        resident_id: residentId,
        full_name: form.fullName.trim(),
        email: residentEmailForDb(form.email, residentId),
        phone,
        unit,
        building: building || null,
        status: 'active',
        balance_due: 0,
        issues: [],
        landlord_id: landlordId,
      })
      if (insertError) {
        setSaving(false)
        setError(insertError.message)
        return
      }
    }

    const [savedVendors, savedResidents] = await Promise.all([
      fetchOnboardingVendors(),
      fetchOnboardingResidents(),
    ])
    setResidentForms(
      savedResidents.length > 0 ? savedResidents.map(residentToFormRow) : [createEmptyResidentForm()],
    )
    setSaving(false)
    await continueToReview({ vendors: savedVendors, residents: savedResidents })
  }

  function updateResidentForm(id: string, patch: Partial<ResidentFormRow>) {
    setResidentForms((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function addResidentForm() {
    setResidentForms((prev) => [...prev, createEmptyResidentForm()])
  }

  function removeResidentForm(id: string) {
    if (residentForms.length <= 1) return
    setResidentForms((prev) => prev.filter((row) => row.id !== id))
    if (isPersistedVendorId(id) && supabase) {
      void supabase
        .from('users')
        .delete()
        .eq('id', id)
        .eq('landlord_id', getActiveLandlordId())
        .then(({ error: deleteError }) => {
          if (deleteError) {
            setError(deleteError.message)
            return
          }
          void refreshCounts()
        })
    }
  }

  async function continueToReview(cached?: {
    vendors: OnboardingVendor[]
    residents: OnboardingResident[]
  }) {
    clearReviewEditMode()
    let snapshot = state
    setState((prev) => {
      snapshot = prev
      return prev
    })

    const [vendors, residents] = cached
      ? [cached.vendors, cached.residents]
      : await Promise.all([fetchOnboardingVendors(), fetchOnboardingResidents()])

    setReviewData(buildOnboardingReviewData(snapshot, vendors, residents))
    await goTo('review')
  }

  async function returnToReviewAfterEdit(patch: Partial<LandlordOnboardingState> = {}) {
    clearReviewEditMode()
    setSaving(true)
    setError(null)

    let snapshot = state
    setState((prev) => {
      snapshot = { ...prev, ...patch }
      return snapshot
    })

    const [vendors, residents] = await Promise.all([
      fetchOnboardingVendors(),
      fetchOnboardingResidents(),
    ])
    const nextState: LandlordOnboardingState = { ...snapshot, ...patch }
    setReviewData(buildOnboardingReviewData(nextState, vendors, residents))
    await goTo('review', patch)
    await refreshCounts()
    setSaving(false)
  }

  async function editReviewStep(targetStep: OnboardingStep) {
    setError(null)
    enterReviewEditMode(targetStep)

    if (targetStep === 'account_setup' && reviewData) {
      setState((prev) => ({ ...prev, accountSetup: reviewData.accountSetup }))
    }
    if (targetStep === 'property') {
      const properties = reviewData?.properties.length
        ? reviewData.properties
        : state.properties
      if (properties.length > 0) {
        setPropertyForms(propertyFormsFromState(properties))
      }
    }
    if (targetStep === 'vendors' && reviewData?.vendors.length) {
      setVendorForms(dedupeVendorForms(reviewData.vendors.map(vendorToFormRow)))
    }
    if (targetStep === 'residents') {
      const snap = wizardSnapshotRef.current
      await goTo(
        'residents',
        {},
        {
          residentForms: pickResidentFormsForStep(snap.residentForms, reviewData?.residents),
        },
      )
      return
    }
    await goTo(targetStep)
  }

  async function finishReview() {
    const data = reviewData ?? (await fetchOnboardingReviewData())
    const reviewState: LandlordOnboardingState = {
      ...state,
      accountSetup: data.accountSetup,
      properties: data.properties,
    }
    const check = canCompleteOnboarding(reviewState, data.vendors, data.residents, data.metrics)
    if (!check.ok) {
      setError(`Complete required setup: ${check.missing.join(', ')}`)
      return
    }
    if (wizardRemoteSaveTimer.current != null) {
      window.clearTimeout(wizardRemoteSaveTimer.current)
      wizardRemoteSaveTimer.current = null
    }
    const transitionStartedAt = Date.now()
    setCompletingSetup(true)
    setSaving(true)
    const result = await completeOnboarding(reviewState, data.vendors, data.residents, data.metrics)
    if (!result.ok) {
      setCompletingSetup(false)
      setSaving(false)
      setError(result.error ?? 'Could not complete onboarding.')
      return
    }
    const completedState: LandlordOnboardingState = {
      ...reviewState,
      onboardingStatus: 'completed',
      currentStep: 'review',
      completedAt: new Date().toISOString(),
    }
    setState(completedState)
    persistOnboardingWizardLocally(completedState)
    const remainingMs = SETUP_COMPLETE_TRANSITION_MS - (Date.now() - transitionStartedAt)
    if (remainingMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, remainingMs))
    }
    navigate('/admin', { replace: true })
  }

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-[14px] text-[#6a7282]">Loading onboarding…</p>
      </main>
    )
  }

  if (completingSetup) {
    return <OnboardingSetupTransition />
  }

  if (importingPortfolio) {
    return (
      <OnboardingSetupTransition
        title="Importing your portfolio"
        subtitle="Creating properties, residents, and vendors…"
      />
    )
  }

  return (
    <main
      className={
        isWelcomeStep
          ? 'flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10 sm:px-8 sm:py-16'
          : 'flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8'
      }
    >
      <div
        className={
          isWelcomeStep ? 'w-full max-w-[880px]' : isReviewStep ? 'mx-auto w-full max-w-[760px]' : 'mx-auto w-full max-w-3xl'
        }
      >
        {!isWelcomeStep && !isReviewStep ? (
          <div className="mb-6">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-[24px] font-semibold tracking-[-0.4px] text-[#101828]">
                {editingFromReview ? 'Edit your setup' : 'Set up Ulo for your portfolio'}
              </h1>
              {isComplete ? (
                <Link to="/admin" className={`${btnSecondary} shrink-0`}>
                  Go to dashboard
                </Link>
              ) : null}
            </div>
            {!editingFromReview ? (
              <OnboardingStepIndicator current={step} setupPath={state.setupPath} className="mb-0 mt-4" />
            ) : (
              <p className="mt-2 text-[14px] text-[#6a7282]">
                Update this section, then save to return to your review summary.
              </p>
            )}
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
            {error}
          </div>
        ) : null}

        {step === 'entry' ? (
          <OnboardingWelcomeHub
            onStartScratch={() => void handleStartScratch()}
            onStartFastTrack={() => void handleStartFastTrack()}
          />
        ) : null}

        {step === 'account_setup' ? (
          <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <h2 className="text-[18px] font-semibold text-[#101828]">Account setup</h2>
            <p className="mt-1 text-[14px] text-[#6a7282]">
              Tell us about your organization before adding properties and people.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <input
                className={`${inputClass} sm:col-span-2`}
                value={state.accountSetup.companyName}
                onChange={(e) => updateAccountSetup({ companyName: e.target.value })}
                placeholder="Company name"
                aria-label="Company name"
              />
              <input
                className={inputClass}
                value={state.accountSetup.contactName}
                onChange={(e) => updateAccountSetup({ contactName: e.target.value })}
                placeholder="Your name"
                aria-label="Your name"
              />
              <input
                className={inputClass}
                type="email"
                value={state.accountSetup.email}
                onChange={(e) => updateAccountSetup({ email: e.target.value })}
                placeholder="Email"
                aria-label="Email"
              />
              <div className="flex flex-col gap-2 sm:col-span-2">
                <input
                  className={inputClass}
                  type="tel"
                  autoComplete="tel"
                  value={state.accountSetup.phone}
                  onChange={(e) => updateAccountSetup({ phone: e.target.value })}
                  placeholder="(555) 123-4567"
                  aria-label="Phone"
                  aria-describedby={`${smsConsentCheckboxId}-disclosure`}
                />
                <p
                  id={`${smsConsentCheckboxId}-disclosure`}
                  className="text-[12px] leading-[18px] tracking-[-0.01em] text-[#6a7282]"
                >
                  By signing up, you agree to receive recurring SMS messages from Ulo related to
                  account verification, maintenance requests, vendor coordination, work order
                  updates, appointment reminders, and other property management notifications.
                  Consent is not a condition of purchase. Reply STOP to opt out. Reply HELP for
                  help. Message frequency varies. Message and data rates may apply.                   View our{' '}
                  <Link
                    to={TERMS_PRIVACY_SECTION_PATH}
                    className="font-medium text-[#9E439F] underline underline-offset-2 hover:text-[#7f3680]"
                  >
                    Privacy Policy
                  </Link>{' '}
                  and{' '}
                  <Link
                    to="/terms"
                    className="font-medium text-[#9E439F] underline underline-offset-2 hover:text-[#7f3680]"
                  >
                    Terms of Service
                  </Link>
                  .
                </p>
                <label
                  htmlFor={smsConsentCheckboxId}
                  className="flex cursor-pointer items-start gap-2.5 pt-1"
                >
                  <input
                    id={smsConsentCheckboxId}
                    type="checkbox"
                    checked={smsConsentAccepted}
                    onChange={(e) => {
                      setSmsConsentAccepted(e.target.checked)
                      if (e.target.checked) {
                        setError((prev) =>
                          prev === 'Please agree to the SMS terms to continue.' ? null : prev,
                        )
                      }
                    }}
                    aria-describedby={`${smsConsentCheckboxId}-disclosure`}
                    className={`${checkboxInputClassName} mt-0.5 accent-[#9E439F]`}
                  />
                  <span className="text-[12px] leading-[18px] text-[#364153]">
                    I agree to receive SMS messages as described above.
                  </span>
                </label>
              </div>
            </div>
            <OnboardingStepNav
              showBack={showBackButton}
              onBack={() => void handleBack()}
              saving={saving}
            >
              <OnboardingContinueButton
                disabled={saving || !smsConsentAccepted}
                onClick={() => void saveAccountSetup()}
              >
                {editContinueLabel ?? 'Continue'}
              </OnboardingContinueButton>
            </OnboardingStepNav>
          </section>
        ) : null}

        {step === 'document_upload' ? (
          <OnboardingDocumentUploadStep
            documents={uploadDocuments}
            processing={uploadProcessing || saving}
            uploadError={uploadError}
            onFilesSelected={queueDocumentUploads}
            onRemoveDocument={removeUploadDocument}
            onBack={() => void handleBack()}
            onContinue={() => void continueFromDocumentUpload()}
            onSkip={() => void skipDocumentUpload()}
          />
        ) : null}

        {step === 'ai_review' && extractionReview ? (
          <OnboardingAiReviewStep
            review={extractionReview}
            saving={saving}
            onReviewChange={setExtractionReview}
            onBackToUploads={() => void goTo('document_upload')}
            onImportSelected={() => void importSelectedFromReview()}
            onImportAll={() => void importAllFromReview()}
            onSkipImport={() => void skipImportFromReview()}
          />
        ) : null}

        {step === 'property' ? (
          <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <h2 className="text-[18px] font-semibold text-[#101828]">Add your properties</h2>
            <p className="mt-1 text-[14px] text-[#6a7282]">
              Tell us about the properties you manage. You can always add more properties later.
            </p>

            <div className="mt-4 flex flex-col gap-4">
              {propertyForms.map((form, index) => (
                <div key={form.id} className="rounded-[10px] border border-[#e5e7eb] p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-[14px] font-semibold text-[#101828]">Property {index + 1}</p>
                    {propertyForms.length > 1 ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-[8px] px-2 py-1 text-[13px] font-medium text-[#64748b] transition-colors hover:bg-[#fef2f2] hover:text-[#b91c1c] active:bg-[#fee2e2]"
                        onClick={() => removePropertyForm(form.id)}
                        aria-label={`Remove property ${index + 1}`}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className={fieldLabelClass}>Property name</span>
                      <input
                        className={inputClass}
                        value={form.name}
                        onChange={(e) => updatePropertyForm(form.id, { name: e.target.value })}
                        placeholder="Riverside Lofts"
                        aria-label={`Property ${index + 1} name`}
                      />
                    </label>
                    <label className="block">
                      <span className={fieldLabelClass}>Address</span>
                      <input
                        className={inputClass}
                        value={form.address}
                        onChange={(e) => updatePropertyForm(form.id, { address: e.target.value })}
                        placeholder="123 Main St, City"
                        aria-label={`Property ${index + 1} address`}
                      />
                    </label>
                    <label className="block">
                      <span className={fieldLabelClass}>Type</span>
                      <div className="relative">
                        <select
                          className={selectClass}
                          value={form.propertyType}
                          onChange={(e) => updatePropertyForm(form.id, { propertyType: e.target.value })}
                          aria-label={`Property ${index + 1} type`}
                        >
                          {PROPERTY_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]" aria-hidden>
                          <svg viewBox="0 0 24 24" fill="none" className="size-4">
                            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                          </svg>
                        </span>
                      </div>
                    </label>
                    <label className="block">
                      <span className={fieldLabelClass}>Total units</span>
                      <input
                        className={inputClass}
                        type="number"
                        min={1}
                        value={form.unitCount}
                        onChange={(e) => updatePropertyForm(form.id, { unitCount: e.target.value })}
                        placeholder="48"
                        aria-label={`Property ${index + 1} total units`}
                      />
                    </label>
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="w-full rounded-[10px] border border-[#e5e7eb] bg-white py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] active:bg-[#f3f4f6]"
                onClick={addPropertyForm}
              >
                + Add another property
              </button>
            </div>
            <OnboardingStepNav
              showBack={showBackButton}
              onBack={() => void handleBack()}
              saving={saving}
            >
              <OnboardingContinueButton disabled={saving} onClick={() => void saveProperty()}>
                {editContinueLabel ?? 'Save & continue'}
              </OnboardingContinueButton>
            </OnboardingStepNav>
          </section>
        ) : null}

        {step === 'vendors' ? (
          <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <h2 className="text-[18px] font-semibold text-[#101828]">Add vendors</h2>
            <p className="mt-1 text-[14px] text-[#6a7282]">
            Tell us about the vendors you work with for repairs, maintenance, and property services.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              {vendorForms.map((form, index) => (
                <div key={form.id} className="rounded-[10px] border border-[#e5e7eb] p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-[14px] font-semibold text-[#101828]">Vendor {index + 1}</p>
                    {vendorForms.length > 1 ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-[8px] px-2 py-1 text-[13px] font-medium text-[#64748b] transition-colors hover:bg-[#fef2f2] hover:text-[#b91c1c] active:bg-[#fee2e2]"
                        onClick={() => removeVendorForm(form.id)}
                        aria-label={`Remove vendor ${index + 1}`}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <input
                      className={`${inputClass} sm:col-span-2`}
                      value={form.name}
                      onChange={(e) => updateVendorForm(form.id, { name: e.target.value })}
                      placeholder="Vendor name"
                      aria-label={`Vendor ${index + 1} name`}
                    />
                    <div className="relative">
                      <select
                        className={`${selectClass} ${!form.category ? 'text-[#9ca3af]' : ''}`}
                        value={form.category}
                        onChange={(e) => updateVendorForm(form.id, { category: e.target.value })}
                        aria-label={`Vendor ${index + 1} trade`}
                      >
                        {VENDOR_TRADE_OPTIONS.map((option) => (
                          <option key={option.value || 'placeholder'} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]" aria-hidden>
                        <svg viewBox="0 0 24 24" fill="none" className="size-4">
                          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                        </svg>
                      </span>
                    </div>
                    <input
                      className={inputClass}
                      value={form.phone}
                      onChange={(e) => updateVendorForm(form.id, { phone: e.target.value })}
                      placeholder="(555) 123-4567"
                      aria-label={`Vendor ${index + 1} phone`}
                    />
                    <input
                      className={`${inputClass} sm:col-span-2`}
                      type="email"
                      value={form.email}
                      onChange={(e) => updateVendorForm(form.id, { email: e.target.value })}
                      placeholder="Email"
                      aria-label={`Vendor ${index + 1} email`}
                    />
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="w-full rounded-[10px] border border-[#e5e7eb] bg-white py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] active:bg-[#f3f4f6]"
                onClick={addVendorForm}
              >
                + Add another vendor
              </button>
            </div>
            <OnboardingStepNav
              showBack={showBackButton}
              onBack={() => void handleBack()}
              saving={saving}
            >
              <OnboardingContinueButton disabled={saving} onClick={() => void saveVendorsAndContinue()}>
                {editContinueLabel ?? 'Continue'}
              </OnboardingContinueButton>
            </OnboardingStepNav>
          </section>
        ) : null}

        {step === 'residents' ? (
          <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <h2 className="text-[18px] font-semibold text-[#101828]">Add residents</h2>
            <p className="mt-1 text-[14px] text-[#6a7282]">
              Residents receive maintenance updates and can report issues by text.
            </p>
            <div className="mt-4 flex flex-col gap-4">
              {residentForms.map((form, index) => (
                <div key={form.id} className="rounded-[10px] border border-[#e5e7eb] p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-[14px] font-semibold text-[#101828]">Resident {index + 1}</p>
                    {residentForms.length > 1 ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-[8px] px-2 py-1 text-[13px] font-medium text-[#64748b] transition-colors hover:bg-[#fef2f2] hover:text-[#b91c1c] active:bg-[#fee2e2]"
                        onClick={() => removeResidentForm(form.id)}
                        aria-label={`Remove resident ${index + 1}`}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <input
                      className={`${inputClass} sm:col-span-2`}
                      value={form.fullName}
                      onChange={(e) => updateResidentForm(form.id, { fullName: e.target.value })}
                      placeholder="Full name"
                      aria-label={`Resident ${index + 1} full name`}
                    />
                    <input
                      className={inputClass}
                      value={form.unit}
                      onChange={(e) => updateResidentForm(form.id, { unit: e.target.value })}
                      placeholder="Unit"
                      aria-label={`Resident ${index + 1} unit`}
                    />
                    <input
                      className={inputClass}
                      value={form.phone}
                      onChange={(e) => updateResidentForm(form.id, { phone: e.target.value })}
                      placeholder="(555) 123-4567"
                      aria-label={`Resident ${index + 1} phone`}
                    />
                    <input
                      className={`${inputClass} sm:col-span-2`}
                      type="email"
                      value={form.email}
                      onChange={(e) => updateResidentForm(form.id, { email: e.target.value })}
                      placeholder="Email"
                      aria-label={`Resident ${index + 1} email`}
                    />
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="w-full rounded-[10px] border border-[#e5e7eb] bg-white py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] active:bg-[#f3f4f6]"
                onClick={addResidentForm}
              >
                + Add another resident
              </button>
            </div>
            <OnboardingStepNav
              showBack={showBackButton}
              onBack={() => void handleBack()}
              saving={saving}
            >
              <OnboardingContinueButton disabled={saving} onClick={() => void saveResidentsAndContinue()}>
                {editContinueLabel ?? 'Continue to review'}
              </OnboardingContinueButton>
            </OnboardingStepNav>
          </section>
        ) : null}

        {step === 'review' ? (
          <OnboardingReviewStep
            loading={reviewLoading}
            saving={saving}
            reviewData={reviewData}
            completionDisabled={!completionCheck.ok}
            completionMissing={completionCheck.missing}
            onEditStep={(targetStep) => void editReviewStep(targetStep)}
            onBack={() => void handleBack()}
            onComplete={() => void finishReview()}
          />
        ) : null}
      </div>
    </main>
  )
}
