/**
 * Landlord onboarding — wizard state, persistence, and import helpers.
 * Scoped to the New Landlord showcase account (EMPTY_LANDLORD_ID).
 */
import { ensureUnitsInDb } from '@/api/unitVacancy'
import { sendTenantActivationSms } from '@/api/tenantActivation'
import { sendVendorInvite, type VendorInviteChannel } from '@/api/vendorVerification'
import {
  EMPTY_LANDLORD_ID,
  getActiveLandlordId,
  getActiveLandlordKind,
} from '@/lib/activeLandlord'
import type {
  ExtractedLease,
  ExtractedMaintenanceIssue,
  MockExtractionReview,
} from '@/lib/onboardingMockExtraction'
import type {
  OnboardingExtractionReview,
  OnboardingUploadedDocument,
} from '@/lib/onboardingDocumentUpload'
import { normalizeBuildingKey } from '@/lib/propertyHealth'
import { supabase } from '@/lib/supabase'
import { normalizePhoneForDb } from '@/lib/phoneFormat'
import { dedupeVendorsByName } from '@/lib/vendorDedup'
import { clearVendorSetupInboxForLandlord } from '@/lib/vendorSetupConversation'
import {
  issueCategoryToVendorTrade,
  isGeneralistTrade,
  normalizeVendorTrade,
} from '@/lib/vendorTrades'

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
}

export type OnboardingAccountSetup = {
  companyName: string
  contactName: string
  email: string
  phone: string
}

export type OnboardingPropertyFormDraft = {
  id: string
  name: string
  address: string
  city: string
  state: string
  zipCode: string
  propertyType: string
  unitCount: string
}

export type OnboardingVendorFormDraft = {
  id: string
  name: string
  category: string
  email: string
  phone: string
}

export type OnboardingResidentFormDraft = {
  id: string
  residentId?: string
  fullName: string
  unit: string
  email: string
  phone: string
  monthlyRent: string
  /** '' | '1' | '5' | 'custom' — UI choice for rent due day */
  rentDueDayMode?: string
  rentDueDay: string
  leaseStart: string
  leaseEnd: string
}

export type OnboardingFormDraft = {
  propertyForms?: OnboardingPropertyFormDraft[]
  vendorForms?: OnboardingVendorFormDraft[]
  residentForms?: OnboardingResidentFormDraft[]
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

export const GUIDED_ONBOARDING_STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'entry', label: 'Welcome' },
  { id: 'account_setup', label: 'Account setup' },
  { id: 'property', label: 'Property' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'residents', label: 'Residents' },
  { id: 'review', label: 'Review' },
]

export const FAST_TRACK_ONBOARDING_STEPS: { id: OnboardingStep; label: string }[] = [
  { id: 'entry', label: 'Welcome' },
  { id: 'document_upload', label: 'Upload documents' },
  { id: 'ai_review', label: 'AI review' },
  { id: 'review', label: 'Review' },
]

/** @deprecated Use getOnboardingStepsForPath instead. */
export const ONBOARDING_STEPS = GUIDED_ONBOARDING_STEPS

const GUIDED_STEP_ORDER: OnboardingStep[] = [
  'entry',
  'account_setup',
  'property',
  'vendors',
  'residents',
  'review',
]

const FAST_TRACK_STEP_ORDER: OnboardingStep[] = [
  'entry',
  'document_upload',
  'ai_review',
  'review',
]

const ALL_ONBOARDING_STEP_IDS = new Set<OnboardingStep>([
  ...GUIDED_STEP_ORDER,
  ...FAST_TRACK_STEP_ORDER,
])

const LEGACY_STEP_MAP: Record<string, OnboardingStep> = {
  property_setup: 'account_setup',
  document_upload: 'document_upload',
  extraction_review: 'ai_review',
  phone_activation: 'ai_review',
  resident_announcement: 'residents',
  maintenance_rules: 'review',
  completion: 'review',
}

export function getOnboardingStepsForPath(
  setupPath: OnboardingSetupPath,
): { id: OnboardingStep; label: string }[] {
  return setupPath === 'fast_track' ? FAST_TRACK_ONBOARDING_STEPS : GUIDED_ONBOARDING_STEPS
}

export function getOnboardingStepOrder(setupPath: OnboardingSetupPath = null): OnboardingStep[] {
  return setupPath === 'fast_track' ? FAST_TRACK_STEP_ORDER : GUIDED_STEP_ORDER
}

/** Map legacy fast-track step ids to the current flow. */
export function resolveOnboardingStepForPath(
  step: OnboardingStep,
  setupPath: OnboardingSetupPath,
): OnboardingStep {
  if (setupPath !== 'fast_track') return step
  if (step === 'property') return 'document_upload'
  if (step === 'vendors' || step === 'residents' || step === 'approval') return 'ai_review'
  return step
}

function normalizeOnboardingStep(step: unknown): OnboardingStep {
  if (typeof step === 'string' && LEGACY_STEP_MAP[step]) {
    return LEGACY_STEP_MAP[step]
  }
  if (typeof step === 'string' && ALL_ONBOARDING_STEP_IDS.has(step as OnboardingStep)) {
    return step as OnboardingStep
  }
  return 'entry'
}

/** Normalize persisted step ids (legacy steps map to the simplified flow). */
export function normalizeOnboardingStepId(step: unknown): OnboardingStep {
  return normalizeOnboardingStep(step)
}

export function getPreviousOnboardingStep(
  current: OnboardingStep | string,
  setupPath: OnboardingSetupPath = null,
): OnboardingStep | null {
  const step = resolveOnboardingStepForPath(normalizeOnboardingStep(current), setupPath)
  const order = getOnboardingStepOrder(setupPath)
  const idx = order.indexOf(step)
  if (idx <= 0) return null
  return order[idx - 1]!
}

const LOCAL_STORAGE_PREFIX = 'ulo.landlordOnboarding.'

function localKey(landlordId: string): string {
  return `${LOCAL_STORAGE_PREFIX}${landlordId}`
}

export function clearLocalOnboardingStorage(landlordId: string = getActiveLandlordId()): void {
  try {
    window.localStorage.removeItem(localKey(landlordId))
  } catch {
    // private mode
  }
}

export function isOnboardingLandlordAccount(landlordId: string = getActiveLandlordId()): boolean {
  return landlordId === EMPTY_LANDLORD_ID || getActiveLandlordKind() === 'empty'
}

/** Fail closed: onboarding mutations must never write to demo/default landlords. */
export function requireOnboardingLandlord(
  landlordId: string = getActiveLandlordId(),
): { ok: true; landlordId: string } | { ok: false; error: string } {
  if (!isOnboardingLandlordAccount(landlordId)) {
    return {
      ok: false,
      error:
        'Wrong landlord scope — switch to New Landlord (empty) before onboarding. Demo and Ulo Operations data stays isolated.',
    }
  }
  if (landlordId !== EMPTY_LANDLORD_ID) {
    return {
      ok: false,
      error: 'Wrong landlord scope — onboarding only writes to the New Landlord account.',
    }
  }
  return { ok: true, landlordId }
}

export function defaultOnboardingState(landlordId: string = getActiveLandlordId()): LandlordOnboardingState {
  return {
    landlordId,
    onboardingStatus: 'not_started',
    currentStep: 'entry',
    setupPath: null,
    accountSetup: { companyName: '', contactName: '', email: '', phone: '' },
    properties: [],
    completedAt: null,
  }
}

function normalizeOnboardingState(state: LandlordOnboardingState): LandlordOnboardingState {
  return {
    ...state,
    currentStep: normalizeOnboardingStep(state.currentStep),
    accountSetup: state.accountSetup ?? defaultOnboardingState(state.landlordId).accountSetup,
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

function writeLocalOnboarding(state: LandlordOnboardingState): void {
  try {
    window.localStorage.setItem(localKey(state.landlordId), JSON.stringify(state))
  } catch {
    // private mode
  }
}

function rowToState(row: Record<string, unknown>, landlordId: string): LandlordOnboardingState {
  const draft = (row.draft_state ?? {}) as Record<string, unknown>
  const properties = Array.isArray(row.properties) ? (row.properties as OnboardingProperty[]) : []
  const accountDraft = (draft.accountSetup ?? {}) as Record<string, unknown>
  const formDraft = draft.formDraft as OnboardingFormDraft | undefined

  return {
    landlordId,
    onboardingStatus: (row.onboarding_status as OnboardingStatus) ?? 'not_started',
    currentStep: normalizeOnboardingStep(row.current_step),
    setupPath: (draft.setupPath as OnboardingSetupPath) ?? null,
    accountSetup: {
      companyName: String(accountDraft.companyName ?? ''),
      contactName: String(accountDraft.contactName ?? ''),
      email: String(accountDraft.email ?? ''),
      phone: String(accountDraft.phone ?? ''),
    },
    properties,
    formDraft,
    completedAt: (row.completed_at as string | null) ?? null,
  }
}

function stateToRow(state: LandlordOnboardingState): Record<string, unknown> {
  return {
    landlord_id: state.landlordId,
    onboarding_status: state.onboardingStatus,
    current_step: state.currentStep,
    properties: state.properties,
    draft_state: {
      setupPath: state.setupPath,
      accountSetup: state.accountSetup,
      formDraft: state.formDraft,
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
  }
}

function mergeOnboardingDraft(
  state: LandlordOnboardingState,
  landlordId: string,
): LandlordOnboardingState {
  const local = readLocalOnboarding(landlordId)
  if (!local) return state
  if (state.onboardingStatus === 'completed') return state

  const localInProgress =
    local.onboardingStatus === 'in_progress' ||
    (local.currentStep !== 'entry' && local.onboardingStatus !== 'not_started')

  if (!localInProgress) {
    return {
      ...state,
      accountSetup: mergeAccountSetup(state.accountSetup, local.accountSetup),
      properties: state.properties.length > 0 ? state.properties : local.properties,
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
    formDraft: local.formDraft ?? state.formDraft,
  }
}

async function readLandlordOnboardingDraft(
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

  const state = await readLandlordOnboardingDraft(landlordId)
  const counts = await fetchAccountSetupCounts(landlordId)
  return reconcileNewLandlordOnboarding(state, counts)
}

export async function saveLandlordOnboarding(
  state: LandlordOnboardingState,
): Promise<void> {
  writeLocalOnboarding(state)

  if (!supabase) return

  const row = stateToRow(state)
  const { error } = await supabase.from('landlord_onboarding').upsert(row, {
    onConflict: 'landlord_id',
  })

  if (error) {
    console.warn('[landlordOnboarding] save', error.message)
  }
}

/** Save wizard progress to localStorage immediately (survives refresh even before remote sync). */
export function persistOnboardingWizardLocally(
  state: LandlordOnboardingState,
  formDraft?: OnboardingFormDraft,
): LandlordOnboardingState {
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

export async function fetchAccountSetupCounts(
  landlordId: string = getActiveLandlordId(),
): Promise<AccountSetupCounts> {
  if (!supabase) {
    return { properties: 0, units: 0, residents: 0, vendors: 0, workflowRuns: 0 }
  }

  const [unitsRes, residentsRes, vendorsRes, runsRes] = await Promise.all([
    supabase.from('units').select('id, building', { count: 'exact', head: false }).eq('landlord_id', landlordId),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
    supabase.from('vendors').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
    supabase.from('workflow_runs').select('id', { count: 'exact', head: true }).eq('landlord_id', landlordId),
  ])

  const buildings = new Set<string>()
  for (const row of unitsRes.data ?? []) {
    const b = String((row as { building?: string }).building ?? '').trim()
    if (b) buildings.add(b)
  }

  return {
    properties: buildings.size,
    units: unitsRes.count ?? (unitsRes.data ?? []).length,
    residents: residentsRes.count ?? 0,
    vendors: vendorsRes.count ?? 0,
    workflowRuns: runsRes.count ?? 0,
  }
}

export function generateUnitLabels(count: number): string[] {
  const labels: string[] = []
  for (let i = 1; i <= count; i++) {
    labels.push(String(100 + i))
  }
  return labels
}

export type OnboardingVendor = {
  id: string
  name: string
  category: string
  email: string
  phone: string
}

export type OnboardingResident = {
  id: string
  residentId: string
  fullName: string
  unit: string
  building: string
  email: string
  phone: string
  monthlyRent: number | null
  rentDueDay: number | null
  leaseStart: string | null
  leaseEnd: string | null
}

function unitInventoryKey(unitLabel: string, building: string | null | undefined): string {
  return `${unitLabel.trim()}::${String(building ?? '').trim()}`
}

function buildOnboardingUnitInventory(
  properties: OnboardingProperty[],
): Array<{
  unitLabel: string
  building: string
  city: string | null
  state: string | null
  zipCode: string | null
}> {
  const units: Array<{
    unitLabel: string
    building: string
    city: string | null
    state: string | null
    zipCode: string | null
  }> = []
  for (const property of properties) {
    const building = property.name.trim()
    if (!building) continue
    const city = property.city.trim() || null
    const state = property.state.trim() || null
    const zipCode = property.zipCode.trim() || null
    for (const label of generateUnitLabels(property.unitCount)) {
      units.push({ unitLabel: label, building, city, state, zipCode })
    }
  }
  return units
}

async function deleteUnitsByIds(unitIds: string[]): Promise<{ ok: boolean; error?: string }> {
  if (!supabase || unitIds.length === 0) {
    return { ok: true }
  }

  const { error: occupancyError } = await supabase.from('occupancy').delete().in('unit_id', unitIds)
  if (occupancyError) {
    return { ok: false, error: occupancyError.message }
  }

  const { error: unitError } = await supabase.from('units').delete().in('id', unitIds)
  if (unitError) {
    return { ok: false, error: unitError.message }
  }

  return { ok: true }
}

/** Remove portfolio buildings (units, occupancy, and residents scoped to each building name). */
export async function deleteLandlordBuildings(
  buildingNames: string[],
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.' }
  }
  if (buildingNames.length === 0) {
    return { ok: true }
  }

  const selected = new Set(buildingNames.map((name) => normalizeBuildingKey(name)))

  const { data: unitRows, error: unitLoadError } = await supabase
    .from('units')
    .select('id, building')
    .eq('landlord_id', landlordId)

  if (unitLoadError) {
    return { ok: false, error: unitLoadError.message }
  }

  const unitIds = (unitRows ?? [])
    .filter((row) => selected.has(normalizeBuildingKey(String((row as { building?: string | null }).building))))
    .map((row) => String((row as { id: string }).id))

  const removedUnits = await deleteUnitsByIds(unitIds)
  if (!removedUnits.ok) {
    return removedUnits
  }

  const { data: residentRows, error: residentLoadError } = await supabase
    .from('users')
    .select('id, building')
    .eq('landlord_id', landlordId)

  if (residentLoadError) {
    return { ok: false, error: residentLoadError.message }
  }

  const residentIds = (residentRows ?? [])
    .filter((row) => selected.has(normalizeBuildingKey(String((row as { building?: string | null }).building))))
    .map((row) => String((row as { id: string }).id))

  if (residentIds.length === 0) {
    return { ok: true }
  }

  const { error: residentDeleteError } = await supabase.from('users').delete().in('id', residentIds)
  if (residentDeleteError) {
    return { ok: false, error: residentDeleteError.message }
  }

  return { ok: true }
}

/** Replace landlord unit inventory with exactly the onboarding property list (no cross-session accumulation). */
async function syncOnboardingPropertyUnits(
  landlordId: string,
  units: Array<{
    unitLabel: string
    building: string | null
    city?: string | null
    state?: string | null
    zipCode?: string | null
  }>,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.' }
  }

  const desiredKeys = new Set(
    units.map((unit) => unitInventoryKey(unit.unitLabel, unit.building)),
  )

  const { data: existing, error: loadError } = await supabase
    .from('units')
    .select('id, unit_label, building')
    .eq('landlord_id', landlordId)

  if (loadError) {
    return { ok: false, error: loadError.message }
  }

  const staleUnitIds = (existing ?? [])
    .filter((row) =>
      !desiredKeys.has(
        unitInventoryKey(
          String((row as { unit_label: string }).unit_label),
          (row as { building?: string | null }).building,
        ),
      ),
    )
    .map((row) => String((row as { id: string }).id))

  const removed = await deleteUnitsByIds(staleUnitIds)
  if (!removed.ok) {
    return removed
  }

  const remainingRows = (existing ?? []).filter(
    (row) => !staleUnitIds.includes(String((row as { id: string }).id)),
  )
  const remainingKeys = new Set(
    remainingRows.map((row) =>
      unitInventoryKey(
        String((row as { unit_label: string }).unit_label),
        (row as { building?: string | null }).building,
      ),
    ),
  )

  // Refresh location on units that already exist for this property inventory.
  for (const unit of units) {
    const key = unitInventoryKey(unit.unitLabel, unit.building)
    if (!remainingKeys.has(key)) continue
    const match = remainingRows.find(
      (row) =>
        unitInventoryKey(
          String((row as { unit_label: string }).unit_label),
          (row as { building?: string | null }).building,
        ) === key,
    )
    if (!match) continue
    const { error: updateError } = await supabase
      .from('units')
      .update({
        city: unit.city?.trim() || null,
        state: unit.state?.trim() || null,
        zip_code: unit.zipCode?.trim() || null,
      })
      .eq('id', String((match as { id: string }).id))
    if (updateError) {
      return { ok: false, error: updateError.message }
    }
  }

  const toInsert = units.filter(
    (unit) => !remainingKeys.has(unitInventoryKey(unit.unitLabel, unit.building)),
  )
  if (toInsert.length === 0) {
    return { ok: true }
  }

  const { error: insertError } = await supabase.from('units').insert(
    toInsert.map((unit) => ({
      landlord_id: landlordId,
      unit_label: unit.unitLabel,
      building: unit.building?.trim() || null,
      city: unit.city?.trim() || null,
      state: unit.state?.trim() || null,
      zip_code: unit.zipCode?.trim() || null,
      status: 'inactive',
    })),
  )

  if (insertError) {
    return { ok: false, error: insertError.message }
  }

  return { ok: true }
}

export async function persistOnboardingProperties(
  properties: OnboardingProperty[],
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) return scope

  if (properties.length === 0) {
    return { ok: false, error: 'Add at least one property.' }
  }

  const units = buildOnboardingUnitInventory(properties)
  if (units.length === 0) {
    return { ok: false, error: 'Each property needs at least one unit.' }
  }

  try {
    const registeredViaSms = await ensureUnitsInDb(units)
    if (registeredViaSms) {
      return syncOnboardingPropertyUnits(scope.landlordId, units)
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to register units.' }
  }

  return syncOnboardingPropertyUnits(scope.landlordId, units)
}

export async function fetchOnboardingVendors(
  landlordId: string = getActiveLandlordId(),
): Promise<OnboardingVendor[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('vendors')
    .select('id, name, category, email, phone')
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
    createdAt: String((row as { created_at?: string | null }).created_at ?? '') || null,
  }))

  return dedupeVendorsByName(rows).map(({ id, name, category, email, phone }) => ({
    id,
    name,
    category,
    email,
    phone,
  }))
}

export async function fetchOnboardingResidents(
  landlordId: string = getActiveLandlordId(),
): Promise<OnboardingResident[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('users')
    .select(
      'id, resident_id, full_name, email, phone, unit, building, monthly_rent, rent_due_day, move_in_date, lease_end_date',
    )
    .eq('landlord_id', landlordId)
    .order('created_at', { ascending: true })

  if (error) {
    // Columns may be missing before migration 20260716130000 — fall back.
    if (/monthly_rent|rent_due_day|column/i.test(error.message)) {
      const { data: legacy, error: legacyError } = await supabase
        .from('users')
        .select('id, resident_id, full_name, email, phone, unit, building, move_in_date, lease_end_date')
        .eq('landlord_id', landlordId)
        .order('created_at', { ascending: true })
      if (legacyError) {
        console.warn('[landlordOnboarding] fetch residents', legacyError.message)
        return []
      }
      return (legacy ?? []).map((row) => mapOnboardingResidentRow(row as Record<string, unknown>))
    }
    console.warn('[landlordOnboarding] fetch residents', error.message)
    return []
  }

  return (data ?? []).map((row) => mapOnboardingResidentRow(row as Record<string, unknown>))
}

function mapOnboardingResidentRow(row: Record<string, unknown>): OnboardingResident {
  const monthlyRaw = row.monthly_rent
  const dueRaw = row.rent_due_day
  const monthlyRent =
    monthlyRaw == null || monthlyRaw === ''
      ? null
      : Number(monthlyRaw)
  const rentDueDay =
    dueRaw == null || dueRaw === ''
      ? null
      : Number(dueRaw)
  return {
    id: String(row.id ?? ''),
    residentId: String(row.resident_id ?? ''),
    fullName: String(row.full_name ?? ''),
    unit: String(row.unit ?? ''),
    building: String(row.building ?? ''),
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    monthlyRent: Number.isFinite(monthlyRent) ? monthlyRent : null,
    rentDueDay:
      Number.isFinite(rentDueDay) && rentDueDay! >= 1 && rentDueDay! <= 31
        ? Math.trunc(rentDueDay!)
        : null,
    leaseStart: asOptionalDateString(
      typeof row.move_in_date === 'string' ? row.move_in_date : null,
    ),
    leaseEnd: asOptionalDateString(
      typeof row.lease_end_date === 'string' ? row.lease_end_date : null,
    ),
  }
}

function asOptionalDateString(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  return value.trim().slice(0, 10)
}

/** Parse "$2,850" / "2850" into a numeric rent amount. */
export function parseMonthlyRentInput(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const amount = Number(cleaned)
  if (!Number.isFinite(amount) || amount < 0) return null
  return amount
}

/** Parse rent due day (1–31). */
export function parseRentDueDayInput(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const day = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(day) || day < 1 || day > 31) return null
  return day
}

/** Normalize date input (YYYY-MM-DD) for Postgres date columns. */
export function parseLeaseDateInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const ms = Date.parse(`${trimmed}T12:00:00`)
  if (!Number.isFinite(ms)) return null
  return trimmed
}

export function maxOnboardingResidentSequence(residents: OnboardingResident[]): number {
  let max = 0
  for (const resident of residents) {
    const parsed = Number.parseInt(resident.residentId.replace(/^(ONB-|RES-)/i, ''), 10)
    if (Number.isFinite(parsed)) {
      max = Math.max(max, parsed)
    }
  }
  return max
}

export function nextOnboardingResidentIdFromSequence(sequence: number): string {
  return `ONB-${String(sequence).padStart(3, '0')}`
}

export async function nextOnboardingResidentId(
  landlordId: string = getActiveLandlordId(),
): Promise<string> {
  const residents = await fetchOnboardingResidents(landlordId)
  return nextOnboardingResidentIdFromSequence(maxOnboardingResidentSequence(residents) + 1)
}

export type OnboardingReviewData = {
  accountSetup: OnboardingAccountSetup
  properties: OnboardingProperty[]
  vendors: OnboardingVendor[]
  residents: OnboardingResident[]
  metrics: AccountSetupCounts
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

/** @deprecated Use buildOnboardingReviewMetrics with fetched vendor/resident lists. */
export function getOnboardingReviewMetrics(
  state: LandlordOnboardingState,
  _counts: AccountSetupCounts,
): AccountSetupCounts {
  return buildOnboardingReviewMetrics(state, [], [])
}

export function buildOnboardingReviewData(
  state: LandlordOnboardingState,
  vendors: OnboardingVendor[] = [],
  residents: OnboardingResident[] = [],
  dbCounts?: AccountSetupCounts,
): OnboardingReviewData {
  return {
    accountSetup: state.accountSetup,
    properties: state.properties,
    vendors,
    residents,
    metrics: buildOnboardingReviewMetrics(state, vendors, residents, dbCounts),
  }
}

export async function fetchOnboardingReviewSupplement(
  state: LandlordOnboardingState,
  landlordId: string = getActiveLandlordId(),
): Promise<{
  vendors: OnboardingVendor[]
  residents: OnboardingResident[]
  dbCounts?: AccountSetupCounts
}> {
  const [vendors, residents] = await Promise.all([
    fetchOnboardingVendors(landlordId),
    fetchOnboardingResidents(landlordId),
  ])

  if (state.properties.length > 0) {
    return { vendors, residents }
  }

  const dbCounts = await fetchAccountSetupCounts(landlordId)
  return { vendors, residents, dbCounts }
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
  )
}

async function deleteLandlordScopedRows(
  table: string,
  landlordId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.' }
  }
  const { error } = await supabase.from(table).delete().eq('landlord_id', landlordId)
  if (error && !/does not exist|Could not find the table/i.test(error.message)) {
    return { ok: false, error: `${table}: ${error.message}` }
  }
  return { ok: true }
}

async function deleteInScopedRows(
  table: string,
  column: string,
  values: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase || values.length === 0) {
    return { ok: true }
  }
  const { error } = await supabase.from(table).delete().in(column, values)
  if (error && !/does not exist|Could not find the table/i.test(error.message)) {
    return { ok: false, error: `${table}: ${error.message}` }
  }
  return { ok: true }
}

/**
 * Delete graph/SMS rows for a landlord that are NOT tied to a current portfolio
 * resident/vendor. Keeps legitimately-created rows (e.g. tenant activation welcome
 * texts) while stripping unscoped import leftovers. Client fallback mirror of the
 * purge_empty_landlord_operations RPC preserve branch.
 */
async function deletePortfolioMismatchedRows(
  table: string,
  landlordId: string,
  residentIds: Set<string>,
  vendorIds: Set<string>,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.' }
  }
  // Mirror of purge_empty_landlord_operations preserve logic: keep portfolio-tied
  // rows AND onboarding comms (tenant.*/vendor.* graph events, vendor_onboarding
  // SMS threads) so onboarding actions survive the dashboard refresh.
  const selectColumns =
    table === 'sms_conversations'
      ? 'id, resident_id, vendor_id, workflow_template_id'
      : 'id, resident_id, vendor_id, event_type'
  const { data, error } = await supabase
    .from(table)
    .select(selectColumns)
    .eq('landlord_id', landlordId)
  if (error) {
    if (/does not exist|Could not find the table/i.test(error.message)) return { ok: true }
    return { ok: false, error: `${table}: ${error.message}` }
  }
  const idsToDelete = ((data ?? []) as Record<string, unknown>[])
    .filter((row) => {
      const residentId = row.resident_id ? String(row.resident_id) : null
      const vendorId = row.vendor_id ? String(row.vendor_id) : null
      const eventType = row.event_type ? String(row.event_type) : ''
      const templateId = row.workflow_template_id ? String(row.workflow_template_id) : ''
      const keepPortfolio =
        (residentId && residentIds.has(residentId)) || (vendorId && vendorIds.has(vendorId))
      const keepOnboarding =
        eventType.startsWith('vendor.') ||
        eventType.startsWith('tenant.') ||
        templateId === 'vendor_onboarding'
      return !(keepPortfolio || keepOnboarding)
    })
    .map((row) => String(row.id))
  return deleteInScopedRows(table, 'id', idsToDelete)
}

/**
 * Clear vendor assignment before deleting vendors.
 * `assigned_vendor_id` is ON DELETE SET NULL; that alone leaves pending_accept/accepted/…
 * rows invalid under require_vendor_for_progress.
 */
async function detachVendorsFromMaintenanceRequests(
  landlordId: string,
  vendorIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.' }
  }

  const cleared = {
    assigned_vendor_id: null,
    vendor_work_status: 'unassigned' as const,
    assigned_at: null,
  }

  const { error: byLandlord } = await supabase
    .from('maintenance_requests')
    .update(cleared)
    .eq('landlord_id', landlordId)

  if (byLandlord) {
    return { ok: false, error: `maintenance_requests: ${byLandlord.message}` }
  }

  if (vendorIds.length > 0) {
    // Also clear any tickets (any landlord) still pointing at these vendor rows.
    const { error: byVendor } = await supabase
      .from('maintenance_requests')
      .update(cleared)
      .in('assigned_vendor_id', vendorIds)

    if (byVendor) {
      return { ok: false, error: `maintenance_requests: ${byVendor.message}` }
    }
  }

  return { ok: true }
}

/**
 * Remove tickets + workflow runs created by fast-track document import.
 * Keeps properties, units, residents, and vendors (guided portfolio).
 */
export async function purgeOnboardingImportedOperations(
  landlordId: string = getActiveLandlordId(),
  preservePortfolioSms = false,
): Promise<{ ok: boolean; error?: string }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) return scope
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.' }
  }

  // Prefer fail-closed SECURITY DEFINER RPC (bypasses missing DELETE RLS on runs).
  // preservePortfolioSms keeps SMS threads + graph events tied to current portfolio
  // residents/vendors (e.g. tenant activation welcome texts) while stripping import junk.
  const { error: rpcError } = await supabase.rpc('purge_empty_landlord_operations', {
    p_preserve_portfolio_sms: preservePortfolioSms,
  })
  if (!rpcError) {
    const remaining = await countLandlordOps(scope.landlordId)
    // In preserve mode the purge intentionally keeps vendor_onboarding runs, so a
    // remaining active run is expected — only gate on leftover imported tickets.
    const blocked = preservePortfolioSms
      ? remaining.tickets > 0
      : remaining.tickets > 0 || remaining.activeWorkflowRuns > 0
    if (blocked) {
      return {
        ok: false,
        error: `Could not clear imported tasks (${remaining.activeWorkflowRuns} runs, ${remaining.tickets} tickets remain).`,
      }
    }
    return { ok: true }
  }

  // RPC missing (migration not applied yet) — fall back to client deletes / cancel.
  if (!/Could not find the function|PGRST202|404/i.test(rpcError.message)) {
    console.warn('[landlordOnboarding] purge_empty_landlord_operations', rpcError.message)
  }

  const { data: ticketRows, error: ticketLoadError } = await supabase
    .from('maintenance_requests')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (ticketLoadError) {
    return { ok: false, error: ticketLoadError.message }
  }

  const ticketIds = (ticketRows ?? []).map((row) => String((row as { id: string }).id))
  const childDelete = await deleteInScopedRows('vendor_status_events', 'ticket_id', ticketIds)
  if (!childDelete.ok) return childDelete

  let graphSmsDeletes: { ok: boolean; error?: string }[]
  if (preservePortfolioSms) {
    const [residentRows, vendorRows] = await Promise.all([
      supabase.from('users').select('id').eq('landlord_id', scope.landlordId),
      supabase.from('vendors').select('id').eq('landlord_id', scope.landlordId),
    ])
    const residentIds = new Set(
      ((residentRows.data ?? []) as { id: string }[]).map((r) => String(r.id)),
    )
    const vendorIds = new Set(
      ((vendorRows.data ?? []) as { id: string }[]).map((r) => String(r.id)),
    )
    graphSmsDeletes = [
      await deletePortfolioMismatchedRows(
        'operations_graph_events',
        scope.landlordId,
        residentIds,
        vendorIds,
      ),
      await deletePortfolioMismatchedRows(
        'property_operations_graph',
        scope.landlordId,
        residentIds,
        vendorIds,
      ),
      // Messages cascade with their thread; delete mismatched threads only.
      await deletePortfolioMismatchedRows(
        'sms_conversations',
        scope.landlordId,
        residentIds,
        vendorIds,
      ),
    ]
  } else {
    graphSmsDeletes = [
      await deleteLandlordScopedRows('operations_graph_events', scope.landlordId),
      await deleteLandlordScopedRows('property_operations_graph', scope.landlordId),
      await deleteLandlordScopedRows('sms_messages', scope.landlordId),
      await deleteLandlordScopedRows('sms_conversations', scope.landlordId),
    ]
  }

  const ordered = [
    await deleteLandlordScopedRows('vendor_feedback', scope.landlordId),
    await deleteLandlordScopedRows('maintenance_invoices', scope.landlordId),
    ...graphSmsDeletes,
    await deleteLandlordScopedRows('workflow_events', scope.landlordId),
    await deleteLandlordScopedRows('workflow_runs', scope.landlordId),
    await deleteLandlordScopedRows('maintenance_requests', scope.landlordId),
  ]

  const failed = ordered.find((result) => !result.ok)
  if (failed) return failed

  // Staff historically lacked DELETE on workflow_runs; UPDATE is allowed — retire leftovers
  // so Active tasks / Needs attention go empty for guided portfolios.
  const cancelled = await cancelLandlordWorkflowRuns(scope.landlordId)
  if (!cancelled.ok) return cancelled

  const remaining = await countLandlordOps(scope.landlordId)
  if (remaining.tickets > 0 || remaining.activeWorkflowRuns > 0) {
    return {
      ok: false,
      error: `Could not clear imported tasks (${remaining.activeWorkflowRuns} active workflow runs still remain). Apply migration 20260716120000_onboarding_ops_purge_staff, then reset again.`,
    }
  }

  return { ok: true }
}

async function cancelLandlordWorkflowRuns(
  landlordId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.' }
  }
  const completedAt = new Date().toISOString()
  const { error } = await supabase
    .from('workflow_runs')
    .update({ status: 'cancelled', completed_at: completedAt })
    .eq('landlord_id', landlordId)
    .in('status', ['active', 'escalated'])

  if (error) {
    return { ok: false, error: `workflow_runs: ${error.message}` }
  }
  return { ok: true }
}

async function countLandlordOps(
  landlordId: string,
): Promise<{ tickets: number; workflowRuns: number; activeWorkflowRuns: number }> {
  if (!supabase) {
    return { tickets: 0, workflowRuns: 0, activeWorkflowRuns: 0 }
  }
  const [tickets, runs, activeRuns] = await Promise.all([
    supabase
      .from('maintenance_requests')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId),
    supabase
      .from('workflow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId),
    supabase
      .from('workflow_runs')
      .select('id', { count: 'exact', head: true })
      .eq('landlord_id', landlordId)
      .in('status', ['active', 'escalated']),
  ])
  return {
    tickets: tickets.count ?? 0,
    workflowRuns: runs.count ?? 0,
    activeWorkflowRuns: activeRuns.count ?? 0,
  }
}

/**
 * New Landlord dashboard sync.
 *
 * Live SMS/web tickets and workflow runs are never deleted on dashboard load.
 * Destructive wipe of workflow runs / tickets only happens when the user clicks
 * **Reset onboarding** (`resetOnboardingPortfolio` / `restartNewLandlordOnboarding`).
 */
export type OnboardingDashboardSync = {
  landlordId: string
  /** Always true — dashboards load real ops for New Landlord. */
  allowImportedOperations: boolean
  purged: boolean
  error?: string
}

export async function ensureOnboardingDashboardMatchesPortfolio(
  landlordId: string = getActiveLandlordId(),
): Promise<OnboardingDashboardSync> {
  // Do not call purge_empty_landlord_operations here. That RPC deleted every
  // maintenance ticket + non-onboarding workflow run on each Overview/Comms load,
  // which wiped real SMS work orders (e.g. WO-3466). Reset is explicit-only.
  return { landlordId, allowImportedOperations: true, purged: false }
}

export async function resetOnboardingPortfolio(
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    // Non-onboarding accounts: no-op (never wipe demo/default).
    return { ok: true }
  }
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.' }
  }

  const { data: vendorRows, error: vendorLoadError } = await supabase
    .from('vendors')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (vendorLoadError) {
    return { ok: false, error: vendorLoadError.message }
  }

  const vendorIds = (vendorRows ?? []).map((row) => String((row as { id: string }).id))

  const { data: unitRows, error: unitLoadError } = await supabase
    .from('units')
    .select('id')
    .eq('landlord_id', scope.landlordId)

  if (unitLoadError) {
    return { ok: false, error: unitLoadError.message }
  }

  const unitIds = (unitRows ?? []).map((row) => String((row as { id: string }).id))

  // Clear progress statuses before any vendor FK SET NULL can trip the check constraint.
  const detached = await detachVendorsFromMaintenanceRequests(scope.landlordId, vendorIds)
  if (!detached.ok) return detached

  // Tickets + workflow runs (RPC when available; verifies leftovers).
  const purged = await purgeOnboardingImportedOperations(scope.landlordId)
  if (!purged.ok) return purged

  const afterOps = [
    await deleteLandlordScopedRows('preventive_maintenance_tasks', scope.landlordId),
    await deleteLandlordScopedRows('unit_assets', scope.landlordId),
    await deleteLandlordScopedRows('users', scope.landlordId),
    await deleteInScopedRows('vendors', 'id', vendorIds),
    await deleteLandlordScopedRows('vendors', scope.landlordId),
  ]
  const afterFailed = afterOps.find((result) => !result.ok)
  if (afterFailed) return afterFailed

  const removed = await deleteUnitsByIds(unitIds)
  if (!removed.ok) return removed

  const unitsScoped = await deleteLandlordScopedRows('units', scope.landlordId)
  if (!unitsScoped.ok) return unitsScoped

  return { ok: true }
}

/** Wipe portfolio + onboarding progress and return to the welcome hub. */
export async function restartNewLandlordOnboarding(
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string; state?: LandlordOnboardingState }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    return { ok: false, error: scope.error }
  }

  // Clear wizard status first so the guard cannot bounce on stale "completed" localStorage
  // even if portfolio deletes partially fail.
  clearLocalOnboardingStorage(scope.landlordId)
  clearVendorSetupInboxForLandlord(scope.landlordId)

  const cleared: LandlordOnboardingState = {
    ...defaultOnboardingState(scope.landlordId),
    onboardingStatus: 'not_started',
    currentStep: 'entry',
    setupPath: null,
    properties: [],
  }
  await saveLandlordOnboarding(cleared)

  const reset = await resetOnboardingPortfolio(scope.landlordId)
  if (!reset.ok) {
    return {
      ok: false,
      error: reset.error ?? 'Could not clear previous portfolio data.',
      state: cleared,
    }
  }

  return { ok: true, state: cleared }
}

/** Wipe units/vendors/residents and clear property draft; optionally keep account setup fields. */
export async function clearOnboardingPortfolioSession(
  options: { keepAccountSetup?: boolean; landlordId?: string } = {},
): Promise<{ ok: boolean; error?: string; state: LandlordOnboardingState }> {
  const landlordId = options.landlordId ?? getActiveLandlordId()
  const keepAccountSetup = options.keepAccountSetup !== false

  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    return {
      ok: false,
      error: scope.error,
      state: defaultOnboardingState(landlordId),
    }
  }

  const reset = await resetOnboardingPortfolio(scope.landlordId)
  if (!reset.ok) {
    return {
      ok: false,
      error: reset.error,
      state: readLocalOnboardingState(scope.landlordId) ?? defaultOnboardingState(scope.landlordId),
    }
  }

  const draft = await readLandlordOnboardingDraft(scope.landlordId)
  const accountSetup =
    keepAccountSetup && hasOnboardingAccountDraft(draft)
      ? draft.accountSetup
      : defaultOnboardingState(scope.landlordId).accountSetup

  const cleared: LandlordOnboardingState = {
    ...defaultOnboardingState(scope.landlordId),
    accountSetup,
    onboardingStatus: 'not_started',
    currentStep: 'entry',
    setupPath: null,
    properties: [],
  }

  await saveLandlordOnboarding(cleared)
  return { ok: true, state: cleared }
}

type ImportUnitRow = {
  id: string
  unitLabel: string
  building: string | null
}

type ImportResidentRow = {
  id: string
  fullName: string
  unit: string
  building: string
  email: string
}

type ImportVendorRow = {
  id: string
  category: string
}

function mapExtractedIssuePriority(priority: string): {
  priority: string
  urgency: string
  severity: string
} {
  const value = priority.trim().toLowerCase()
  if (value === 'urgent' || value === 'emergency') {
    return { priority: 'urgent', urgency: 'urgent', severity: 'urgent' }
  }
  if (value === 'high') {
    return { priority: 'high', urgency: 'urgent', severity: 'high' }
  }
  return { priority: 'normal', urgency: 'normal', severity: 'normal' }
}

function resolveImportUnitLabel(issueUnit: string, units: ImportUnitRow[]): string {
  const trimmed = issueUnit.trim()
  if (!trimmed) return trimmed

  const exact = units.find(
    (unit) => unit.unitLabel.trim().toLowerCase() === trimmed.toLowerCase(),
  )
  if (exact) return exact.unitLabel

  const letter = trimmed.toUpperCase()
  if (/^[A-Z]$/.test(letter)) {
    const index = letter.charCodeAt(0) - 'A'.charCodeAt(0)
    if (units[index]) return units[index]!.unitLabel
  }

  return trimmed
}

function findImportResident(
  residents: ImportResidentRow[],
  issueUnit: string,
  building: string,
): ImportResidentRow | undefined {
  const unitKey = issueUnit.trim().toLowerCase()
  const buildingKey = normalizeBuildingKey(building)
  return (
    residents.find(
      (resident) =>
        resident.unit.trim().toLowerCase() === unitKey &&
        normalizeBuildingKey(resident.building) === buildingKey,
    ) ?? residents.find((resident) => resident.unit.trim().toLowerCase() === unitKey)
  )
}

function findImportUnit(
  units: ImportUnitRow[],
  issueUnit: string,
  building: string,
  resolvedLabel: string,
): ImportUnitRow | undefined {
  const buildingKey = normalizeBuildingKey(building)
  return (
    units.find(
      (unit) =>
        unit.unitLabel === resolvedLabel &&
        normalizeBuildingKey(unit.building ?? '') === buildingKey,
    ) ??
    units.find((unit) => unit.unitLabel === resolvedLabel) ??
    units.find(
      (unit) =>
        unit.unitLabel.trim().toLowerCase() === issueUnit.trim().toLowerCase() &&
        normalizeBuildingKey(unit.building ?? '') === buildingKey,
    )
  )
}

function parseFlexibleDate(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Date.parse(trimmed)
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  return null
}

async function fetchImportUnits(landlordId: string): Promise<ImportUnitRow[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('units')
    .select('id, unit_label, building')
    .eq('landlord_id', landlordId)
    .order('unit_label', { ascending: true })

  if (error) {
    console.warn('[landlordOnboarding] fetch import units', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String((row as { id: string }).id),
    unitLabel: String((row as { unit_label: string }).unit_label ?? ''),
    building: String((row as { building?: string | null }).building ?? '') || null,
  }))
}

async function fetchImportResidents(landlordId: string): Promise<ImportResidentRow[]> {
  const residents = await fetchOnboardingResidents(landlordId)
  return residents.map((resident) => ({
    id: resident.id,
    fullName: resident.fullName,
    unit: resident.unit,
    building: resident.building,
    email: resident.email,
  }))
}

async function logImportWorkflowEvent(
  workflowRunId: string,
  event: {
    eventType: string
    step?: string
    message: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  if (!supabase) return

  const { error } = await supabase.from('workflow_events').insert({
    workflow_run_id: workflowRunId,
    event_type: event.eventType,
    step: event.step ?? null,
    actor_type: 'system',
    message: event.message,
    metadata: event.metadata ?? {},
  })

  if (error) {
    console.warn('[landlordOnboarding] workflow event insert', error.message)
  }
}

function matchImportVendorForCategory(
  category: string,
  vendors: ImportVendorRow[],
): ImportVendorRow | undefined {
  if (vendors.length === 0) return undefined

  const issueTrade = issueCategoryToVendorTrade(category)
  const preferred = [issueTrade, 'general'] as const

  for (const preferredSlug of preferred) {
    const match = vendors.find((vendor) => {
      const vendorTrade = normalizeVendorTrade(vendor.category, { fallbackOther: false })
      if (preferredSlug === 'general') {
        return isGeneralistTrade(vendor.category) || vendorTrade === 'general'
      }
      return vendorTrade === preferredSlug
    })
    if (match) return match
  }

  return vendors[0]
}

async function importExtractedMaintenanceIssues(
  issues: ExtractedMaintenanceIssue[],
  params: {
    landlordId: string
    units: ImportUnitRow[]
    residents: ImportResidentRow[]
    vendors: ImportVendorRow[]
  },
): Promise<{ tickets: number; workflowRuns: number }> {
  if (!supabase || issues.length === 0) {
    return { tickets: 0, workflowRuns: 0 }
  }

  let tickets = 0
  let workflowRuns = 0
  const now = Date.now()

  for (let index = 0; index < issues.length; index++) {
    const issue = issues[index]!
    const resolvedUnit = resolveImportUnitLabel(issue.unit, params.units)
    const resident = findImportResident(params.residents, issue.unit, issue.building)
    const unit = findImportUnit(params.units, issue.unit, issue.building, resolvedUnit)
    const sla = mapExtractedIssuePriority(issue.priority)
    const createdAt = new Date(now - index * 36 * 60 * 60 * 1000).toISOString()
    const dueAt = new Date(
      Date.now() -
        (sla.severity === 'urgent' || sla.severity === 'high' ? 6 : 1) * 60 * 60 * 1000,
    ).toISOString()
    const matchedVendor = matchImportVendorForCategory(issue.category, params.vendors)
    const vendorWorkStatus = matchedVendor
      ? index % 2 === 0
        ? 'pending_accept'
        : 'accepted'
      : 'unassigned'

    const { data: ticketRow, error: ticketError } = await supabase
      .from('maintenance_requests')
      .insert({
        landlord_id: params.landlordId,
        created_at: createdAt,
        priority: sla.priority,
        urgency: sla.urgency,
        severity: sla.severity,
        resident_name: resident?.fullName ?? 'Property Manager',
        email: resident?.email?.trim() || 'newlandlord@ulohome.io',
        unit: resolvedUnit,
        description: issue.description.trim() || 'Imported maintenance issue',
        assigned_vendor_id: matchedVendor?.id ?? null,
        assigned_at: matchedVendor ? createdAt : null,
        vendor_work_status: vendorWorkStatus,
        issue_category: issue.category.trim() || 'general',
        estimated_minutes: sla.severity === 'urgent' ? 240 : 480,
        due_at: dueAt,
      })
      .select('id')
      .single()

    if (ticketError || !ticketRow?.id) {
      console.warn('[landlordOnboarding] maintenance import', ticketError?.message)
      continue
    }

    tickets += 1
    const ticketId = String(ticketRow.id)
    const runStatus = sla.severity === 'urgent' || index === 0 ? 'escalated' : 'active'

    const { data: runRow, error: runError } = await supabase
      .from('workflow_runs')
      .insert({
        template_id: 'maintenance_intake',
        status: runStatus,
        entity_type: 'maintenance_request',
        entity_id: ticketId,
        property_id: null,
        unit_id: unit?.id ?? null,
        resident_id: resident?.id ?? null,
        landlord_id: params.landlordId,
        trigger_type: 'dashboard',
        workflow_type: 'maintenance',
        current_stage: runStatus === 'escalated' ? 'escalated' : 'routed',
        current_step: runStatus === 'escalated' ? 'awaiting_review' : 'document_import',
        started_at: createdAt,
        metadata: {
          landlord_id: params.landlordId,
          unit_label: resolvedUnit,
          building: issue.building,
          maintenance_request_id: ticketId,
          issue_category: issue.category,
          source: 'onboarding_import',
          description: issue.description,
        },
      })
      .select('id')
      .single()

    if (runError || !runRow?.id) {
      console.warn('[landlordOnboarding] maintenance workflow import', runError?.message)
      continue
    }

    workflowRuns += 1
    const runId = String(runRow.id)
    await logImportWorkflowEvent(runId, {
      eventType: 'workflow.trigger',
      step: 'document_import',
      message: 'Maintenance issue imported from onboarding documents',
      metadata: { maintenance_request_id: ticketId, source: 'onboarding_import' },
    })
    if (runStatus === 'escalated') {
      await logImportWorkflowEvent(runId, {
        eventType: 'workflow.escalate',
        step: 'awaiting_review',
        message: 'Imported issue flagged for landlord review',
      })
    }
  }

  return { tickets, workflowRuns }
}

async function importExtractedLeases(
  leases: ExtractedLease[],
  params: {
    landlordId: string
    units: ImportUnitRow[]
    residents: ImportResidentRow[]
  },
): Promise<{ leases: number; workflowRuns: number }> {
  if (!supabase || leases.length === 0) {
    return { leases: 0, workflowRuns: 0 }
  }

  let importedLeases = 0
  let workflowRuns = 0

  for (let index = 0; index < leases.length; index++) {
    const lease = leases[index]!
    const resident =
      params.residents.find(
        (row) => row.fullName.trim().toLowerCase() === lease.residentName.trim().toLowerCase(),
      ) ?? findImportResident(params.residents, lease.unit, lease.building)
    const resolvedUnit = resolveImportUnitLabel(lease.unit, params.units)
    const unit = findImportUnit(params.units, lease.unit, lease.building, resolvedUnit)
    const leaseEndIso = parseFlexibleDate(lease.leaseEnd)
    const startedAt = new Date(Date.now() - (index + 1) * 3 * 24 * 60 * 60 * 1000).toISOString()
    const runStatus = index === 0 ? 'active' : 'escalated'

    const { data: runRow, error: runError } = await supabase
      .from('workflow_runs')
      .insert({
        template_id: 'lease_renewal',
        status: runStatus,
        entity_type: resident ? 'user' : 'lease_document',
        entity_id: resident?.id ?? null,
        property_id: null,
        unit_id: unit?.id ?? null,
        resident_id: resident?.id ?? null,
        landlord_id: params.landlordId,
        trigger_type: 'dashboard',
        workflow_type: 'leasing',
        current_stage: runStatus === 'escalated' ? 'escalated' : 'acted',
        current_step: runStatus === 'escalated' ? 'no_response' : 'renewal_offer_sent',
        started_at: startedAt,
        metadata: {
          landlord_id: params.landlordId,
          unit_label: resolvedUnit,
          building: lease.building,
          resident_name: lease.residentName,
          lease_start: lease.leaseStart,
          lease_end_date: lease.leaseEnd,
          lease_end_iso: leaseEndIso,
          rent_amount: lease.rentAmount ?? null,
          source: 'onboarding_import',
          document_type: 'lease_agreement',
        },
      })
      .select('id')
      .single()

    if (runError || !runRow?.id) {
      console.warn('[landlordOnboarding] lease workflow import', runError?.message)
      continue
    }

    importedLeases += 1
    workflowRuns += 1
    const runId = String(runRow.id)
    await logImportWorkflowEvent(runId, {
      eventType: 'lease.document_imported',
      step: 'document_import',
      message: `Lease document imported for ${lease.residentName}`,
      metadata: { source: 'onboarding_import', lease_end: lease.leaseEnd },
    })
    await logImportWorkflowEvent(runId, {
      eventType: runStatus === 'escalated' ? 'workflow.escalate' : 'lease.renewal_started',
      step: runStatus === 'escalated' ? 'no_response' : 'renewal_offer_sent',
      message:
        runStatus === 'escalated'
          ? 'Lease renewal awaiting landlord decision'
          : 'Lease renewal offer sent from imported documents',
    })
  }

  return { leases: importedLeases, workflowRuns }
}

export async function importMockExtraction(
  review: MockExtractionReview,
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string; imported: Record<string, number> }> {
  const scope = requireOnboardingLandlord(landlordId)
  if (!scope.ok) {
    return { ok: false, error: scope.error, imported: {} }
  }
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.', imported: {} }
  }
  landlordId = scope.landlordId

  const imported = {
    properties: 0,
    units: 0,
    residents: 0,
    vendors: 0,
    tickets: 0,
    leases: 0,
    workflowRuns: 0,
  }

  const selectedProperties = review.properties.filter((p) => p.selected)
  const onboardingProperties: OnboardingProperty[] = selectedProperties.map((p) => ({
    id: p.id,
    name: p.name,
    streetAddress: p.address.split(',')[0]?.trim() ?? p.address,
    city: '',
    state: '',
    zipCode: '',
    unitCount: p.unitCount,
  }))

  if (onboardingProperties.length > 0) {
    const unitResult = await persistOnboardingProperties(onboardingProperties)
    if (!unitResult.ok) return { ...unitResult, imported }
    imported.properties = onboardingProperties.length
    imported.units = onboardingProperties.reduce((s, p) => s + p.unitCount, 0)
  }

  const selectedResidents = review.residents.filter((r) => r.selected)
  const selectedLeases = review.leases.filter((lease) => lease.selected)
  for (let i = 0; i < selectedResidents.length; i++) {
    const r = selectedResidents[i]!
    const residentId = `ONB-${String(i + 1).padStart(3, '0')}`
    const matchedLease = selectedLeases.find(
      (lease) =>
        lease.residentName.trim().toLowerCase() === r.fullName.trim().toLowerCase() ||
        (lease.unit.trim() &&
          r.unit.trim() &&
          lease.unit.trim().toLowerCase() === r.unit.trim().toLowerCase()),
    )
    const monthlyRent =
      matchedLease?.rentAmount != null
        ? parseMonthlyRentInput(matchedLease.rentAmount)
        : null
    const { error } = await supabase.from('users').insert({
      resident_id: residentId,
      full_name: r.fullName,
      email: r.email,
      phone: r.phone,
      unit: r.unit,
      building: r.building,
      status: 'active',
      balance_due: 0,
      issues: [],
      landlord_id: landlordId,
      move_in_date: r.leaseStart || null,
      lease_end_date: r.leaseEnd || null,
      monthly_rent: monthlyRent,
    })
    if (!error) imported.residents += 1
  }

  const selectedVendors = review.vendors.filter((v) => v.selected)
  const seenVendorNames = new Set<string>()
  const uniqueSelectedVendors = selectedVendors.filter((vendor) => {
    const nameKey = vendor.name.trim().toLowerCase()
    if (!nameKey || seenVendorNames.has(nameKey)) return false
    seenVendorNames.add(nameKey)
    return true
  })

  if (uniqueSelectedVendors.length > 0) {
    const existingVendors = await fetchOnboardingVendors(landlordId)
    const existingByName = new Map(
      existingVendors.map((vendor) => [vendor.name.trim().toLowerCase(), vendor]),
    )

    for (const vendor of uniqueSelectedVendors) {
      const nameKey = vendor.name.trim().toLowerCase()
      const payload = {
        name: vendor.name,
        category: vendor.category,
        email: vendor.email,
        phone: normalizePhoneForDb(vendor.phone) ?? null,
        notification_channel: 'both' as const,
        active: true,
      }
      const existing = existingByName.get(nameKey)
      if (existing) {
        const { error } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', existing.id)
          .eq('landlord_id', landlordId)
        if (!error) imported.vendors += 1
        continue
      }

      const { error } = await supabase.from('vendors').insert({
        ...payload,
        landlord_id: landlordId,
      })
      if (!error) {
        imported.vendors += 1
        existingByName.set(nameKey, {
          id: `imported-${nameKey}`,
          name: vendor.name,
          category: vendor.category ?? '',
          email: vendor.email,
          phone: vendor.phone,
        })
      }
    }
  }

  const [importUnits, importResidents, importVendors] = await Promise.all([
    fetchImportUnits(landlordId),
    fetchImportResidents(landlordId),
    fetchOnboardingVendors(landlordId),
  ])

  const maintenanceIssues = review.maintenanceIssues.filter((issue) => issue.selected)
  if (maintenanceIssues.length > 0) {
    const maintenanceImport = await importExtractedMaintenanceIssues(maintenanceIssues, {
      landlordId,
      units: importUnits,
      residents: importResidents,
      vendors: importVendors.map((vendor) => ({
        id: vendor.id,
        category: vendor.category,
      })),
    })
    imported.tickets = maintenanceImport.tickets
    imported.workflowRuns += maintenanceImport.workflowRuns
  }

  if (selectedLeases.length > 0) {
    const leaseImport = await importExtractedLeases(selectedLeases, {
      landlordId,
      units: importUnits,
      residents: importResidents,
    })
    imported.leases = leaseImport.leases
    imported.workflowRuns += leaseImport.workflowRuns
  }

  return { ok: true, imported }
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

export function canCompleteOnboarding(
  state: LandlordOnboardingState,
  vendors: OnboardingVendor[] = [],
  residents: OnboardingResident[] = [],
  dbCounts?: AccountSetupCounts,
): { ok: boolean; missing: string[] } {
  const metrics = buildOnboardingReviewMetrics(state, vendors, residents, dbCounts)
  const missing: string[] = []
  if (!state.accountSetup.companyName.trim()) missing.push('Company name')
  if (!state.accountSetup.contactName.trim()) missing.push('Contact name')
  if (metrics.properties === 0) missing.push('At least one property')
  if (metrics.units === 0) missing.push('At least one unit')
  return { ok: missing.length === 0, missing }
}

export async function completeOnboarding(
  state: LandlordOnboardingState,
  vendors: OnboardingVendor[] = [],
  residents: OnboardingResident[] = [],
  dbCounts?: AccountSetupCounts,
): Promise<{ ok: boolean; error?: string; activationWarning?: string }> {
  const scope = requireOnboardingLandlord(state.landlordId)
  if (!scope.ok) return scope

  const check = canCompleteOnboarding(state, vendors, residents, dbCounts)
  if (!check.ok) {
    return { ok: false, error: `Missing: ${check.missing.join(', ')}` }
  }

  // Do not purge tickets/workflow runs on complete — live SMS intake may already
  // have created real work orders. Wipe only via Reset onboarding.

  const completed: LandlordOnboardingState = {
    ...state,
    landlordId: scope.landlordId,
    onboardingStatus: 'completed',
    currentStep: 'review',
    completedAt: new Date().toISOString(),
  }
  await saveLandlordOnboarding(completed)

  // General rule: anyone listed during onboarding is automatically started on
  // their activation/verification flow when setup completes (tenants + vendors).
  // Best-effort — never block finishing setup on delivery failures.
  const warnings: string[] = []
  const companyName = state.accountSetup.companyName.trim() || null
  const propertyName = state.properties.map((p) => p.name.trim()).find(Boolean) || undefined

  try {
    const residentIds = residents
      .filter((r) => r.phone.trim().length > 0)
      .map((r) => r.id)
      .filter((id) => id.trim().length > 0)
    if (residentIds.length > 0) {
      const summary = await sendTenantActivationSms({
        landlordId: scope.landlordId,
        residentIds,
        companyName,
      })
      if (!summary.configured) {
        console.warn('[landlordOnboarding] tenant activation not configured')
      } else if (summary.error) {
        warnings.push(`couldn't send welcome texts to your residents (${summary.error})`)
      } else if ((summary.failed ?? 0) > 0) {
        const failed = summary.failed ?? 0
        warnings.push(
          `couldn't send welcome texts to ${failed} resident${failed === 1 ? '' : 's'}`,
        )
      }
    }
  } catch (err) {
    console.warn('[landlordOnboarding] tenant activation trigger failed', err)
    warnings.push('the resident welcome texts could not be sent')
  }

  try {
    const inviteable = vendors.filter(
      (v) => v.phone.trim().length > 0 || v.email.trim().length > 0,
    )
    if (inviteable.length > 0) {
      const results = await Promise.allSettled(
        inviteable.map((vendor) => {
          const phone = vendor.phone.trim()
          const email = vendor.email.trim()
          const channel: VendorInviteChannel =
            phone && email ? 'both' : phone ? 'sms' : 'email'
          const trade = normalizeVendorTrade(vendor.category, { fallbackOther: false })
          return sendVendorInvite({
            landlordId: scope.landlordId,
            vendorId: vendor.id,
            businessName: vendor.name.trim(),
            email: email || undefined,
            phone: phone || undefined,
            propertyName,
            channel,
            tradeCategories: trade ? [trade] : undefined,
          })
        }),
      )

      let failed = 0
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failed += 1
          console.warn('[landlordOnboarding] vendor invite failed', {
            vendorId: inviteable[index]?.id,
            reason: result.reason,
          })
          return
        }
        const delivery = result.value.delivery
        const anySent = delivery.sms === 'sent' || delivery.email === 'sent'
        if (!anySent) {
          failed += 1
          console.warn('[landlordOnboarding] vendor invite not delivered', {
            vendorId: inviteable[index]?.id,
            delivery,
          })
        }
      })

      if (failed > 0) {
        warnings.push(
          `couldn't send verification invites to ${failed} vendor${failed === 1 ? '' : 's'}`,
        )
      }
    }
  } catch (err) {
    console.warn('[landlordOnboarding] vendor invite trigger failed', err)
    warnings.push('the vendor verification invites could not be sent')
  }

  const activationWarning =
    warnings.length > 0
      ? `We finished setup, but ${warnings.join('; ')}. Check the activity feed for details.`
      : undefined

  return { ok: true, activationWarning }
}

export function shouldBlockDashboard(
  state: LandlordOnboardingState,
  landlordId: string = getActiveLandlordId(),
): boolean {
  return isOnboardingLandlordAccount(landlordId) && state.onboardingStatus !== 'completed'
}

export function createPropertyId(): string {
  return `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function getActiveOnboardingStepIndex(
  step: OnboardingStep,
  setupPath: OnboardingSetupPath = null,
): number {
  const resolved = resolveOnboardingStepForPath(normalizeOnboardingStep(step), setupPath)
  return getOnboardingStepOrder(setupPath).indexOf(resolved)
}
