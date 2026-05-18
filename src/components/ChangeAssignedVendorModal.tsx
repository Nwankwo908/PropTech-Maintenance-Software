import { useEffect, useId, useMemo, useState } from 'react'
import {
  postDiscoverExternalVendors,
  type ExternalVendorSuggestionDto,
} from '@/api/discoverExternalVendors'

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

function IconWrenchNetwork({ className = 'size-5 shrink-0 text-[#003594]' }: { className?: string }) {
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

function IconCircleCheckBlue({ className = 'size-5 shrink-0 text-[#155dfc]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.65} />
      <path d="M8.5 12.5l2.5 2.5 5-5" stroke="currentColor" strokeWidth={1.65} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconClose({ className = 'size-5 shrink-0 text-[#6a7282]' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
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
  const [externalLoading, setExternalLoading] = useState(false)
  const [externalError, setExternalError] = useState<string | null>(null)
  const [externalNotice, setExternalNotice] = useState<string | null>(null)
  const [selectedExternalIndex, setSelectedExternalIndex] = useState(0)

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
    setSelectedExternalIndex(0)
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

  const selectedExternal = externalSuggestions[selectedExternalIndex]
  const canSaveExternal =
    useExternalLayout &&
    !externalLoading &&
    !externalError &&
    Boolean(selectedExternal?.name?.trim()) &&
    !saving

  async function save() {
    if (useExternalLayout) {
      if (!canSaveExternal || !selectedExternal) return
      await Promise.resolve(
        onSave(selectedExternal.name.trim(), { createVendorIfMissing: true }),
      )
      return
    }
    if (!canSaveInternal) return
    await Promise.resolve(onSave(selection.trim()))
  }

  if (useExternalLayout) {
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
          className="relative flex w-full max-w-[672px] flex-col overflow-hidden rounded-[10px] bg-white shadow-[0px_25px_50px_0px_rgba(0,0,0,0.25)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-[77px] shrink-0 items-center justify-between border-b border-[#e5e7eb] bg-white px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#cad1e4]">
                <IconWrenchNetwork />
              </div>
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="text-[18px] font-semibold leading-7 tracking-[-0.4395px] text-[#0a0a0a]"
                >
                  Select Vendor
                </h2>
                <p className="text-[14px] font-normal leading-5 tracking-[-0.1504px] text-[#4a5565]">
                  We found more qualified vendors outside your network
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!saving) onClose()
              }}
              disabled={saving}
              className="shrink-0 rounded-lg p-1 text-[#6a7282] outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
              aria-label="Close"
            >
              <IconClose />
            </button>
          </div>

          <div className="max-h-[min(480px,60vh)] min-h-[200px] overflow-y-auto px-6 pt-6">
            {externalLoading ? (
              <p className="pb-6 text-[14px] leading-5 text-[#6a7282]">Searching Google Places and Yelp…</p>
            ) : null}
            {externalError ? (
              <p className="pb-6 text-[13px] leading-5 text-error" role="alert">
                {externalError}
              </p>
            ) : null}
            {externalNotice && !externalLoading ? (
              <p className="pb-4 text-[13px] leading-5 text-[#6a7282]" role="status">
                {externalNotice}
              </p>
            ) : null}
            {!externalLoading && !externalError && externalSuggestions.length === 0 ? (
              <p className="pb-6 text-[14px] leading-5 text-[#6a7282]">
                No outside-network results yet. Set Edge secrets{' '}
                <span className="font-medium text-[#0a0a0a]">GOOGLE_PLACES_API_KEY</span> and/or{' '}
                <span className="font-medium text-[#0a0a0a]">YELP_API_KEY</span>, and optionally{' '}
                <span className="font-medium text-[#0a0a0a]">EXTERNAL_VENDOR_SEARCH_LOCATION</span> when
                tickets have no unit/address for search.
              </p>
            ) : null}

            <div className="flex flex-col gap-4 pb-6">
              {externalSuggestions.map((v, i) => {
                const selected = i === selectedExternalIndex
                return (
                  <button
                    key={`${v.name}-${i}`}
                    type="button"
                    disabled={saving}
                    onClick={() => setSelectedExternalIndex(i)}
                    className={`relative w-full rounded-[10px] border px-[17px] pb-[17px] pt-[17px] text-left outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-[#155dfc] focus-visible:ring-offset-2 disabled:opacity-60 ${
                      selected
                        ? 'border-[#155dfc] bg-[#eff6ff]'
                        : 'border-[#e5e7eb] bg-white hover:border-[#d1d5dc]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[16px] font-medium leading-6 tracking-[-0.3125px] text-[#101828]">
                          {v.name}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[14px] leading-5 tracking-[-0.1504px]">
                          <span className="inline-flex items-center gap-1 text-[#101828]">
                            <span className="text-[#f0b100]" aria-hidden>
                              ★
                            </span>
                            <span className="font-medium">
                              {v.rating != null ? v.rating.toFixed(1) : '—'}
                            </span>
                          </span>
                          <span className="text-[#6a7282]">
                            ({v.reviewCount != null ? v.reviewCount : '—'})
                          </span>
                        </div>
                        {v.priceLabel ? (
                          <p className="mt-2 text-[14px] leading-5 tracking-[-0.1504px] text-[#4a5565]">
                            <span className="font-medium text-[#4a5565]">{v.priceLabel}</span>
                            <span className="font-normal"> · estimated tier</span>
                          </p>
                        ) : (
                          <p className="mt-2 text-[14px] leading-5 text-[#6a7282]">Pricing varies — confirm with the vendor</p>
                        )}
                      </div>
                      {selected ? (
                        <span className="shrink-0" aria-hidden>
                          <IconCircleCheckBlue />
                        </span>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {saveError ? (
            <p className="px-6 text-[13px] leading-4 text-error" role="alert">
              {saveError}
            </p>
          ) : null}

          <div className="flex shrink-0 gap-3 border-t border-[#e5e7eb] bg-[#f9fafb] px-6 pb-4 pt-[17px]">
            <button
              type="button"
              onClick={() => {
                void save()
              }}
              disabled={!canSaveExternal}
              className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-[#003594] px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-white outline-none transition-colors hover:bg-[#002a75] focus-visible:ring-2 focus-visible:ring-[#003594] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f9fafb] disabled:pointer-events-none disabled:opacity-60"
            >
              <IconCircleCheck className="size-4" />
              {saving ? 'Assigning…' : 'Assign Vendor'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-9 min-w-0 flex-1 items-center justify-center rounded-lg border border-black/10 bg-white px-4 text-[14px] font-medium leading-5 tracking-[-0.1504px] text-[#0a0a0a] outline-none transition-colors hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
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
