/**
 * Onboarding draft persistence — localStorage + landlord_onboarding row.
 */
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { loadCanonicalOnboardingProperties } from './hydrateProperties'
import {
  defaultOnboardingApprovalRules,
  normalizeOnboardingApprovalRules,
} from '@/lib/onboardingApprovalRules'
import { supabase } from '@/lib/supabase'
import { fetchAccountSetupCounts } from './persist/account'
import { isOnboardingLandlordAccount } from './scope'
import type {
  AccountSetupCounts,
  LandlordOnboardingState,
  OnboardingAccountSetup,
  OnboardingFormDraft,
  OnboardingProperty,
  OnboardingSetupPath,
  OnboardingStatus,
  OnboardingStep,
} from './types'
import { normalizeOnboardingStep } from './steps'

export {
  isOnboardingLandlordAccount,
  requireOnboardingLandlord,
} from './scope'

const LOCAL_STORAGE_PREFIX = 'ulo.landlordOnboarding.'

function localKey(landlordId: string): string {
  return `${LOCAL_STORAGE_PREFIX}${landlordId}`
}

/** Session flag so a beforeunload flush cannot resurrect a wiped wizard during Reset. */
const RESET_GUARD_KEY = 'ulo.onboarding.resetGuard'

export function markOnboardingResetInProgress(): void {
  try {
    window.sessionStorage.setItem(RESET_GUARD_KEY, String(Date.now()))
  } catch {
    // private mode
  }
}

export function clearOnboardingResetGuard(): void {
  try {
    window.sessionStorage.removeItem(RESET_GUARD_KEY)
  } catch {
    // private mode
  }
}

export function isOnboardingResetInProgress(): boolean {
  try {
    const raw = window.sessionStorage.getItem(RESET_GUARD_KEY)
    if (!raw) return false
    const startedAt = Number(raw)
    // Expire after 30s so a crashed reset cannot block saves forever.
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > 30_000) {
      window.sessionStorage.removeItem(RESET_GUARD_KEY)
      return false
    }
    return true
  } catch {
    return false
  }
}

export function clearLocalOnboardingStorage(landlordId: string = getActiveLandlordId()): void {
  try {
    window.localStorage.removeItem(localKey(landlordId))
  } catch {
    // private mode
  }
}

export function defaultOnboardingState(landlordId: string = getActiveLandlordId()): LandlordOnboardingState {
  return {
    landlordId,
    onboardingStatus: 'not_started',
    currentStep: 'entry',
    setupPath: null,
    accountSetup: {
      companyName: '',
      contactName: '',
      email: '',
      phone: '',
      backupContactName: '',
      backupContactPhone: '',
      smsConsentAcceptedAt: null,
    },
    properties: [],
    approvalRules: defaultOnboardingApprovalRules(),
    completedAt: null,
  }
}

function normalizeAccountSetup(raw: unknown): OnboardingAccountSetup {
  const defaults = defaultOnboardingState().accountSetup
  if (!raw || typeof raw !== 'object') return { ...defaults }
  const row = raw as Record<string, unknown>
  const consentRaw = row.smsConsentAcceptedAt ?? row.sms_consent_accepted_at
  const smsConsentAcceptedAt =
    typeof consentRaw === 'string' && consentRaw.trim() ? consentRaw.trim() : null
  return {
    companyName: String(row.companyName ?? ''),
    contactName: String(row.contactName ?? ''),
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    backupContactName: String(row.backupContactName ?? row.backup_contact_name ?? ''),
    backupContactPhone: String(row.backupContactPhone ?? row.backup_contact_phone ?? ''),
    smsConsentAcceptedAt,
  }
}

function normalizeOnboardingState(state: LandlordOnboardingState): LandlordOnboardingState {
  return {
    ...state,
    currentStep: normalizeOnboardingStep(state.currentStep),
    accountSetup: normalizeAccountSetup(state.accountSetup),
    properties: normalizeOnboardingProperties(state.properties),
    approvalRules: normalizeOnboardingApprovalRules(state.approvalRules),
    formDraft: state.formDraft,
  }
}

function readLocalOnboarding(landlordId: string): LandlordOnboardingState | null {
  try {
    const raw = window.localStorage.getItem(localKey(landlordId))
    if (!raw) return null
    return normalizeOnboardingState(JSON.parse(raw) as LandlordOnboardingState)
  } catch {
    return null
  }
}

/** Synchronous read of cached onboarding state (localStorage only). */
export function readLocalOnboardingState(
  landlordId: string = getActiveLandlordId(),
): LandlordOnboardingState | null {
  return readLocalOnboarding(landlordId)
}

export function writeLocalOnboarding(state: LandlordOnboardingState): void {
  try {
    window.localStorage.setItem(localKey(state.landlordId), JSON.stringify(state))
  } catch {
    // private mode
  }
}

function normalizeOnboardingProperty(raw: unknown): OnboardingProperty | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = String(row.id ?? '').trim()
  const name = String(row.name ?? '').trim()
  const streetAddress = String(row.streetAddress ?? row.street_address ?? '').trim()
  const city = String(row.city ?? '').trim()
  const state = String(row.state ?? '').trim().toUpperCase()
  const zipCode = String(row.zipCode ?? row.zip_code ?? '').trim()
  const unitCount = Number(row.unitCount ?? row.unit_count)
  if (!id || !name || !Number.isFinite(unitCount) || unitCount < 1) return null
  const propertyManagerName = String(
    row.propertyManagerName ?? row.property_manager_name ?? '',
  ).trim()
  const propertyManagerPhone = String(
    row.propertyManagerPhone ?? row.property_manager_phone ?? '',
  ).trim()
  const propertyType = String(row.propertyType ?? row.property_type ?? '').trim()
  return {
    id,
    name,
    streetAddress,
    city,
    state,
    zipCode,
    unitCount: Math.round(unitCount),
    propertyType: propertyType || undefined,
    propertyManagerName,
    propertyManagerPhone,
  }
}

function normalizeOnboardingProperties(raw: unknown): OnboardingProperty[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => normalizeOnboardingProperty(item))
    .filter((item): item is OnboardingProperty => item != null)
}

function rowToState(row: Record<string, unknown>, landlordId: string): LandlordOnboardingState {
  const draft = (row.draft_state ?? {}) as Record<string, unknown>
  const properties = normalizeOnboardingProperties(row.properties)
  const accountDraft = (draft.accountSetup ?? {}) as Record<string, unknown>
  const formDraft = draft.formDraft as OnboardingFormDraft | undefined

  return {
    landlordId,
    onboardingStatus: (row.onboarding_status as OnboardingStatus) ?? 'not_started',
    currentStep: normalizeOnboardingStep(row.current_step),
    setupPath: (draft.setupPath as OnboardingSetupPath) ?? null,
    accountSetup: normalizeAccountSetup(accountDraft),
    properties,
    approvalRules: normalizeOnboardingApprovalRules({
      auto_approval_threshold: row.auto_approval_threshold,
      emergency_types: row.emergency_types,
      after_hours_rule: row.after_hours_rule,
      marketplace_preference: row.marketplace_preference,
      notification_preference: row.notification_preference,
      notification_channel: row.notification_channel,
      communication_style: row.communication_style,
      ...(typeof draft.approvalRules === 'object' && draft.approvalRules
        ? (draft.approvalRules as Record<string, unknown>)
        : {}),
    }),
    formDraft,
    completedAt: (row.completed_at as string | null) ?? null,
  }
}

function emergencyContactFromAccount(account: OnboardingAccountSetup): Record<string, string> {
  const name = account.backupContactName.trim()
  const phone = account.backupContactPhone.trim()
  if (!name && !phone) return {}
  return {
    name,
    phone,
    role: 'backup',
  }
}

function stateToRow(state: LandlordOnboardingState): Record<string, unknown> {
  const rules = normalizeOnboardingApprovalRules(state.approvalRules)
  return {
    landlord_id: state.landlordId,
    onboarding_status: state.onboardingStatus,
    current_step: state.currentStep,
    // After complete, canonical data lives in properties — keep onboarding JSON draft-only.
    properties: state.onboardingStatus === 'completed' ? [] : state.properties,
    auto_approval_threshold: rules.autoApprovalThreshold,
    emergency_types: rules.emergencyTypes,
    after_hours_rule: rules.afterHoursRule,
    marketplace_preference: rules.marketplacePreference,
    notification_preference: rules.notificationPreference,
    notification_channel: rules.notificationChannel,
    communication_style: rules.communicationStyle,
    emergency_contact: emergencyContactFromAccount(state.accountSetup),
    draft_state: {
      setupPath: state.setupPath,
      accountSetup: state.accountSetup,
      formDraft: state.formDraft,
      approvalRules: rules,
    },
    completed_at: state.completedAt,
    updated_at: new Date().toISOString(),
  }
}

const IN_PROGRESS_ONBOARDING_STEPS: OnboardingStep[] = [
  'account_setup',
  'property',
  'document_upload',
  'ai_review',
  'approval',
  'vendors',
  'residents',
  'payouts',
  'review',
]

function mergeAccountSetup(
  primary: OnboardingAccountSetup,
  fallback: OnboardingAccountSetup,
): OnboardingAccountSetup {
  return {
    companyName: primary.companyName.trim() || fallback.companyName,
    contactName: primary.contactName.trim() || fallback.contactName,
    email: primary.email.trim() || fallback.email,
    phone: primary.phone.trim() || fallback.phone,
    backupContactName: primary.backupContactName.trim() || fallback.backupContactName,
    backupContactPhone: primary.backupContactPhone.trim() || fallback.backupContactPhone,
    smsConsentAcceptedAt:
      primary.smsConsentAcceptedAt?.trim() ||
      fallback.smsConsentAcceptedAt?.trim() ||
      null,
  }
}

function mergeOnboardingDraft(
  state: LandlordOnboardingState,
  landlordId: string,
): LandlordOnboardingState {
  const local = readLocalOnboarding(landlordId)
  if (!local) return state
  if (state.onboardingStatus === 'completed') return state

  // Server (or explicit reset) is on the welcome hub — never let a stale local
  // in_progress draft jump the user past the path-choice screen.
  const serverOnWelcome =
    state.onboardingStatus === 'not_started' ||
    (state.currentStep === 'entry' && state.setupPath == null)
  if (serverOnWelcome || isOnboardingResetInProgress()) {
    if (local.onboardingStatus === 'in_progress' || local.currentStep !== 'entry') {
      clearLocalOnboardingStorage(landlordId)
    }
    return state
  }

  const localInProgress =
    local.onboardingStatus === 'in_progress' ||
    (local.currentStep !== 'entry' && local.onboardingStatus !== 'not_started')

  if (!localInProgress) {
    return {
      ...state,
      accountSetup: mergeAccountSetup(state.accountSetup, local.accountSetup),
      properties: state.properties.length > 0 ? state.properties : local.properties,
      approvalRules: normalizeOnboardingApprovalRules(
        local.approvalRules ?? state.approvalRules,
      ),
      formDraft: state.formDraft ?? local.formDraft,
    }
  }

  return {
    ...state,
    onboardingStatus:
      local.onboardingStatus === 'completed' ? state.onboardingStatus : local.onboardingStatus,
    currentStep: local.currentStep,
    setupPath: local.setupPath ?? state.setupPath,
    accountSetup: mergeAccountSetup(local.accountSetup, state.accountSetup),
    properties: local.properties.length > 0 ? local.properties : state.properties,
    approvalRules: normalizeOnboardingApprovalRules(
      local.approvalRules ?? state.approvalRules,
    ),
    formDraft: local.formDraft ?? state.formDraft,
  }
}

export async function readLandlordOnboardingDraft(
  landlordId: string = getActiveLandlordId(),
): Promise<LandlordOnboardingState> {
  const fallback = readLocalOnboarding(landlordId) ?? defaultOnboardingState(landlordId)

  if (!supabase) {
    return fallback
  }

  const { data, error } = await supabase
    .from('landlord_onboarding')
    .select('*')
    .eq('landlord_id', landlordId)
    .maybeSingle()

  if (error) {
    console.warn('[landlordOnboarding] fetch draft', error.message)
    return fallback
  }

  const state = normalizeOnboardingState(
    !data ? fallback : rowToState(data as Record<string, unknown>, landlordId),
  )
  return mergeOnboardingDraft(state, landlordId)
}

export async function fetchLandlordOnboarding(
  landlordId: string = getActiveLandlordId(),
): Promise<LandlordOnboardingState> {
  const fallback = readLocalOnboarding(landlordId) ?? defaultOnboardingState(landlordId)

  if (!supabase) {
    return reconcileNewLandlordOnboarding(fallback, {
      properties: 0,
      units: 0,
      residents: 0,
      vendors: 0,
      workflowRuns: 0,
    })
  }

  let state = await readLandlordOnboardingDraft(landlordId)
  if (state.onboardingStatus === 'completed') {
    const canonical = await loadCanonicalOnboardingProperties(landlordId)
    if (canonical.length > 0) {
      state = { ...state, properties: canonical }
    }
  }
  const counts = await fetchAccountSetupCounts(landlordId)
  return reconcileNewLandlordOnboarding(state, counts)
}

export async function saveLandlordOnboarding(
  state: LandlordOnboardingState,
): Promise<void> {
  // During Reset, only persist explicit welcome-hub writes from restart helpers.
  if (
    isOnboardingResetInProgress() &&
    !(state.onboardingStatus === 'not_started' && state.currentStep === 'entry')
  ) {
    return
  }

  writeLocalOnboarding(state)

  if (!supabase) return

  const row = stateToRow(state)
  const { error } = await supabase.from('landlord_onboarding').upsert(row, {
    onConflict: 'landlord_id',
  })

  if (error) {
    if (
      error.code === '42703' ||
      /marketplace_preference|communication_style|column .* does not exist/i.test(
        error.message,
      )
    ) {
      const {
        marketplace_preference: _dropMarket,
        communication_style: _dropStyle,
        ...legacyRow
      } = row
      const retry = await supabase.from('landlord_onboarding').upsert(legacyRow, {
        onConflict: 'landlord_id',
      })
      if (retry.error) {
        console.warn('[landlordOnboarding] save', retry.error.message)
      }
      return
    }
    console.warn('[landlordOnboarding] save', error.message)
  }
}

export function persistOnboardingWizardLocally(
  state: LandlordOnboardingState,
  formDraft?: OnboardingFormDraft,
): LandlordOnboardingState {
  if (
    isOnboardingResetInProgress() &&
    !(state.onboardingStatus === 'not_started' && state.currentStep === 'entry')
  ) {
    return state
  }
  const next: LandlordOnboardingState = formDraft ? { ...state, formDraft } : state
  writeLocalOnboarding(next)
  return next
}

export async function saveOnboardingWizardDraft(
  state: LandlordOnboardingState,
  formDraft?: OnboardingFormDraft,
): Promise<void> {
  const next = persistOnboardingWizardLocally(state, formDraft ?? state.formDraft)
  await saveLandlordOnboarding(next)
}

export function hasOnboardingAccountDraft(state: LandlordOnboardingState): boolean {
  const { accountSetup } = state
  return (
    Boolean(accountSetup.companyName.trim()) ||
    Boolean(accountSetup.contactName.trim()) ||
    Boolean(accountSetup.email.trim()) ||
    Boolean(accountSetup.phone.trim())
  )
}

export function hasOnboardingDraft(state: LandlordOnboardingState): boolean {
  return hasOnboardingAccountDraft(state) || state.properties.length > 0
}

export function isAccountEmpty(counts: AccountSetupCounts): boolean {
  return (
    counts.properties === 0 &&
    counts.units === 0 &&
    counts.residents === 0 &&
    counts.vendors === 0 &&
    counts.workflowRuns === 0
  )
}

export async function reconcileNewLandlordOnboarding(
  state: LandlordOnboardingState,
  counts: AccountSetupCounts,
): Promise<LandlordOnboardingState> {
  if (!isOnboardingLandlordAccount(state.landlordId)) return state
  if (!isAccountEmpty(counts)) return state

  if (state.onboardingStatus === 'completed') {
    const fresh = defaultOnboardingState(state.landlordId)
    await saveLandlordOnboarding(fresh)
    return fresh
  }

  const hasPersistedProgress =
    state.properties.length > 0 ||
    hasOnboardingAccountDraft(state) ||
    IN_PROGRESS_ONBOARDING_STEPS.includes(state.currentStep)

  if (state.currentStep !== 'entry' && !hasPersistedProgress) {
    const fresh = defaultOnboardingState(state.landlordId)
    await saveLandlordOnboarding(fresh)
    return fresh
  }

  return state
}


export function shouldBlockDashboard(
  state: LandlordOnboardingState,
  landlordId: string = getActiveLandlordId(),
): boolean {
  return isOnboardingLandlordAccount(landlordId) && state.onboardingStatus !== 'completed'
}
