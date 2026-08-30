import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import {
  TERMS_SECTION_6_2_HREF,
  TERMS_SECTION_10_HREF,
  VENDOR_ONBOARDING_OVERRIDE_DISCLAIMER_BODY,
} from '@/lib/vendorOnboardingOverrideAck'

export function OverrideOnboardingModal({
  open,
  vendorName,
  saving,
  error,
  onClose,
  onActivate,
}: {
  open: boolean
  vendorName: string
  saving: boolean
  error: string | null
  onClose: () => void
  onActivate: () => void
}) {
  const titleId = useId()
  const checkboxId = useId()
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!open) setAccepted(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, saving])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
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
        className="relative w-full max-w-lg rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1)]"
      >
        <h2 id={titleId} className="text-[18px] font-semibold leading-7 text-[#0a0a0a]">
          Activate without verification
        </h2>
        <p className="mt-2 text-[14px] leading-5 text-[#6a7282]">
          {vendorName} will be eligible for work orders even though Ulo has not completed
          verification.
        </p>

        <label htmlFor={checkboxId} className="mt-4 flex cursor-pointer items-start gap-3">
          <input
            id={checkboxId}
            type="checkbox"
            className={`mt-0.5 ${checkboxInputClassName}`}
            checked={accepted}
            disabled={saving}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <span className="text-[14px] leading-5 text-[#364153]">
            {VENDOR_ONBOARDING_OVERRIDE_DISCLAIMER_BODY}{' '}
            (Links to{' '}
            <Link
              to={TERMS_SECTION_6_2_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#186179] underline underline-offset-2 hover:text-[#0f4a5c]"
              onClick={(event) => event.stopPropagation()}
            >
              Terms Section 6.2
            </Link>
            {' & '}
            <Link
              to={TERMS_SECTION_10_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#186179] underline underline-offset-2 hover:text-[#0f4a5c]"
              onClick={(event) => event.stopPropagation()}
            >
              Section 10
            </Link>
            )
          </span>
        </label>

        {error ? (
          <p className="mt-4 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] leading-5 text-[#991b1b]">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="sa-press inline-flex h-9 items-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 text-[13px] font-medium text-[#364153] hover:bg-[#f9fafb] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!accepted || saving}
            onClick={onActivate}
            className="sa-press inline-flex h-9 items-center rounded-[10px] bg-[#187960] px-4 text-[13px] font-medium text-white hover:bg-[#146b52] disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? 'Activating…' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  )
}
