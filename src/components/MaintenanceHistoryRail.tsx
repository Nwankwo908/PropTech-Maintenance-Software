import { useCallback, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { MaintenanceHistoryPanel } from '@/components/MaintenanceHistoryPanel'
import maintenanceHistoryIcon from '@/assets/maintenance-history.png'
import {
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
} from '@/lib/adminRightRail'
import { notifyPropertyDetailsChanged } from '@/lib/propertyDetailsCompleteness'
import {
  loadApprovedMaintenanceRecords,
  loadMaintenanceHistoryDocuments,
  saveApprovedMaintenanceRecords,
  saveMaintenanceHistoryDocuments,
  type MaintenanceHistoryDocument,
  type MaintenanceHistoryRecord,
} from '@/lib/maintenanceHistoryImport'

const HISTORY_DESCRIPTION =
  'Upload previous invoices, receipts, or work orders to help Ulo understand past repairs, identify recurring issues, and improve future maintenance planning.'

function CloseRailIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

export function MaintenanceHistoryRail({
  open,
  building,
  onClose,
}: {
  open: boolean
  building: string
  onClose: () => void
}) {
  const titleId = useId()
  const [docs, setDocs] = useState<MaintenanceHistoryDocument[]>([])
  const [approved, setApproved] = useState<MaintenanceHistoryRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !building) return
    setDocs(loadMaintenanceHistoryDocuments({ building }))
    setApproved(loadApprovedMaintenanceRecords({ building }))
    setError(null)
  }, [building, open])

  const persistDocs = useCallback(
    (next: MaintenanceHistoryDocument[]) => {
      setDocs(next)
      saveMaintenanceHistoryDocuments(next, { building })
      notifyPropertyDetailsChanged(building)
    },
    [building],
  )

  const persistApproved = useCallback(
    (next: MaintenanceHistoryRecord[]) => {
      setApproved(next)
      saveApprovedMaintenanceRecords(next, { building })
      notifyPropertyDetailsChanged(building)
    },
    [building],
  )

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, open])

  if (!open) return null

  return createPortal(
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div role="presentation" className={ADMIN_RIGHT_RAIL_SCRIM} aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${adminRightRailPanelClass(undefined, 'max-w-[min(100vw,640px)]')} !border-0`}
      >
        <header className="sa-enter relative shrink-0 px-5 py-4 pr-12">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={maintenanceHistoryIcon}
              alt=""
              className="size-8 shrink-0 object-contain"
              aria-hidden
            />
            <h2 id={titleId} className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
              Add maintenance history
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="sa-press absolute right-4 top-4 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
          >
            <CloseRailIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <p className="mb-4 text-[13px] leading-normal text-[#64748b]">{HISTORY_DESCRIPTION}</p>
          <MaintenanceHistoryPanel
            building={building}
            docs={docs}
            approved={approved}
            onDocsChange={persistDocs}
            onApprovedChange={persistApproved}
            onError={setError}
            hideIntro
          />
          {error ? <p className="mt-3 text-[12px] text-[#b91c1c]">{error}</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
