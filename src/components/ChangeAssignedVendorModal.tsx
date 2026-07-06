import { useEffect, useId, useMemo, useState } from 'react'
import {
  postDiscoverExternalVendors,
  type ExternalVendorSuggestionDto,
} from '@/api/discoverExternalVendors'
import { FindExternalVendorRail } from '@/components/FindExternalVendorRail'

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

const VENDOR_SELECT_PLACEHOLDER = 'Select a vendor'

export type ChangeVendorSaveMeta = {
  createVendorIfMissing?: boolean
}

export type ChangeAssignedVendorModalProps = {
  open: boolean
  /** Currently assigned vendor name (shown as initial select value). */
  currentVendor: string
  /** Deduplicated list of vendor display names to offer. */
  vendorOptions: string[]
  onClose: () => void
  onSave: (nextVendor: string, meta?: ChangeVendorSaveMeta) => void | Promise<void>
  /** True while a persisted save is in flight (blocks dismiss actions). */
  saving?: boolean
  /** Inline error from the last failed save (e.g. API message). */
  saveError?: string | null
  /**
   * When `vendorOptions` is empty and this is set, loads Google Places + Yelp suggestions
   * via Edge (Figma “outside your network” flow).
   */
  externalDiscovery?: {
    ticketId: string
    url: string
    secret: string
    locationLabel?: string
    issueCategory?: string | null
  } | null
}

/**
 * Admin flow to override AI/auto-assigned vendor (Figma 150:634 in-network;
 * Figma 306:1224 when no in-network specialty match — Google + Yelp discovery).
 */
export function ChangeAssignedVendorModal({
  open,
  currentVendor,
  vendorOptions,
  onClose,
  onSave,
  saving = false,
  saveError = null,
  externalDiscovery = null,
}: ChangeAssignedVendorModalProps) {
  const titleId = useId()
  const selectId = useId()
  const safeOptions = useMemo(() => {
    if (vendorOptions.length > 0) return vendorOptions
    return [VENDOR_SELECT_PLACEHOLDER]
  }, [vendorOptions])

  const useExternalLayout =
    vendorOptions.length === 0 && externalDiscovery != null

  const [selection, setSelection] = useState(() =>
    currentVendor && safeOptions.includes(currentVendor) ? currentVendor : safeOptions[0] ?? '',
  )

  const [externalSuggestions, setExternalSuggestions] = useState<
    ExternalVendorSuggestionDto[]
  >([])
  const [externalProvidersUsed, setExternalProvidersUsed] = useState<string[]>([])
  const [externalLoading, setExternalLoading] = useState(false)
  const [externalError, setExternalError] = useState<string | null>(null)
  const [externalNotice, setExternalNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const next =
      currentVendor && safeOptions.includes(currentVendor)
        ? currentVendor
        : safeOptions[0] ?? ''
    setSelection(next)
  }, [open, currentVendor, safeOptions])

  useEffect(() => {
    if (!open || !useExternalLayout || !externalDiscovery) return
    let cancelled = false
    setExternalLoading(true)
    setExternalError(null)
    setExternalNotice(null)
    setExternalSuggestions([])
    setExternalProvidersUsed([])
    void (async () => {
      try {
        const res = await postDiscoverExternalVendors({
          url: externalDiscovery.url,
          secret: externalDiscovery.secret,
          ticketId: externalDiscovery.ticketId,
        })
        if (cancelled) return
        if (res.notice) setExternalNotice(res.notice)
        setExternalSuggestions(res.suggestions ?? [])
        setExternalProvidersUsed(res.providersUsed ?? [])
      } catch (e) {
        if (!cancelled) {
          setExternalError(e instanceof Error ? e.message : 'Could not load suggestions')
        }
      } finally {
        if (!cancelled) setExternalLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, useExternalLayout, externalDiscovery?.ticketId, externalDiscovery?.url, externalDiscovery?.secret])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, saving])

  if (!open) return null

  const canSaveInternal =
    Boolean(selection.trim()) &&
    selection.trim() !== VENDOR_SELECT_PLACEHOLDER &&
    !saving

  async function save() {
    if (!canSaveInternal) return
    await Promise.resolve(onSave(selection.trim()))
  }

  if (useExternalLayout) {
    return (
      <FindExternalVendorRail
        open={open}
        onClose={onClose}
        saving={saving}
        saveError={saveError}
        loading={externalLoading}
        error={externalError}
        notice={externalNotice}
        locationLabel={externalDiscovery?.locationLabel ?? 'Property · Unit'}
        issueCategory={externalDiscovery?.issueCategory ?? null}
        suggestions={externalSuggestions}
        providersUsed={externalProvidersUsed}
        onSelect={async (pick) => {
          await Promise.resolve(onSave(pick.name.trim(), { createVendorIfMissing: true }))
        }}
      />
    )
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
        <div className="flex h-[59px] shrink-0 items-center justify-between bg-[#b58500] px-6">
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
            className="shrink-0 rounded-lg px-2 py-1 text-[14px] font-medium leading-5 text-white/90 outline-none transition-colors hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#b58500] disabled:pointer-events-none disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <div className="flex flex-col gap-4 px-6 pb-6 pt-6">
          <div className="flex flex-col gap-2">
            <label htmlFor={selectId} className="text-[14px] font-medium leading-5 tracking-[-0.1504px] text-neutral-variant">
              Select Vendor
            </label>
            <p className="text-[12px] leading-4 text-neutral">
              Only vendors who are active and have the right specialty for this job will be considered — the same
              specialties listed under User Management → Vendors.
            </p>
            <div className="relative">
              <select
                id={selectId}
                value={safelistSelection(selection, safeOptions)}
                onChange={(e) => setSelection(e.target.value)}
                disabled={saving}
                className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-transparent bg-secondary py-0 pl-[13px] pr-10 text-[14px] font-medium tracking-[-0.1504px] text-extended-3 outline-none focus:border-extended-1/40 focus:bg-white focus:ring-2 focus:ring-extended-1/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {safeOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </div>
          </div>

          {saveError ? (
            <p className="text-[13px] leading-4 text-error" role="alert">
              {saveError}
            </p>
          ) : null}

          <div className="flex w-full min-w-0 gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                void save()
              }}
              disabled={!canSaveInternal}
              className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-[#b58500] px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white outline-none transition-colors hover:bg-[#9a7310] focus-visible:ring-2 focus-visible:ring-[#b58500] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-9 min-w-0 flex-1 items-center justify-center rounded-lg border border-black/10 bg-white px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-extended-3 outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
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
