import { useEffect, useId, useMemo, useState } from 'react'
import { ALL_UNIT_OPTIONS } from '@/lib/propertyUnitOptions'

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'past_resident', label: 'Past Resident' },
  { value: 'suspended', label: 'Suspended' },
] as const

export type AddResidentSubmitPayload = {
  fullName: string
  email: string
  phone: string
  unit: string
  status: (typeof STATUS_OPTIONS)[number]['value']
}

function IconUserPlusHeader({ className = 'size-5 text-[#155dfc]' }: { className?: string }) {
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

function IconChevronDown({ className = 'size-4 text-[#0a0a0a]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  )
}

const inputClass =
  'h-9 w-full rounded-lg border border-transparent bg-[#f3f3f5] px-3 text-[14px] tracking-[-0.1504px] text-[#0a0a0a] outline-none placeholder:text-[#717182] focus:border-[#e5e7eb] focus:ring-1 focus:ring-[#e5e7eb]'

const selectClass =
  'h-9 w-full cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2'

/** Add New Resident form (Figma 129:16139). */
export function AddResidentModal({
  open,
  extraUnitOptions = [],
  onClose,
  onSubmit,
}: {
  open: boolean
  /** Units from admin-registered properties; merged with default inventory. */
  extraUnitOptions?: { value: string; label: string }[]
  onClose: () => void
  onSubmit: (payload: AddResidentSubmitPayload) => void
}) {
  const titleId = useId()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [unit, setUnit] = useState('')
  const [moveInDate, setMoveInDate] = useState('')
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]['value']>('active')

  const formValid = useMemo(() => {
    return fullName.trim().length > 0 && email.trim().length > 0
  }, [fullName, email])

  const unitOptions = useMemo(() => {
    const seen = new Set<string>()
    const merged: { value: string; label: string }[] = []
    for (const o of ALL_UNIT_OPTIONS) {
      merged.push({ value: o.value, label: o.label })
      seen.add(o.value)
    }
    for (const o of extraUnitOptions) {
      if (seen.has(o.value)) continue
      seen.add(o.value)
      merged.push(o)
    }
    return [{ value: '', label: 'Select a unit' }, ...merged]
  }, [extraUnitOptions])

  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (!open) {
      setFullName('')
      setEmail('')
      setPhone('')
      setUnit('')
      setMoveInDate('')
      setStatus('active')
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

  if (!open) return null

  function submit() {
    if (!formValid) return
    onSubmit({
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      unit,
      status,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,560px)] flex-col overflow-hidden border-l border-[#e5e7eb] bg-white shadow-[inset_1px_0_0_0_#e5e7eb]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-[#e5e7eb] px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#dbeafe]">
              <IconUserPlusHeader />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#101828]"
              >
                Add New Resident
              </h2>
              <p className="text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                Create a new resident account
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
          <div className="flex flex-col gap-4 pb-6">
            <div className="space-y-2">
              <label htmlFor="add-resident-name" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Full Name <span className="text-[#c10007]">*</span>
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
              <label htmlFor="add-resident-email" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Email Address <span className="text-[#c10007]">*</span>
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
              <label htmlFor="add-resident-phone" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Phone Number
              </label>
              <input
                id="add-resident-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g., (555) 123-4567"
                className={inputClass}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="add-resident-unit" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Unit Assignment
              </label>
              <div className="relative">
                <select
                  id="add-resident-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className={`${selectClass} ${!unit ? 'text-[#717182]' : 'text-[#0a0a0a]'}`}
                >
                  {unitOptions.map((o) => (
                    <option key={o.value || 'placeholder'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                  <IconChevronDown />
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="add-resident-move-in" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Move-In Date
              </label>
              <input
                id="add-resident-move-in"
                type="date"
                value={moveInDate}
                onChange={(e) => setMoveInDate(e.target.value)}
                className={`${inputClass} min-h-9`}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="add-resident-status" className="block text-[14px] font-medium tracking-[-0.1504px] text-[#364153]">
                Account Status
              </label>
              <div className="relative">
                <select
                  id="add-resident-status"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as (typeof STATUS_OPTIONS)[number]['value'])
                  }
                  className={`${selectClass} text-[#0a0a0a]`}
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
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 py-[17px]">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[42px] min-w-[85px] items-center justify-center rounded-[10px] border border-[#d1d5dc] bg-white px-4 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#364153] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!formValid}
            onClick={submit}
            className={[
              'inline-flex h-[42px] min-w-[131px] items-center justify-center rounded-[10px] px-4 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2',
              formValid
                ? 'bg-[#101828] hover:bg-[#475467]'
                : 'cursor-not-allowed bg-[#d1d5dc]',
            ].join(' ')}
          >
            Add Resident
          </button>
        </footer>
      </div>
    </div>
  )
}
