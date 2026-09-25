import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getErrorMessage } from '@/lib/errorMessage'
import { parseRentDueDayInput, type RentDueDayChoice } from '@/lib/onboarding'
import { ACCEPTED_UPLOAD_MIME, isAcceptedUploadFile } from '@/lib/onboardingDocumentUpload'
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
  /** False when the landlord only edited contact fields — do not rewrite unit/building. */
  unitAssignmentChanged: boolean
  /** YYYY-MM-DD; empty when unset */
  leaseStart: string
  /** YYYY-MM-DD; empty when unset */
  leaseEnd: string
  /** Day of month 1–31, or null when unset */
  rentDueDay: number | null
  /** Send welcome SMS to the new number after a phone change. */
  restartOnboarding?: boolean
  /** Lease / move-in files to attach on save. */
  leaseDocumentFiles?: File[]
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
  /** Day of month 1–31 from onboarding / `users.rent_due_day` */
  rentDueDay?: number | null
}

const STATUS_OPTIONS: { value: ResidentStatus; label: string }[] = [
  { value: 'active', label: 'Occupied' },
  { value: 'pending', label: 'Pending move-in' },
  { value: 'past_resident', label: 'Past resident' },
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

function rentDueDayModeFromDay(day: number | null | undefined): RentDueDayChoice {
  if (day == null || !Number.isFinite(day)) return ''
  if (day === 1) return '1'
  if (day === 5) return '5'
  return 'custom'
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
  onDelete,
}: {
  row: EditResidentModalRow | null
  /** Vacant units plus current assignment (for reassignment). */
  unitOptions: { value: string; label: string }[]
  /** `''` = unassigned */
  initialUnitOptionKey: string
  onClose: () => void
  /** Persist changes (Supabase update or demo state patch in parent). */
  onSave: (payload: EditResidentSavePayload) => Promise<void>
  /** Permanently remove the tenant roster account. */
  onDelete: (row: EditResidentModalRow) => Promise<void>
}) {
  const titleId = useId()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<ResidentStatus>('active')
  const [unitKey, setUnitKey] = useState('')
  const [unitAssignmentChanged, setUnitAssignmentChanged] = useState(false)
  const [leaseStart, setLeaseStart] = useState('')
  const [leaseEnd, setLeaseEnd] = useState('')
  const [rentDueDayMode, setRentDueDayMode] = useState<RentDueDayChoice>('')
  const [rentDueDay, setRentDueDay] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [restartOnboarding, setRestartOnboarding] = useState(true)
  const [leaseFiles, setLeaseFiles] = useState<File[]>([])
  const [leaseUploadError, setLeaseUploadError] = useState<string | null>(null)
  const leaseFileInputRef = useRef<HTMLInputElement | null>(null)
  const busy = saving || deleting

  const formValid = useMemo(() => {
    const trimmedEmail = email.trim()
    if (fullName.trim().length === 0) return false
    if (!trimmedEmail) return true
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
  }, [fullName, email])

  const offerRestartOnboarding = Boolean(row) && shouldOfferRestartTenantOnboarding(row?.phone, phone)

  useEffect(() => {
    if (!row) return
    setFullName(row.name)
    setEmail(row.email)
    setPhone(row.phone ? formatPhoneNational(row.phone) : '')
    setStatus(row.status)
    setUnitKey(initialUnitOptionKey)
    setUnitAssignmentChanged(false)
    setLeaseStart(toDateInputValue(row.leaseStart))
    setLeaseEnd(toDateInputValue(row.leaseEnd))
    setRentDueDayMode(rentDueDayModeFromDay(row.rentDueDay))
    setRentDueDay(
      row.rentDueDay != null && Number.isFinite(row.rentDueDay) ? String(row.rentDueDay) : '',
    )
    setSaveError(null)
    setRestartOnboarding(true)
    setConfirmDelete(false)
    setDeleting(false)
    setLeaseFiles([])
    setLeaseUploadError(null)
  }, [
    row?.id,
    row?.name,
    row?.email,
    row?.phone,
    row?.status,
    row?.leaseStart,
    row?.leaseEnd,
    row?.rentDueDay,
    initialUnitOptionKey,
  ])

  useEffect(() => {
    if (!row) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (confirmDelete) setConfirmDelete(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, onClose, confirmDelete])

  useEffect(() => {
    if (!row) return
    const html = document.documentElement
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = document.body.style.overflow
    html.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prevHtmlOverflow
      document.body.style.overflow = prevBodyOverflow
    }
  }, [row])

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
    if (rentDueDayMode === 'custom' && !rentDueDay.trim()) {
      setSaveError('Enter a custom rent due day (1–31).')
      setSaving(false)
      return
    }
    const parsedRentDueDay = rentDueDay.trim() ? parseRentDueDayInput(rentDueDay) : null
    if (rentDueDay.trim() && parsedRentDueDay == null) {
      setSaveError('Rent due day must be between 1 and 31.')
      setSaving(false)
      return
    }
    try {
      // #region agent log
      fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'A',location:'EditResidentModal.tsx:save',message:'edit resident save start',data:{hasLeaseFiles:leaseFiles.length>0,leaseFileCount:leaseFiles.length,fullNameLen:fullName.trim().length},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      await onSave({
        id: row.id,
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phoneResult.phone ?? undefined,
        status,
        unitOptionKey: unitKey.trim(),
        unitAssignmentChanged,
        leaseStart: leaseStart.trim(),
        leaseEnd: leaseEnd.trim(),
        rentDueDay: parsedRentDueDay,
        restartOnboarding: offerRestartOnboarding && restartOnboarding,
        leaseDocumentFiles: leaseFiles.length > 0 ? leaseFiles : undefined,
      })
      // #region agent log
      fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'A',location:'EditResidentModal.tsx:save:ok',message:'edit resident save succeeded',data:{hasLeaseFiles:leaseFiles.length>0},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      onClose()
    } catch (e) {
      const msg = getErrorMessage(e, "Couldn't save. Please try again.")
      // #region agent log
      fetch('http://127.0.0.1:7898/ingest/3050e2ef-64dd-49e5-a718-1f5719c45963',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5d0562'},body:JSON.stringify({sessionId:'5d0562',runId:'pre-fix',hypothesisId:'A',location:'EditResidentModal.tsx:save:catch',message:'edit resident save threw',data:{errorMessage:msg,isEnterYourName:msg==='Enter your name.',rawType:e instanceof Error?e.name:typeof e},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setSaveError(msg)
    } finally {
      setSaving(false)
    }
  }

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

  async function remove() {
    if (!row || busy) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      setSaveError(null)
      return
    }
    setDeleting(true)
    setSaveError(null)
    try {
      await onDelete(row)
      onClose()
    } catch (e) {
      setSaveError(getErrorMessage(e, "Couldn't delete this resident. Please try again."))
    } finally {
      setDeleting(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end overflow-hidden overscroll-none"
      onWheel={(e) => e.stopPropagation()}
    >
      <div role="presentation" className="sa-scrim absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sa-rail relative flex h-full max-h-dvh min-w-0 w-full max-w-[min(100vw,560px)] flex-col overflow-hidden border-l border-secondary bg-white shadow-[inset_1px_0_0_0_#A788964D]"
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
                {fullName.trim() || row.name.trim() || 'Resident'}
              </h2>
              <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-neutral">
                Resident ID: {row.residentId}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="sa-press flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain overscroll-x-none touch-pan-y px-6 pb-6 pt-6">
          {saveError ? (
            <p
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-800"
              role="alert"
            >
              {saveError}
            </p>
          ) : null}
          <div className="flex min-w-0 flex-col gap-4">
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
                Email Address
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
                  onChange={(e) => {
                    setUnitKey(e.target.value)
                    setUnitAssignmentChanged(true)
                  }}
                  className={selectClass}
                >
                  <option value="">Unassigned</option>
                  {unitKey && !unitOptions.some((o) => o.value === unitKey) ? (
                    <option value={unitKey}>
                      {row.unit.kind === 'assigned'
                        ? `${row.unit.unit} (current)`
                        : 'Current unit'}
                    </option>
                  ) : null}
                  {unitOptions
                    .filter((o) => o.value)
                    .map((o) => (
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
                  className={`${inputClass} min-h-9 min-w-0`}
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
                  className={`${inputClass} min-h-9 min-w-0`}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="edit-resident-rent-due"
                className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant"
              >
                Rent due day
              </label>
              <div className="relative">
                <select
                  id="edit-resident-rent-due"
                  value={rentDueDayMode}
                  onChange={(e) => {
                    const choice = e.target.value as RentDueDayChoice
                    if (choice === '1' || choice === '5') {
                      setRentDueDayMode(choice)
                      setRentDueDay(choice)
                      return
                    }
                    if (choice === 'custom') {
                      const current = rentDueDay.trim()
                      setRentDueDayMode('custom')
                      setRentDueDay(current === '1' || current === '5' ? '' : current)
                      return
                    }
                    setRentDueDayMode('')
                    setRentDueDay('')
                  }}
                  className={selectClass}
                >
                  <option value="">Select day</option>
                  <option value="1">1st</option>
                  <option value="5">5th</option>
                  <option value="custom">Custom</option>
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                  <IconChevronDown />
                </span>
              </div>
              {rentDueDayMode === 'custom' ? (
                <input
                  type="text"
                  inputMode="numeric"
                  value={rentDueDay}
                  onChange={(e) => setRentDueDay(e.target.value)}
                  placeholder="Day of month (1–31)"
                  className={inputClass}
                  aria-label="Custom rent due day"
                />
              ) : null}
            </div>
            <div className="space-y-2">
              <label
                htmlFor="edit-resident-status"
                className="block text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant"
              >
                Occupancy status
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
                disabled={busy}
                onClick={() => leaseFileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (busy) return
                  addLeaseFiles(event.dataTransfer.files)
                }}
                className="sa-press flex w-full flex-col items-center justify-center rounded-[10px] border border-dashed border-[#d1d5db] bg-[#fafafa] px-4 py-6 text-center outline-none hover:border-[#9ca3af] hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
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
                        disabled={busy}
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
                        className="sa-press shrink-0 text-[12px] font-medium text-[#b52a00] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>

        <footer className="flex w-full shrink-0 flex-col gap-3 border-t border-secondary bg-secondary px-6 pb-5 pt-4">
          {confirmDelete ? (
            <p className="text-[13px] leading-5 text-neutral">
              This permanently removes {row.name.trim() || 'this resident'} from your roster and
              their tenant account. This cannot be undone.
            </p>
          ) : null}
          <div className="flex w-full gap-3">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="sa-press flex h-[42px] min-w-0 flex-1 basis-0 items-center justify-center gap-2 rounded-[10px] border border-error px-4 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-error outline-none hover:bg-error focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
            >
              <IconTrash />
              {deleting ? 'Deleting…' : confirmDelete ? 'Delete account' : 'Delete Account'}
            </button>
            {confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="sa-press flex h-[42px] min-w-0 flex-1 basis-0 items-center justify-center rounded-[10px] border border-secondary bg-white px-5 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-extended-3 outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void save()}
                disabled={!formValid || busy}
                className="sa-press flex h-[42px] min-w-0 flex-1 basis-0 items-center justify-center rounded-[10px] bg-extended-1 px-5 text-[16px] font-medium leading-6 tracking-[-0.3125px] text-white outline-none hover:bg-extended-1 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
