import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import type { PropertyUnitField } from '@/lib/propertyUnitFields'

const AMENITY_KEYS = [
  { id: 'parking', label: 'Parking' },
  { id: 'swimming_pool', label: 'Swimming Pool' },
  { id: 'fitness_center', label: 'Fitness Center' },
  { id: 'laundry', label: 'Laundry' },
  { id: 'elevator', label: 'Elevator' },
  { id: 'security_24_7', label: '24/7 Security' },
  { id: 'pet_friendly', label: 'Pet Friendly' },
  { id: 'playground', label: 'Playground' },
  { id: 'storage', label: 'Storage' },
] as const

const PROPERTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Select property type' },
  { value: 'multifamily', label: 'Multifamily' },
  { value: 'single_family', label: 'Single Family' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'student_housing', label: 'Student Housing' },
]

const inputClass =
  'h-9 w-full rounded-lg border border-transparent bg-secondary px-3 text-[14px] tracking-[-0.1504px] text-extended-3 outline-none placeholder:text-neutral focus:border-secondary focus:ring-1 focus:ring-secondary'

const selectTriggerClass =
  'flex h-9 w-full cursor-pointer appearance-none items-center justify-between rounded-lg border border-transparent bg-secondary pl-[13px] pr-10 py-px text-left text-[14px] font-medium tracking-[-0.1504px] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'

function IconBuildingHeader({ className = 'size-5 text-primary' }: { className?: string }) {
  return (
    <svg viewBox="0 0 19 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8.95111 11.8433L8.02222 11.8222C7.72667 11.8222 7.47333 11.6322 7.36778 11.3578C7.26222 11.0833 7.34667 10.7667 7.55778 10.5767L9.73222 8.61333V0.633333C9.73222 0.295556 9.45778 0 9.09889 0H0.633333C0.295556 0 0 0.274445 0 0.633333V14.7144C0 15.0522 0.274444 15.3478 0.633333 15.3478H3.54667V12.4767C3.54667 12.35 3.65222 12.2233 3.8 12.2233H5.99556C6.12222 12.2233 6.24889 12.3289 6.24889 12.4767V15.3267H9.07778C9.01444 15.1789 8.99333 15.0311 8.99333 14.8833V11.8433H8.95111ZM1.71 3.35667C1.71 3.25111 1.79444 3.16667 1.9 3.16667H3.86333C3.96889 3.16667 4.05333 3.25111 4.05333 3.35667V5.32C4.05333 5.42556 3.96889 5.51 3.86333 5.51H1.9C1.79444 5.51 1.71 5.42556 1.71 5.32V3.35667ZM4.09556 9.56333C4.09556 9.66889 4.01111 9.75333 3.90556 9.75333H1.94222C1.83667 9.75333 1.75222 9.66889 1.75222 9.56333V7.6C1.75222 7.49444 1.83667 7.41 1.94222 7.41H3.90556C4.01111 7.41 4.09556 7.49444 4.09556 7.6V9.56333ZM5.63667 3.33556C5.63667 3.23 5.72111 3.14556 5.82667 3.14556H7.81111C7.91667 3.14556 8.00111 3.23 8.00111 3.33556V5.29889C8.00111 5.40444 7.91667 5.48889 7.81111 5.48889H5.84778C5.74222 5.48889 5.65778 5.40444 5.65778 5.29889V3.33556H5.63667ZM5.86889 9.75333C5.76333 9.75333 5.67889 9.66889 5.67889 9.56333V7.6C5.67889 7.49444 5.76333 7.41 5.86889 7.41H7.83222C7.93778 7.41 8.02222 7.49444 8.02222 7.6V9.56333C8.02222 9.66889 7.93778 9.75333 7.83222 9.75333H5.86889Z" />
      <path d="M17.4167 9.68999V6.83999H15.8544V8.25443L13.7856 6.35443C13.7222 6.2911 13.6378 6.26999 13.5533 6.26999C13.4689 6.26999 13.3844 6.2911 13.3211 6.35443L8.04333 11.1044L9.66889 11.1467V14.8833C9.66889 15.1155 9.85889 15.3055 10.0911 15.3055H12.4133V13.1733C12.4133 12.92 12.6244 12.7089 12.8778 12.7089H14.2711C14.5244 12.7089 14.7356 12.92 14.7356 13.1733V15.3055H17.0367C17.2689 15.3055 17.4589 15.1155 17.4589 14.8833V11.2311L19 11.1255L17.4167 9.68999ZM14.5456 10.2389C14.5456 10.4289 14.3978 10.5767 14.2078 10.5767H12.9411C12.7511 10.5767 12.6033 10.4289 12.6033 10.2389V9.9011C12.6033 9.7111 12.7511 9.56332 12.9411 9.56332H14.2078C14.3978 9.56332 14.5456 9.7111 14.5456 9.9011V10.2389Z" />
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

export type AddPropertyFormPayload = {
  propertyName: string
  propertyType: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
  totalUnits: string
  yearBuilt: string | null
  amenities: string[]
  units?: PropertyUnitField[]
}

type UnitFieldState = {
  key: string
  id: string | null
  label: string
}

type AddPropertyModalProps = {
  open: boolean
  onClose: () => void
  onSubmit: (payload: AddPropertyFormPayload) => void
  mode?: 'add' | 'edit'
  initialValues?: AddPropertyFormPayload | null
  error?: string | null
}

const sectionTitleClass =
  'text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-extended-3'
const labelClass =
  'text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant'

/** Add New Property rail — Figma 197:1233 (Property Tech Prototypes). */
function hydrateFromInitial(values: AddPropertyFormPayload | null | undefined) {
  return {
    propertyName: values?.propertyName ?? '',
    propertyType: values?.propertyType ?? '',
    streetAddress: values?.streetAddress ?? '',
    city: values?.city ?? '',
    state: values?.state ?? '',
    zipCode: values?.zipCode ?? '',
    totalUnits: values?.totalUnits ?? '',
    yearBuilt: values?.yearBuilt?.trim() || '',
    amenities: Object.fromEntries((values?.amenities ?? []).map((id) => [id, true])) as Record<
      string,
      boolean
    >,
    units: (values?.units ?? []).map((unit, index) => ({
      key: unit.id ?? `unit-${index}`,
      id: unit.id,
      label: unit.label,
    })),
  }
}

export function AddPropertyModal({
  open,
  onClose,
  onSubmit,
  mode = 'add',
  initialValues = null,
  error = null,
}: AddPropertyModalProps) {
  const titleId = useId()
  const [propertyName, setPropertyName] = useState('')
  const [propertyType, setPropertyType] = useState('')
  const [streetAddress, setStreetAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [totalUnits, setTotalUnits] = useState('')
  const [yearBuilt, setYearBuilt] = useState('')
  const [amenities, setAmenities] = useState<Record<string, boolean>>({})

  const [unitFields, setUnitFields] = useState<UnitFieldState[]>([])

  const unitFieldError = useMemo(() => {
    if (mode !== 'edit' || unitFields.length === 0) return null
    const labels = unitFields.map((unit) => unit.label.trim().toLowerCase()).filter(Boolean)
    if (new Set(labels).size !== labels.length) return 'Each unit needs its own name.'
    return null
  }, [mode, unitFields])

  const formValid = useMemo(() => {
    const unitLabels = unitFields.map((unit) => unit.label.trim())
    const unitsReady =
      mode !== 'edit' ||
      unitFields.length === 0 ||
      (unitLabels.every((label) => label.length > 0) && !unitFieldError)
    const unitCount = mode === 'edit' && unitFields.length > 0 ? unitFields.length : Number(totalUnits)
    return (
      propertyName.trim().length > 0 &&
      propertyType.trim().length > 0 &&
      streetAddress.trim().length > 0 &&
      city.trim().length > 0 &&
      state.trim().length > 0 &&
      zipCode.trim().length > 0 &&
      unitCount > 0 &&
      unitsReady
    )
  }, [propertyName, propertyType, streetAddress, city, state, zipCode, totalUnits, mode, unitFields, unitFieldError])

  const wasOpen = useRef(false)
  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      setPropertyName('')
      setPropertyType('')
      setStreetAddress('')
      setCity('')
      setState('')
      setZipCode('')
      setTotalUnits('')
      setYearBuilt('')
      setAmenities({})
      setUnitFields([])
      return
    }
    if (wasOpen.current) return
    wasOpen.current = true
    const next = hydrateFromInitial(initialValues)
    setPropertyName(next.propertyName)
    setPropertyType(next.propertyType)
    setStreetAddress(next.streetAddress)
    setCity(next.city)
    setState(next.state)
    setZipCode(next.zipCode)
    setTotalUnits(next.units.length > 0 ? String(next.units.length) : next.totalUnits)
    setYearBuilt(next.yearBuilt)
    setAmenities(next.amenities)
    setUnitFields(next.units)
  }, [open, initialValues])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function toggleAmenity(id: string) {
    setAmenities((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function commitUnitFields(next: UnitFieldState[]) {
    setUnitFields(next)
    if (next.length > 0) setTotalUnits(String(next.length))
  }

  function submit() {
    if (!formValid) return
    const selected = AMENITY_KEYS.filter((a) => amenities[a.id]).map((a) => a.id)
    const units =
      mode === 'edit'
        ? unitFields.map((unit) => ({ id: unit.id, label: unit.label.trim() }))
        : undefined
    onSubmit({
      propertyName: propertyName.trim(),
      propertyType: propertyType.trim(),
      streetAddress: streetAddress.trim(),
      city: city.trim(),
      state: state.trim(),
      zipCode: zipCode.trim(),
      totalUnits: units && units.length > 0 ? String(units.length) : totalUnits.trim(),
      yearBuilt: yearBuilt.trim() || null,
      amenities: selected,
      units,
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 flex h-full max-h-dvh w-full max-w-[min(100vw,753px)] flex-col overflow-hidden rounded-l-[10px] border-l border-secondary bg-white shadow-[inset_1px_0_0_0_#A788964D]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-secondary px-6 pt-4 pb-[17px]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#E0F2EF] text-[#101828]">
              <IconBuildingHeader className="size-5" />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3"
              >
                {mode === 'edit' ? 'Edit Property' : 'Add New Property'}
              </h2>
              <p className="text-[14px] leading-5 tracking-[-0.1504px] text-neutral">
                {mode === 'edit'
                  ? 'Update this property’s details'
                  : 'Register a new property to the system'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-neutral outline-none hover:bg-black/5 hover:text-extended-3 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6">
          <div className="flex flex-col gap-6 pb-6">
            <section className="flex flex-col gap-3">
              <h3 className={sectionTitleClass}>Basic Information</h3>
              <div className="flex flex-col gap-4">
                <div className="space-y-2">
                  <label htmlFor="add-prop-name" className={`block ${labelClass}`}>
                    Property Name <span className="text-error">*</span>
                  </label>
                  <input
                    id="add-prop-name"
                    type="text"
                    value={propertyName}
                    onChange={(e) => setPropertyName(e.target.value)}
                    placeholder="e.g., Sunset Apartments"
                    className={inputClass}
                    autoComplete="organization"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="add-prop-type" className={`block ${labelClass}`}>
                    Property Type <span className="text-error">*</span>
                  </label>
                  <div className="relative">
                    <select
                      id="add-prop-type"
                      value={propertyType}
                      onChange={(e) => setPropertyType(e.target.value)}
                      className={`${selectTriggerClass} ${!propertyType ? 'text-neutral' : 'text-extended-3'}`}
                    >
                      {PROPERTY_TYPE_OPTIONS.map((o) => (
                        <option key={o.value || 'placeholder'} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2">
                      <IconChevronDown className="size-4 text-extended-3" />
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h3 className={sectionTitleClass}>Address</h3>
              <div className="flex flex-col gap-4">
                <div className="space-y-2">
                  <label htmlFor="add-prop-street" className={`block ${labelClass}`}>
                    Street Address <span className="text-error">*</span>
                  </label>
                  <input
                    id="add-prop-street"
                    type="text"
                    value={streetAddress}
                    onChange={(e) => setStreetAddress(e.target.value)}
                    placeholder="e.g., 123 Main Street"
                    className={inputClass}
                    autoComplete="street-address"
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <label htmlFor="add-prop-city" className={`block ${labelClass}`}>
                      City <span className="text-error">*</span>
                    </label>
                    <input
                      id="add-prop-city"
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="e.g., San Francisco"
                      className={inputClass}
                      autoComplete="address-level2"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="add-prop-state" className={`block ${labelClass}`}>
                      State <span className="text-error">*</span>
                    </label>
                    <input
                      id="add-prop-state"
                      type="text"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="e.g., CA"
                      className={inputClass}
                      autoComplete="address-level1"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="add-prop-zip" className={`block ${labelClass}`}>
                      ZIP Code <span className="text-error">*</span>
                    </label>
                    <input
                      id="add-prop-zip"
                      type="text"
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value)}
                      placeholder="e.g., 94102"
                      className={inputClass}
                      autoComplete="postal-code"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <h3 className={sectionTitleClass}>Property Details</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="add-prop-units" className={`block ${labelClass}`}>
                    Total Units <span className="text-error">*</span>
                  </label>
                  <input
                    id="add-prop-units"
                    type="number"
                    min={1}
                    value={totalUnits}
                    onChange={(e) => setTotalUnits(e.target.value)}
                    placeholder="e.g., 50"
                    readOnly={mode === 'edit' && unitFields.length > 0}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="add-prop-year" className={`block ${labelClass}`}>
                    Year Built
                  </label>
                  <input
                    id="add-prop-year"
                    type="text"
                    inputMode="numeric"
                    value={yearBuilt}
                    onChange={(e) => setYearBuilt(e.target.value)}
                    placeholder="e.g., 2015"
                    className={inputClass}
                  />
                </div>
              </div>
            </section>

            {mode === 'edit' ? (
              <section className="flex flex-col gap-3">
                <h3 className={sectionTitleClass}>Units</h3>
                <div className="flex flex-col gap-3">
                  {unitFields.map((unit, index) => (
                    <div key={unit.key} className="flex items-end gap-2">
                      <div className="min-w-0 flex-1 space-y-2">
                        <label htmlFor={`edit-prop-unit-${unit.key}`} className={`block ${labelClass}`}>
                          Unit {index + 1}
                        </label>
                        <input
                          id={`edit-prop-unit-${unit.key}`}
                          type="text"
                          value={unit.label}
                          onChange={(e) =>
                            commitUnitFields(
                              unitFields.map((row) =>
                                row.key === unit.key ? { ...row, label: e.target.value } : row,
                              ),
                            )
                          }
                          placeholder="e.g., A"
                          className={inputClass}
                        />
                      </div>
                      {unit.id == null ? (
                        <button
                          type="button"
                          onClick={() => commitUnitFields(unitFields.filter((row) => row.key !== unit.key))}
                          className="h-9 shrink-0 rounded-lg px-2 text-[14px] font-medium text-neutral outline-none hover:text-extended-3 focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {unitFieldError ? (
                    <p className="text-[13px] text-[#b91c1c]" role="alert">
                      {unitFieldError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      commitUnitFields([
                        ...unitFields,
                        { key: `new-${unitFields.length}-${Date.now()}`, id: null, label: '' },
                      ])
                    }
                    className="self-start text-[14px] font-medium text-[#186179] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#186179]"
                  >
                    Add unit
                  </button>
                </div>
              </section>
            ) : null}

            <section className="flex flex-col gap-3">
              <h3 className={sectionTitleClass}>Amenities</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {AMENITY_KEYS.map((a) => (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center gap-2 rounded-lg py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(amenities[a.id])}
                      onChange={() => toggleAmenity(a.id)}
                      className={checkboxInputClassName}
                    />
                    <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant">
                      {a.label}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-secondary bg-secondary px-6 py-[17px]">
          {error ? (
            <p className="text-[13px] text-[#b91c1c]" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!formValid}
            onClick={submit}
            className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-transparent px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#186179] outline-none focus-visible:ring-2 focus-visible:ring-[#186179] focus-visible:ring-offset-2 focus-visible:ring-offset-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
         
            {mode === 'edit' ? 'Save' : 'Add Property'}
          </button>
         
        </footer>
      </div>
    </div>
  )
}
