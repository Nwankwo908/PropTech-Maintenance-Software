import { useEffect, useId, useMemo, useState } from 'react'

function IconWrenchHeader({ className = 'size-5 shrink-0 text-white' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconCircleCheck({ className = 'size-4 shrink-0 text-white' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.65} />
      <path d="M8.5 12.5l2.5 2.5 5-5" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const VENDOR_SELECT_PLACEHOLDER = 'Select a vendor'

export type ChangeAssignedVendorModalProps = {
  open: boolean
  /** Currently assigned vendor name (shown as initial select value). */
  currentVendor: string
  /** Deduplicated list of vendor display names to offer. */
  vendorOptions: string[]
  onClose: () => void
  onSave: (nextVendor: string) => void | Promise<void>
  /** True while a persisted save is in flight (blocks dismiss actions). */
  saving?: boolean
  /** Inline error from the last failed save (e.g. API message). */
  saveError?: string | null
}

/**
 * Admin flow to override AI/auto-assigned vendor (Figma 150:634).
 */
export function ChangeAssignedVendorModal({
  open,
  currentVendor,
  vendorOptions,
  onClose,
  onSave,
  saving = false,
  saveError = null,
}: ChangeAssignedVendorModalProps) {
  const titleId = useId()
  const selectId = useId()
  const safeOptions = useMemo(() => {
    if (vendorOptions.length > 0) return vendorOptions
    return [VENDOR_SELECT_PLACEHOLDER]
  }, [vendorOptions])

  const [selection, setSelection] = useState(() =>
    currentVendor && safeOptions.includes(currentVendor) ? currentVendor : safeOptions[0] ?? '',
  )

  useEffect(() => {
    if (!open) return
    const next =
      currentVendor && safeOptions.includes(currentVendor)
        ? currentVendor
        : safeOptions[0] ?? ''
    setSelection(next)
  }, [open, currentVendor, safeOptions])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, saving])

  if (!open) return null

  const canSave =
    Boolean(selection.trim()) &&
    selection.trim() !== VENDOR_SELECT_PLACEHOLDER &&
    !saving

  async function save() {
    if (!canSave) return
    await Promise.resolve(onSave(selection.trim()))
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div
        role="presentation"
        className="absolute inset-0"
        aria-hidden
        onClick={() => {
          if (!saving) onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex w-full max-w-[440px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-[59px] shrink-0 items-center justify-between bg-[#155dfc] px-6">
          <div className="flex min-w-0 items-center gap-3">
            <IconWrenchHeader />
            <h2
              id={titleId}
              className="truncate text-[18px] font-semibold leading-[27px] tracking-[-0.4395px] text-white"
            >
              Change Assigned Vendor
            </h2>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!saving) onClose()
            }}
            disabled={saving}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-white/90 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#155dfc] disabled:pointer-events-none disabled:opacity-50"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-4 px-6 pb-6 pt-6">
          <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
            Select a new vendor to assign to this maintenance request
          </p>

          <div className="flex flex-col gap-2">
            <label htmlFor={selectId} className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#364153]">
              Select Vendor
            </label>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              Only active vendors saved in the system whose specialty matches this ticket’s category (same specialties as
              User Management → Vendors).
            </p>
            <div className="relative">
              <select
                id={selectId}
                value={safelistSelection(selection, safeOptions)}
                onChange={(e) => setSelection(e.target.value)}
                disabled={saving}
                className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-transparent bg-[#f3f3f5] py-0 pl-[13px] pr-10 text-[14px] font-medium tracking-[-0.1504px] text-[#0a0a0a] outline-none focus:border-[#155dfc]/40 focus:bg-white focus:ring-2 focus:ring-[#155dfc]/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {safeOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#6a7282]" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </div>
          </div>

          {saveError ? (
            <p className="text-[13px] leading-4 text-[#c10007]" role="alert">
              {saveError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                console.log('Save button clicked')
                void save()
              }}
              disabled={!canSave}
              className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-[#155dfc] px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white outline-none transition-colors hover:bg-[#1249d6] focus-visible:ring-2 focus-visible:ring-[#155dfc] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 sm:flex-initial sm:min-w-[200px]"
            >
              <IconCircleCheck />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-black/10 bg-white px-[17px] text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#944c73] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function safelistSelection(value: string, options: string[]): string {
  if (options.includes(value)) return value
  return options[0] ?? ''
}
