import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { TableCheckbox, checkboxInputClassName } from '@/components/TableCheckbox'
import { PRIVACY_POLICY_PATH } from '@/lib/legal/privacyPolicyContent'
import { ResidentOccupancySelect } from '@/components/ResidentOccupancySelect'
import { normalizeOnboardingOccupancyStatus } from '@/lib/onboarding'
import {
  countSelectedInReview,
  formatExtractedUnitPlacement,
  type ExtractedFinancialRecord,
  type ExtractedLeaseInfo,
  type OnboardingExtractionReview,
  type OnboardingExtractedMaintenanceIssue,
  type OnboardingExtractedProperty,
  type OnboardingExtractedResident,
  type OnboardingExtractedUnit,
  type OnboardingExtractedVendor,
} from '@/lib/onboardingDocumentUpload'
import {
  onboardingBtnGhostClass,
  onboardingBtnPrimaryClass,
  onboardingNestedCardClass,
  onboardingSectionStackClass,
  onboardingSurfaceSectionClass,
  ONBOARDING_PROPERTY_TYPE_OPTIONS,
  resolveOnboardingPropertyType,
} from './onboardingFieldStyles'
import { US_STATE_OPTIONS } from '@/lib/usLocations'

const btnPrimary = onboardingBtnPrimaryClass

const btnGhost = onboardingBtnGhostClass

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
  children,
  as = 'li',
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
  children?: React.ReactNode
  as?: 'li' | 'div'
}) {
  const Wrapper = as
  return (
    <Wrapper className="sa-row rounded-[8px] border border-[#eef0f3] px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <TableCheckbox aria-label={`Include ${label}`} checked={checked} onChange={onToggle} />
        </div>
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
            ) : (
              <p className="text-[13px] font-medium text-[#101828]">{label}</p>
            )}
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
          <p className="mt-1 text-[11px] text-[#9ca3af]">Source: {sourceDocumentName}</p>
          {children}
        </div>
        {onEdit ? (
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
}

export function OnboardingAiReviewStep({
  review,
  saving,
  onReviewChange,
  onBackToUploads,
  onImportAll,
}: OnboardingAiReviewStepProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const smsConsentId = useId()

  const selectedCount = countSelectedInReview(review)
  const isEmpty =
    review.properties.length === 0 &&
    review.units.length === 0 &&
    review.residents.length === 0 &&
    review.leases.length === 0 &&
    review.vendors.length === 0 &&
    review.maintenanceIssues.length === 0 &&
    review.financialRecords.length === 0

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

  function setPropertySectionSelected(selected: boolean) {
    onReviewChange({
      ...review,
      properties: review.properties.map((row) => ({ ...row, selected })),
      units: review.units.map((row) => ({ ...row, selected })),
      residents: review.residents.map((row) => ({ ...row, selected })),
    })
  }

  function setLeaseSectionSelected(selected: boolean) {
    onReviewChange({
      ...review,
      leases: review.leases.map((row) => ({ ...row, selected })),
    })
  }

  function sectionSelectActions(
    onSelect: () => void,
    onDeselect: () => void,
  ) {
    return (
      <>
        <button
          type="button"
          disabled={saving}
          onClick={onSelect}
          className="text-[12px] font-medium text-[#186179] hover:text-[#0f4d61] disabled:opacity-50"
        >
          Select
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onDeselect}
          className="text-[12px] font-medium text-[#6a7282] hover:text-[#101828] disabled:opacity-50"
        >
          Deselect
        </button>
      </>
    )
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

  function renderResidentEditFields(item: OnboardingExtractedResident) {
    return (
      <div className="mt-3 grid gap-3 border-t border-[#f3f4f6] pt-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabelClass}>Email</span>
          <input
            className={inputClass}
            type="email"
            value={item.email}
            onChange={(e) => patchResident(item.id, { email: e.target.value })}
            placeholder="Email"
          />
        </label>
        <label className="block">
          <span className={fieldLabelClass}>Phone</span>
          <input
            className={inputClass}
            type="tel"
            value={item.phone}
            onChange={(e) => patchResident(item.id, { phone: e.target.value })}
            placeholder="Phone"
          />
        </label>
        <label className="block">
          <span className={fieldLabelClass}>Occupancy status</span>
          <ResidentOccupancySelect
            className={selectClass}
            value={normalizeOnboardingOccupancyStatus(item.occupancyStatus)}
            onChange={(occupancyStatus) => patchResident(item.id, { occupancyStatus })}
            aria-label={`Occupancy status for ${item.fullName || 'resident'}`}
          />
        </label>
        <label className="block">
          <span className={fieldLabelClass}>Monthly rent</span>
          <input
            className={inputClass}
            value={item.monthlyRent}
            onChange={(e) => patchResident(item.id, { monthlyRent: e.target.value })}
            placeholder="$2,850"
          />
        </label>
        <label className="block">
          <span className={fieldLabelClass}>Rent due day (1–31)</span>
          <input
            className={inputClass}
            value={item.rentDueDay}
            onChange={(e) => patchResident(item.id, { rentDueDay: e.target.value })}
            placeholder="1"
          />
        </label>
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
        ? review.properties.map((item) => {
            const propertyUnits = unitsForProperty(item, review.units, review.properties)
            propertyUnits.forEach((unit) => assignedUnitIds.add(unit.id))

            return (
              <ReviewItemRow
                key={item.id}
                checked={item.selected}
                onToggle={() => patchProperty(item.id, { selected: !item.selected })}
                label={item.name}
                sourceDocumentName={item.sourceDocumentName}
                editing={editingId === item.id}
                editValue={editDraft}
                editMode="label"
                editFieldLabel="Property name"
                onEdit={() => startEdit(item.id, item.name)}
                onSaveEdit={() => saveEdit('properties', 'name', review.properties)}
                onCancelEdit={() => setEditingId(null)}
                onEditChange={setEditDraft}
              >
                  <div className="mt-3 grid gap-3 border-t border-[#f3f4f6] pt-3 sm:grid-cols-2">
                    <p className="sm:col-span-2 text-[12px] font-medium text-[#364153]">
                      Complete location details (not always on the document)
                    </p>
                    <label className="block sm:col-span-2">
                      <span className={fieldLabelClass}>Street address</span>
                      <input
                        className={inputClass}
                        value={item.address}
                        onChange={(e) => patchProperty(item.id, { address: e.target.value })}
                        placeholder="Street address"
                      />
                    </label>
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
                    <label className="block">
                      <span className={fieldLabelClass}>ZIP</span>
                      <input
                        className={inputClass}
                        value={item.zipCode}
                        onChange={(e) => patchProperty(item.id, { zipCode: e.target.value })}
                        placeholder="07102"
                      />
                    </label>
                    <label className="block">
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
                    <label className="block">
                      <span className={fieldLabelClass}>Property manager name</span>
                      <input
                        className={inputClass}
                        value={item.propertyManagerName}
                        onChange={(e) =>
                          patchProperty(item.id, { propertyManagerName: e.target.value })
                        }
                        placeholder="Optional"
                      />
                    </label>
                    <label className="block">
                      <span className={fieldLabelClass}>Property manager phone</span>
                      <input
                        className={inputClass}
                        value={item.propertyManagerPhone}
                        onChange={(e) =>
                          patchProperty(item.id, { propertyManagerPhone: e.target.value })
                        }
                        placeholder="Optional"
                      />
                    </label>
                  </div>

                  {propertyUnits.length > 0 ? (
                    <div className="mt-3 border-t border-[#f3f4f6] pt-3">
                      <p className="text-[12px] font-medium text-[#364153]">Units and residents</p>
                      <ul className="mt-2 list-none space-y-2 pl-0">
                        {propertyUnits.map((unit) => {
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
                                  onToggle={() =>
                                    patchResident(resident.id, { selected: !resident.selected })
                                  }
                                  label={resident.fullName}
                                  sourceDocumentName={resident.sourceDocumentName}
                                  editing={editingId === resident.id}
                                  editValue={editDraft}
                                  editMode="label"
                                  editFieldLabel="Resident name"
                                  onEdit={() => startEdit(resident.id, resident.fullName)}
                                  onSaveEdit={() =>
                                    saveEdit('residents', 'fullName', review.residents)
                                  }
                                  onCancelEdit={() => setEditingId(null)}
                                  onEditChange={setEditDraft}
                                >
                                  {renderResidentEditFields(resident)}
                                </ReviewItemRow>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}

                  {(() => {
                    const propertyResidents = residentsForProperty(
                      item,
                      review.residents,
                      review.properties,
                    ).filter((resident) => !assignedResidentIds.has(resident.id))
                    if (propertyResidents.length === 0) return null
                    propertyResidents.forEach((resident) => assignedResidentIds.add(resident.id))
                    return (
                      <div className="mt-3 border-t border-[#f3f4f6] pt-3">
                        <p className="text-[12px] font-medium text-[#364153]">
                          Residents without a linked unit
                        </p>
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
                                editing={editingId === resident.id}
                                editValue={editDraft}
                                editMode="label"
                                editFieldLabel="Resident name"
                                onEdit={() => startEdit(resident.id, resident.fullName)}
                                onSaveEdit={() =>
                                  saveEdit('residents', 'fullName', review.residents)
                                }
                                onCancelEdit={() => setEditingId(null)}
                                onEditChange={setEditDraft}
                              >
                                {renderResidentEditFields(resident)}
                              </ReviewItemRow>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })()}
              </ReviewItemRow>
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
                        editing={editingId === resident.id}
                        editValue={editDraft}
                        editMode="label"
                        editFieldLabel="Resident name"
                        onEdit={() => startEdit(resident.id, resident.fullName)}
                        onSaveEdit={() => saveEdit('residents', 'fullName', review.residents)}
                        onCancelEdit={() => setEditingId(null)}
                        onEditChange={setEditDraft}
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
                    editing={editingId === resident.id}
                    editValue={editDraft}
                    editMode="label"
                    editFieldLabel="Resident name"
                    onEdit={() => startEdit(resident.id, resident.fullName)}
                    onSaveEdit={() => saveEdit('residents', 'fullName', review.residents)}
                    onCancelEdit={() => setEditingId(null)}
                    onEditChange={setEditDraft}
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

  function renderVendorRows() {
    if (review.vendors.length === 0) {
      return <p className="mt-2 text-[13px] text-[#6a7282]">No vendors detected.</p>
    }
    return (
      <ul className="mt-3 space-y-2">
        {review.vendors.map((item) => (
          <ReviewItemRow
            key={item.id}
            checked={item.selected}
            onToggle={() => patchVendor(item.id, { selected: !item.selected })}
            label={item.name}
            value={[item.category, item.phone, item.email].filter(Boolean).join(' · ')}
            sourceDocumentName={item.sourceDocumentName}
            editing={editingId === item.id}
            editValue={editDraft}
            onEdit={() => startEdit(item.id, item.email)}
            onSaveEdit={() => saveEdit('vendors', 'email', review.vendors)}
            onCancelEdit={() => setEditingId(null)}
            onEditChange={setEditDraft}
          >
            <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-[#f3f4f6] pt-3">
              <input
                type="checkbox"
                checked={item.preferredEmergency}
                onChange={(e) =>
                  patchVendor(item.id, { preferredEmergency: e.target.checked })
                }
                className={`${checkboxInputClassName} mt-0.5 accent-[#611879]`}
              />
              <span className="text-[12px] leading-5 text-[#364153]">
                Preferred emergency vendor for urgent after-hours work
              </span>
            </label>
          </ReviewItemRow>
        ))}
      </ul>
    )
  }

  function renderSimpleRows<
    T extends {
      id: string
      selected: boolean
      sourceDocumentName: string
    },
  >(
    items: T[],
    section: keyof OnboardingExtractionReview,
    labelFor: (item: T) => string,
    valueFor: (item: T) => string,
    editField: string,
    getEditValue: (item: T) => string,
    emptyLabel: string,
  ) {
    if (items.length === 0) return <p className="mt-2 text-[13px] text-[#6a7282]">{emptyLabel}</p>
    return (
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <ReviewItemRow
            key={item.id}
            checked={item.selected}
            onToggle={() =>
              onReviewChange({
                ...review,
                [section]: items.map((row) =>
                  row.id === item.id ? { ...row, selected: !row.selected } : row,
                ),
              } as OnboardingExtractionReview)
            }
            label={labelFor(item)}
            value={valueFor(item)}
            sourceDocumentName={item.sourceDocumentName}
            editing={editingId === item.id}
            editValue={editDraft}
            onEdit={() => startEdit(item.id, getEditValue(item))}
            onSaveEdit={() => saveEdit(section, editField, items)}
            onCancelEdit={() => setEditingId(null)}
            onEditChange={setEditDraft}
          />
        ))}
      </ul>
    )
  }

  const account = review.account
  const smsChecked = Boolean(account.smsConsentAcceptedAt)

  return (
    <section className={onboardingSurfaceSectionClass}>
      <h2 className="text-[18px] font-semibold text-[#101828]">Review and Approve Information</h2>

      <div className={`${onboardingSectionStackClass} mt-4`}>
        <ReviewSection title="Your organization">
          <p className="mt-1 text-[13px] text-[#6a7282]">
            Required for Fast Track — same details as the manual Account setup step.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className={fieldLabelClass}>Company name</span>
              <input
                className={inputClass}
                value={account.companyName}
                onChange={(e) => patchAccount({ companyName: e.target.value })}
                placeholder="Company name"
              />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Your name</span>
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
            <label className="block sm:col-span-2">
              <span className={fieldLabelClass}>Phone</span>
              <input
                className={inputClass}
                type="tel"
                value={account.phone}
                onChange={(e) => patchAccount({ phone: e.target.value })}
                placeholder="(555) 123-4567"
                aria-describedby={`${smsConsentId}-disclosure`}
              />
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
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Backup contact name (optional)</span>
              <input
                className={inputClass}
                value={account.backupContactName}
                onChange={(e) => patchAccount({ backupContactName: e.target.value })}
                placeholder="Backup contact name"
              />
            </label>
            <label className="block">
              <span className={fieldLabelClass}>Backup contact phone (optional)</span>
              <input
                className={inputClass}
                type="tel"
                value={account.backupContactPhone}
                onChange={(e) => patchAccount({ backupContactPhone: e.target.value })}
                placeholder="Backup contact number"
              />
            </label>
          </div>
        </ReviewSection>

        {isEmpty ? (
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
              title="Properties Found"
              count={
                review.properties.length ||
                (review.units.length > 0 || review.residents.length > 0 ? 1 : 0)
              }
              headerActions={sectionSelectActions(
                () => setPropertySectionSelected(true),
                () => setPropertySectionSelected(false),
              )}
            >
              {renderPropertyRows()}
            </ReviewSection>
            <ReviewSection
              title="Lease Information Found"
              count={review.leases.length}
              headerActions={
                review.leases.length > 0
                  ? sectionSelectActions(
                      () => setLeaseSectionSelected(true),
                      () => setLeaseSectionSelected(false),
                    )
                  : undefined
              }
            >
              {renderSimpleRows<ExtractedLeaseInfo>(
                review.leases,
                'leases',
                (item) => item.residentName,
                (item) =>
                  [
                    formatExtractedUnitPlacement(item.building, item.unit),
                    `${item.leaseStart} – ${item.leaseEnd}`,
                    `Rent ${item.rentAmount}`,
                    `Deposit ${item.securityDeposit}`,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                'rentAmount',
                (item) => item.rentAmount,
                'No lease information detected.',
              )}
            </ReviewSection>
            <ReviewSection title="Vendors Found" count={review.vendors.length}>
              {renderVendorRows()}
            </ReviewSection>
            <ReviewSection title="Maintenance Issues Found" count={review.maintenanceIssues.length}>
              {renderSimpleRows<OnboardingExtractedMaintenanceIssue>(
                review.maintenanceIssues,
                'maintenanceIssues',
                (item) => item.description,
                (item) =>
                  `${item.building} · Unit ${item.unit}${item.imageTags?.length ? ` · ${item.imageTags.join(', ')}` : ''}`,
                'description',
                (item) => item.description,
                'No maintenance issues detected.',
              )}
            </ReviewSection>
            <ReviewSection title="Financial Records Found" count={review.financialRecords.length}>
              {renderSimpleRows<ExtractedFinancialRecord>(
                review.financialRecords,
                'financialRecords',
                (item) => item.recordType,
                (item) => `${item.description} · ${item.amount} · ${item.period}`,
                'amount',
                (item) => item.amount,
                'No financial records detected.',
              )}
            </ReviewSection>
          </>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-4 border-t border-[#eef0f3] pt-4">
        <p className="text-[13px] text-[#6a7282]">
          {selectedCount} item{selectedCount === 1 ? '' : 's'} selected for import
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" disabled={saving} onClick={onBackToUploads} className={btnGhost}>
            Back
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onImportAll}
            className={btnPrimary}
          >
            Continue
          </button>
        </div>
      </div>
    </section>
  )
}
