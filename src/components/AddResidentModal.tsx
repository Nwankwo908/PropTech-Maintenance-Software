import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import { ACCEPTED_UPLOAD_MIME, isAcceptedUploadFile } from '@/lib/onboardingDocumentUpload'
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
  /** Lease / move-in files to attach after the resident is created. */
  leaseDocumentFiles?: File[]
}

const ADD_UNIT_OPTION_VALUE = '__add_unit__'

function IconUserPlusHeader({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 15 17" fill="currentColor" className={className} aria-hidden>
      <path d="M8.65617 0H0.898728C0.394179 0 0 0.496511 0 1.0885V15.3345C0 15.9265 0.394179 16.4231 0.898728 16.4231H8.37236C8.86115 16.4231 9.27109 15.9456 9.27109 15.3345V0.72567C9.25533 0.324642 8.98728 0 8.65617 0ZM3.95756 2.04333C3.95756 1.94785 4.02063 1.87146 4.09946 1.87146H5.15586C5.2347 1.87146 5.29777 1.94785 5.29777 2.04333V3.26551C5.29777 3.361 5.21893 3.43738 5.15586 3.43738H4.09946C4.02063 3.43738 3.95756 3.361 3.95756 3.26551V2.04333ZM3.95756 5.28975C3.95756 5.19427 4.02063 5.09878 4.09946 5.09878H5.15586C5.2347 5.09878 5.29777 5.19427 5.29777 5.28975V6.51193C5.29777 6.60741 5.21893 6.6838 5.15586 6.6838H4.09946C4.02063 6.6838 3.95756 6.60741 3.95756 6.51193V5.28975ZM3.95756 8.53617C3.95756 8.44068 4.02063 8.3643 4.09946 8.3643H5.15586C5.2347 8.3643 5.29777 8.44068 5.29777 8.53617V9.73925C5.29777 9.83473 5.21893 9.91112 5.15586 9.91112H4.09946C4.02063 9.91112 3.95756 9.83473 3.95756 9.73925V8.53617ZM1.37174 2.04333C1.37174 1.94785 1.43481 1.87146 1.51365 1.87146H2.57005C2.64888 1.87146 2.71195 1.94785 2.71195 2.04333V3.26551C2.71195 3.361 2.64888 3.43738 2.57005 3.43738H1.51365C1.43481 3.43738 1.37174 3.361 1.37174 3.26551V2.04333ZM1.37174 5.28975C1.37174 5.19427 1.43481 5.09878 1.51365 5.09878H2.57005C2.64888 5.09878 2.71195 5.19427 2.71195 5.28975V6.51193C2.71195 6.60741 2.64888 6.6838 2.57005 6.6838H1.51365C1.43481 6.6838 1.37174 6.60741 1.37174 6.51193V5.28975ZM2.58582 9.93022H1.52942C1.45058 9.93022 1.38751 9.85383 1.38751 9.75835V8.53617C1.38751 8.44068 1.45058 8.3643 1.52942 8.3643H2.58582C2.66465 8.3643 2.72772 8.44068 2.72772 8.53617V9.73925C2.74349 9.85383 2.68042 9.93022 2.58582 9.93022ZM4.44634 14.5707C4.44634 14.6662 4.38327 14.7426 4.30444 14.7426H2.90116C2.82232 14.7426 2.75925 14.6662 2.75925 14.5707V11.7635C2.75925 11.668 2.82232 11.5916 2.90116 11.5916H4.30444C4.38327 11.5916 4.44634 11.668 4.44634 11.7635V14.5707ZM6.51184 14.5707C6.51184 14.6662 6.44877 14.7426 6.36994 14.7426H4.96666C4.88782 14.7426 4.82475 14.6662 4.82475 14.5707V11.7635C4.82475 11.668 4.90359 11.5916 4.96666 11.5916H6.36994C6.44877 11.5916 6.51184 11.668 6.51184 11.7635V14.5707ZM7.88358 9.73925C7.88358 9.83473 7.82051 9.91112 7.74168 9.91112H6.68528C6.60644 9.91112 6.54337 9.83473 6.54337 9.73925V8.51707C6.54337 8.42159 6.60644 8.3452 6.68528 8.3452H7.74168C7.82051 8.3452 7.88358 8.42159 7.88358 8.51707V9.73925ZM7.88358 6.51193C7.88358 6.60741 7.82051 6.6838 7.74168 6.6838H6.68528C6.60644 6.6838 6.54337 6.60741 6.54337 6.51193V5.28975C6.54337 5.19427 6.60644 5.09878 6.68528 5.09878H7.74168C7.82051 5.09878 7.88358 5.19427 7.88358 5.28975V6.51193ZM7.88358 3.26551C7.88358 3.361 7.82051 3.43738 7.74168 3.43738H6.68528C6.60644 3.43738 6.54337 3.361 6.54337 3.26551V2.04333C6.54337 1.94785 6.60644 1.87146 6.68528 1.87146H7.74168C7.82051 1.87146 7.88358 1.94785 7.88358 2.04333V3.26551Z" />
      <path d="M14.8211 10.3885C14.7423 9.4719 14.0958 8.78442 13.3233 8.78442H12.2669C11.4943 8.78442 10.8636 9.4719 10.769 10.4076L10.6271 11.8972C10.6113 12.0881 10.7059 12.2791 10.8636 12.3173C11.0843 12.3746 11.3208 12.4128 11.5573 12.451L11.7308 15.9456C11.7465 16.213 11.9357 16.4421 12.1565 16.4421H13.4652C13.6859 16.4421 13.8751 16.2321 13.8909 15.9456L14.0643 12.451C14.3008 12.4128 14.5216 12.3746 14.7581 12.3173C14.9157 12.2791 15.0261 12.0881 14.9946 11.8972L14.8211 10.3885Z" />
      <path d="M12.8028 8.30701C13.5866 8.30701 14.2219 7.53753 14.2219 6.58832C14.2219 5.63911 13.5866 4.86963 12.8028 4.86963C12.0191 4.86963 11.3838 5.63911 11.3838 6.58832C11.3838 7.53753 12.0191 8.30701 12.8028 8.30701Z" />
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
  const [leaseFiles, setLeaseFiles] = useState<File[]>([])
  const [leaseUploadError, setLeaseUploadError] = useState<string | null>(null)
  const leaseFileInputRef = useRef<HTMLInputElement | null>(null)

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
    setLeaseFiles([])
    setLeaseUploadError(null)
  }, [open, prevOpen])

  function addLeaseFiles(list: FileList | File[] | null) {
    if (!list) return
    const next: File[] = []
    let error: string | null = null
    for (const file of Array.from(list)) {
      const accepted = isAcceptedUploadFile(file)
      if (!accepted.ok) {
        error = accepted.error
        continue
      }
      const duplicate = leaseFiles.some(
        (existing) =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified,
      )
      if (!duplicate) next.push(file)
    }
    if (next.length > 0) setLeaseFiles((prev) => [...prev, ...next])
    setLeaseUploadError(error)
  }

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
      leaseDocumentFiles: leaseFiles.length > 0 ? leaseFiles : undefined,
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
            <div className="space-y-2 border-t border-secondary pt-4">
              <p className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant">
                Lease documents
              </p>
              <p className="text-[12px] font-normal leading-4 text-neutral">
                Upload lease or move-in files. They appear under Documents on this profile and in
                Organization settings after you save.
              </p>
              <button
                type="button"
                onClick={() => leaseFileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  addLeaseFiles(event.dataTransfer.files)
                }}
                className="sa-press flex w-full flex-col items-center justify-center rounded-[10px] border border-dashed border-[#d1d5db] bg-[#fafafa] px-4 py-6 text-center outline-none hover:border-[#9ca3af] hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <span className="text-[14px] font-semibold text-[#101828]">
                  Drop files here or click to browse
                </span>
                <span className="mt-1 text-[12px] text-[#6a7282]">
                  PDF, Word, Excel, images · up to 20MB each
                </span>
              </button>
              <input
                ref={leaseFileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_UPLOAD_MIME}
                className="sr-only"
                onChange={(event) => {
                  addLeaseFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              {leaseUploadError ? (
                <p className="text-[13px] font-medium text-red-800" role="alert">
                  {leaseUploadError}
                </p>
              ) : null}
              {leaseFiles.length > 0 ? (
                <ul className="space-y-2">
                  {leaseFiles.map((file) => (
                    <li
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[#e5e7eb] bg-white px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-[13px] font-medium text-[#0a0a0a]">
                        {file.name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setLeaseFiles((prev) =>
                            prev.filter(
                              (item) =>
                                !(
                                  item.name === file.name &&
                                  item.size === file.size &&
                                  item.lastModified === file.lastModified
                                ),
                            ),
                          )
                        }
                        className="sa-press shrink-0 text-[12px] font-medium text-[#b52a00] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
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
