import { useEffect, useId, useState } from 'react'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import {
  setupOutreachAckBody,
  setupOutreachAckCheckboxLabel,
  setupOutreachAckConfirmLabel,
  setupOutreachAckTitle,
  type SetupOutreachRecipientKind,
} from '@/lib/setupOutreachAck'

export function SetupOutreachAckModal({
  open,
  kind,
  retry = false,
  saving = false,
  onClose,
  onConfirm,
}: {
  open: boolean
  kind: SetupOutreachRecipientKind
  retry?: boolean
  saving?: boolean
  onClose: () => void
  onConfirm: () => void
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
          {setupOutreachAckTitle(kind)}
        </h2>
        <p className="mt-2 text-[14px] leading-5 text-[#6a7282]">{setupOutreachAckBody(kind)}</p>

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
            {setupOutreachAckCheckboxLabel(kind)}
          </span>
        </label>

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
            onClick={onConfirm}
            className="sa-press inline-flex h-9 items-center rounded-[10px] bg-[#187960] px-4 text-[13px] font-medium text-white hover:bg-[#146b52] disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? 'Sending…' : setupOutreachAckConfirmLabel({ kind, retry })}
          </button>
        </div>
      </div>
    </div>
  )
}
