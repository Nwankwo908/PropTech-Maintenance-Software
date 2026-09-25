import { useEffect } from 'react'
import {
  onboardingBtnPrimaryClass,
  onboardingBtnSecondaryClass,
} from './onboardingFieldStyles'

type NoVendorsContinueModalProps = {
  titleId: string
  saving?: boolean
  onClose: () => void
  onConfirm: () => void
}

/** Confirm continuing Fast Track Review / Complete when no vendors are selected. */
export function NoVendorsContinueModal({
  titleId,
  saving = false,
  onClose,
  onConfirm,
}: NoVendorsContinueModalProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="presentation"
        className="absolute inset-0"
        aria-hidden
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[420px] rounded-[12px] bg-white p-6 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
      >
        <h2 id={titleId} className="text-[18px] font-semibold tracking-[-0.2px] text-[#111827]">
          Continue without vendors?
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[#4b5563]">
          Are you sure you want to continue without adding any vendors?
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className={onboardingBtnSecondaryClass}
          >
            Go back
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onConfirm}
            className={onboardingBtnPrimaryClass}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
