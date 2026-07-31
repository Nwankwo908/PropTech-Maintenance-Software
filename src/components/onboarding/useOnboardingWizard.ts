/**
 * Onboarding wizard process — load, persist, navigate, review-edit, complete.
 * Step screens stay presentational; this hook owns the flow.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  anyDocumentProcessing,
  buildOnboardingExtractionReview,
  createUploadedDocumentFromFile,
  persistOnboardingDocumentFile,
  emptyExtractionReview,
  isAcceptedUploadFile,
  normalizeExtractionReview,
  runMockDocumentProcessing,
  toMockExtractionReview,
  hasExtractionReviewData,
  summarizeReviewSelections,
  type OnboardingExtractionReview,
  type OnboardingUploadedDocument,
} from '@/lib/onboardingDocumentUpload'
import {
  accountSetupFromReviewManual,
  validateReviewManualAccount,
} from '@/lib/onboardingReviewManual'
import {
  createEmptyPropertyForm,
  normalizePropertyFormRow,
  propertyFormsFromState,
  type PropertyFormRow,
} from '@/components/onboarding/onboardingPropertyForm'
import {
  createEmptyVendorForm,
  dedupeVendorForms,
  vendorToFormRow,
  type VendorFormRow,
} from '@/components/onboarding/onboardingVendorForm'
import {
  createEmptyResidentForm,
  pickResidentFormsForStep,
  readPersistedResidentForms,
  residentFormsHaveData,
  residentToFormRow,
  type ResidentFormRow,
} from '@/components/onboarding/onboardingResidentForm'
import {
  fetchLandlordStripeConnectStatus,
  primaryPayoutMethodLabel,
} from '@/api/landlordStripeConnect'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  buildOnboardingReviewData,
  canCompleteOnboarding,
  completeOnboarding,
  defaultOnboardingState,
  fetchAccountSetupCounts,
  fetchLandlordOnboarding,
  fetchOnboardingReviewData,
  fetchOnboardingReviewSupplement,
  fetchOnboardingResidents,
  fetchOnboardingVendors,
  clearOnboardingPortfolioSession,
  clearOnboardingResetGuard,
  fetchLandlordSmsIntakeNumber,
  getPreviousOnboardingStep,
  isLandlordStripePayoutsReady,
  isOnboardingResetInProgress,
  importMockExtraction,
  normalizeOnboardingStep,
  listOnboardingUnitOptions,
  persistLandlordAccountProfile,
  persistOnboardingProperties,
  persistOnboardingWizardLocally,
  readLocalOnboardingState,
  requireOnboardingLandlord,
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
} from '@/lib/onboarding'
import { supabase } from '@/lib/supabase'
import { type OnboardingApprovalRules } from '@/lib/onboardingApprovalRules'

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
    setters.setPropertyForms(draft.propertyForms.map(normalizePropertyFormRow))
  } else if (onboarding.properties.length > 0) {
    setters.setPropertyForms(propertyFormsFromState(onboarding.properties))
  }
}

const SETUP_COMPLETE_TRANSITION_MS = 5000

export function useOnboardingWizard() {
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
  const [payoutsReady, setPayoutsReady] = useState(false)
  const [payoutMethodLabel, setPayoutMethodLabel] = useState<string | null>(null)
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

  const storedStep = normalizeOnboardingStep(state.currentStep)
  // After Reset, status is not_started — always show the path-choice hub even if
  // a stale current_step lingered in a draft for one paint.
  const step =
    editingFromReview && reviewEditStep != null
      ? reviewEditStep
      : state.onboardingStatus === 'not_started'
        ? 'entry'
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
    payoutsReady,
  )
  const isWelcomeStep = step === 'entry'
  const isReviewStep = step === 'review'
  const isComplete = state.onboardingStatus === 'completed'
  const showBackButton =
    editingFromReview ||
    (step !== 'entry' && getPreviousOnboardingStep(step, state.setupPath) != null)
  const editContinueLabel = editingFromReview ? 'Save and return to review' : undefined
  const propertyNames = state.properties
    .map((property) => property.name.trim())
    .filter(Boolean)
  const unitOptions = listOnboardingUnitOptions(state.properties)
  const multiPropertyPortfolio = propertyNames.length > 1

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
    if (isOnboardingResetInProgress()) return
    const snap = wizardSnapshotRef.current
    if (snap.state.onboardingStatus === 'not_started' && snap.state.currentStep === 'entry') {
      return
    }
    const formDraft = buildWizardFormDraft(snap.propertyForms, snap.vendorForms, snap.residentForms, snap)
    persistOnboardingWizardLocally(snap.state, formDraft)

    if (wizardRemoteSaveTimer.current != null) {
      window.clearTimeout(wizardRemoteSaveTimer.current)
    }
    wizardRemoteSaveTimer.current = window.setTimeout(() => {
      if (isOnboardingResetInProgress()) return
      const latest = wizardSnapshotRef.current
      if (latest.state.onboardingStatus === 'not_started' && latest.state.currentStep === 'entry') {
        return
      }
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
    const cancelPendingSaves = () => {
      if (wizardRemoteSaveTimer.current != null) {
        window.clearTimeout(wizardRemoteSaveTimer.current)
        wizardRemoteSaveTimer.current = null
      }
    }
    window.addEventListener('ulo:onboarding-reset', cancelPendingSaves)
    return () => window.removeEventListener('ulo:onboarding-reset', cancelPendingSaves)
  }, [])

  useEffect(() => {
    if (loading) return

    const flush = () => {
      // Reset navigates away with a hard reload; do not write the old wizard back.
      if (isOnboardingResetInProgress()) return
      const snap = wizardSnapshotRef.current
      if (snap.state.onboardingStatus === 'not_started' && snap.state.currentStep === 'entry') {
        return
      }
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
      clearOnboardingResetGuard()

      const onWelcome =
        onboarding.onboardingStatus === 'not_started' ||
        normalizeOnboardingStep(onboarding.currentStep) === 'entry'
      const localSnapshot = readLocalOnboardingState()
      const localInProgress =
        localSnapshot != null &&
        localSnapshot.onboardingStatus === 'in_progress' &&
        normalizeOnboardingStep(localSnapshot.currentStep) !== 'entry'
      const counts = onWelcome && !localInProgress ? await fetchAccountSetupCounts() : null
      const hasStalePortfolio =
        onWelcome &&
        !localInProgress &&
        (onboarding.properties.length > 0 ||
          (counts != null &&
            (counts.properties > 0 ||
              counts.units > 0 ||
              counts.residents > 0 ||
              counts.vendors > 0 ||
              counts.workflowRuns > 0)))

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
        normalizeOnboardingStep(onboarding.currentStep),
        onboarding.setupPath,
      )
      const normalizedOnboarding =
        resolvedStep === normalizeOnboardingStep(onboarding.currentStep)
          ? onboarding
          : { ...onboarding, currentStep: resolvedStep }
      setState(normalizedOnboarding)
      if (normalizedOnboarding !== onboarding) {
        void saveLandlordOnboarding(normalizedOnboarding)
      }
      if (normalizedOnboarding.accountSetup.smsConsentAcceptedAt) {
        setSmsConsentAccepted(true)
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
      setPropertyForms(state.formDraft.propertyForms.map(normalizePropertyFormRow))
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
    if (residentFormsHaveData(residentForms)) {
      const defaultBuilding = state.properties[0]?.name?.trim() ?? ''
      if (
        defaultBuilding &&
        state.properties.length === 1 &&
        residentForms.some((form) => !form.building.trim())
      ) {
        setResidentForms((prev) =>
          prev.map((form) =>
            form.building.trim() ? form : { ...form, building: defaultBuilding },
          ),
        )
      }
      return
    }

    let cancelled = false
    void (async () => {
      const dbResidents = await fetchOnboardingResidents()
      if (cancelled) return
      if (residentFormsHaveData(wizardSnapshotRef.current.residentForms)) return

      const defaultBuilding = state.properties[0]?.name?.trim() ?? ''
      if (dbResidents.length > 0) {
        setResidentForms(
          dbResidents.map((resident) => {
            const row = residentToFormRow(resident)
            return row.building.trim()
              ? row
              : { ...row, building: defaultBuilding }
          }),
        )
        return
      }

      const persistedForms = readPersistedResidentForms(state.formDraft)
      if (persistedForms) {
        setResidentForms(
          persistedForms.map((form) =>
            form.building.trim() ? form : { ...form, building: defaultBuilding },
          ),
        )
        return
      }

      setResidentForms([createEmptyResidentForm(defaultBuilding)])
    })()

    return () => {
      cancelled = true
    }
  }, [loading, step, state.formDraft, state.properties])

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
    if (extractionReview) {
      if (!extractionReview.account) {
        setExtractionReview(normalizeExtractionReview(extractionReview, state.accountSetup))
      }
      return
    }
    const persistedExtraction = readPersistedExtractionReview(state.formDraft)
    if (persistedExtraction) {
      setExtractionReview(normalizeExtractionReview(persistedExtraction, state.accountSetup))
      return
    }
    if (uploadDocuments.length > 0) {
      setExtractionReview(
        buildOnboardingExtractionReview(uploadDocuments, state.accountSetup),
      )
      return
    }
    setExtractionReview(emptyExtractionReview(state.accountSetup))
  }, [loading, step, extractionReview, uploadDocuments, state.formDraft, state.accountSetup])

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
      const [supplement, ready, stripeStatus] = await Promise.all([
        fetchOnboardingReviewSupplement(state),
        isLandlordStripePayoutsReady(state.landlordId),
        fetchLandlordStripeConnectStatus(state.landlordId).catch(() => null),
      ])
      if (cancelled) return
      setPayoutsReady(ready || stripeStatus?.ready === true)
      setPayoutMethodLabel(primaryPayoutMethodLabel(stripeStatus))
      setReviewData(
        buildOnboardingReviewData(
          state,
          supplement.vendors,
          supplement.residents,
          supplement.dbCounts,
          supplement.smsIntakeNumber,
        ),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [loading, step, state])

  // Stripe Connect return/refresh lands on /admin/onboarding?connect=…
  useEffect(() => {
    if (loading) return
    const connectParam = new URLSearchParams(window.location.search).get('connect')
    if (connectParam !== 'return' && connectParam !== 'refresh') return
    if (step === 'payouts') return
    void goTo('payouts')
    // Intentionally only when connect query is present after load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

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

  function updateApprovalRules(patch: Partial<OnboardingApprovalRules>) {
    setState((prev) => {
      const next: LandlordOnboardingState = {
        ...prev,
        approvalRules: { ...prev.approvalRules, ...patch },
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
      extractionReview?: OnboardingExtractionReview | null
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
    const draftSnap = {
      ...snap,
      extractionReview:
        forms?.extractionReview !== undefined ? forms.extractionReview : snap.extractionReview,
    }

    let next!: LandlordOnboardingState
    setState((prev) => {
      next = mergeOnboardingStep(prev, nextStep, {
        ...patch,
        formDraft: buildWizardFormDraft(
          draftPropertyForms,
          draftVendorForms,
          draftResidentForms,
          draftSnap,
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
    if (step === 'review' && previous === 'payouts') {
      await goTo('payouts')
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

  function queueDocumentUploads(files: FileList | File[]) {
    const errors: string[] = []
    const queued: { doc: OnboardingUploadedDocument; file: File }[] = []

    for (const file of Array.from(files)) {
      const check = isAcceptedUploadFile(file)
      if (!check.ok) {
        errors.push(check.error)
        continue
      }
      queued.push({ doc: createUploadedDocumentFromFile(file), file })
    }

    if (errors.length > 0) {
      setUploadError(errors.join(' '))
    } else {
      setUploadError(null)
    }
    if (queued.length === 0) return

    const newDocs = queued.map((item) => item.doc)
    setUploadDocuments((prev) => [...prev, ...newDocs])
    setUploadProcessing(true)

    const landlordId = getActiveLandlordId()
    for (const { doc, file } of queued) {
      const controller = new AbortController()
      processingControllersRef.current.set(doc.id, controller)
      void (async () => {
        const persisted = await persistOnboardingDocumentFile(landlordId, doc.id, file)
        if ('storagePath' in persisted) {
          setUploadDocuments((prev) =>
            prev.map((row) =>
              row.id === doc.id
                ? {
                    ...row,
                    storageBucket: persisted.storageBucket,
                    storagePath: persisted.storagePath,
                    contentType: file.type || row.contentType || null,
                  }
                : row,
            ),
          )
        } else {
          console.warn('[onboarding] document preview upload skipped', persisted.error)
        }

        const latest: OnboardingUploadedDocument = {
          ...doc,
          ...('storagePath' in persisted
            ? {
                storageBucket: persisted.storageBucket,
                storagePath: persisted.storagePath,
                contentType: file.type || doc.contentType || null,
              }
            : {}),
        }
        await runMockDocumentProcessing(
          latest,
          (updated) => {
            setUploadDocuments((prev) =>
              prev.map((row) =>
                row.id === updated.id
                  ? {
                      ...updated,
                      storageBucket: row.storageBucket ?? updated.storageBucket,
                      storagePath: row.storagePath ?? updated.storagePath,
                      contentType: row.contentType ?? updated.contentType,
                    }
                  : row,
              ),
            )
          },
          controller.signal,
        )
      })().finally(() => {
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
    setExtractionReview(
      buildOnboardingExtractionReview(uploadDocuments, state.accountSetup),
    )
    await goTo('ai_review')
    setSaving(false)
  }

  async function skipDocumentUpload() {
    setError(null)
    setExtractionReview(emptyExtractionReview(state.accountSetup))
    await goTo('ai_review')
  }

  async function commitFastTrackImport(review: OnboardingExtractionReview): Promise<boolean> {
    const scope = requireOnboardingLandlord()
    if (!scope.ok) {
      setError(scope.error)
      return false
    }

    const normalized = normalizeExtractionReview(review, state.accountSetup)
    const accountCheck = validateReviewManualAccount(normalized.account)
    if (!accountCheck.ok) {
      setError(accountCheck.error)
      return false
    }

    setExtractionReview(normalized)
    setSaving(true)
    setError(null)

    const selectionLog = summarizeReviewSelections(normalized)
    console.info('[onboarding] AI review continue selections', selectionLog)
    if (supabase) {
      try {
        const { recordActivityLog } = await import('@/lib/recordActivityLog')
        await recordActivityLog({
          landlordId: scope.landlordId,
          eventType: 'onboarding.extraction_review_continued',
          source: 'onboarding',
          actorType: 'landlord',
          metadata: {
            message: `Imported ${selectionLog.selected.total} item${
              selectionLog.selected.total === 1 ? '' : 's'
            }; skipped ${selectionLog.skipped.total}.`,
            step: 'ai_review',
            selected: selectionLog.selected,
            skipped: selectionLog.skipped,
            selected_ids: selectionLog.selectedIds,
            skipped_ids: selectionLog.skippedIds,
          },
        })
      } catch (err) {
        console.warn('[onboarding] selection log failed', err)
      }
    }

    const accountSetup = accountSetupFromReviewManual(normalized.account)
    const profile = await persistLandlordAccountProfile(scope.landlordId, accountSetup)
    if (!profile.ok) {
      setSaving(false)
      setError(profile.error ?? 'Could not save account details.')
      return false
    }

    const hasImport =
      normalized.properties.some((item) => item.selected) ||
      normalized.units.some((item) => item.selected) ||
      normalized.residents.some((item) => item.selected) ||
      normalized.vendors.some((item) => item.selected) ||
      normalized.leases.some((item) => item.selected) ||
      normalized.maintenanceIssues.some((item) => item.selected)

    let properties: OnboardingProperty[] = []

    if (hasImport) {
      // Only selected rows are imported (toMockExtractionReview filters by selected).
      const result = await importMockExtraction(toMockExtractionReview(normalized))
      if (!result.ok) {
        setSaving(false)
        setError(result.error ?? "We couldn't finish the import. Please try again.")
        return false
      }

      properties = normalized.properties
        .filter((property) => property.selected)
        .map((property) => ({
          id: property.id,
          name: property.name,
          streetAddress: property.address.split(',')[0]?.trim() ?? property.address,
          city: property.city.trim(),
          state: property.state.trim().toUpperCase(),
          zipCode: property.zipCode.trim(),
          unitCount: property.unitCount,
          propertyType: property.propertyType.trim() || 'multifamily',
          propertyManagerName: property.propertyManagerName.trim(),
          propertyManagerPhone: property.propertyManagerPhone.trim(),
        }))

      if (properties.length > 0) {
        const unitResult = await persistOnboardingProperties(properties)
        if (!unitResult.ok) {
          setSaving(false)
          setError(unitResult.error ?? 'Could not save property locations.')
          return false
        }
      }

      await refreshCounts()
    }

    await goTo(
      'approval',
      { properties, accountSetup },
      { extractionReview: normalized },
    )
    setSaving(false)
    return true
  }

  async function continueFromAiReview() {
    if (!extractionReview) return
    setImportingPortfolio(true)
    setError(null)
    try {
      // Honor current checkbox state — do not force-select everything.
      await commitFastTrackImport(extractionReview)
    } finally {
      setImportingPortfolio(false)
    }
  }

  async function continueToApprovalRules() {
    clearReviewEditMode()
    await goTo('approval')
  }

  async function saveApprovalRulesAndContinue(rules: LandlordOnboardingState['approvalRules']) {
    if (editingFromReviewRef.current) {
      await returnToReviewAfterEdit({ approvalRules: rules })
      return
    }
    clearReviewEditMode()
    await goTo('payouts', { approvalRules: rules })
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

    const [vendors, residents, smsIntakeNumber] = cached
      ? await Promise.all([
          Promise.resolve(cached.vendors),
          Promise.resolve(cached.residents),
          fetchLandlordSmsIntakeNumber(snapshot.landlordId),
        ])
      : await Promise.all([
          fetchOnboardingVendors(),
          fetchOnboardingResidents(),
          fetchLandlordSmsIntakeNumber(snapshot.landlordId),
        ])

    setReviewData(
      buildOnboardingReviewData(snapshot, vendors, residents, undefined, smsIntakeNumber),
    )
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

    const [vendors, residents, smsIntakeNumber] = await Promise.all([
      fetchOnboardingVendors(),
      fetchOnboardingResidents(),
      fetchLandlordSmsIntakeNumber(snapshot.landlordId),
    ])
    const nextState: LandlordOnboardingState = { ...snapshot, ...patch }
    setReviewData(
      buildOnboardingReviewData(nextState, vendors, residents, undefined, smsIntakeNumber),
    )
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
      approvalRules: data.approvalRules,
    }
    const ready = await isLandlordStripePayoutsReady(reviewState.landlordId)
    setPayoutsReady(ready)
    const check = canCompleteOnboarding(
      reviewState,
      data.vendors,
      data.residents,
      data.metrics,
      ready,
    )
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
    navigate('/admin', {
      replace: true,
      state: result.activationWarning
        ? { onboardingNotice: result.activationWarning }
        : undefined,
    })
  }


  return {
    // status
    loading,
    saving,
    setSaving,
    error,
    setError,
    completingSetup,
    importingPortfolio,
    // navigation / step
    step,
    state,
    isWelcomeStep,
    isReviewStep,
    isComplete,
    showBackButton,
    editContinueLabel,
    editingFromReview,
    editingFromReviewRef,
    // forms
    propertyForms,
    setPropertyForms,
    vendorForms,
    setVendorForms,
    residentForms,
    setResidentForms,
    propertyNames,
    unitOptions,
    multiPropertyPortfolio,
    smsConsentAccepted,
    setSmsConsentAccepted,
    smsConsentCheckboxId,
    updateAccountSetup,
    updateApprovalRules,
    // fast-track
    uploadDocuments,
    uploadProcessing,
    uploadError,
    extractionReview,
    setExtractionReview,
    queueDocumentUploads,
    removeUploadDocument,
    continueFromDocumentUpload,
    skipDocumentUpload,
    continueFromAiReview,
    // review / payouts
    reviewData,
    reviewLoading,
    completionCheck,
    payoutsReady,
    setPayoutsReady,
    payoutMethodLabel,
    setPayoutMethodLabel,
    // actions
    goTo,
    goBack: handleBack,
    handleStartScratch,
    handleStartFastTrack,
    handleBack,
    refreshCounts,
    returnToReviewAfterEdit,
    continueToApprovalRules,
    saveApprovalRulesAndContinue,
    continueToReview,
    editReviewStep,
    finishReview,
  }
}
