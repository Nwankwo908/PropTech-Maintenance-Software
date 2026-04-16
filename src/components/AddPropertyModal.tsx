import { useEffect, useId, useMemo, useState } from 'react'

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
  'h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#e5e7eb] focus:ring-1 focus:ring-[#e5e7eb]'

const selectTriggerClass =
  'flex h-9 w-full cursor-pointer appearance-none items-center justify-between rounded-lg border border-transparent bg-[#f3f3f5] pl-[13px] pr-10 py-px text-left text-[14px] font-medium tracking-[-0.1504px] outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2'

function IconBuildingHeader({ className = 'size-5 text-[#9810fa]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 21V8l8-5 8 5v13M9 21v-6h6v6"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconChevronDown({ className = 'size-4 text-[#0a0a0a]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

function IconAddCheck({ className = 'size-4 shrink-0 text-white' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.5} />
      <path d="M8 12l2.5 2.5L16 9" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
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
}

type AddPropertyModalProps = {
  open: boolean
  onClose: () => void
  onSubmit: (payload: AddPropertyFormPayload) => void
}

const sectionTitleClass =
  'text-[14px] font-semibold leading-5 tracking-[-0.1504px] text-[#101828]'
const labelClass =
  'text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]'

/** Add New Property rail — Figma 197:1233 (Property Tech Prototypes). */
export function AddPropertyModal({ open, onClose, onSubmit }: AddPropertyModalProps) {
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

  const formValid = useMemo(() => {
    return (
      propertyName.trim().length > 0 &&
      propertyType.trim().length > 0 &&
      streetAddress.trim().length > 0 &&
      city.trim().length > 0 &&
      state.trim().length > 0 &&
      zipCode.trim().length > 0 &&
      totalUnits.trim().length > 0 &&
      Number(totalUnits) > 0
    )
  }, [propertyName, propertyType, streetAddress, city, state, zipCode, totalUnits])

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setPropertyName('')
      setPropertyType('')
      setStreetAddress('')
      setCity('')
      setState('')
      setZipCode('')
      setTotalUnits('')
      setYearBuilt('')
      setAmenities({})
    }
  }

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

  function submit() {
    if (!formValid) return
    const selected = AMENITY_KEYS.filter((a) => amenities[a.id]).map((a) => a.id)
    onSubmit({
      propertyName: propertyName.trim(),
      propertyType: propertyType.trim(),
      streetAddress: streetAddress.trim(),
      city: city.trim(),
      state: state.trim(),
      zipCode: zipCode.trim(),
      totalUnits: totalUnits.trim(),
      yearBuilt: yearBuilt.trim() || null,
      amenities: selected,
    })
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,753px)] flex-col overflow-hidden rounded-l-[10px] border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-[#e5e7eb] px-6 pt-4 pb-[17px]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#f3e8ff]">
              <IconBuildingHeader />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#101828]"
              >
                Add New Property
              </h2>
              <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                Register a new property to the system
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none hover:bg-black/5 hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
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
                    Property Name <span className="text-[#c10007]">*</span>
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
                    Property Type <span className="text-[#c10007]">*</span>
                  </label>
                  <div className="relative">
                    <select
                      id="add-prop-type"
                      value={propertyType}
                      onChange={(e) => setPropertyType(e.target.value)}
                      className={`${selectTriggerClass} ${!propertyType ? 'text-[#717182]' : 'text-[#0a0a0a]'}`}
                    >
                      {PROPERTY_TYPE_OPTIONS.map((o) => (
                        <option key={o.value || 'placeholder'} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2">
                      <IconChevronDown className="size-4 text-[#0a0a0a]" />
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
                    Street Address <span className="text-[#c10007]">*</span>
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
                      City <span className="text-[#c10007]">*</span>
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
                      State <span className="text-[#c10007]">*</span>
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
                      ZIP Code <span className="text-[#c10007]">*</span>
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
                    Total Units <span className="text-[#c10007]">*</span>
                  </label>
                  <input
                    id="add-prop-units"
                    type="number"
                    min={1}
                    value={totalUnits}
                    onChange={(e) => setTotalUnits(e.target.value)}
                    placeholder="e.g., 50"
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
                      className="size-4 shrink-0 rounded border border-black/10 bg-[#f3f3f5] text-[#9810fa] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] focus:ring-2 focus:ring-[#944c73] focus:ring-offset-1"
                    />
                    <span className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
                      {a.label}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-stretch gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-[17px] sm:flex-nowrap">
          <button
            type="button"
            disabled={!formValid}
            onClick={submit}
            className={[
              'inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
              formValid ? 'bg-[#9810fa] hover:bg-[#8710e0]' : 'cursor-not-allowed bg-[#d1d5dc]',
            ].join(' ')}
          >
            <IconAddCheck />
            Add Property
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  )
}
