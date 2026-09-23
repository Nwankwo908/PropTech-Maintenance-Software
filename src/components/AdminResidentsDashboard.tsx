import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import magnifyingGlassIcon from '@/assets/Magnifying glass.svg'
import editIcon from '@/assets/noun_edit_469454.svg'
import { SetupSuccessCheckboxGuide } from '@/components/SetupSuccessCheckboxGuide'
import { TableCheckbox } from '@/components/TableCheckbox'
import { loadUnitsFromDb } from '@/api/unitVacancy'
import { registerUnitSms, syncSmsIdentity } from '@/api/landlordSmsOnboarding'
import {
  phoneChanged,
  restartTenantOnboardingAfterPhoneChange,
  resetTenantActivationForPhoneChange,
  sendTenantActivationSms,
} from '@/api/tenantActivation'
import {
  AddResidentModal,
  type AddResidentSubmitPayload,
} from '@/components/AddResidentModal'
import {
  EditResidentModal,
  type EditResidentModalRow,
  type EditResidentSavePayload,
} from '@/components/EditResidentModal'
import {
  TenantActivationStatusChip,
} from '@/components/TenantActivationStatusChip'
import { SetupOutreachAckModal } from '@/components/SetupOutreachAckModal'
import { PaymentStatusChip } from '@/components/PaymentStatusChip'
import { optionalPhoneForDbOrError } from '@/lib/phoneFormat'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { customUnitPickKey, unitOptionKeyToCell } from '@/lib/residentUnitKeys'
import {
  buildPropertyIdByBuilding,
  residentDetailPath,
} from '@/lib/propertyRoutes'
import { listPropertiesForLandlord } from '@/lib/properties'
import {
  findCanonicalPropertyForResident,
  mapUnitsForPropertyHealth,
  normalizeBuildingKey,
} from '@/lib/propertyHealth'
import {
  initialUnitOptionKeyForResident,
  residentPlacementUpdateForSave,
  resolveInventoryUnitForResidentSave,
} from '@/lib/propertyResidentUnitOptions'
import {
  displayResidentEmail,
  groupResidentsByLeasePlace,
  residentEmailPatchForSave,
} from '@/lib/residentProfileDetail'
import { isRentChargePaidFromRun } from '@/lib/paymentSettlement'
import { deleteResidentsForLandlord } from '@/lib/residentDeletion'
import { uploadResidentLeaseDocuments } from '@/lib/residentLeaseDocuments'
import {
  dismissSetupSuccessCheckboxGuide,
  isSetupSuccessCheckboxGuideActive,
  isSetupSuccessCheckboxGuideNavigation,
} from '@/lib/setupSuccessGuide'
import { resolveTenantActivationChip, countUnactivatedTenants } from '@/lib/tenantActivationStatus'
import { supabase } from '@/lib/supabase'
import { getErrorMessage, isUniqueViolation } from '@/lib/errorMessage'
import { parseLeaseDateInput } from '@/lib/onboarding'
import {
  normalizeResidentOccupancyStatus,
  residentOccupancyLabel,
} from '@/lib/residentOccupancy'
import {
  activateUnitsFromResidentAssignments,
  syncAssignedUnitOccupancyFromResidentStatus,
} from '@/lib/unitActivation'
import type { PropertyHistoryPaymentStatus } from '@/lib/propertyHistory'

type InventoryUnitOption = {
  id: string
  unitLabel: string
  building: string | null
}

type ResidentRow = {
  id: string
  residentId: string
  name: string
  unit: string
  building: string | null
  propertyLinkId: string | null
  unitLabel: string
  rentLabel: string
  paymentStatus: PropertyHistoryPaymentStatus
  contactPhone: string | null
  contactEmail: string | null
  status: string
  leaseStart: string | null
  leaseEnd: string | null
  rentDueDay: number | null
  activationStatus: string | null
  smsConsentStatus: string | null
  activationAttemptCount: number
  activationSmsSentAt: string | null
}

type ResidentHouseholdRow = {
  key: string
  members: ResidentRow[]
}

function asString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function asFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function formatUnit(building: string | null, unit: string | null): string {
  const b = building?.trim().replace(/\s+Apartments$/i, '')
  const u = unit?.trim()
  if (b && u) return `${b} - ${u}`
  return u || b || '—'
}

function formatBalance(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function formatMonthlyRent(amount: number | null): string {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return '—'
  return formatBalance(amount)
}

function householdRentLabel(members: ResidentRow[]): string {
  return members.find((member) => member.rentLabel !== '—')?.rentLabel ?? '—'
}

function householdPaymentStatus(members: ResidentRow[]): PropertyHistoryPaymentStatus {
  return members.some((member) => member.paymentStatus === 'not_paid') ? 'not_paid' : 'paid'
}

function householdOccupancyLabel(members: ResidentRow[]): string {
  const labels = new Set(members.map((member) => residentOccupancyLabel(member.status)))
  if (labels.size === 1) return [...labels][0] ?? '—'
  return residentOccupancyLabel(members[0]?.status ?? 'active')
}

/** Activation follows the primary lease holder (first member on the household row). */
function householdActivationChip(members: ResidentRow[]) {
  const primary = members[0]
  return resolveTenantActivationChip({
    activationStatus: primary?.activationStatus,
    smsConsentStatus: primary?.smsConsentStatus,
    activationAttemptCount: primary?.activationAttemptCount,
    activationSmsSentAt: primary?.activationSmsSentAt,
  })
}

function primaryHouseholdContacts(primary: ResidentRow | undefined): {
  phones: string[]
  emails: string[]
} {
  if (!primary) return { phones: [], emails: [] }
  const phone = primary.contactPhone?.trim()
  const email = primary.contactEmail?.trim()
  return {
    phones: phone ? [phone] : [],
    emails: email ? [email] : [],
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function rentPaymentStatusFromRun(run: {
  id: string
  status: string
  metadata: Record<string, unknown>
}): PropertyHistoryPaymentStatus {
  const rentStatus = asString(run.metadata.rent_status).toLowerCase()
  if (rentStatus === 'paid') return 'paid'
  if (
    isRentChargePaidFromRun({
      id: run.id,
      template_id: 'rent_collection',
      status: run.status,
      metadata: run.metadata,
    }).paid
  ) {
    return 'paid'
  }
  return 'not_paid'
}

const ONBOARDING_STARTED_BANNER_MS = 30_000

type ResidentsBannerState =
  | { kind: 'onboarding_started'; count: number; expiresAt: number }
  | { kind: 'error'; message: string }
  | null

function onboardingStartedBannerMessage(count: number): string {
  return count === 1
    ? '1 resident is starting onboarding.'
    : `${count} residents are starting onboarding.`
}

function ActivationReminderAlertIcon() {
  return (
    <svg
      className="mt-0.5 size-4 shrink-0 text-[#101828]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden
    >
      <path
        d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
    </svg>
  )
}

function SelectionTrashIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function toEditResidentRow(resident: ResidentRow): EditResidentModalRow {
  return {
    id: resident.id,
    residentId: resident.residentId || resident.id.slice(0, 8).toUpperCase(),
    name: resident.name,
    email: resident.contactEmail ?? '',
    phone: resident.contactPhone ?? undefined,
    unit: resident.unit.trim()
      ? { kind: 'assigned', unit: resident.unit, building: resident.building ?? '' }
      : { kind: 'unassigned' },
    status: normalizeResidentOccupancyStatus(resident.status),
    leaseStart: resident.leaseStart,
    leaseEnd: resident.leaseEnd,
    rentDueDay: resident.rentDueDay,
  }
}

function leaseDateOnly(value: unknown): string | null {
  const raw = asString(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

function rentDueDayFromRaw(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 31) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 31) return Math.trunc(parsed)
  }
  return null
}

export function AdminResidentsDashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [residents, setResidents] = useState<ResidentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [addResidentOpen, setAddResidentOpen] = useState(false)
  const [addResidentError, setAddResidentError] = useState<string | null>(null)
  const [unitOptions, setUnitOptions] = useState<{ value: string; label: string }[]>([])
  const [inventoryUnits, setInventoryUnits] = useState<InventoryUnitOption[]>([])
  const [editingResident, setEditingResident] = useState<ResidentRow | null>(null)
  const [selectedResidentIds, setSelectedResidentIds] = useState<Set<string>>(() => new Set())
  const [deleteResidentsSaving, setDeleteResidentsSaving] = useState(false)
  const [deleteResidentsError, setDeleteResidentsError] = useState<string | null>(null)
  const [onboardingSaving, setOnboardingSaving] = useState(false)
  const [setupOutreachAckOpen, setSetupOutreachAckOpen] = useState(false)
  const [residentsBanner, setResidentsBanner] = useState<ResidentsBannerState>(null)
  const [showCheckboxGuide, setShowCheckboxGuide] = useState(() =>
    isSetupSuccessCheckboxGuideActive(location.state, 'residents'),
  )
  const [checkboxGuideRunId, setCheckboxGuideRunId] = useState(0)
  const checkboxGuideTargetRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isSetupSuccessCheckboxGuideActive(location.state, 'residents')) return
    setShowCheckboxGuide(true)
    setCheckboxGuideRunId((value) => value + 1)
    if (isSetupSuccessCheckboxGuideNavigation(location.state, 'residents')) {
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    if (residentsBanner?.kind !== 'onboarding_started') return
    const remaining = residentsBanner.expiresAt - Date.now()
    if (remaining <= 0) {
      setResidentsBanner(null)
      return
    }
    const timerId = window.setTimeout(() => setResidentsBanner(null), remaining)
    return () => window.clearTimeout(timerId)
  }, [residentsBanner])

  const loadResidents = useCallback(async () => {
    // #region agent log
    fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'D',location:'AdminResidentsDashboard.tsx:loadResidents:start',message:'loadResidents start',data:{landlordId:getActiveLandlordId()},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!supabase) {
      setLoading(false)
      setError('Supabase is not configured — connect a project to see residents.')
      return
    }

    setLoading(true)
    setError(null)

    try {
    const selectWithActivation =
      'id, resident_id, full_name, unit, building, status, phone, email, monthly_rent, move_in_date, lease_end_date, rent_due_day, activation_status, sms_consent_status, activation_attempt_count, activation_sms_sent_at'
    const selectLegacy =
      'id, resident_id, full_name, unit, building, status, phone, email, monthly_rent, move_in_date, lease_end_date'

    let data: Record<string, unknown>[] | null = null
    let fetchError: { message: string } | null = null

    const primary = await supabase
      .from('users')
      .select(selectWithActivation)
      .eq('landlord_id', getActiveLandlordId())
      .neq('status', 'past_resident')

    if (primary.error && /column .* does not exist/i.test(primary.error.message)) {
      const legacy = await supabase
        .from('users')
        .select(selectLegacy)
        .eq('landlord_id', getActiveLandlordId())
        .neq('status', 'past_resident')
      data = (legacy.data as Record<string, unknown>[] | null) ?? null
      fetchError = legacy.error
    } else {
      data = (primary.data as Record<string, unknown>[] | null) ?? null
      fetchError = primary.error
    }

    if (fetchError) {
      // #region agent log
      fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'D',location:'AdminResidentsDashboard.tsx:loadResidents:fetchError',message:'users fetch error',data:{error:fetchError.message,landlordId:getActiveLandlordId()},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setError(getErrorMessage(fetchError, 'Something went wrong. Please try again.'))
      setResidents([])
      setLoading(false)
      return
    }

    const landlordId = getActiveLandlordId()
    const [propertiesResult, unitsResult, rentRunsResult] = await Promise.all([
      listPropertiesForLandlord(landlordId),
      supabase
        .from('units')
        .select('id, unit_label, building, status, property_id')
        .eq('landlord_id', landlordId)
        .limit(2000),
      supabase
        .from('workflow_runs')
        .select('id, resident_id, status, started_at, metadata')
        .eq('landlord_id', landlordId)
        .eq('template_id', 'rent_collection')
        .order('started_at', { ascending: false })
        .limit(1000),
    ])

    const canonicalProperties =
      propertiesResult.ok
        ? propertiesResult.properties.map((property) => ({
            id: property.id,
            name: property.name,
          }))
        : []
    const propertyIdByBuilding = buildPropertyIdByBuilding(canonicalProperties)
    const healthUnits = mapUnitsForPropertyHealth(
      (unitsResult.data ?? []) as Record<string, unknown>[],
    )
    const paymentStatusByResident = new Map<string, PropertyHistoryPaymentStatus>()
    for (const raw of (rentRunsResult.data ?? []) as Record<string, unknown>[]) {
      const residentId = asString(raw.resident_id)
      if (!residentId || paymentStatusByResident.has(residentId)) continue
      paymentStatusByResident.set(
        residentId,
        rentPaymentStatusFromRun({
          id: asString(raw.id),
          status: asString(raw.status),
          metadata: asRecord(raw.metadata),
        }),
      )
    }

    const rows: ResidentRow[] = ((data ?? []) as Record<string, unknown>[])
      .map((raw) => {
        const status = asString(raw.status) || 'active'
        const unit = asString(raw.unit) || null
        const building = asString(raw.building) || null
        const phone = asString(raw.phone) || null
        const email = displayResidentEmail(asString(raw.email) || null)
        const monthlyRent = asFiniteNumber(raw.monthly_rent)
        const matchedProperty = findCanonicalPropertyForResident(
          { unit: unit ?? '', building },
          canonicalProperties,
          healthUnits,
        )
        const propertyLinkId =
          matchedProperty?.id ??
          (building ? propertyIdByBuilding.get(normalizeBuildingKey(building)) ?? null : null)
        return {
          id: asString(raw.id),
          residentId: asString(raw.resident_id),
          name: asString(raw.full_name) || 'Unnamed resident',
          unit: unit ?? '',
          building,
          propertyLinkId,
          unitLabel: formatUnit(building, unit),
          rentLabel: formatMonthlyRent(monthlyRent > 0 ? monthlyRent : null),
          paymentStatus: paymentStatusByResident.get(asString(raw.id)) ?? 'not_paid',
          contactPhone: phone,
          contactEmail: email,
          status,
          leaseStart: leaseDateOnly(raw.move_in_date),
          leaseEnd: leaseDateOnly(raw.lease_end_date),
          rentDueDay: rentDueDayFromRaw(raw.rent_due_day),
          activationStatus: asString(raw.activation_status) || null,
          smsConsentStatus: asString(raw.sms_consent_status) || null,
          activationAttemptCount: asFiniteNumber(raw.activation_attempt_count),
          activationSmsSentAt: asString(raw.activation_sms_sent_at) || null,
        }
      })
      .filter((row) => row.id)

    // #region agent log
    {
      const nameCounts = new Map<string, number>()
      const scopeCounts = new Map<string, { count: number; ids: string[] }>()
      for (const row of rows) {
        const nameKey = row.name.trim().toLowerCase().replace(/\s+/g, ' ')
        nameCounts.set(nameKey, (nameCounts.get(nameKey) ?? 0) + 1)
        const scope = `${nameKey}::${row.unit.trim().toLowerCase()}::${(row.building ?? '')
          .trim()
          .toLowerCase()}`
        const prev = scopeCounts.get(scope) ?? { count: 0, ids: [] }
        prev.count += 1
        prev.ids.push(row.id)
        scopeCounts.set(scope, prev)
      }
      const dupNames = [...nameCounts.entries()]
        .filter(([, n]) => n > 1)
        .map(([name, count]) => ({ name, count }))
      const dupScopes = [...scopeCounts.entries()]
        .filter(([, v]) => v.count > 1)
        .map(([scope, v]) => ({ scope, count: v.count, ids: v.ids }))
      fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'A',location:'AdminResidentsDashboard.tsx:loadResidents',message:'resident duplicate scan',data:{landlordId:getActiveLandlordId(),rowCount:rows.length,dupNames,dupScopes,sample:rows.slice(0,20).map((r)=>({id:r.id,name:r.name,unit:r.unit,building:r.building}))},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    setResidents(rows)
    setLoading(false)
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'D',location:'AdminResidentsDashboard.tsx:loadResidents:catch',message:'loadResidents threw',data:{error:error instanceof Error ? {message:error.message,stack:error.stack} : String(error),landlordId:getActiveLandlordId()},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setError(getErrorMessage(error, 'Something went wrong. Please try again.'))
      setResidents([])
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadResidents()
  }, [loadResidents])

  useEffect(() => {
    void loadUnitsFromDb().then((rows) => {
      const landlordId = getActiveLandlordId()
      const scoped = rows.filter((row) => row.landlord_id === landlordId && row.unit_label.trim())
      setInventoryUnits(
        scoped.map((row) => ({
          id: row.id,
          unitLabel: row.unit_label.trim(),
          building: row.building?.trim() || null,
        })),
      )
      setUnitOptions(
        scoped.map((row) => {
          const building = row.building?.trim() ?? ''
          const unit = row.unit_label.trim()
          return {
            value: customUnitPickKey(unit, building),
            label: building ? `${building} — ${unit}` : unit,
          }
        }),
      )
    })
  }, [])

  async function addResidentFromModal(payload: AddResidentSubmitPayload) {
    setAddResidentError(null)
    if (!supabase) {
      setAddResidentError('Supabase is not configured — connect a project to add residents.')
      return
    }

    const landlordId = getActiveLandlordId()
    const { data: existingRows, error: existingError } = await supabase
      .from('users')
      .select('resident_id')
      .eq('landlord_id', landlordId)

    if (existingError) {
      setAddResidentError(existingError.message)
      return
    }

    let nextResidentNumber = 1
    for (const row of (existingRows ?? []) as Record<string, unknown>[]) {
      const rawId = asString(row.resident_id)
      const parsed = Number.parseInt(rawId.replace(/^RES-/i, ''), 10)
      if (Number.isFinite(parsed)) {
        nextResidentNumber = Math.max(nextResidentNumber, parsed + 1)
      }
    }

    const residentId = `RES-${String(nextResidentNumber).padStart(3, '0')}`
    const unitCell = payload.unit ? unitOptionKeyToCell(payload.unit) : { kind: 'unassigned' as const }
    const phoneResult = optionalPhoneForDbOrError(payload.phone)
    if (phoneResult.error) {
      setAddResidentError(phoneResult.error)
      return
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from('users')
      .insert({
        resident_id: residentId,
        full_name: payload.fullName,
        email: payload.email,
        phone: phoneResult.phone,
        unit: unitCell.kind === 'assigned' ? unitCell.unit : null,
        building: unitCell.kind === 'assigned' ? unitCell.building : null,
        status: payload.status,
        balance_due: 0,
        issues: [],
        landlord_id: landlordId,
        move_in_date: parseLeaseDateInput(payload.leaseStart),
        lease_end_date: parseLeaseDateInput(payload.leaseEnd),
      })
      .select('id')
      .single()

    if (insertError) {
      setAddResidentError(insertError.message)
      return
    }

    const newResidentId = asString(insertedRow?.id)
    if (unitCell.kind === 'assigned' && newResidentId) {
      void registerUnitSms({
        unitLabel: unitCell.unit,
        building: unitCell.building,
        residentId: newResidentId,
        tenantPhone: phoneResult.phone,
      })
      void activateUnitsFromResidentAssignments({
        landlordId,
        residents: [
          {
            id: newResidentId,
            unit: unitCell.unit,
            building: unitCell.building,
            status: payload.status,
            moveInDate: parseLeaseDateInput(payload.leaseStart),
            leaseEndDate: parseLeaseDateInput(payload.leaseEnd),
          },
        ],
        source: 'add_resident',
      })
    } else if (phoneResult.phone && newResidentId) {
      void syncSmsIdentity({
        phone: phoneResult.phone,
        identityType: 'resident',
        residentId: newResidentId,
      })
    }

    await loadResidents()
    setAddResidentOpen(false)
  }

  const editResidentRow = useMemo(
    () => (editingResident ? toEditResidentRow(editingResident) : null),
    [editingResident],
  )

  const editUnitOptions = useMemo(() => {
    const options = [{ value: '', label: 'Unassigned' }, ...unitOptions]
    if (!editingResident?.unit.trim()) return options
    const currentKey = initialUnitOptionKeyForResident(
      editingResident.unit,
      editingResident.building,
      inventoryUnits,
    )
    if (currentKey && !options.some((option) => option.value === currentKey)) {
      options.push({
        value: currentKey,
        label: `${editingResident.unitLabel} (current)`,
      })
    }
    return options
  }, [editingResident, inventoryUnits, unitOptions])

  const editInitialUnitKey = useMemo(() => {
    if (!editingResident?.unit.trim()) return ''
    return initialUnitOptionKeyForResident(
      editingResident.unit,
      editingResident.building,
      inventoryUnits,
    )
  }, [editingResident, inventoryUnits])

  async function handleEditResidentSave(payload: EditResidentSavePayload) {
    if (!supabase || !editingResident) {
      throw new Error("We can't reach the server right now. Please try again in a moment.")
    }

    const previousUnit = editingResident.unit.trim()
    const previousBuilding = (editingResident.building ?? '').trim()
    const placement = residentPlacementUpdateForSave({
      unitAssignmentChanged: payload.unitAssignmentChanged,
      submittedUnitKey: payload.unitOptionKey,
      previousUnit,
      previousBuilding,
      units: inventoryUnits,
      fallbackBuilding: previousBuilding,
    })
    const assigned =
      placement && placement.unit
        ? resolveInventoryUnitForResidentSave(inventoryUnits, {
            unit: placement.unit,
            building: placement.building ?? '',
          })
        : !placement && previousUnit
          ? resolveInventoryUnitForResidentSave(inventoryUnits, {
              unit: previousUnit,
              building: previousBuilding,
            })
          : null
    const previousPhone = editingResident.contactPhone
    const emailPatch = residentEmailPatchForSave(payload.email, editingResident.contactEmail)
    const updatePayload: Record<string, unknown> = {
      full_name: payload.fullName,
      phone: payload.phone ?? null,
      status: payload.status,
      move_in_date: parseLeaseDateInput(payload.leaseStart),
      lease_end_date: parseLeaseDateInput(payload.leaseEnd),
      rent_due_day: payload.rentDueDay,
    }
    if (placement) {
      updatePayload.unit = placement.unit
      updatePayload.building = placement.building
    }
    if (emailPatch !== undefined) {
      updatePayload.email = emailPatch
    }

    let { error: updateError } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('id', payload.id)
      .eq('landlord_id', getActiveLandlordId())

    if (
      updateError &&
      emailPatch !== undefined &&
      isUniqueViolation(updateError) &&
      /email/i.test(updateError.message ?? '')
    ) {
      const submitted = payload.email.trim()
      const current = editingResident.contactEmail ?? ''
      if (!submitted || submitted === current) {
        const { email: _ignored, ...withoutEmail } = updatePayload
        const retry = await supabase
          .from('users')
          .update(withoutEmail)
          .eq('id', payload.id)
          .eq('landlord_id', getActiveLandlordId())
        updateError = retry.error
      }
    }

    if (updateError) {
      throw new Error(getErrorMessage(updateError, 'Something went wrong. Please try again.'))
    }

    if (assigned) {
      await syncAssignedUnitOccupancyFromResidentStatus({
        landlordId: getActiveLandlordId(),
        residentId: payload.id,
        unitId: assigned.unitId,
        unitLabel: assigned.unitLabel,
        building: assigned.building,
        status: payload.status,
        residentName: payload.fullName,
        source: 'edit_resident',
      })
    }

    if (payload.phone?.trim()) {
      void syncSmsIdentity({
        phone: payload.phone,
        identityType: 'resident',
        residentId: payload.id,
        unitId: assigned?.unitId ?? null,
        unitLabel: assigned?.unitLabel ?? null,
        building: assigned?.building ?? null,
      })
    }

    if (phoneChanged(previousPhone, payload.phone)) {
      if (payload.restartOnboarding && payload.phone?.trim()) {
        const result = await restartTenantOnboardingAfterPhoneChange({
          landlordId: getActiveLandlordId(),
          residentId: payload.id,
        })
        if (!result.ok || (result.failed ?? 0) > 0) {
          throw new Error(
            result.error ||
              'Resident saved, but the welcome text could not be delivered. You can start onboarding again from the resident profile.',
          )
        }
      } else {
        await resetTenantActivationForPhoneChange({
          landlordId: getActiveLandlordId(),
          residentId: payload.id,
        })
      }
    }

    if (payload.leaseDocumentFiles && payload.leaseDocumentFiles.length > 0) {
      const unitLabel =
        placement?.unit?.trim() ||
        (!placement ? previousUnit : '') ||
        editingResident.unit.trim()
      const buildingLabel =
        (placement?.building ?? '').trim() ||
        (!placement ? previousBuilding : '') ||
        (editingResident.building ?? '').trim()
      const docsResult = await uploadResidentLeaseDocuments({
        landlordId: getActiveLandlordId(),
        residentId: payload.id,
        resident: {
          fullName: payload.fullName,
          unit: unitLabel,
          building: buildingLabel,
          phone: payload.phone,
          email: payload.email,
        },
        files: payload.leaseDocumentFiles,
      })
      if (!docsResult.ok) {
        throw new Error(docsResult.error)
      }
    }

    setEditingResident(null)
    await loadResidents()
  }

  async function handleEditResidentDelete(row: EditResidentModalRow) {
    const result = await deleteResidentsForLandlord({
      landlordId: getActiveLandlordId(),
      residentIds: [row.id],
    })
    if (!result.ok) {
      throw new Error(result.error)
    }
    setEditingResident(null)
    setSelectedResidentIds((prev) => {
      if (!prev.has(row.id)) return prev
      const next = new Set(prev)
      next.delete(row.id)
      return next
    })
    await loadResidents()
  }

  const residentHouseholds = useMemo((): ResidentHouseholdRow[] => {
    const byId = new Map(residents.map((resident) => [resident.id, resident]))
    const groups = groupResidentsByLeasePlace(
      residents.map((resident) => ({
        id: resident.id,
        fullName: resident.name,
        unit: resident.unit,
        building: resident.building,
        status: resident.status,
      })),
    ).map((group) => ({
      key: group.map((member) => member.id).join('|'),
      members: group
        .map((member) => byId.get(member.id))
        .filter((member): member is ResidentRow => Boolean(member)),
    }))
    // #region agent log
    const multiNameRows = groups
      .map((g) => {
        const names = g.members.map((m) => m.name.trim().toLowerCase())
        const uniq = new Set(names)
        return {
          key: g.key,
          memberCount: g.members.length,
          uniqueNames: uniq.size,
          names: g.members.map((m) => m.name),
        }
      })
      .filter((g) => g.memberCount > 1 || groups.filter((x) => x.members[0]?.name.trim().toLowerCase() === g.names[0]?.trim().toLowerCase()).length > 1)
    const nameToHouseholds = new Map<string, number>()
    for (const g of groups) {
      const n = (g.members[0]?.name ?? '').trim().toLowerCase()
      if (!n) continue
      nameToHouseholds.set(n, (nameToHouseholds.get(n) ?? 0) + 1)
    }
    const repeatedPrimaryNames = [...nameToHouseholds.entries()].filter(([, c]) => c > 1)
    if (repeatedPrimaryNames.length > 0 || multiNameRows.some((r) => r.uniqueNames < r.memberCount)) {
      fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'B',location:'AdminResidentsDashboard.tsx:households',message:'household duplicate name signal',data:{landlordId:getActiveLandlordId(),householdCount:groups.length,repeatedPrimaryNames,multiNameRows:multiNameRows.slice(0,20)},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    return groups
  }, [residents])

  const filteredHouseholds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const matchesSearch = (resident: ResidentRow) =>
      !q ||
      resident.name.toLowerCase().includes(q) ||
      resident.unitLabel.toLowerCase().includes(q) ||
      (resident.contactPhone ?? '').toLowerCase().includes(q) ||
      (resident.contactEmail ?? '').toLowerCase().includes(q)

    return residentHouseholds.filter((household) => household.members.some(matchesSearch))
  }, [residentHouseholds, searchQuery])

  const filteredResidents = useMemo(
    () => filteredHouseholds.flatMap((household) => household.members),
    [filteredHouseholds],
  )

  const unactivatedResidentCount = useMemo(
    () =>
      countUnactivatedTenants(
        residents.map((resident) => ({
          activationStatus: resident.activationStatus,
          smsConsentStatus: resident.smsConsentStatus,
          activationAttemptCount: resident.activationAttemptCount,
          activationSmsSentAt: resident.activationSmsSentAt,
        })),
      ),
    [residents],
  )

  const selectedResidentCount = selectedResidentIds.size
  /** One household selected (any member count) → Edit opens the primary lease holder. */
  const selectedEditPrimary = useMemo(() => {
    if (selectedResidentIds.size === 0) return null
    const matched = residentHouseholds.filter((household) =>
      household.members.some((member) => selectedResidentIds.has(member.id)),
    )
    if (matched.length !== 1) return null
    const household = matched[0]
    if (!household) return null
    const memberIds = new Set(household.members.map((member) => member.id))
    for (const id of selectedResidentIds) {
      if (!memberIds.has(id)) return null
    }
    return household.members[0] ?? null
  }, [residentHouseholds, selectedResidentIds])
  const selectedOnboardingRetryOnly = useMemo(() => {
    const selected = residents.filter((resident) => selectedResidentIds.has(resident.id))
    if (selected.length === 0) return false
    return selected.every((resident) => {
      const chip = resolveTenantActivationChip({
        activationStatus: resident.activationStatus,
        smsConsentStatus: resident.smsConsentStatus,
        activationAttemptCount: resident.activationAttemptCount,
        activationSmsSentAt: resident.activationSmsSentAt,
      })
      return (
        chip.status === 'waiting' ||
        chip.status === 'delivery_failed' ||
        chip.status === 'action_required'
      )
    })
  }, [residents, selectedResidentIds])
  const allFilteredResidentsSelected =
    filteredResidents.length > 0 &&
    filteredResidents.every((resident) => selectedResidentIds.has(resident.id))
  const someFilteredResidentsSelected =
    filteredResidents.some((resident) => selectedResidentIds.has(resident.id)) &&
    !allFilteredResidentsSelected

  const checkboxGuideResidentId = useMemo(() => {
    const match = filteredResidents.find((resident) => {
      const chip = resolveTenantActivationChip({
        activationStatus: resident.activationStatus,
        smsConsentStatus: resident.smsConsentStatus,
        activationAttemptCount: resident.activationAttemptCount,
        activationSmsSentAt: resident.activationSmsSentAt,
      })
      return chip.status === 'not_started' && Boolean(resident.contactPhone?.trim())
    })
    return match?.id ?? filteredResidents[0]?.id ?? null
  }, [filteredResidents])

  useEffect(() => {
    if (!showCheckboxGuide || selectedResidentCount === 0) return
    dismissSetupSuccessCheckboxGuide('residents')
    setShowCheckboxGuide(false)
  }, [showCheckboxGuide, selectedResidentCount])

  function householdIsSelected(members: ResidentRow[]): boolean {
    return members.length > 0 && members.every((member) => selectedResidentIds.has(member.id))
  }

  function householdIsIndeterminate(members: ResidentRow[]): boolean {
    const selected = members.filter((member) => selectedResidentIds.has(member.id)).length
    return selected > 0 && selected < members.length
  }

  function toggleHouseholdSelected(members: ResidentRow[]) {
    setSelectedResidentIds((prev) => {
      const next = new Set(prev)
      const selected = members.every((member) => next.has(member.id))
      for (const member of members) {
        if (selected) next.delete(member.id)
        else next.add(member.id)
      }
      return next
    })
  }

  function toggleAllFilteredResidentsSelected() {
    setSelectedResidentIds((prev) => {
      const next = new Set(prev)
      if (allFilteredResidentsSelected) {
        for (const resident of filteredResidents) next.delete(resident.id)
      } else {
        for (const resident of filteredResidents) next.add(resident.id)
      }
      return next
    })
  }

  async function deleteSelectedResidents() {
    if (selectedResidentIds.size === 0 || !supabase) return

    setDeleteResidentsError(null)
    setDeleteResidentsSaving(true)

    const landlordId = getActiveLandlordId()
    const idsToDelete = Array.from(selectedResidentIds)

    const result = await deleteResidentsForLandlord({
      landlordId,
      residentIds: idsToDelete,
    })

    if (!result.ok) {
      setDeleteResidentsError(result.error)
      setDeleteResidentsSaving(false)
      return
    }

    setResidents((prev) => prev.filter((resident) => !selectedResidentIds.has(resident.id)))
    setSelectedResidentIds(new Set())
    setDeleteResidentsSaving(false)
  }

  async function startOnboardingForSelected() {
    if (selectedResidentIds.size === 0) return

    setResidentsBanner(null)
    setOnboardingSaving(true)

    const selected = residents.filter((resident) => selectedResidentIds.has(resident.id))
    const firstSendIds: string[] = []
    const resendIds: string[] = []
    let missingPhone = 0
    let alreadyComplete = 0

    for (const resident of selected) {
      if (!resident.contactPhone?.trim()) {
        missingPhone += 1
        continue
      }

      const chip = resolveTenantActivationChip({
        activationStatus: resident.activationStatus,
        smsConsentStatus: resident.smsConsentStatus,
        activationAttemptCount: resident.activationAttemptCount,
        activationSmsSentAt: resident.activationSmsSentAt,
      })

      if (
        chip.status === 'activated' ||
        chip.status === 'opted_out' ||
        chip.status === 'declined'
      ) {
        alreadyComplete += 1
        continue
      }

      if (
        chip.actionRequired ||
        chip.status === 'waiting' ||
        chip.status === 'delivery_failed'
      ) {
        resendIds.push(resident.id)
      } else {
        firstSendIds.push(resident.id)
      }
    }

    if (firstSendIds.length === 0 && resendIds.length === 0) {
      setOnboardingSaving(false)
      if (missingPhone > 0 && alreadyComplete === 0) {
        setResidentsBanner({
          kind: 'error',
          message: 'Selected residents need a phone number before onboarding can start.',
        })
      } else if (alreadyComplete > 0 && missingPhone === 0) {
        setResidentsBanner({
          kind: 'error',
          message: 'Selected residents are already activated, opted out, or declined updates.',
        })
      } else {
        setResidentsBanner({
          kind: 'error',
          message:
            'No selected residents are ready for onboarding. Add phone numbers or choose residents who have not been activated yet.',
        })
      }
      return
    }

    let sent = 0
    let failed = 0
    let skipped = 0
    let lastError: string | undefined

    if (firstSendIds.length > 0) {
      const result = await sendTenantActivationSms({ residentIds: firstSendIds })
      sent += result.sent ?? 0
      failed += result.failed ?? 0
      skipped += result.skipped ?? 0
      if (result.error) lastError = result.error
    }

    if (resendIds.length > 0) {
      const result = await sendTenantActivationSms({
        residentIds: resendIds,
        resend: true,
      })
      sent += result.sent ?? 0
      failed += result.failed ?? 0
      skipped += result.skipped ?? 0
      if (result.error) lastError = result.error
    }

    await loadResidents()
    setOnboardingSaving(false)

    if (sent > 0) {
      const { notifySetupSuccessProgressChanged } = await import('@/lib/setupSuccessChecklist')
      notifySetupSuccessProgressChanged()
    }

    if (sent > 0 && failed === 0) {
      setResidentsBanner({
        kind: 'onboarding_started',
        count: sent,
        expiresAt: Date.now() + ONBOARDING_STARTED_BANNER_MS,
      })
      return
    }

    if (sent > 0) {
      setResidentsBanner({
        kind: 'error',
        message: `Welcome texts sent to ${sent} resident${sent === 1 ? '' : 's'}, but ${failed} could not be delivered.${
          missingPhone > 0 ? ` ${missingPhone} skipped (no phone on file).` : ''
        }`,
      })
      return
    }

    setResidentsBanner({
      kind: 'error',
      message:
        lastError ??
        'Welcome texts could not be sent. Check phone numbers and try again.',
    })
  }

  const showOnboardingStartedBanner =
    residentsBanner?.kind === 'onboarding_started' &&
    residentsBanner.expiresAt > Date.now()
  const showUnactivatedReminderBanner =
    !loading && unactivatedResidentCount > 0 && !showOnboardingStartedBanner
  const showResidentsErrorBanner =
    residentsBanner?.kind === 'error' && !showOnboardingStartedBanner

  // #region agent log
  fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'A',location:'AdminResidentsDashboard.tsx:render',message:'Residents dashboard rendering',data:{loading,residentCount:residents.length,householdCount:filteredHouseholds.length,landlordId:getActiveLandlordId(),error},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  return (
    // Natural height so AdminLayout's scroll region owns vertical scrolling.
    <main className="px-8 pb-12">
      <SetupSuccessCheckboxGuide
        key={checkboxGuideRunId}
        active={showCheckboxGuide}
        targetRef={checkboxGuideTargetRef}
      />
      <div className="flex items-start justify-between gap-3 py-6">
        <div>
          <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
            Residents
          </h1>
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
          See your residents' lease status and balances at a glance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAddResidentError(null)
            setAddResidentOpen(true)
          }}
          className="sa-press inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-transparent px-4 text-[14px] font-medium leading-5 text-[#186179] outline-none focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="size-4 shrink-0"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add resident
        </button>
      </div>

      {addResidentError ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {addResidentError}
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[13px] text-[#92400e]">
          {error}
        </div>
      ) : null}

      {showOnboardingStartedBanner && residentsBanner?.kind === 'onboarding_started' ? (
        <div
          className="mb-4 flex items-start gap-2.5 rounded-[10px] border border-[#7fb889] bg-[#9DD4A6] px-4 py-3 text-[13px] leading-5 text-[#101828]"
          role="status"
        >
          <p>{onboardingStartedBannerMessage(residentsBanner.count)}</p>
        </div>
      ) : showResidentsErrorBanner && residentsBanner?.kind === 'error' ? (
        <div
          className="mb-4 rounded-[10px] border border-[#E8A5AA] bg-[#F6B9BE] px-4 py-3 text-[13px] leading-5 text-[#101828]"
          role="alert"
        >
          {residentsBanner.message}
        </div>
      ) : showUnactivatedReminderBanner ? (
        <div
          className="mb-4 flex items-start gap-2.5 rounded-[10px] border border-[#E8A5AA] bg-[#F6B9BE] px-4 py-3 text-[13px] leading-5 text-[#364153]"
          role="status"
        >
          <ActivationReminderAlertIcon />
          <p className="text-[#101828]">
            {unactivatedResidentCount === 1
              ? '1 resident has not been activated yet.'
              : `${unactivatedResidentCount} residents have not been activated yet.`}{' '}
            Select the checkbox to start onboarding when you're ready.
          </p>
        </div>
      ) : null}

      <div className="sa-surface mb-4 rounded-[10px] border border-[#e5e7eb] bg-white p-4 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1 xl:min-w-[240px]">
            <span className="pointer-events-none absolute left-3 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center">
              <img
                src={magnifyingGlassIcon}
                alt=""
                className="size-4 object-contain opacity-60"
                width={16}
                height={16}
                decoding="async"
                aria-hidden
              />
            </span>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search residents by name or unit…"
              className="sa-surface h-9 w-full rounded-lg border border-transparent bg-[#e8e9ed] py-1 pl-10 pr-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] shadow-none placeholder:text-[#717182] outline-none hover:border-black/10 hover:bg-[#dfe0e6] focus:border-[#0030b5]/45 focus:bg-white focus:ring-2 focus:ring-[#0030b5]/30"
              aria-label="Search residents"
            />
          </div>
        </div>
      </div>

      {deleteResidentsError ? (
        <div className="mb-4 rounded-[10px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
          Could not delete selected residents: {deleteResidentsError}
        </div>
      ) : null}
      {selectedResidentCount > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            aria-label="Edit resident"
            disabled={deleteResidentsSaving || onboardingSaving || !selectedEditPrimary}
            onClick={() => {
              if (selectedEditPrimary) setEditingResident(selectedEditPrimary)
            }}
            className="sa-press inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <img src={editIcon} alt="" className="size-4" />
            Edit
          </button>
          <button
            type="button"
            disabled={deleteResidentsSaving || onboardingSaving}
            onClick={() => void deleteSelectedResidents()}
            className="sa-press inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#b52a00] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <SelectionTrashIcon />
            Delete
          </button>
          <button
            type="button"
            onClick={() => setSelectedResidentIds(new Set())}
            className="sa-press inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            Clear
          </button>
          <button
            type="button"
            disabled={onboardingSaving || deleteResidentsSaving}
            onClick={() => setSetupOutreachAckOpen(true)}
            className="sa-press inline-flex h-9 items-center justify-center rounded-lg bg-[#187960] px-3 text-[14px] font-medium text-white outline-none hover:bg-[#146b52] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {onboardingSaving
              ? 'Sending…'
              : selectedOnboardingRetryOnly
                ? 'Retry setup'
                : 'Setup Resident'}
          </button>
        </div>
      ) : null}

      <section className="sa-surface rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="min-w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                <th className="w-12 px-4 py-3">
                  <TableCheckbox
                    aria-label="Select all visible residents"
                    disabled={loading || filteredHouseholds.length === 0}
                    checked={allFilteredResidentsSelected}
                    indeterminate={someFilteredResidentsSelected}
                    onChange={toggleAllFilteredResidentsSelected}
                  />
                </th>
                <th className="w-10 px-2 py-3" aria-label="Edit" />
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Resident</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Unit</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Rent</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Payment status</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Contact</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Occupancy</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Activation</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                    <td colSpan={9} className="px-6 py-10 text-center text-[14px] text-[#6a7282]">
                    Loading residents…
                  </td>
                </tr>
              ) : filteredHouseholds.length === 0 ? (
                <tr>
                    <td colSpan={9} className="px-6 py-10 text-center text-[14px] text-[#6a7282]">
                    {residents.length === 0 ? (
                      <>
                        No residents yet.{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setAddResidentError(null)
                            setAddResidentOpen(true)
                          }}
                          className="sa-link text-tertiary underline-offset-2 hover:underline"
                        >
                          Add residents
                        </button>{' '}
                        so Ulo can reach them.
                      </>
                    ) : (
                      'No residents match your search.'
                    )}
                  </td>
                </tr>
              ) : (
                filteredHouseholds.map((household, index) => {
                  const primary = household.members[0]
                  if (!primary) return null
                  const contacts = primaryHouseholdContacts(primary)
                  const householdNames = household.members.map((member) => member.name).join(', ')
                  return (
                  <tr
                    key={household.key}
                    style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
                    className="sa-enter group/row border-b border-[#f3f4f6] last:border-b-0 hover:bg-[#fafafa]"
                  >
                    <td className="w-12 px-4 py-4">
                      <div
                        ref={
                          showCheckboxGuide &&
                          household.members.some((member) => member.id === checkboxGuideResidentId)
                            ? checkboxGuideTargetRef
                            : undefined
                        }
                        className="inline-flex"
                      >
                        <TableCheckbox
                          aria-label={`Select ${householdNames}`}
                          checked={householdIsSelected(household.members)}
                          indeterminate={householdIsIndeterminate(household.members)}
                          onChange={() => toggleHouseholdSelected(household.members)}
                        />
                      </div>
                    </td>
                    <td className="w-10 px-2 py-4">
                      <button
                        type="button"
                        aria-label={`Edit ${primary.name}`}
                        onClick={() => setEditingResident(primary)}
                        className="sa-press inline-flex size-7 items-center justify-center rounded-[6px] opacity-0 transition-opacity duration-150 hover:bg-[#f3f4f6] group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1"
                      >
                        <img src={editIcon} alt="" className="size-3.5" />
                      </button>
                    </td>
                    <td className="px-6 py-4 text-[14px] font-medium text-[#0a0a0a]">
                      <button
                        type="button"
                        onClick={() =>
                          navigate(residentDetailPath(primary.id), {
                            state: { from: '/admin/residents' },
                          })
                        }
                        className="sa-link min-w-0 truncate rounded-[4px] text-left text-[#0a0a0a] hover:text-[#186179] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                      >
                        {primary.name}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-[14px] text-[#6a7282]">{primary.unitLabel}</td>
                    <td className="px-6 py-4 text-[14px] tabular-nums text-[#0a0a0a]">
                      {householdRentLabel(household.members)}
                    </td>
                    <td className="px-6 py-4">
                      <PaymentStatusChip status={householdPaymentStatus(household.members)} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-0.5">
                        {contacts.phones.map((phone) => (
                          <span key={phone} className="text-[13px] leading-5 text-[#0a0a0a]">
                            {phone}
                          </span>
                        ))}
                        {contacts.emails.map((email) => (
                          <span key={email} className="truncate text-[12px] leading-4 text-[#6a7282]">
                            {email}
                          </span>
                        ))}
                        {contacts.phones.length === 0 && contacts.emails.length === 0 ? (
                          <span className="text-[14px] text-[#6a7282]">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[14px] text-[#6a7282]">
                      {householdOccupancyLabel(household.members)}
                    </td>
                    <td className="px-6 py-4 align-middle">
                      <TenantActivationStatusChip chip={householdActivationChip(household.members)} />
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AddResidentModal
        open={addResidentOpen}
        extraUnitOptions={unitOptions}
        onClose={() => setAddResidentOpen(false)}
        onSubmit={(payload) => {
          void addResidentFromModal(payload)
        }}
      />

      <SetupOutreachAckModal
        open={setupOutreachAckOpen}
        kind="resident"
        retry={selectedOnboardingRetryOnly}
        saving={onboardingSaving}
        onClose={() => {
          if (onboardingSaving) return
          setSetupOutreachAckOpen(false)
        }}
        onConfirm={() => {
          void (async () => {
            await startOnboardingForSelected()
            setSetupOutreachAckOpen(false)
          })()
        }}
      />

      <EditResidentModal
        row={editResidentRow}
        unitOptions={editUnitOptions}
        initialUnitOptionKey={editInitialUnitKey}
        onClose={() => setEditingResident(null)}
        onSave={handleEditResidentSave}
        onDelete={handleEditResidentDelete}
      />
    </main>
  )
}

export default AdminResidentsDashboard
