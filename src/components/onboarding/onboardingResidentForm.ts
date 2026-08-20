/**
 * Resident step form helpers — moved from AdminOnboardingDashboard (behavior unchanged).
 */
import type { Dispatch, SetStateAction } from 'react'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getOnboardingErrorMessage } from '@/lib/errorMessage'
import {
  allocateOnboardingResidentId,
  fetchOnboardingResidents,
  listOnboardingUnitOptions,
  maxOnboardingResidentSequence,
  nextOnboardingResidentIdFromSequence,
  normalizeOnboardingOccupancyStatus,
  onboardingResidentIdPrefix,
  parseLeaseDateInput,
  parseMonthlyRentInput,
  parseRentDueDayInput,
  readLocalOnboardingState,
  requireOnboardingLandlord,
  type LandlordOnboardingState,
  type OnboardingFormDraft,
  type OnboardingOccupancyStatus,
  type OnboardingProperty,
  type OnboardingResident,
  type PropertyFormRow,
  type RentDueDayChoice,
  type ResidentFormRow,
} from '@/lib/onboarding'
import { deleteResidentsForLandlord } from '@/lib/residentDeletion'
import { phoneForDbOrError, normalizePhoneForDb } from '@/lib/phoneFormat'
import { supabase } from '@/lib/supabase'
import { activateUnitsFromResidentAssignments } from '@/lib/unitActivation'
import { isPersistedOnboardingRowId } from './onboardingPersistedId'

export type { RentDueDayChoice, ResidentFormRow }

/** Accepts UI rows and persisted drafts (draft `rentDueDayMode` is optional string). */
export type ResidentFormInput = {
  id: string
  residentId?: string
  fullName?: string
  unit?: string
  building?: string
  email?: string
  phone?: string
  monthlyRent?: string
  rentDueDayMode?: string
  rentDueDay?: string
  leaseStart?: string
  leaseEnd?: string
  maintenanceResponsibilitiesClause?: string
  occupancyStatus?: OnboardingOccupancyStatus | string
}

export function residentFormRowHasUserInput(form: ResidentFormInput): boolean {
  return (
    (form.fullName ?? '').trim() !== '' ||
    (form.unit ?? '').trim() !== '' ||
    (form.building ?? '').trim() !== '' ||
    (form.phone ?? '').trim() !== '' ||
    (form.email ?? '').trim() !== '' ||
    (form.monthlyRent ?? '').trim() !== '' ||
    (form.rentDueDayMode ?? '') !== '' ||
    (form.rentDueDay ?? '').trim() !== '' ||
    (form.leaseStart ?? '').trim() !== '' ||
    (form.leaseEnd ?? '').trim() !== '' ||
    (form.maintenanceResponsibilitiesClause ?? '').trim() !== '' ||
    Boolean(form.occupancyStatus && form.occupancyStatus !== 'active')
  )
}

export function residentFormsHaveData(forms: ResidentFormInput[] | undefined): boolean {
  return (forms ?? []).some(residentFormRowHasUserInput)
}

export function rentDueDayModeFromDay(day: number | null | undefined): RentDueDayChoice {
  if (day == null || !Number.isFinite(day)) return ''
  if (day === 1) return '1'
  if (day === 5) return '5'
  return 'custom'
}

export function resolveRentDueDayMode(
  mode: string | undefined,
  dayValue: string,
): RentDueDayChoice {
  if (mode === '1' || mode === '5' || mode === 'custom' || mode === '') {
    return mode
  }
  const trimmed = dayValue.trim()
  if (!trimmed) return ''
  if (trimmed === '1') return '1'
  if (trimmed === '5') return '5'
  return 'custom'
}

export function createEmptyResidentForm(defaultBuilding = ''): ResidentFormRow {
  return {
    id: `resident-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fullName: '',
    unit: '',
    building: defaultBuilding,
    email: '',
    phone: '',
    monthlyRent: '',
    rentDueDayMode: '',
    rentDueDay: '',
    leaseStart: '',
    leaseEnd: '',
    maintenanceResponsibilitiesClause: '',
    occupancyStatus: 'active',
  }
}

export function normalizeResidentFormRow(form: ResidentFormInput): ResidentFormRow {
  const rentDueDay = form.rentDueDay ?? ''
  return {
    id: form.id,
    residentId: form.residentId,
    fullName: form.fullName ?? '',
    unit: form.unit ?? '',
    building: form.building ?? '',
    email: form.email ?? '',
    phone: form.phone ?? '',
    monthlyRent: form.monthlyRent ?? '',
    rentDueDayMode: resolveRentDueDayMode(form.rentDueDayMode, rentDueDay),
    rentDueDay,
    leaseStart: form.leaseStart ?? '',
    leaseEnd: form.leaseEnd ?? '',
    maintenanceResponsibilitiesClause: form.maintenanceResponsibilitiesClause ?? '',
    occupancyStatus: normalizeOnboardingOccupancyStatus(form.occupancyStatus),
  }
}

export function residentToFormRow(resident: OnboardingResident): ResidentFormRow {
  const rentDueDay =
    resident.rentDueDay != null && Number.isFinite(resident.rentDueDay)
      ? String(resident.rentDueDay)
      : ''
  return {
    id: resident.id,
    residentId: resident.residentId,
    fullName: resident.fullName,
    unit: resident.unit,
    building: resident.building ?? '',
    email: resident.email.endsWith('@onboarding.local') ? '' : resident.email,
    phone: resident.phone,
    monthlyRent:
      resident.monthlyRent != null && Number.isFinite(resident.monthlyRent)
        ? String(resident.monthlyRent)
        : '',
    rentDueDayMode: rentDueDayModeFromDay(resident.rentDueDay),
    rentDueDay,
    leaseStart: resident.leaseStart ?? '',
    leaseEnd: resident.leaseEnd ?? '',
    maintenanceResponsibilitiesClause: resident.maintenanceResponsibilitiesClause ?? '',
    occupancyStatus: normalizeOnboardingOccupancyStatus(resident.occupancyStatus),
  }
}

export function pickResidentFormsForStep(
  preferred: ResidentFormRow[],
  reviewResidents: OnboardingResident[] | undefined,
): ResidentFormRow[] {
  const preferredNamed = preferred.filter((form) => form.fullName.trim())
  if (reviewResidents && reviewResidents.length > preferredNamed.length) {
    return reviewResidents.map(residentToFormRow)
  }
  if (residentFormsHaveData(preferred)) return preferred.map(normalizeResidentFormRow)
  if (reviewResidents?.length) return reviewResidents.map(residentToFormRow)
  return preferred.length > 0
    ? preferred.map(normalizeResidentFormRow)
    : [createEmptyResidentForm()]
}

export function readPersistedResidentForms(
  stateDraft: OnboardingFormDraft | undefined,
): ResidentFormRow[] | undefined {
  const stateForms = stateDraft?.residentForms
  if (stateForms && residentFormsHaveData(stateForms)) {
    return stateForms.map(normalizeResidentFormRow)
  }
  const localForms = readLocalOnboardingState()?.formDraft?.residentForms
  if (localForms && residentFormsHaveData(localForms)) {
    return localForms.map(normalizeResidentFormRow)
  }
  return undefined
}

export function residentEmailForDb(email: string, _residentId: string): string {
  // users.email is NOT NULL — store empty string when the landlord did not enter one.
  // Never invent @onboarding.local placeholders for display.
  return email.trim()
}

export function applyResidentFormPatch(
  forms: ResidentFormRow[],
  id: string,
  patch: Partial<ResidentFormRow>,
): ResidentFormRow[] {
  return forms.map((row) => (row.id === id ? { ...row, ...patch } : row))
}

/** Side-effect for removing a persisted resident row (fire-and-forget). */
export function deletePersistedOnboardingResident(
  id: string,
  deps: {
    setError: (value: string | null) => void
    refreshCounts: () => Promise<void>
  },
): void {
  if (!isPersistedOnboardingRowId(id) || !supabase) return
  void deleteResidentsForLandlord({
    landlordId: getActiveLandlordId(),
    residentIds: [id],
  }).then((result) => {
    if (!result.ok) {
      deps.setError(result.error)
      return
    }
    void deps.refreshCounts()
  })
}

export type SaveOnboardingResidentsStepInput = {
  residentForms: ResidentFormRow[]
  properties: OnboardingProperty[]
  propertyForms: PropertyFormRow[]
  editingFromReview: boolean
  setSaving: (value: boolean) => void
  setError: (value: string | null) => void
  setResidentForms: Dispatch<SetStateAction<ResidentFormRow[]>>
  returnToReviewAfterEdit: (patch?: Partial<LandlordOnboardingState>) => Promise<void>
  continueToApprovalRules: () => Promise<void>
  refreshCounts: () => Promise<void>
}

export async function saveOnboardingResidentsStep(
  input: SaveOnboardingResidentsStepInput,
): Promise<void> {
  const {
    residentForms,
    properties,
    propertyForms,
    editingFromReview,
    setSaving,
    setError,
    setResidentForms,
    returnToReviewAfterEdit,
    continueToApprovalRules,
  } = input

  if (!supabase) {
    setError("We can't reach the server right now. Please try again in a moment.")
    return
  }
  const db = supabase
  const scope = requireOnboardingLandlord()
  if (!scope.ok) {
    setError(scope.error)
    return
  }

  const residentsToSave = residentForms.filter((form) => form.fullName.trim())
  for (const form of residentForms) {
    const hasPartialData = residentFormRowHasUserInput(form)
    if (hasPartialData && !form.fullName.trim()) {
      setError('Each resident needs a name, or clear empty resident rows.')
      return
    }
  }

  type ResidentLeasePayload = {
    monthly_rent: number | null
    rent_due_day: number | null
    move_in_date: string | null
    lease_end_date: string | null
    maintenance_responsibilities_clause: string | null
  }
  const leasePayloads: ResidentLeasePayload[] = []
  for (const form of residentsToSave) {
    if (form.monthlyRent.trim() && parseMonthlyRentInput(form.monthlyRent) == null) {
      setError(`${form.fullName.trim()}: Enter a valid monthly rent amount.`)
      return
    }
    if (form.rentDueDayMode === 'custom' && !form.rentDueDay.trim()) {
      setError(`${form.fullName.trim()}: Enter a custom rent due day (1–31).`)
      return
    }
    if (form.rentDueDay.trim() && parseRentDueDayInput(form.rentDueDay) == null) {
      setError(`${form.fullName.trim()}: Rent due day must be between 1 and 31.`)
      return
    }
    if (form.leaseStart.trim() && parseLeaseDateInput(form.leaseStart) == null) {
      setError(`${form.fullName.trim()}: Lease start must be a valid date.`)
      return
    }
    if (form.leaseEnd.trim() && parseLeaseDateInput(form.leaseEnd) == null) {
      setError(`${form.fullName.trim()}: Lease end must be a valid date.`)
      return
    }
    leasePayloads.push({
      monthly_rent: parseMonthlyRentInput(form.monthlyRent),
      rent_due_day: parseRentDueDayInput(form.rentDueDay),
      move_in_date: parseLeaseDateInput(form.leaseStart),
      lease_end_date: parseLeaseDateInput(form.leaseEnd),
      maintenance_responsibilities_clause:
        form.maintenanceResponsibilitiesClause.trim() || null,
    })
  }

  setSaving(true)
  setError(null)

  const fallbackBuilding =
    properties[0]?.name ?? propertyForms[0]?.name.trim() ?? ''
  const unitOptions = listOnboardingUnitOptions(properties)
  const landlordId = scope.landlordId
  const existingResidents = await fetchOnboardingResidents(landlordId)
  let nextResidentSequence = maxOnboardingResidentSequence(
    existingResidents,
    landlordId,
  )
  const existingByPhone = new Map(
    existingResidents
      .map((resident) => {
        const phone = normalizePhoneForDb(resident.phone)
        return phone ? ([phone, resident] as const) : null
      })
      .filter((row): row is readonly [string, OnboardingResident] => row != null),
  )
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
    let building = form.building.trim() || fallbackBuilding || null
    if (unit && unitOptions.length > 0) {
      const matchedOption = unitOptions.find(
        (option) =>
          option.unitLabel === unit &&
          (!building || option.building === building),
      )
      if (matchedOption?.building) {
        building = matchedOption.building
      }
    }
    const lease = leasePayloads[i]!

    const occupancyStatus = normalizeOnboardingOccupancyStatus(form.occupancyStatus)
    const matchedByPhone = phone ? existingByPhone.get(phone) : undefined
    const persistedId =
      isPersistedOnboardingRowId(form.id)
        ? form.id
        : matchedByPhone?.id && isPersistedOnboardingRowId(matchedByPhone.id)
          ? matchedByPhone.id
          : null

    if (persistedId) {
      const { error: updateError } = await db
        .from('users')
        .update({
          full_name: form.fullName.trim(),
          email: residentEmailForDb(
            form.email,
            form.residentId ?? matchedByPhone?.residentId ?? 'ONB-000',
          ),
          phone,
          unit,
          building,
          status: occupancyStatus,
          ...lease,
        })
        .eq('id', persistedId)
        .eq('landlord_id', landlordId)
      if (updateError) {
        // Retry without newer lease columns if migrations are not applied yet.
        if (
          /monthly_rent|rent_due_day|maintenance_responsibilities_clause|column/i.test(
            updateError.message,
          )
        ) {
          const { error: retryError } = await db
            .from('users')
            .update({
              full_name: form.fullName.trim(),
              email: residentEmailForDb(
                form.email,
                form.residentId ?? matchedByPhone?.residentId ?? 'ONB-000',
              ),
              phone,
              unit,
              building,
              status: occupancyStatus,
              move_in_date: lease.move_in_date,
              lease_end_date: lease.lease_end_date,
            })
            .eq('id', persistedId)
            .eq('landlord_id', landlordId)
          if (retryError) {
            setSaving(false)
            setError(
              getOnboardingErrorMessage(retryError, 'Couldn’t save this resident. Please try again.'),
            )
            return
          }
          continue
        }
        setSaving(false)
        setError(
          getOnboardingErrorMessage(updateError, 'Couldn’t save this resident. Please try again.'),
        )
        return
      }
      continue
    }

    nextResidentSequence += 1
    let residentId =
      nextOnboardingResidentIdFromSequence(nextResidentSequence, landlordId)
    const baseInsert = {
      full_name: form.fullName.trim(),
      phone,
      unit,
      building,
      status: occupancyStatus,
      balance_due: 0,
      issues: [] as string[],
      landlord_id: landlordId,
    }

    const tryInsert = async (id: string, withLease: boolean) => {
      const payload = withLease
        ? {
            ...baseInsert,
            resident_id: id,
            email: residentEmailForDb(form.email, id),
            ...lease,
          }
        : {
            ...baseInsert,
            resident_id: id,
            email: residentEmailForDb(form.email, id),
            move_in_date: lease.move_in_date,
            lease_end_date: lease.lease_end_date,
          }
      return db.from('users').insert(payload)
    }

    let { error: insertError } = await tryInsert(residentId, true)
    if (
      insertError &&
      /monthly_rent|rent_due_day|maintenance_responsibilities_clause|column/i.test(
        insertError.message,
      )
    ) {
      ;({ error: insertError } = await tryInsert(residentId, false))
    }

    // Collision: mint a new landlord-scoped id (DB allocate, then random suffix).
    for (let attempt = 0; attempt < 3 && insertError; attempt++) {
      if (!/resident_id|users_resident_id|duplicate key|unique/i.test(insertError.message)) {
        break
      }
      if (attempt === 0) {
        residentId = await allocateOnboardingResidentId(landlordId)
      } else {
        residentId = `${onboardingResidentIdPrefix(landlordId)}-${crypto
          .randomUUID()
          .replace(/-/g, '')
          .slice(0, 8)
          .toUpperCase()}`
      }
      ;({ error: insertError } = await tryInsert(residentId, true))
      if (
        insertError &&
        /monthly_rent|rent_due_day|maintenance_responsibilities_clause|column/i.test(
          insertError.message,
        )
      ) {
        ;({ error: insertError } = await tryInsert(residentId, false))
      }
    }

    if (insertError) {
      setSaving(false)
      console.warn('[onboarding] resident save failed', insertError.message)
      setError(
        getOnboardingErrorMessage(insertError, 'Couldn’t save this resident. Please try again.'),
      )
      return
    }
  }

  const savedResidents = await fetchOnboardingResidents(landlordId)

  // General rule: tenant + unit + lease dates activates the unit (no separate Activate click).
  await activateUnitsFromResidentAssignments({
    landlordId,
    residents: savedResidents.map((r) => ({
      id: r.id,
      unit: r.unit,
      building: r.building || fallbackBuilding,
      status: r.occupancyStatus,
      leaseStart: r.leaseStart,
      leaseEnd: r.leaseEnd,
    })),
    source: 'onboarding_residents',
  })

  setResidentForms(
    savedResidents.length > 0
      ? savedResidents.map(residentToFormRow)
      : [createEmptyResidentForm(fallbackBuilding)],
  )
  setSaving(false)
  if (editingFromReview) {
    await returnToReviewAfterEdit()
    return
  }
  await continueToApprovalRules()
}
