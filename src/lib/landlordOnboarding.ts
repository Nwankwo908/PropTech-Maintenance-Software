/**
 * Landlord onboarding — wizard state, persistence, and import helpers.
 * Scoped to the New Landlord showcase account (EMPTY_LANDLORD_ID).
 */
import { ensureUnitsInDb } from '@/api/unitVacancy'
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
  email: string
  phone: string
}

function unitInventoryKey(unitLabel: string, building: string | null | undefined): string {
  return `${unitLabel.trim()}::${String(building ?? '').trim()}`
}

function buildOnboardingUnitInventory(
  properties: OnboardingProperty[],
): Array<{ unitLabel: string; building: string }> {
  const units: Array<{ unitLabel: string; building: string }> = []
  for (const property of properties) {
    const building = property.name.trim()
    if (!building) continue
    for (const label of generateUnitLabels(property.unitCount)) {
      units.push({ unitLabel: label, building })
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
  units: Array<{ unitLabel: string; building: string | null }>,
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

  const remainingKeys = new Set(
    (existing ?? [])
      .filter((row) => !staleUnitIds.includes(String((row as { id: string }).id)))
      .map((row) =>
        unitInventoryKey(
          String((row as { unit_label: string }).unit_label),
          (row as { building?: string | null }).building,
        ),
      ),
  )

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
      return syncOnboardingPropertyUnits(landlordId, units)
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to register units.' }
  }

  return syncOnboardingPropertyUnits(landlordId, units)
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
    .select('id, resident_id, full_name, email, phone, unit')
    .eq('landlord_id', landlordId)
    .order('created_at', { ascending: true })

  if (error) {
    console.warn('[landlordOnboarding] fetch residents', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String((row as { id: string }).id),
    residentId: String((row as { resident_id: string }).resident_id ?? ''),
    fullName: String((row as { full_name: string }).full_name ?? ''),
    unit: String((row as { unit?: string | null }).unit ?? ''),
    email: String((row as { email?: string | null }).email ?? ''),
    phone: String((row as { phone?: string | null }).phone ?? ''),
  }))
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

export async function resetOnboardingPortfolio(
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string }> {
  if (!isOnboardingLandlordAccount(landlordId)) {
    return { ok: true }
  }
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.' }
  }

  const { data: ticketRows, error: ticketLoadError } = await supabase
    .from('maintenance_requests')
    .select('id')
    .eq('landlord_id', landlordId)

  if (ticketLoadError) {
    return { ok: false, error: ticketLoadError.message }
  }

  const ticketIds = (ticketRows ?? []).map((row) => String((row as { id: string }).id))

  const { data: unitRows, error: unitLoadError } = await supabase
    .from('units')
    .select('id')
    .eq('landlord_id', landlordId)

  if (unitLoadError) {
    return { ok: false, error: unitLoadError.message }
  }

  const unitIds = (unitRows ?? []).map((row) => String((row as { id: string }).id))
  const removed = await deleteUnitsByIds(unitIds)
  if (!removed.ok) {
    return removed
  }

  const childDelete = await deleteInScopedRows('vendor_status_events', 'ticket_id', ticketIds)
  if (!childDelete.ok) {
    return childDelete
  }

  const parallelDeletes = await Promise.all([
    deleteLandlordScopedRows('vendor_feedback', landlordId),
    deleteLandlordScopedRows('maintenance_invoices', landlordId),
    deleteLandlordScopedRows('preventive_maintenance_tasks', landlordId),
    deleteLandlordScopedRows('unit_assets', landlordId),
    deleteLandlordScopedRows('operations_graph_events', landlordId),
    deleteLandlordScopedRows('workflow_events', landlordId),
    deleteLandlordScopedRows('workflow_runs', landlordId),
    deleteLandlordScopedRows('maintenance_requests', landlordId),
    deleteLandlordScopedRows('users', landlordId),
    deleteLandlordScopedRows('vendors', landlordId),
    deleteLandlordScopedRows('units', landlordId),
  ])

  const failed = parallelDeletes.find((result) => !result.ok)
  if (failed) {
    return failed
  }

  return { ok: true }
}

/** Wipe portfolio + onboarding progress and return to the welcome hub. */
export async function restartNewLandlordOnboarding(
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string; state?: LandlordOnboardingState }> {
  if (!isOnboardingLandlordAccount(landlordId)) {
    return { ok: false, error: 'Only the New Landlord account can be reset.' }
  }

  clearLocalOnboardingStorage(landlordId)

  const cleared: LandlordOnboardingState = {
    ...defaultOnboardingState(landlordId),
    onboardingStatus: 'not_started',
    currentStep: 'entry',
    setupPath: null,
    properties: [],
  }

  await saveLandlordOnboarding(cleared)

  void resetOnboardingPortfolio(landlordId).catch((err) => {
    console.warn('[landlordOnboarding] background portfolio reset failed', err)
  })

  return { ok: true, state: cleared }
}

/** Wipe units/vendors/residents and clear property draft; optionally keep account setup fields. */
export async function clearOnboardingPortfolioSession(
  options: { keepAccountSetup?: boolean; landlordId?: string } = {},
): Promise<{ ok: boolean; error?: string; state: LandlordOnboardingState }> {
  const landlordId = options.landlordId ?? getActiveLandlordId()
  const keepAccountSetup = options.keepAccountSetup !== false

  if (!isOnboardingLandlordAccount(landlordId)) {
    return { ok: true, state: defaultOnboardingState(landlordId) }
  }

  const reset = await resetOnboardingPortfolio(landlordId)
  if (!reset.ok) {
    return {
      ok: false,
      error: reset.error,
      state: readLocalOnboardingState(landlordId) ?? defaultOnboardingState(landlordId),
    }
  }

  const draft = await readLandlordOnboardingDraft(landlordId)
  const accountSetup =
    keepAccountSetup && hasOnboardingAccountDraft(draft)
      ? draft.accountSetup
      : defaultOnboardingState(landlordId).accountSetup

  const cleared: LandlordOnboardingState = {
    ...defaultOnboardingState(landlordId),
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

  const normalized = category.trim().toLowerCase()
  const preferredCategories: string[] =
    normalized === 'plumbing' || normalized === 'water_damage'
      ? ['plumbing', 'general']
      : normalized === 'electrical'
        ? ['electrical', 'general']
        : normalized === 'hvac'
          ? ['hvac', 'general']
          : normalized === 'appliance'
            ? ['appliance', 'general']
            : [normalized, 'general']

  for (const preferred of preferredCategories) {
    const match = vendors.find(
      (vendor) => vendor.category.trim().toLowerCase() === preferred,
    )
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
  if (!supabase) {
    return { ok: false, error: 'Database unavailable.', imported: {} }
  }

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
  for (let i = 0; i < selectedResidents.length; i++) {
    const r = selectedResidents[i]!
    const residentId = `ONB-${String(i + 1).padStart(3, '0')}`
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
      move_in_date: r.leaseStart,
      lease_end_date: r.leaseEnd,
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
          category: vendor.category,
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

  const selectedLeases = review.leases.filter((lease) => lease.selected)
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
): Promise<{ ok: boolean; error?: string }> {
  const check = canCompleteOnboarding(state, vendors, residents, dbCounts)
  if (!check.ok) {
    return { ok: false, error: `Missing: ${check.missing.join(', ')}` }
  }

  const completed: LandlordOnboardingState = {
    ...state,
    onboardingStatus: 'completed',
    currentStep: 'review',
    completedAt: new Date().toISOString(),
  }
  await saveLandlordOnboarding(completed)
  return { ok: true }
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
