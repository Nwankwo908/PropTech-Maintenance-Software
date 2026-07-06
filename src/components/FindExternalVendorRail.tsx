import { useEffect, useId } from 'react'
import type { ExternalVendorSuggestionDto } from '@/api/discoverExternalVendors'
import {
  buildExternalSearchQueryLabel,
  enrichExternalVendorSuggestions,
  formatExternalProviderChip,
  formatSourceBadgeLabel,
  type ExternalVendorDisplayRow,
} from '@/lib/externalVendorDisplay'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="size-[13px] shrink-0 text-[#717182]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  )
}

function MapPinIcon() {
  return (
    <svg className="size-[10px] shrink-0 text-[#717182]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg className="size-[10px] shrink-0 text-[#717182]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg className="size-[10px] shrink-0 text-[#717182]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" />
    </svg>
  )
}

function UserPlusIcon() {
  return (
    <svg className="size-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" strokeLinecap="round" />
    </svg>
  )
}

function StarRating({ rating }: { rating: number | null }) {
  const value = rating ?? 0
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, i) => {
        const filled = value >= i + 1 - 0.25
        return (
          <svg
            key={i}
            className={`size-[11px] ${filled ? 'text-[#f0b100]' : 'text-[#e5e7eb]'}`}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
          </svg>
        )
      })}
    </div>
  )
}

function SourceBadge({ source }: { source: ExternalVendorDisplayRow['primarySource'] }) {
  const label = formatSourceBadgeLabel(source)
  const className =
    source === 'yelp'
      ? 'bg-[#fef2f2] text-[#fb2c36]'
      : source === 'netvendor'
        ? 'bg-[#ecfdf5] text-[#059669]'
        : source === 'google'
          ? 'bg-[#eff6ff] text-[#155dfc]'
          : 'bg-[#f3f4f6] text-[#717182]'

  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold leading-[13.5px] ${className}`}>
      {label}
    </span>
  )
}

function VendorResultRow({
  vendor,
  saving,
  onSelect,
}: {
  vendor: ExternalVendorDisplayRow
  saving: boolean
  onSelect: () => void
}) {
  const distanceLabel =
    vendor.distanceMiles != null
      ? `${vendor.distanceMiles.toFixed(1)} mi · ${vendor.address ?? ''}`
      : vendor.address

  return (
    <div className="border-b border-[#e5e7eb] py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">{vendor.name}</p>
            <SourceBadge source={vendor.primarySource} />
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <StarRating rating={vendor.rating} />
            <span className="text-[11px] font-semibold text-[#0a0a0a]">
              {vendor.rating != null ? vendor.rating.toFixed(1) : '—'}
            </span>
            <span className="text-[11px] text-[#717182]">
              ({vendor.reviewCount != null ? vendor.reviewCount : '—'} reviews)
            </span>
          </div>

          {distanceLabel ? (
            <div className="mt-1.5 flex items-center gap-1">
              <MapPinIcon />
              <p className="text-[11px] leading-[16.5px] text-[#717182]">{distanceLabel}</p>
            </div>
          ) : null}

          {vendor.phone || vendor.website ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-3">
              {vendor.phone ? (
                <div className="flex items-center gap-1">
                  <PhoneIcon />
                  <span className="text-[11px] text-[#717182]">{vendor.phone}</span>
                </div>
              ) : null}
              {vendor.website ? (
                <div className="flex items-center gap-1">
                  <GlobeIcon />
                  <span className="text-[11px] text-[#717182]">{vendor.website}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {vendor.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {vendor.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-[#f3f4f6] px-1.5 py-0.5 text-[10px] leading-[15px] text-[#717182]"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={onSelect}
          className="inline-flex shrink-0 items-center gap-1 rounded-[10px] bg-[#0a0a0a] px-3 py-1.5 text-[12px] font-semibold leading-4 text-white outline-none transition-colors hover:bg-[#1f2937] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
        >
          <UserPlusIcon />
          Select
        </button>
      </div>
    </div>
  )
}

export type FindExternalVendorRailProps = {
  open: boolean
  onClose: () => void
  onSelect: (suggestion: ExternalVendorSuggestionDto) => void | Promise<void>
  locationLabel: string
  issueCategory?: string | null
  suggestions: ExternalVendorSuggestionDto[]
  providersUsed?: string[]
  loading?: boolean
  error?: string | null
  notice?: string | null
  saving?: boolean
  saveError?: string | null
}

/** Figma 835:1519 — Find External Vendor, overview right rail. */
export function FindExternalVendorRail({
  open,
  onClose,
  onSelect,
  locationLabel,
  issueCategory = null,
  suggestions,
  providersUsed,
  loading = false,
  error = null,
  notice = null,
  saving = false,
  saveError = null,
}: FindExternalVendorRailProps) {
  const titleId = useId()
  const displayRows = enrichExternalVendorSuggestions(suggestions, issueCategory)
  const searchQuery = buildExternalSearchQueryLabel(issueCategory, locationLabel)
  const providerChip = formatExternalProviderChip(providersUsed)
  const resultCount = displayRows.length

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
    <div className="fixed inset-0 z-[55] flex justify-end">
      <div
        role="presentation"
        className="absolute inset-0 bg-black/40"
        aria-hidden
        onClick={() => {
          if (!saving) onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full max-h-dvh w-full max-w-[min(100vw,520px)] flex-col overflow-hidden rounded-l-[12px] border border-[#e5e7eb] bg-white shadow-[0px_8px_24px_rgba(0,0,0,0.12)]"
      >
        <button
          type="button"
          onClick={() => {
            if (!saving) onClose()
          }}
          disabled={saving}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
        >
          <CloseIcon />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <header className="border-b border-[#e5e7eb] px-6 pb-5 pt-6 pr-12">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded bg-[#fb2c36] px-1.5 py-0.5 text-[10px] font-bold leading-[15px] text-white">
                URGENT
              </span>
              <span className="text-[11px] leading-[16.5px] text-[#717182]">
                SLA breach · No roster backup
              </span>
            </div>
            <h2 id={titleId} className="mt-2 text-[18px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]">
              Find External Vendor
            </h2>
            <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">{locationLabel}</p>
          </header>

          <div className="border-b border-[#e5e7eb] bg-[#f9fafb] px-6 py-4">
            <div className="flex items-center gap-2 rounded-[10px] border border-black/10 bg-white px-[13px] py-[9px]">
              <SearchIcon />
              <p className="min-w-0 flex-1 truncate text-[12px] leading-4 text-[#0a0a0a]">{searchQuery}</p>
              <span className="shrink-0 rounded bg-[#eff6ff] px-1.5 py-0.5 text-[10px] font-semibold leading-[15px] text-[#155dfc]">
                {providerChip}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-[15px] text-[#717182]">
              {loading
                ? 'Searching…'
                : `${resultCount} business${resultCount === 1 ? '' : 'es'} found · not on your roster`}
            </p>
            {notice && !loading ? (
              <p className="mt-1 text-[11px] leading-[15px] text-[#717182]" role="status">
                {notice}
              </p>
            ) : null}
          </div>

          <div className="px-6">
            {loading ? (
              <p className="py-6 text-[13px] leading-5 text-[#6a7282]">Searching external vendors…</p>
            ) : null}

            {error ? (
              <p className="py-4 text-[13px] leading-5 text-error" role="alert">
                {error}
              </p>
            ) : null}

            {!loading && !error && displayRows.length === 0 ? (
              <p className="py-6 text-[13px] leading-5 text-[#6a7282]">
                No outside-network results yet. Configure external vendor search secrets on Supabase Edge.
              </p>
            ) : null}

            {!loading && !error && displayRows.length > 0 ? (
              <div>
                {displayRows.map((vendor) => (
                  <VendorResultRow
                    key={`${vendor.name}-${vendor.primarySource}`}
                    vendor={vendor}
                    saving={saving}
                    onSelect={() => {
                      void onSelect(vendor)
                    }}
                  />
                ))}
              </div>
            ) : null}

            {saveError ? (
              <p className="pb-4 text-[13px] leading-4 text-error" role="alert">
                {saveError}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex shrink-0 justify-end border-t border-[#e5e7eb] px-6 py-4">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2 text-[13px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  )
}

export default FindExternalVendorRail
