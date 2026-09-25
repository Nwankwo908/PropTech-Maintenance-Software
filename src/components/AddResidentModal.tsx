import { useEffect, useId, useMemo, useState } from 'react'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import { optionalPhoneForDbOrError } from '@/lib/phoneFormat'
import { customUnitPickKey } from '@/lib/residentUnitKeys'

const STATUS_OPTIONS = [
  { value: 'active', label: 'Occupied' },
  { value: 'pending', label: 'Pending move-in' },
  { value: 'past_resident', label: 'Past resident' },
  { value: 'suspended', label: 'Suspended' },
] as const

export type AddResidentPropertyOption = {
  /** Canonical `properties.id`. */
  value: string
  /** Display label in the select. */
  label: string
  /** Property name used as `users.building`. */
  name: string
}

export type AddResidentUnitOption = {
  /** `__pick:` unit+building key. */
  value: string
  /** Unit label shown in Assign unit. */
  label: string
  unitLabel: string
  building: string
  propertyId: string | null
}

export type AddResidentSubmitPayload = {
  fullName: string
  email: string
  phone: string
  /** `__pick:` unit+building key when a unit is set; otherwise empty. */
  unit: string
  status: (typeof STATUS_OPTIONS)[number]['value']
  /** YYYY-MM-DD; empty when unset */
  leaseStart: string
  /** YYYY-MM-DD; empty when unset */
  leaseEnd: string
  propertyId?: string
  propertyName?: string
  /** Free-text unit number from “Add unit”. */
  customUnitLabel?: string
  /** True when the unit was typed via Add unit and should be created on the property. */
  isNewUnit?: boolean
  /** After save, open the Add Property rail and link it to this resident. */
  openAddPropertyAfter?: boolean
}

const ADD_UNIT_OPTION_VALUE = '__add_unit__'

function IconUserPlusHeader({ className = 'size-5 text-extended-1' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth={1.8} />
      <path
        d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M19 8v6M22 11h-6"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconChevronDown({ className = 'size-4 text-extended-3' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

const inputClass =
  'sa-surface h-9 w-full rounded-lg border border-transparent bg-secondary px-3 text-[14px] tracking-[-0.1504px] text-extended-3 outline-none placeholder:text-neutral focus:border-secondary focus:ring-1 focus:ring-secondary'

const selectClass =
  'sa-surface h-9 w-full cursor-pointer appearance-none rounded-lg border border-transparent bg-secondary py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'

/** Add New Resident form (Figma 129:16139). */
export function AddResidentModal({
  open,
  propertyOptions = [],
  unitOptions = [],
  onClose,
  onSubmit,
}: {
  open: boolean
  /** Landlord properties for Assign properties. */
  propertyOptions?: AddResidentPropertyOption[]
  /** Portfolio units — filtered by selected property for Assign unit. */
  unitOptions?: AddResidentUnitOption[]
  onClose: () => void
  onSubmit: (payload: AddResidentSubmitPayload) => void
}) {
  const titleId = useId()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [unitValue, setUnitValue] = useState('')
  const [customUnitLabel, setCustomUnitLabel] = useState('')
  const [openAddPropertyAfter, setOpenAddPropertyAfter] = useState(false)
  const [leaseStart, setLeaseStart] = useState('')
  const [leaseEnd, setLeaseEnd] = useState('')
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]['value']>('active')
  const [phoneError, setPhoneError] = useState<string | null>(null)

  const formValid = useMemo(() => {
    return fullName.trim().length > 0 && email.trim().length > 0
  }, [fullName, email])

  const propertySelectOptions = useMemo(
    () => [{ value: '', label: 'Select a property', name: '' }, ...propertyOptions],
    [propertyOptions],
  )

  const selectedProperty = useMemo(
    () => propertyOptions.find((option) => option.value === propertyId) ?? null,
    [propertyOptions, propertyId],
  )

  const unitsForProperty = useMemo(() => {
    if (!selectedProperty) return []
    const propertyNameKey = selectedProperty.name.trim().toLowerCase()
    return unitOptions
      .filter((option) => {
        if (option.propertyId && option.propertyId === selectedProperty.value) return true
        return option.building.trim().toLowerCase() === propertyNameKey
      })
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }))
  }, [selectedProperty, unitOptions])

  const addingCustomUnit = unitValue === ADD_UNIT_OPTION_VALUE

  const [prevOpen, setPrevOpen] = useState(open)
  useEffect(() => {
    if (open === prevOpen) return
    setPrevOpen(open)
    if (open) return
    setFullName('')
    setEmail('')
    setPhone('')
    setPropertyId('')
    setUnitValue('')
    setCustomUnitLabel('')
    setOpenAddPropertyAfter(false)
    setLeaseStart('')
    setLeaseEnd('')
    setStatus('active')
    setPhoneError(null)
  }, [open, prevOpen])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function submit() {
    if (!open || !formValid) return
    const phoneResult = optionalPhoneForDbOrError(phone)
    if (phoneResult.error) {
      setPhoneError(phoneResult.error)
      return
    }
    setPhoneError(null)
    const propertyName = selectedProperty?.name.trim() || ''
    const isNewUnit = addingCustomUnit
    const customLabel = isNewUnit ? customUnitLabel.trim() : ''
    const selectedExisting = !isNewUnit
      ? unitsForProperty.find((option) => option.value === unitValue) ?? null
      : null
    const unitKey = isNewUnit
      ? customLabel && propertyName
        ? customUnitPickKey(customLabel, propertyName)
        : customLabel
          ? customUnitPickKey(customLabel, '')
          : ''
      : selectedExisting?.value ?? ''
    onSubmit({
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phoneResult.phone ?? '',
      unit: unitKey,
      status,
      leaseStart: leaseStart.trim(),
      leaseEnd: leaseEnd.trim(),
      propertyId: selectedProperty?.value || undefined,
      propertyName: propertyName || undefined,
      customUnitLabel: customLabel || selectedExisting?.unitLabel || undefined,
      isNewUnit: Boolean(isNewUnit && customLabel),
      openAddPropertyAfter,
    })
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="sa-scrim absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sa-rail relative z-10 flex h-full max-h-dvh w-full max-w-[min(100vw,560px)] flex-col overflow-hidden border-l border-secondary bg-white shadow-[inset_1px_0_0_0_#A788964D]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-secondary px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-extended-2">
              <IconUserPlusHeader />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3"
              >
                Add New Resident
              </h2>
              <p className="text-[14px] leading-5 tracking-[-0.1504px] text-neutral">
                Create a new resident account
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="sa-press shrink-0 rounded-lg p-1 text-neutral outline-none hover:bg-black/5 hover:text-extended-3 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6">
          <div className="flex flex-col gap-4 pb-6">
            <div className="space-y-2">
              <label htmlFor="add-resident-name" className="block text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant">
                Full Name <span className="text-error">*</span>
              </label>
              <input
                id="add-resident-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g., John Doe"
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="add-resident-email" className="block text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant">
                Email Address <span className="text-error">*</span>
              </label>
              <input
                id="add-resident-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g., john.doe@email.com"
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="add-resident-phone" className="block text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant">
                Phone Number
              </label>
              <input
                id="add-resident-phone"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  if (phoneError) setPhoneError(null)
                }}
                placeholder="e.g., (555) 123-4567"
                className={inputClass}
              />
              {phoneError ? (
                <p className="text-[12px] font-medium leading-4 text-error" role="alert">
                  {phoneError}
                </p>
              ) : (
                <p className="text-[12px] font-normal leading-4 text-neutral">
                  US numbers only — any common format is fine.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label htmlFor="add-resident-property" className="block text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant">
                Assign properties
              </label>
              <div className="relative">
                <select
                  id="add-resident-property"
                  value={openAddPropertyAfter ? '' : propertyId}
                  disabled={openAddPropertyAfter}
                  onChange={(e) => {
                    setPropertyId(e.target.value)
                    setUnitValue('')
                    setCustomUnitLabel('')
                  }}
                  className={`${selectClass} ${openAddPropertyAfter || !propertyId ? 'text-neutral' : 'text-extended-3'} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {propertySelectOptions.map((o) => (
                    <option key={o.value || 'placeholder'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                  <IconChevronDown />
                </span>
              </div>
              {propertyOptions.length === 0 && !openAddPropertyAfter ? (
                <p className="text-[12px] leading-4 text-neutral">
                  No properties yet. Check Add property below to create one for this resident.
                </p>
              ) : null}
            </div>
            {selectedProperty && !openAddPropertyAfter ? (
              <div className="space-y-2">
                <label
                  htmlFor="add-resident-unit"
                  className="block text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant"
                >
                  Assign unit
                </label>
                <div className="relative">
                  <select
                    id="add-resident-unit"
                    value={unitValue}
                    onChange={(e) => {
                      const next = e.target.value
                      setUnitValue(next)
                      if (next !== ADD_UNIT_OPTION_VALUE) setCustomUnitLabel('')
                    }}
                    className={`${selectClass} ${!unitValue ? 'text-neutral' : 'text-extended-3'}`}
                  >
                    <option value="">Select a unit</option>
                    {unitsForProperty.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    <option value={ADD_UNIT_OPTION_VALUE}>Add unit</option>
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                    <IconChevronDown />
                  </span>
                </div>
                {unitsForProperty.length === 0 && !addingCustomUnit ? (
                  <p className="text-[12px] leading-4 text-neutral">
                    No units on this property yet. Choose Add unit to create one.
                  </p>
                ) : null}
                {addingCustomUnit ? (
                  <div className="flex flex-col gap-2 pt-1">
                    <label
                      htmlFor="add-resident-custom-unit"
                      className="block text-[13px] font-medium tracking-[-0.1504px] text-neutral-variant"
                    >
                      Unit number
                    </label>
                    <input
                      id="add-resident-custom-unit"
                      type="text"
                      value={customUnitLabel}
                      onChange={(e) => setCustomUnitLabel(e.target.value)}
                      placeholder="e.g., 4B"
                      className={inputClass}
                      autoFocus
                    />
                    <p className="text-[12px] leading-4 text-neutral">
                      This unit will be saved to {selectedProperty.name}.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="add-resident-lease-start"
                  className="block text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant"
                >
                  Lease start date
                </label>
                <input
                  id="add-resident-lease-start"
                  type="date"
                  value={leaseStart}
                  onChange={(e) => setLeaseStart(e.target.value)}
                  className={`${inputClass} min-h-9`}
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="add-resident-lease-end"
                  className="block text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant"
                >
                  Lease end date
                </label>
                <input
                  id="add-resident-lease-end"
                  type="date"
                  value={leaseEnd}
                  onChange={(e) => setLeaseEnd(e.target.value)}
                  className={`${inputClass} min-h-9`}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="add-resident-status" className="block text-[14px] font-medium tracking-[-0.1504px] text-neutral-variant">
                Occupancy status
              </label>
              <div className="relative">
                <select
                  id="add-resident-status"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as (typeof STATUS_OPTIONS)[number]['value'])
                  }
                  className={`${selectClass} text-extended-3`}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                  <IconChevronDown />
                </span>
              </div>
            </div>
            <label
              htmlFor="add-resident-add-property"
              className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-secondary bg-secondary/60 px-3 py-3"
            >
              <input
                id="add-resident-add-property"
                type="checkbox"
                checked={openAddPropertyAfter}
                onChange={(e) => {
                  const checked = e.target.checked
                  setOpenAddPropertyAfter(checked)
                  if (checked) {
                    setPropertyId('')
                    setUnitValue('')
                    setCustomUnitLabel('')
                  }
                }}
                className={`mt-0.5 ${checkboxInputClassName}`}
              />
              <span className="min-w-0">
                <span className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-extended-3">
                  Add property
                </span>
                <span className="mt-0.5 block text-[12px] leading-4 text-neutral">
                  After this resident is saved, open the add property form and connect it to them.
                </span>
              </span>
            </label>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-stretch gap-3 border-t border-secondary bg-secondary px-6 py-[17px] sm:flex-nowrap">
          <button
            type="button"
            disabled={!formValid}
            onClick={submit}
            className="sa-press inline-flex h-[42px] min-w-0 flex-1 items-center justify-center rounded-[10px] bg-[#187960] px-4 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none focus-visible:ring-2 focus-visible:ring-[#b58500] focus-visible:ring-offset-2 focus-visible:ring-offset-secondary enabled:hover:bg-[#9a7310] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Resident
          </button>
        </footer>
      </div>
    </div>
  )
}
