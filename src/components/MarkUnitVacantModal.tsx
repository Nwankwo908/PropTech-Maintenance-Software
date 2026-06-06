import { useId, useState } from 'react'

type MarkUnitVacantModalProps = {
  open: boolean
  unitLabel: string
  building: string | null
  loading?: boolean
  onClose: () => void
  onConfirm: () => void
}

export function MarkUnitVacantModal({
  open,
  unitLabel,
  building,
  loading = false,
  onClose,
  onConfirm,
}: MarkUnitVacantModalProps) {
  const titleId = useId()

  if (!open) return null

  const location = building ? `${unitLabel} — ${building}` : unitLabel

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-[#e5e7eb] bg-white p-6 shadow-lg"
      >
        <h2 id={titleId} className="text-[18px] font-semibold text-[#101828]">
          Mark unit vacant?
        </h2>
        <p className="mt-2 text-[14px] leading-5 text-[#6a7282]">
          This will end the current tenant&apos;s occupancy for <strong>{location}</strong>, deregister
          their SMS identity, archive open resident SMS threads, and mark active occupants as past
          residents.
        </p>
        <p className="mt-3 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[13px] leading-5 text-[#92400e]">
          Add the new tenant before activating this unit.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-9 rounded-lg px-4 text-[14px] font-medium text-[#4a5565] hover:bg-[#f3f4f6] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="h-9 rounded-lg bg-[#dc2626] px-4 text-[14px] font-medium text-white hover:bg-[#b91c1c] disabled:opacity-50"
          >
            {loading ? 'Marking vacant…' : 'Mark vacant'}
          </button>
        </div>
      </div>
    </div>
  )
}
