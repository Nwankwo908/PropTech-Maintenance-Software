import { useEffect, useId, useMemo, useState } from 'react'
import { getErrorMessage } from '@/lib/errorMessage'
import { formatPhoneNational, optionalPhoneForDbOrError } from '@/lib/phoneFormat'
import { shouldOfferRestartTenantOnboarding } from '@/api/tenantActivation'
import { checkboxInputClassName } from '@/components/TableCheckbox'

type ResidentStatus = 'active' | 'pending' | 'past_resident' | 'suspended'

export type EditResidentSavePayload = {
  id: string
  fullName: string
  email: string
  phone: string | undefined
  status: ResidentStatus
  /** Inventory key (e.g. `2b-a`); empty string = unassigned */
  unitOptionKey: string
  /** YYYY-MM-DD; empty when unset */
  leaseStart: string
  /** YYYY-MM-DD; empty when unset */
  leaseEnd: string
  /** Send welcome SMS to the new number after a phone change. */
  restartOnboarding?: boolean
}

export type EditResidentModalRow = {
  /** `users.id` (uuid) from Supabase, or demo row id. */
  id: string
  residentId: string
  name: string
  email: string
  phone?: string
  unit: { kind: 'unassigned' } | { kind: 'assigned'; unit: string; building: string }
  status: ResidentStatus
  /** YYYY-MM-DD */
  leaseStart?: string | null
  /** YYYY-MM-DD */
  leaseEnd?: string | null
}

const STATUS_OPTIONS: { value: ResidentStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'past_resident', label: 'Past Resident' },
  { value: 'suspended', label: 'Suspended' },
]

const inputClass =
  'sa-surface h-9 w-full rounded-lg border border-transparent bg-secondary px-3 text-[14px] tracking-[-0.1504px] text-extended-3 outline-none placeholder:text-neutral focus:border-secondary focus:ring-1 focus:ring-secondary'

const selectClass =
  'sa-surface h-9 w-full cursor-pointer appearance-none rounded-lg border border-transparent bg-secondary py-1 pl-3 pr-9 text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'

function IconPencilHeader({ className = 'size-5 text-extended-1' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
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

function toDateInputValue(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
}

function IconTrash({ className = 'size-4 shrink-0 text-error' }: { className?: string }) {
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

/** Edit resident form (Figma 130:19686). */
export function EditResidentModal({
  row,
  unitOptions,
  initialUnitOptionKey,
  onClose,
  onSave,
}: {
  row: EditResidentModalRow | null
  /** Vacant units plus current assignment (for reassignment). */
  unitOptions: { value: string; label: string }[]
  /** `''` = unassigned */
  initialUnitOptionKey: string
  onClose: () => void
  /** Persist changes (Supabase update or demo state patch in parent). */
  onSave: (payload: EditResidentSavePayload) => Promise<void>
}) {
  const titleId = useId()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<ResidentStatus>('active')
  const [unitKey, setUnitKey] = useState('')
  const [leaseStart, setLeaseStart] = useState('')
  const [leaseEnd, setLeaseEnd] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [restartOnboarding, setRestartOnboarding] = useState(true)

  const formValid = useMemo(() => {
    return fullName.trim().length > 0 && email.trim().length > 0
  }, [fullName, email])

  const offerRestartOnboarding = Boolean(row) && shouldOfferRestartTenantOnboarding(row?.phone, phone)

  useEffect(() => {
    if (!row) return
    setFullName(row.name)
    setEmail(row.email)
    setPhone(row.phone ? formatPhoneNational(row.phone) : '')
    setStatus(row.status)
    setUnitKey(initialUnitOptionKey)
    setLeaseStart(toDateInputValue(row.leaseStart))
    setLeaseEnd(toDateInputValue(row.leaseEnd))
    setSaveError(null)
    setRestartOnboarding(true)
  }, [
    row?.id,
    row?.name,
    row?.email,
    row?.phone,
    row?.status,
    row?.leaseStart,
    row?.leaseEnd,
    initialUnitOptionKey,
  ])

  useEffect(() => {
    if (!row) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, onClose])

  if (!row) return null

  async function save() {
    if (!formValid || !row) return
    setSaving(true)
    setSaveError(null)
    const phoneResult = optionalPhoneForDbOrError(phone)
    if (phoneResult.error) {
      setSaveError(phoneResult.error)
      setSaving(false)
      return
    }
    try {
      await onSave({
        id: row.id,
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phoneResult.phone ?? undefined,
        status,
        unitOptionKey: unitKey.trim(),
        leaseStart: leaseStart.trim(),
        leaseEnd: leaseEnd.trim(),
        restartOnboarding: offerRestartOnboarding && restartOnboarding,
      })
      onClose()
    } catch (e) {
      setSaveError(getErrorMessage(e, "Couldn't save. Please try again."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div role="presentation" className="sa-scrim absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sa-rail relative flex h-full max-h-dvh w-full max-w-[min(100vw,560px)] flex-col overflow-hidden border-l border-secondary bg-white shadow-[inset_1px_0_0_0_#A788964D]"
      >
        <header className="flex h-[81px] shrink-0 items-center justify-between border-b border-secondary px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-extended-2">
              <IconPencilHeader />
            </div>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-extended-3"
              >
                Edit Resident
              </h2>
              <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-neutral">
                {row.residentId}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="sa-press flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
          {saveError ? (
            <p
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-800"
              role="alert"
            >
              {saveError}
            </p>
          ) : null}
          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <label className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant">
                Full Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={inputClass}
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant">
                Email Address <span className="text-error">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant">
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
                autoComplete="tel"
                placeholder="(555) 123-4567"
              />
              <p className="text-[12px] font-normal leading-4 text-neutral">
                US numbers only — any common format is fine.
              </p>
              {offerRestartOnboarding ? (
                <label className="mt-2 flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className={`${checkboxInputClassName} mt-0.5`}
                    checked={restartOnboarding}
                    onChange={(e) => setRestartOnboarding(e.target.checked)}
                    aria-label="Start onboarding again"
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] font-medium leading-5 text-extended-3">
                      Start onboarding again
                    </span>
                    <span className="mt-0.5 block text-[12px] font-normal leading-4 text-neutral">
                      Send a welcome text to this number so they can opt in. Use this if the original number was wrong.
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
            <div className="space-y-2">
              <label
                htmlFor="edit-resident-unit"
                className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant"
              >
                Unit assignment
              </label>
              <div className="relative">
                <select
                  id="edit-resident-unit"
                  value={unitKey}
                  onChange={(e) => setUnitKey(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Unassigned</option>
                  {unitOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                  <IconChevronDown />
                </span>
              </div>
              <p className="text-[12px] font-normal leading-4 text-neutral">
                Shows vacant units and this resident&apos;s current unit so you can reassign if needed.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="edit-resident-lease-start"
                  className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant"
                >
                  Lease start date
                </label>
                <input
                  id="edit-resident-lease-start"
                  type="date"
                  value={leaseStart}
                  onChange={(e) => setLeaseStart(e.target.value)}
                  className={`${inputClass} min-h-9`}
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="edit-resident-lease-end"
                  className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant"
                >
                  Lease end date
                </label>
                <input
                  id="edit-resident-lease-end"
                  type="date"
                  value={leaseEnd}
                  onChange={(e) => setLeaseEnd(e.target.value)}
                  className={`${inputClass} min-h-9`}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="edit-resident-status"
                className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant"
              >
                Account Status
              </label>
              <div className="relative">
                <select
                  id="edit-resident-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ResidentStatus)}
                  className={selectClass}
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

        <footer className="flex w-full shrink-0 gap-3 border-t border-secondary bg-secondary px-6 pb-5 pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="sa-press flex h-[42px] min-w-0 flex-1 basis-0 items-center justify-center gap-2 rounded-[10px] border border-error px-4 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-error outline-none hover:bg-error focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <IconTrash />
            Delete Account
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!formValid || saving}
            className="sa-press flex h-[42px] min-w-0 flex-1 basis-0 items-center justify-center rounded-[10px] bg-extended-1 px-5 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none hover:bg-extended-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}
