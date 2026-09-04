import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import magnifyingGlassIcon from '@/assets/Magnifying glass.svg'
import { SetupSuccessCheckboxGuide } from '@/components/SetupSuccessCheckboxGuide'
import { TableCheckbox } from '@/components/TableCheckbox'
import { loadUnitsFromDb } from '@/api/unitVacancy'
import { registerUnitSms, syncSmsIdentity } from '@/api/landlordSmsOnboarding'
import {
  sendTenantActivationSms,
} from '@/api/tenantActivation'
import {
  AddResidentModal,
  type AddResidentSubmitPayload,
} from '@/components/AddResidentModal'
import {
  TenantActivationStatusChip,
} from '@/components/TenantActivationStatusChip'
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
import { displayResidentEmail } from '@/lib/residentProfileDetail'
import { deleteResidentsForLandlord } from '@/lib/residentDeletion'
import {
  dismissSetupSuccessCheckboxGuide,
  isSetupSuccessCheckboxGuideNavigation,
} from '@/lib/setupSuccessGuide'
import { resolveTenantActivationChip, countUnactivatedTenants } from '@/lib/tenantActivationStatus'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/errorMessage'
import { parseLeaseDateInput } from '@/lib/onboarding'
import { residentOccupancyLabel } from '@/lib/residentOccupancy'
import { activateUnitsFromResidentAssignments } from '@/lib/unitActivation'

type BalanceSort = 'desc' | 'asc'

type ResidentRow = {
  id: string
  name: string
  building: string | null
  propertyLinkId: string | null
  unitLabel: string
  rentLabel: string
  moveInLabel: string
  contactPhone: string | null
  contactEmail: string | null
  leaseEndLabel: string
  balanceDue: number
  status: string
  activationStatus: string | null
  smsConsentStatus: string | null
  activationAttemptCount: number
  activationSmsSentAt: string | null
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

function formatLeaseEnd(value: string | null): string {
  if (!value?.trim()) return '—'
  const date = new Date(`${value.trim()}T12:00:00`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatMoveIn(value: string | null): string {
  if (!value?.trim()) return '—'
  const date = new Date(`${value.trim()}T12:00:00`)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
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

function FilterToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-[#e5e7eb] bg-[#f3f3f5] p-0.5"
      role="group"
      aria-label={label}
    >
      {options.map((option) => {
        const isActive = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={[
              'sa-pill inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-[13px] font-medium tracking-[-0.1504px] outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-1',
              isActive
                ? 'bg-white text-[#0a0a0a] shadow-sm'
                : 'text-[#6a7282] hover:text-[#364153]',
            ].join(' ')}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
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

export function AdminResidentsDashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [residents, setResidents] = useState<ResidentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [balanceSort, setBalanceSort] = useState<BalanceSort>('desc')
  const [addResidentOpen, setAddResidentOpen] = useState(false)
  const [addResidentError, setAddResidentError] = useState<string | null>(null)
  const [unitOptions, setUnitOptions] = useState<{ value: string; label: string }[]>([])
  const [selectedResidentIds, setSelectedResidentIds] = useState<Set<string>>(() => new Set())
  const [deleteResidentsSaving, setDeleteResidentsSaving] = useState(false)
  const [deleteResidentsError, setDeleteResidentsError] = useState<string | null>(null)
  const [onboardingSaving, setOnboardingSaving] = useState(false)
  const [residentsBanner, setResidentsBanner] = useState<ResidentsBannerState>(null)
  const [showCheckboxGuide, setShowCheckboxGuide] = useState(() =>
    isSetupSuccessCheckboxGuideNavigation(location.state, 'residents'),
  )
  const [checkboxGuideRunId, setCheckboxGuideRunId] = useState(0)
  const checkboxGuideTargetRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isSetupSuccessCheckboxGuideNavigation(location.state, 'residents')) return
    setShowCheckboxGuide(true)
    setCheckboxGuideRunId((value) => value + 1)
    navigate(location.pathname, { replace: true, state: {} })
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
    if (!supabase) {
      setLoading(false)
      setError('Supabase is not configured — connect a project to see residents.')
      return
    }

    setLoading(true)
    setError(null)

    const selectWithActivation =
      'id, full_name, unit, building, status, balance_due, lease_end_date, move_in_date, phone, email, monthly_rent, activation_status, sms_consent_status, activation_attempt_count, activation_sms_sent_at'
    const selectLegacy =
      'id, full_name, unit, building, status, balance_due, lease_end_date, move_in_date, phone, email, monthly_rent'

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
      setError(getErrorMessage(fetchError, 'Something went wrong. Please try again.'))
      setResidents([])
      setLoading(false)
      return
    }

    const landlordId = getActiveLandlordId()
    const [propertiesResult, unitsResult] = await Promise.all([
      listPropertiesForLandlord(landlordId),
      supabase
        .from('units')
        .select('id, unit_label, building, status, property_id')
        .eq('landlord_id', landlordId)
        .limit(2000),
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

    const rows: ResidentRow[] = ((data ?? []) as Record<string, unknown>[])
      .map((raw) => {
        const balanceDue = asFiniteNumber(raw.balance_due)
        const status = asString(raw.status) || 'active'
        const leaseEndDate = asString(raw.lease_end_date) || null
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
          name: asString(raw.full_name) || 'Unnamed resident',
          building,
          propertyLinkId,
          unitLabel: formatUnit(building, unit),
          rentLabel: formatMonthlyRent(monthlyRent > 0 ? monthlyRent : null),
          moveInLabel: formatMoveIn(asString(raw.move_in_date) || null),
          contactPhone: phone,
          contactEmail: email,
          leaseEndLabel: formatLeaseEnd(leaseEndDate),
          balanceDue,
          status,
          activationStatus: asString(raw.activation_status) || null,
          smsConsentStatus: asString(raw.sms_consent_status) || null,
          activationAttemptCount: asFiniteNumber(raw.activation_attempt_count),
          activationSmsSentAt: asString(raw.activation_sms_sent_at) || null,
        }
      })
      .filter((row) => row.id)

    setResidents(rows)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadResidents()
  }, [loadResidents])

  useEffect(() => {
    void loadUnitsFromDb().then((rows) => {
      const landlordId = getActiveLandlordId()
      setUnitOptions(
        rows
          .filter((row) => row.landlord_id === landlordId && row.unit_label.trim())
          .map((row) => {
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

  const filteredResidents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = residents.filter((resident) => {
      const matchesSearch =
        !q ||
        resident.name.toLowerCase().includes(q) ||
        resident.unitLabel.toLowerCase().includes(q) ||
        resident.leaseEndLabel.toLowerCase().includes(q) ||
        resident.moveInLabel.toLowerCase().includes(q) ||
        (resident.contactPhone ?? '').toLowerCase().includes(q) ||
        (resident.contactEmail ?? '').toLowerCase().includes(q)
      if (!matchesSearch) return false
      return true
    })

    return filtered.sort((a, b) => {
      const balanceDelta =
        balanceSort === 'desc' ? b.balanceDue - a.balanceDue : a.balanceDue - b.balanceDue
      if (balanceDelta !== 0) return balanceDelta
      return a.name.localeCompare(b.name)
    })
  }, [residents, searchQuery, balanceSort])

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

  function toggleResidentSelected(id: string) {
    setSelectedResidentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
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
        chip.status === 'waiting'
      ) {
        alreadyComplete += 1
        continue
      }

      if (chip.actionRequired) {
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
          message: 'Selected residents are already activated or waiting for a reply.',
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
          <div className="flex flex-wrap items-center gap-3">
            <FilterToggleGroup
              label="Sort by balance"
              value={balanceSort}
              options={[
                { value: 'desc', label: 'Highest balance' },
                { value: 'asc', label: 'Lowest balance' },
              ]}
              onChange={setBalanceSort}
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#0a0a0a]">
            <span className="font-medium">{selectedResidentCount}</span>
            {selectedResidentCount === 1 ? ' resident selected' : ' residents selected'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedResidentIds(new Set())}
              className="sa-press inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-3 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
            >
              Clear selection
            </button>
            <button
              type="button"
              disabled={onboardingSaving || deleteResidentsSaving}
              onClick={() => void startOnboardingForSelected()}
              className="sa-press inline-flex h-9 items-center justify-center rounded-lg bg-[#187960] px-3 text-[14px] font-medium text-white outline-none hover:bg-[#146b52] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {onboardingSaving ? 'Starting…' : 'Start onboarding'}
            </button>
            <button
              type="button"
              disabled={deleteResidentsSaving || onboardingSaving}
              onClick={() => void deleteSelectedResidents()}
              className="sa-press inline-flex h-9 items-center justify-center rounded-lg border border-[#b52a00]/30 bg-[#fff4f0] px-3 text-[14px] font-medium text-[#b52a00] outline-none hover:bg-[#ffe9e1] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
            >
              {deleteResidentsSaving ? 'Deleting…' : 'Delete selected'}
            </button>
          </div>
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
                    disabled={loading || filteredResidents.length === 0}
                    checked={allFilteredResidentsSelected}
                    indeterminate={someFilteredResidentsSelected}
                    onChange={toggleAllFilteredResidentsSelected}
                  />
                </th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Resident</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Unit</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Rent</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Contact</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Move-in</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Lease ends</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Occupancy</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Balance</th>
                <th className="px-6 py-3 text-[12px] font-medium text-[#6a7282]">Activation</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                    <td colSpan={10} className="px-6 py-10 text-center text-[14px] text-[#6a7282]">
                    Loading residents…
                  </td>
                </tr>
              ) : filteredResidents.length === 0 ? (
                <tr>
                    <td colSpan={10} className="px-6 py-10 text-center text-[14px] text-[#6a7282]">
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
                filteredResidents.map((resident, index) => (
                  <tr
                    key={resident.id}
                    style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
                    className="sa-enter border-b border-[#f3f4f6] last:border-b-0"
                  >
                    <td className="w-12 px-4 py-4">
                      <div
                        ref={
                          showCheckboxGuide && resident.id === checkboxGuideResidentId
                            ? checkboxGuideTargetRef
                            : undefined
                        }
                        className="inline-flex"
                      >
                        <TableCheckbox
                          aria-label={`Select ${resident.name}`}
                          checked={selectedResidentIds.has(resident.id)}
                          onChange={() => toggleResidentSelected(resident.id)}
                        />
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[14px] font-medium text-[#0a0a0a]">
                      <button
                        type="button"
                        onClick={() =>
                          navigate(residentDetailPath(resident.id), {
                            state: { from: '/admin/residents' },
                          })
                        }
                        className="sa-link rounded-[4px] text-left text-[#0a0a0a] hover:text-[#186179] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                      >
                        {resident.name}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-[14px] text-[#6a7282]">{resident.unitLabel}</td>
                    <td className="px-6 py-4 text-[14px] tabular-nums text-[#0a0a0a]">
                      {resident.rentLabel}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-0.5">
                        {resident.contactPhone ? (
                          <span className="text-[13px] leading-5 text-[#0a0a0a]">{resident.contactPhone}</span>
                        ) : null}
                        {resident.contactEmail ? (
                          <span className="truncate text-[12px] leading-4 text-[#6a7282]">
                            {resident.contactEmail}
                          </span>
                        ) : null}
                        {!resident.contactPhone && !resident.contactEmail ? (
                          <span className="text-[14px] text-[#6a7282]">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[14px] tabular-nums text-[#6a7282]">
                      {resident.moveInLabel}
                    </td>
                    <td className="px-6 py-4 text-[14px] tabular-nums text-[#6a7282]">
                      {resident.leaseEndLabel}
                    </td>
                    <td className="px-6 py-4 text-[14px] text-[#6a7282]">
                      {residentOccupancyLabel(resident.status)}
                    </td>
                    <td
                      className={[
                        'px-6 py-4 text-[14px] tabular-nums',
                        resident.balanceDue > 0
                          ? 'font-semibold text-[#0a0a0a]'
                          : 'text-[#6a7282]',
                      ].join(' ')}
                    >
                      {formatBalance(resident.balanceDue)}
                    </td>
                    <td className="px-6 py-4 align-middle">
                      {(() => {
                        const chip = resolveTenantActivationChip({
                          activationStatus: resident.activationStatus,
                          smsConsentStatus: resident.smsConsentStatus,
                          activationAttemptCount: resident.activationAttemptCount,
                          activationSmsSentAt: resident.activationSmsSentAt,
                        })
                        return <TenantActivationStatusChip chip={chip} />
                      })()}
                    </td>
                  </tr>
                ))
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
    </main>
  )
}

export default AdminResidentsDashboard
