type InspectionCaptureChooserProps = {
  onUseComputer: () => void
  onUsePhone: () => void
  onClose: () => void
}

export function InspectionCaptureChooser({
  onUseComputer,
  onUsePhone,
  onClose,
}: InspectionCaptureChooserProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0d0f11]/40 p-4">
      <div
        role="dialog"
        aria-labelledby="inspection-take-photos-title"
        className="w-full max-w-[420px] rounded-[14px] bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="inspection-take-photos-title" className="text-[16px] font-semibold text-[#0d0f11]">
            Take photos
          </h2>
          <button
            type="button"
            className="pd-btn pd-btn-ghost text-[13px]"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <div className="mt-4 grid gap-3">
          <button
            type="button"
            onClick={onUseComputer}
            className="rounded-[10px] border border-[#e2e8f0] px-4 py-3 text-left hover:border-[#186179]"
          >
            <p className="text-[14px] font-semibold text-[#0d0f11]">Use this computer</p>
            <p className="mt-0.5 text-[12px] text-[#64748b]">Take photos with a connected camera.</p>
          </button>
          <button
            type="button"
            onClick={onUsePhone}
            className="rounded-[10px] border border-[#e2e8f0] px-4 py-3 text-left hover:border-[#186179]"
          >
            <p className="text-[14px] font-semibold text-[#0d0f11]">Use your phone</p>
            <p className="mt-0.5 text-[12px] text-[#64748b]">
              Scan a QR code and send photos directly to this inspection.
            </p>
          </button>
        </div>
      </div>
    </div>
  )
}
