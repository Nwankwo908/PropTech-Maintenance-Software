import { useEffect, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { StreetAddressAutocomplete } from '@/components/StreetAddressAutocomplete'
import { TableCheckbox, checkboxInputClassName } from '@/components/TableCheckbox'
import { PRIVACY_POLICY_PATH } from '@/lib/legal/privacyPolicyContent'
import { ResidentOccupancySelect } from '@/components/ResidentOccupancySelect'
import { normalizeOnboardingOccupancyStatus } from '@/lib/onboarding'
import {
  type OnboardingExtractionReview,
  type OnboardingExtractedProperty,
  type OnboardingExtractedResident,
  type OnboardingExtractedUnit,
  type OnboardingExtractedVendor,
} from '@/lib/onboardingDocumentUpload'
import {
  onboardingNestedCardClass,
  onboardingSectionStackClass,
  onboardingSurfaceSectionClass,
  ONBOARDING_PROPERTY_TYPE_OPTIONS,
  resolveOnboardingPropertyType,
} from './onboardingFieldStyles'
import {
  OnboardingContinueButton,
  OnboardingStepNav,
} from './OnboardingStepChrome'
import { OnboardingUloNumberCard } from '@/components/onboarding/OnboardingUloNumberCard'
import { NoVendorsContinueModal } from '@/components/onboarding/NoVendorsContinueModal'
import { OnboardingSendSwitch } from '@/components/onboarding/OnboardingSendSwitch'
import { US_STATE_OPTIONS } from '@/lib/usLocations'
import { VENDOR_TRADE_OPTIONS as CANONICAL_VENDOR_TRADE_OPTIONS } from '@/lib/vendorTrades'

const VENDOR_TRADE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Select trade' },
  ...CANONICAL_VENDOR_TRADE_OPTIONS.map((trade) => ({
    value: trade.value,
    label: trade.label,
  })),
]

const MANUAL_PROPERTY_SOURCE = 'Manual entry'

function createEmptyExtractedProperty(): OnboardingExtractedProperty {
  return {
    id: `property-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    propertyType: '',
    unitCount: 0,
    unitLabels: '',
    propertyManagerName: '',
    propertyManagerPhone: '',
    sourceDocumentName: MANUAL_PROPERTY_SOURCE,
    confidence: 1,
    selected: false,
    needsReview: false,
  }
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="sa-press inline-flex size-8 items-center justify-center rounded-full text-[#101828] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#101828]/20"
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" />
      </svg>
    </button>
  )
}

function createEmptyExtractedVendor(): OnboardingExtractedVendor {
  return {
    id: `vendor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    category: null,
    phone: '',
    email: '',
    preferredEmergency: false,
    sourceDocumentName: 'Manual entry',
    confidence: 1,
    selected: false,
    needsReview: false,
    sendOnboardingOnComplete: false,
  }
}

const inputClass =
  'mt-1 h-9 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[13px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

const selectClass = `${inputClass} appearance-none pr-8`

const fieldLabelClass = 'block text-[12px] font-medium text-[#6a7282]'

function normalizeBuildingLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function propertyIdentity(property: OnboardingExtractedProperty): string {
  return normalizeBuildingLabel(property.name || property.address)
}

function unitsForProperty(
  property: OnboardingExtractedProperty,
  units: OnboardingExtractedUnit[],
  allProperties: OnboardingExtractedProperty[],
): OnboardingExtractedUnit[] {
  const identity = propertyIdentity(property)
  return units.filter((unit) => {
    const unitBuilding = normalizeBuildingLabel(unit.building)
    if (identity && unitBuilding) {
      return (
        unitBuilding === identity ||
        unitBuilding === normalizeBuildingLabel(property.address) ||
        unitBuilding === normalizeBuildingLabel(property.name) ||
        unitBuilding.startsWith(`${identity} `) ||
        identity.startsWith(`${unitBuilding} `)
      )
    }
    return allProperties.length === 1
  })
}

function residentForUnit(
  unit: OnboardingExtractedUnit,
  residents: OnboardingExtractedResident[],
): OnboardingExtractedResident | undefined {
  const unitLabel = unit.label.trim().toLowerCase()
  const unitBuilding = normalizeBuildingLabel(unit.building)
  return residents.find((resident) => {
    if (resident.unit.trim().toLowerCase() !== unitLabel) return false
    const residentBuilding = normalizeBuildingLabel(resident.building)
    if (unitBuilding && residentBuilding) return unitBuilding === residentBuilding
    return true
  })
}

function residentsForProperty(
  property: OnboardingExtractedProperty,
  residents: OnboardingExtractedResident[],
  allProperties: OnboardingExtractedProperty[],
): OnboardingExtractedResident[] {
  const identity = propertyIdentity(property)
  return residents.filter((resident) => {
    const residentBuilding = normalizeBuildingLabel(resident.building)
    if (identity && residentBuilding) {
      return (
        residentBuilding === identity ||
        residentBuilding === normalizeBuildingLabel(property.address) ||
        residentBuilding === normalizeBuildingLabel(property.name)
      )
    }
    return allProperties.length === 1
  })
}

function ReviewItemRow({
  checked,
  onToggle,
  label,
  value,
  sourceDocumentName,
  editing,
  editValue,
  editMode = 'value',
  editFieldLabel,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onEditChange,
  trailing,
  children,
  as = 'li',
  showSelection = true,
}: {
  checked: boolean
  onToggle: () => void
  label: string
  value?: string
  sourceDocumentName: string
  editing: boolean
  editValue: string
  editMode?: 'label' | 'value'
  editFieldLabel?: string
  onEdit?: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onEditChange: (value: string) => void
  /** Replaces the Edit control (e.g. resident Onboarding switch). */
  trailing?: ReactNode
  children?: ReactNode
  as?: 'li' | 'div'
  /** When false, hide the include checkbox and the label beside it. */
  showSelection?: boolean
}) {
  const Wrapper = as
  return (
    <Wrapper className="sa-row rounded-[8px] border border-[#eef0f3] px-3 py-3">
      <div className={showSelection ? 'flex items-start gap-3' : undefined}>
        {showSelection ? (
        <div className="pt-0.5">
          <TableCheckbox aria-label={`Include ${label}`} checked={checked} onChange={onToggle} />
        </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {editing && editMode === 'label' ? (
              <div className="min-w-0 flex-1">
                {editFieldLabel ? (
                  <span className={fieldLabelClass}>{editFieldLabel}</span>
                ) : null}
                <input
                  className={inputClass}
                  value={editValue}
                  onChange={(e) => onEditChange(e.target.value)}
                  aria-label={editFieldLabel ?? 'Edit name'}
                />
              </div>
            ) : showSelection ? (
              <p className="text-[13px] font-medium text-[#101828]">{label}</p>
            ) : null}
          </div>
          {editing && editMode === 'label' ? (
            <div className="mt-2">
              <button type="button" onClick={onCancelEdit} className="text-[12px] font-medium text-[#6a7282]">
                Cancel
              </button>
            </div>
          ) : editing && editMode === 'value' ? (
            <div className="mt-2">
              {editFieldLabel ? <span className={fieldLabelClass}>{editFieldLabel}</span> : null}
              <input className={inputClass} value={editValue} onChange={(e) => onEditChange(e.target.value)} />
              <div className="mt-2">
                <button type="button" onClick={onCancelEdit} className="text-[12px] font-medium text-[#6a7282]">
                  Cancel
                </button>
              </div>
            </div>
          ) : value?.trim() ? (
            <p className="mt-1 text-[13px] leading-relaxed text-[#364153]">{value}</p>
          ) : null}
          {showSelection ? (
            <p className="mt-1 text-[11px] text-[#9ca3af]">Source: {sourceDocumentName}</p>
          ) : null}
          {children}
        </div>
        {trailing ? (
          trailing
        ) : onEdit ? (
          editing ? (
            <button
              type="button"
              onClick={onSaveEdit}
              className="shrink-0 text-[12px] font-medium text-[#187960] hover:text-[#14634f]"
            >
              Save
            </button>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              className="shrink-0 text-[12px] font-medium text-[#9E439F] hover:text-[#863786]"
            >
              Edit
            </button>
          )
        ) : null}
      </div>
    </Wrapper>
  )
}

function ReviewSection({
  title,
  count,
  emptyLabel,
  headerActions,
  children,
}: {
  title: string
  count?: number
  emptyLabel?: string
  headerActions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className={onboardingNestedCardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-[#101828]">
          {count != null ? `${title} (${count})` : title}
        </h3>
        {headerActions ? <div className="flex flex-wrap items-center gap-2">{headerActions}</div> : null}
      </div>
      {children ?? (
        emptyLabel ? <p className="mt-2 text-[13px] text-[#6a7282]">{emptyLabel}</p> : null
      )}
    </section>
  )
}

export type OnboardingAiReviewStepProps = {
  review: OnboardingExtractionReview
  saving: boolean
  onReviewChange: (review: OnboardingExtractionReview) => void
  onBackToUploads: () => void
  onImportAll: () => void
  continueLabel?: string
  /** Landlord SMS line assigned for this account (Review stage). */
  smsIntakeNumber?: string | null
  smsIntakeNumberDisplay?: string | null
  /** True when the landlord skipped the lease upload step. */
  skippedUpload?: boolean
}

export function OnboardingAiReviewStep({
  review,
  saving,
  onReviewChange,
  onBackToUploads,
  onImportAll,
  continueLabel = 'Continue',
  smsIntakeNumber = null,
  smsIntakeNumberDisplay = null,
  skippedUpload = false,
}: OnboardingAiReviewStepProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [confirmNoVendorsOpen, setConfirmNoVendorsOpen] = useState(false)
  const [teamMemberOpen, setTeamMemberOpen] = useState(false)
  const smsConsentId = useId()
  const noVendorsTitleId = useId()

  const hasSelectedVendors = review.vendors.some(
    (vendor) => vendor.selected && vendor.name.trim().length > 0,
  )
  const isEmpty =
    review.properties.length === 0 &&
    review.units.length === 0 &&
    review.residents.length === 0 &&
    review.leases.length === 0 &&
    review.vendors.length === 0 &&
    review.financialRecords.length === 0
  const manualAdd = skippedUpload || review.skippedDocumentUpload === true

  useEffect(() => {
    const backup = review.account
    if (
      backup.backupContactName.trim() ||
      backup.backupContactPhone.trim() ||
      backup.backupContactEmail.trim()
    ) {
      setTeamMemberOpen(true)
    }
  }, [
    review.account.backupContactName,
    review.account.backupContactPhone,
    review.account.backupContactEmail,
  ])

  useEffect(() => {
    if (manualAdd) return
    if (review.vendors.length > 0) return
    onReviewChange({
      ...review,
      vendors: [createEmptyExtractedVendor()],
    })
    // Seed one blank row for manual entry when extraction found none.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the list is empty
  }, [review.vendors.length, manualAdd])

  function requestContinue() {
    if (!hasSelectedVendors) {
      setConfirmNoVendorsOpen(true)
      return
    }
    onImportAll()
  }

  function patchAccount(patch: Partial<OnboardingExtractionReview['account']>) {
    onReviewChange({
      ...review,
      account: { ...review.account, ...patch },
    })
  }

  function patchProperty(id: string, patch: Partial<OnboardingExtractedProperty>) {
    onReviewChange({
      ...review,
      properties: review.properties.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    })
  }

  function patchResident(id: string, patch: Partial<OnboardingExtractedResident>) {
    onReviewChange({
      ...review,
      residents: review.residents.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    })
  }

  function patchUnit(id: string, patch: Partial<OnboardingExtractedUnit>) {
    onReviewChange({
      ...review,
      units: review.units.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    })
  }

  function patchVendor(id: string, patch: Partial<OnboardingExtractedVendor>) {
    onReviewChange({
      ...review,
      vendors: review.vendors.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    })
  }

  function addPropertyForm() {
    onReviewChange({
      ...review,
      properties: [...review.properties, createEmptyExtractedProperty()],
    })
  }

  function removePropertyForm(id: string) {
    onReviewChange({
      ...review,
      properties: review.properties.filter((row) => row.id !== id),
    })
  }

  function addVendorForm() {
    onReviewChange({
      ...review,
      vendors: [...review.vendors, createEmptyExtractedVendor()],
    })
  }

  function removeVendorForm(id: string) {
    if (review.vendors.length <= 1) {
      onReviewChange({
        ...review,
        vendors: manualAdd ? [] : [createEmptyExtractedVendor()],
      })
      return
    }
    onReviewChange({
      ...review,
      vendors: review.vendors.filter((row) => row.id !== id),
    })
  }

  function startEdit(id: string, value: string) {
    setEditingId(id)
    setEditDraft(value)
  }

  function saveEdit<T extends { id: string }>(
    section: keyof OnboardingExtractionReview,
    field: string,
    items: T[],
  ) {
    onReviewChange({
      ...review,
      [section]: items.map((item) =>
        item.id === editingId ? { ...item, [field]: editDraft } : item,
      ),
    } as OnboardingExtractionReview)
    setEditingId(null)
    setEditDraft('')
  }

  function renderResidentEditFields(
    item: OnboardingExtractedResident,
    opts: { showUnit?: boolean } = {},
  ) {
    return (
      <div className="mt-3 grid gap-3 border-t border-[#f3f4f6] pt-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={fieldLabelClass}>Full name</span>
          <input
            className={inputClass}
            value={item.fullName}
            onChange={(e) => patchResident(item.id, { fullName: e.target.value })}
            placeholder="Full name"
          />
        </label>
        <div
          className={`grid gap-3 sm:col-span-2 ${opts.showUnit ? 'sm:grid-cols-[1fr_1fr_120px]' : 'sm:grid-cols-2'}`}
        >
        <label className="block min-w-0">
          <span className={fieldLabelClass}>Email</span>
          <input
            className={inputClass}
            type="email"
            value={item.email}
            onChange={(e) => patchResident(item.id, { email: e.target.value })}
            placeholder="Email"
          />
        </label>
        <label className="block min-w-0">
          <span className={fieldLabelClass}>Phone</span>
          <input
            className={inputClass}
            type="tel"
            value={item.phone}
            onChange={(e) => patchResident(item.id, { phone: e.target.value })}
            placeholder="Phone"
          />
        </label>
        {opts.showUnit ? (
          <label className="block min-w-0">
            <span className={fieldLabelClass}>Unit</span>
            <input
              className={inputClass}
              value={item.unit}
              onChange={(e) => patchResident(item.id, { unit: e.target.value })}
              placeholder="4B"
            />
          </label>
        ) : null}
        </div>
        <div className="grid grid-cols-3 gap-3 sm:col-span-2">
        <label className="block min-w-0">
          <span className={fieldLabelClass}>Occupancy status</span>
          <ResidentOccupancySelect
            className={selectClass}
            value={normalizeOnboardingOccupancyStatus(item.occupancyStatus)}
            onChange={(occupancyStatus) => patchResident(item.id, { occupancyStatus })}
            aria-label={`Occupancy status for ${item.fullName || 'resident'}`}
          />
        </label>
        <label className="block min-w-0">
          <span className={fieldLabelClass}>Monthly rent</span>
          <input
            className={inputClass}
            value={item.monthlyRent}
            onChange={(e) => patchResident(item.id, { monthlyRent: e.target.value })}
            placeholder="$2,850"
          />
        </label>
        <label className="block min-w-0">
          <span className={fieldLabelClass}>Rent due day (1–31)</span>
          <input
            className={inputClass}
            value={item.rentDueDay}
            onChange={(e) => patchResident(item.id, { rentDueDay: e.target.value })}
            placeholder="1"
          />
        </label>
        </div>
        <label className="block sm:col-span-2">
          <span className={fieldLabelClass}>Maintenance responsibilities clause</span>
          <textarea
            className={`${inputClass} min-h-[72px] resize-y py-2`}
            value={item.maintenanceResponsibilitiesClause}
            onChange={(e) =>
              patchResident(item.id, {
                maintenanceResponsibilitiesClause: e.target.value,
              })
            }
            placeholder="Optional. Who handles what from the lease."
          />
        </label>
      </div>
    )
  }

  function residentOnboardingTrailing(resident: OnboardingExtractedResident) {
    const hasPhone = resident.phone.trim().length > 0
    return (
      <OnboardingSendSwitch
        enabled={Boolean(resident.sendOnboardingOnComplete)}
        disabled={!hasPhone}
        onChange={(sendOnboardingOnComplete) =>
          patchResident(resident.id, { sendOnboardingOnComplete })
        }
        aria-label={
          hasPhone
            ? `Send onboarding message to ${resident.fullName || 'resident'} when setup completes`
            : `Add a phone number to send onboarding to ${resident.fullName || 'resident'}`
        }
      />
    )
  }

  function renderPropertyRows() {
    if (
      review.properties.length === 0 &&
      review.units.length === 0 &&
      review.residents.length === 0
    ) {
      return <p className="mt-2 text-[13px] text-[#6a7282]">No properties detected.</p>
    }

    const assignedUnitIds = new Set<string>()
    const assignedResidentIds = new Set<string>()

    const propertyRows =
      review.properties.length > 0
        ? review.properties.map((item, index) => {
            const propertyUnits = unitsForProperty(item, review.units, review.properties)
            propertyUnits.forEach((unit) => assignedUnitIds.add(unit.id))
            const addedByHand = manualAdd || item.sourceDocumentName === MANUAL_PROPERTY_SOURCE
            const showUnitCount =
              addedByHand || Math.max(item.unitCount, propertyUnits.length) > 1
            const isMultifamily =
              resolveOnboardingPropertyType(item.propertyType) === 'multifamily'

            return (
              <li key={item.id} className="list-none">
              <ReviewItemRow
                as="div"
                checked={item.selected}
                onToggle={() => patchProperty(item.id, { selected: !item.selected })}
                label={item.name}
                sourceDocumentName={item.sourceDocumentName}
                editing={false}
                editValue=""
                onSaveEdit={() => undefined}
                onCancelEdit={() => undefined}
                onEditChange={() => undefined}
                showSelection={!manualAdd}
              >
                  <div
                    className={
                      manualAdd
                        ? 'grid gap-3 sm:grid-cols-2'
                        : 'mt-3 grid gap-3 border-t border-[#f3f4f6] pt-3 sm:grid-cols-2'
                    }
                  >
                    <label className="block min-w-0">
                      <span className={fieldLabelClass}>Property name</span>
                      <input
                        className={inputClass}
                        value={item.name}
                        onChange={(e) => {
                          const name = e.target.value
                          patchProperty(
                            item.id,
                            addedByHand
                              ? {
                                  name,
                                  selected:
                                    name.trim().length > 0 || item.address.trim().length > 0,
                                }
                              : { name },
                          )
                        }}
                        placeholder="Property name"
                      />
                    </label>
                    <div className="min-w-0">
                      <span className={fieldLabelClass}>Street address</span>
                      <StreetAddressAutocomplete
                        className={inputClass}
                        value={item.address}
                        onChange={(address) =>
                          patchProperty(
                            item.id,
                            addedByHand
                              ? {
                                  address,
                                  selected:
                                    item.name.trim().length > 0 || address.trim().length > 0,
                                }
                              : { address },
                          )
                        }
                        onPlaceResolved={(parsed) =>
                          patchProperty(item.id, {
                            address: parsed.street || item.address,
                            city: parsed.city || item.city,
                            state: parsed.state || item.state,
                            zipCode: parsed.zipCode || item.zipCode,
                          })
                        }
                        placeholder="Street address"
                      />
                    </div>
                    <label className="block">
                      <span className={fieldLabelClass}>City</span>
                      <input
                        className={inputClass}
                        value={item.city}
                        onChange={(e) => patchProperty(item.id, { city: e.target.value })}
                        placeholder="City"
                      />
                    </label>
                    <label className="block">
                      <span className={fieldLabelClass}>State</span>
                      <div className="relative">
                        <select
                          className={selectClass}
                          value={item.state}
                          onChange={(e) => patchProperty(item.id, { state: e.target.value })}
                        >
                          <option value="">Select state</option>
                          {US_STATE_OPTIONS.map((option) => (
                            <option key={option.code} value={option.code}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </label>
                    <div
                      className={`grid gap-3 sm:col-span-2 ${showUnitCount ? 'grid-cols-3' : 'grid-cols-2'}`}
                    >
                    <label className="block min-w-0">
                      <span className={fieldLabelClass}>ZIP</span>
                      <input
                        className={inputClass}
                        value={item.zipCode}
                        onChange={(e) => patchProperty(item.id, { zipCode: e.target.value })}
                        placeholder="07102"
                      />
                    </label>
                    {showUnitCount ? (
                    <label className="block min-w-0">
                      <span className={fieldLabelClass}>Units</span>
                      <input
                        className={inputClass}
                        type="number"
                        min={1}
                        value={item.unitCount > 0 ? String(item.unitCount) : ''}
                        onChange={(e) => {
                          const parsed = Number.parseInt(e.target.value, 10)
                          patchProperty(item.id, {
                            unitCount: Number.isFinite(parsed) && parsed >= 1 ? parsed : 0,
                          })
                        }}
                        placeholder="1"
                      />
                    </label>
                    ) : null}
                    <label className="block min-w-0">
                      <span className={fieldLabelClass}>Property type</span>
                      <div className="relative">
                        <select
                          className={`${selectClass} pr-10`}
                          value={resolveOnboardingPropertyType(item.propertyType)}
                          onChange={(e) => patchProperty(item.id, { propertyType: e.target.value })}
                        >
                          <option value="">Select property type</option>
                          {ONBOARDING_PROPERTY_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]"
                          aria-hidden
                        >
                          <svg viewBox="0 0 24 24" fill="none" className="size-4">
                            <path
                              d="M6 9l6 6 6-6"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                            />
                          </svg>
                        </span>
                      </div>
                    </label>
                    </div>
                  </div>

                  {(() => {
                    const propertyResidents: OnboardingExtractedResident[] = []
                    const seenResidentIds = new Set<string>()
                    for (const unit of propertyUnits) {
                      const resident = residentForUnit(unit, review.residents)
                      if (!resident || seenResidentIds.has(resident.id)) continue
                      seenResidentIds.add(resident.id)
                      propertyResidents.push(resident)
                    }
                    for (const resident of residentsForProperty(
                      item,
                      review.residents,
                      review.properties,
                    )) {
                      if (seenResidentIds.has(resident.id)) continue
                      seenResidentIds.add(resident.id)
                      propertyResidents.push(resident)
                    }
                    propertyResidents.forEach((resident) => assignedResidentIds.add(resident.id))
                    if (propertyResidents.length === 0) return null
                    return (
                      <div className="mt-3 border-t border-[#f3f4f6] pt-3">
                        <p className="text-[12px] font-medium text-[#364153]">Residents</p>
                        <ul className="mt-2 list-none space-y-2 pl-0">
                          {propertyResidents.map((resident) => (
                            <li key={resident.id} className="list-none">
                              <ReviewItemRow
                                as="div"
                                checked={resident.selected}
                                onToggle={() =>
                                  patchResident(resident.id, { selected: !resident.selected })
                                }
                                label={resident.fullName}
                                sourceDocumentName={resident.sourceDocumentName}
                                editing={false}
                                editValue=""
                                onSaveEdit={() => undefined}
                                onCancelEdit={() => undefined}
                                onEditChange={() => undefined}
                                trailing={residentOnboardingTrailing(resident)}
                              >
                                {renderResidentEditFields(resident, { showUnit: isMultifamily })}
                              </ReviewItemRow>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })()}
              </ReviewItemRow>
              {addedByHand ? (
                <div className="mt-2 flex justify-center">
                  <button
                    type="button"
                    className="rounded-[8px] px-2 py-1 text-[12px] font-medium text-[#64748b] transition-colors hover:bg-[#fef2f2] hover:text-[#b91c1c]"
                    onClick={() => removePropertyForm(item.id)}
                    aria-label={`Remove property ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
              </li>
            )
          })
        : []

    const orphanUnits = review.units.filter((unit) => !assignedUnitIds.has(unit.id))
    for (const unit of orphanUnits) {
      const resident = residentForUnit(unit, review.residents)
      if (resident) assignedResidentIds.add(resident.id)
    }
    const orphanResidents = review.residents.filter((resident) => !assignedResidentIds.has(resident.id))

    return (
      <ul className="mt-3 space-y-2">
        {propertyRows}
        {orphanUnits.length > 0 ? (
          <li className="list-none rounded-[8px] border border-[#eef0f3] px-3 py-3">
            <p className="text-[12px] font-medium text-[#364153]">Units without a matched property</p>
            <ul className="mt-2 list-none space-y-2 pl-0">
              {orphanUnits.map((unit) => {
                const resident = residentForUnit(unit, review.residents)
                if (resident) assignedResidentIds.add(resident.id)
                return (
                  <li key={unit.id} className="list-none space-y-2">
                    <ReviewItemRow
                      as="div"
                      checked={unit.selected}
                      onToggle={() => patchUnit(unit.id, { selected: !unit.selected })}
                      label={`Unit ${unit.label}`}
                      sourceDocumentName={unit.sourceDocumentName}
                      editing={editingId === unit.id}
                      editValue={editDraft}
                      editMode="label"
                      editFieldLabel="Unit number"
                      onEdit={() => startEdit(unit.id, unit.label)}
                      onSaveEdit={() => saveEdit('units', 'label', review.units)}
                      onCancelEdit={() => setEditingId(null)}
                      onEditChange={setEditDraft}
                    />
                    {resident ? (
                      <ReviewItemRow
                        as="div"
                        checked={resident.selected}
                        onToggle={() => patchResident(resident.id, { selected: !resident.selected })}
                        label={resident.fullName}
                        sourceDocumentName={resident.sourceDocumentName}
                        editing={false}
                        editValue=""
                        onSaveEdit={() => undefined}
                        onCancelEdit={() => undefined}
                        onEditChange={() => undefined}
                        trailing={residentOnboardingTrailing(resident)}
                      >
                        {renderResidentEditFields(resident)}
                      </ReviewItemRow>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </li>
        ) : null}
        {orphanResidents.length > 0 ? (
          <li className="list-none rounded-[8px] border border-[#eef0f3] px-3 py-3">
            <p className="text-[12px] font-medium text-[#364153]">Residents without a matched property</p>
            <ul className="mt-2 list-none space-y-2 pl-0">
              {orphanResidents.map((resident) => (
                <li key={resident.id} className="list-none">
                  <ReviewItemRow
                    as="div"
                    checked={resident.selected}
                    onToggle={() => patchResident(resident.id, { selected: !resident.selected })}
                    label={resident.fullName}
                    sourceDocumentName={resident.sourceDocumentName}
                    editing={false}
                    editValue=""
                    onSaveEdit={() => undefined}
                    onCancelEdit={() => undefined}
                    onEditChange={() => undefined}
                    trailing={residentOnboardingTrailing(resident)}
                  >
                    {renderResidentEditFields(resident)}
                  </ReviewItemRow>
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    )
  }

  function renderVendorForms() {
    const vendors =
      review.vendors.length > 0 ? review.vendors : [createEmptyExtractedVendor()]

    return (
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-[13px] text-[#6a7282]">
          Add preferred vendors for repairs and property services. You can enter them here even if
          none were found in your documents.
        </p>
        {vendors.map((item, index) => (
          <div
            key={item.id}
            className="rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[13px] font-semibold text-[#101828]">Vendor {index + 1}</p>
              <div className="flex items-center gap-3">
                <OnboardingSendSwitch
                  enabled={Boolean(item.sendOnboardingOnComplete)}
                  disabled={!item.phone.trim() && !item.email.trim()}
                  onChange={(sendOnboardingOnComplete) =>
                    patchVendor(item.id, { sendOnboardingOnComplete })
                  }
                  aria-label={
                    item.phone.trim() || item.email.trim()
                      ? `Send verification invite to vendor ${index + 1} when setup completes`
                      : `Add a phone or email to send onboarding to vendor ${index + 1}`
                  }
                />
                {vendors.length > 1 ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-[8px] px-2 py-1 text-[12px] font-medium text-[#64748b] transition-colors hover:bg-[#fef2f2] hover:text-[#b91c1c]"
                    onClick={() => removeVendorForm(item.id)}
                    aria-label={`Remove vendor ${index + 1}`}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className={fieldLabelClass}>Vendor name</span>
                <input
                  className={inputClass}
                  value={item.name}
                  onChange={(e) =>
                    patchVendor(item.id, {
                      name: e.target.value,
                      selected: e.target.value.trim().length > 0,
                    })
                  }
                  placeholder="Vendor name"
                  aria-label={`Vendor ${index + 1} name`}
                />
              </label>
              <label className="block relative">
                <span className={fieldLabelClass}>Trade</span>
                <select
                  className={`${selectClass} ${!(item.category ?? '').trim() ? 'text-[#9ca3af]' : ''}`}
                  value={item.category ?? ''}
                  onChange={(e) =>
                    patchVendor(item.id, {
                      category: e.target.value.trim() || null,
                      selected: item.name.trim().length > 0 || Boolean(e.target.value.trim()),
                    })
                  }
                  aria-label={`Vendor ${index + 1} trade`}
                >
                  {VENDOR_TRADE_OPTIONS.map((option) => (
                    <option key={option.value || 'placeholder'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span
                  className="pointer-events-none absolute right-3 top-[30px] text-[#6a7282]"
                  aria-hidden
                >
                  <svg viewBox="0 0 24 24" fill="none" className="size-4">
                    <path
                      d="M6 9l6 6 6-6"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </label>
              <label className="block">
                <span className={fieldLabelClass}>Phone</span>
                <input
                  className={inputClass}
                  type="tel"
                  value={item.phone}
                  onChange={(e) =>
                    patchVendor(item.id, {
                      phone: e.target.value,
                      selected: item.name.trim().length > 0,
                    })
                  }
                  placeholder="(555) 123-4567"
                  aria-label={`Vendor ${index + 1} phone`}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className={fieldLabelClass}>Email</span>
                <input
                  className={inputClass}
                  type="email"
                  value={item.email}
                  onChange={(e) =>
                    patchVendor(item.id, {
                      email: e.target.value,
                      selected: item.name.trim().length > 0,
                    })
                  }
                  placeholder="Email"
                  aria-label={`Vendor ${index + 1} email`}
                />
              </label>
              <label className="flex cursor-pointer items-start gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={item.preferredEmergency}
                  onChange={(e) =>
                    patchVendor(item.id, {
                      preferredEmergency: e.target.checked,
                      selected: item.name.trim().length > 0,
                    })
                  }
                  className={`${checkboxInputClassName} mt-0.5 accent-[#611879]`}
                  aria-label={`Vendor ${index + 1} preferred emergency vendor`}
                />
                <span className="text-[12px] leading-5 text-[#364153]">
                  Preferred emergency vendor for urgent after-hours work
                </span>
              </label>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="w-full rounded-[10px] border border-[#e5e7eb] bg-white py-2.5 text-[13px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb]"
          onClick={addVendorForm}
        >
          + Add another vendor
        </button>
      </div>
    )
  }

  const account = review.account
  const smsChecked = Boolean(account.smsConsentAcceptedAt)

  return (
    <section className={onboardingSurfaceSectionClass}>
      <div className={onboardingSectionStackClass}>
        <OnboardingUloNumberCard
          smsIntakeNumber={smsIntakeNumber}
          smsIntakeNumberDisplay={smsIntakeNumberDisplay}
        />

        <ReviewSection title="Your organization">
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabelClass}>Company name (optional)</span>
              <input
                className={inputClass}
                value={account.companyName}
                onChange={(e) => patchAccount({ companyName: e.target.value })}
                placeholder="Company name"
              />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>
                Phone <span className="text-[#b91c1c]">*</span> (Required)
              </span>
              <input
                className={inputClass}
                type="tel"
                value={account.phone}
                onChange={(e) => patchAccount({ phone: e.target.value })}
                placeholder="(555) 123-4567"
                aria-describedby={`${smsConsentId}-disclosure`}
              />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>
                Your name <span className="text-[#b91c1c]">*</span> (Required)
              </span>
              <input
                className={inputClass}
                value={account.contactName}
                onChange={(e) => patchAccount({ contactName: e.target.value })}
                placeholder="Your name"
              />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Support email</span>
              <input
                className={inputClass}
                type="email"
                value={account.email}
                onChange={(e) => patchAccount({ email: e.target.value })}
                placeholder="Support email"
              />
            </label>
            <div className="sm:col-span-2">
              <p
                id={`${smsConsentId}-disclosure`}
                className="mt-2 text-[12px] leading-[18px] text-[#6a7282]"
              >
                By signing up, you agree to receive recurring SMS messages from Ulo related to account
                verification, maintenance requests, vendor coordination, work order updates,
                appointment reminders, and other property management notifications. Consent is not a
                condition of purchase. Reply STOP to opt out. Reply HELP for help. Message frequency
                varies. Message and data rates may apply. View our{' '}
                <Link
                  to={PRIVACY_POLICY_PATH}
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
                htmlFor={smsConsentId}
                className="mt-2 flex cursor-pointer items-start gap-2.5"
              >
                <input
                  id={smsConsentId}
                  type="checkbox"
                  checked={smsChecked}
                  onChange={(e) =>
                    patchAccount({
                      smsConsentAcceptedAt: e.target.checked
                        ? account.smsConsentAcceptedAt || new Date().toISOString()
                        : null,
                    })
                  }
                  className={`${checkboxInputClassName} mt-0.5 accent-[#611879]`}
                />
                <span className="text-[12px] leading-[18px] text-[#364153]">
                  I agree to receive SMS messages as described above.
                </span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[15px] font-semibold text-[#101828]">Add Team member</p>
                {teamMemberOpen ? null : (
                  <AddRowButton label="Add team member" onClick={() => setTeamMemberOpen(true)} />
                )}
              </div>
              {teamMemberOpen ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={fieldLabelClass}>Team member name (optional)</span>
                    <input
                      className={inputClass}
                      value={account.backupContactName}
                      onChange={(e) => patchAccount({ backupContactName: e.target.value })}
                      placeholder="Team member name"
                    />
                  </label>
                  <label className="block">
                    <span className={fieldLabelClass}>Team member phone number (optional)</span>
                    <input
                      className={inputClass}
                      type="tel"
                      value={account.backupContactPhone}
                      onChange={(e) => patchAccount({ backupContactPhone: e.target.value })}
                      placeholder="(555) 123-4567"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className={fieldLabelClass}>Team member email (optional)</span>
                    <input
                      className={inputClass}
                      type="email"
                      value={account.backupContactEmail}
                      onChange={(e) => patchAccount({ backupContactEmail: e.target.value })}
                      placeholder="name@company.com"
                    />
                    <p className="mt-1.5 text-[12px] leading-[18px] text-[#6a7282]">
                      They can sign in to this account and receive the same operational texts you do.
                    </p>
                  </label>
                </div>
              ) : null}
            </div>
          </div>
        </ReviewSection>

        {isEmpty && !manualAdd ? (
          <div className="rounded-[10px] border border-dashed border-[#e5e7eb] bg-[#fafafa] px-4 py-8 text-center">
            <p className="text-[14px] font-medium text-[#101828]">No extracted portfolio data yet</p>
            <p className="mt-1 text-[13px] text-[#6a7282]">
              Upload documents to extract properties, residents, and vendors — or complete your
              organization details above and continue.
            </p>
          </div>
        ) : (
          <>
            <ReviewSection
              title={manualAdd ? 'Add properties' : 'Properties Found'}
              count={
                manualAdd
                  ? undefined
                  : review.properties.length ||
                    (review.units.length > 0 || review.residents.length > 0 ? 1 : 0)
              }
              headerActions={
                manualAdd ? (
                  <AddRowButton label="Add property" onClick={addPropertyForm} />
                ) : undefined
              }
            >
              {manualAdd && review.properties.length === 0 ? null : renderPropertyRows()}
              {manualAdd ? null : (
                <button
                  type="button"
                  className="mt-3 w-full rounded-[10px] border border-[#e5e7eb] bg-white py-2.5 text-[13px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb]"
                  onClick={addPropertyForm}
                >
                  + Add another property
                </button>
              )}
            </ReviewSection>
            {manualAdd ? null : (
            <ReviewSection title="Lease Information Found" count={review.leases.length}>
              {null}
            </ReviewSection>
            )}
            <ReviewSection
              title={manualAdd ? 'Add vendor' : 'Vendors'}
              count={
                manualAdd
                  ? undefined
                  : review.vendors.filter((v) => v.name.trim()).length || undefined
              }
              headerActions={
                manualAdd ? (
                  <AddRowButton label="Add vendor" onClick={addVendorForm} />
                ) : undefined
              }
            >
              {manualAdd && review.vendors.length === 0 ? null : renderVendorForms()}
            </ReviewSection>
          </>
        )}
      </div>

      <OnboardingStepNav showBack onBack={onBackToUploads} saving={saving}>
        <OnboardingContinueButton disabled={saving} onClick={requestContinue}>
          {continueLabel}
        </OnboardingContinueButton>
      </OnboardingStepNav>

      {confirmNoVendorsOpen ? (
        <NoVendorsContinueModal
          titleId={noVendorsTitleId}
          saving={saving}
          onClose={() => setConfirmNoVendorsOpen(false)}
          onConfirm={() => {
            setConfirmNoVendorsOpen(false)
            onImportAll()
          }}
        />
      ) : null}
    </section>
  )
}
