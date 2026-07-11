import { useEffect, useId, useMemo, useState } from 'react'
import type { ExternalVendorSuggestionDto } from '@/api/discoverExternalVendors'
import { ExternalVendorVerificationView } from '@/components/ExternalVendorVerificationView'
import {
  ADMIN_RIGHT_RAIL_STACK_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
  type AdminRightRailStackedPosition,
} from '@/lib/adminRightRail'
import {
  buildExternalSearchQueryLabel,
  enrichExternalVendorSuggestions,
  formatExternalProviderChip,
  formatSourceBadgeLabel,
  type ExternalVendorDisplayRow,
} from '@/lib/externalVendorDisplay'
import {
  buildVendorSetupContextFromExternalVendor,
  isVendorSetupAwaitingResponse,
} from '@/lib/vendorSetupConversation'
import { CallPhoneButton, PhoneTelLink } from '@/components/CallPhoneButton'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
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

function CheckIcon() {
  return (
    <svg className="size-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
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

function RatingTierBadge({ tier }: { tier: ExternalVendorDisplayRow['ratingTier'] }) {
  const className =
    tier.tone === 'excellent'
      ? 'bg-[#ecfdf5] text-[#047857]'
      : tier.tone === 'strong'
        ? 'bg-[#eff6ff] text-[#1d4ed8]'
        : tier.tone === 'good'
          ? 'bg-[#f0fdf4] text-[#15803d]'
          : tier.tone === 'acceptable'
            ? 'bg-[#fefce8] text-[#a16207]'
            : 'bg-[#fef2f2] text-[#b91c1c]'

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold leading-[15px] ${className}`}>
      {tier.recommendationBadge}
    </span>
  )
}

function ConfidenceBadge({ tier }: { tier: ExternalVendorDisplayRow['confidenceTier'] }) {
  const className =
    tier.tone === 'very-high'
      ? 'bg-[#f3f4f6] text-[#111827]'
      : tier.tone === 'high'
        ? 'bg-[#f3f4f6] text-[#374151]'
        : tier.tone === 'moderate'
          ? 'bg-[#f9fafb] text-[#4b5563]'
          : tier.tone === 'limited'
            ? 'bg-[#fff7ed] text-[#c2410c]'
            : 'bg-[#fef2f2] text-[#991b1b]'

  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-medium leading-[13.5px] ${className}`}>
      {tier.label}
    </span>
  )
}

function DistanceTierBadge({ tier }: { tier: ExternalVendorDisplayRow['distanceTier'] }) {
  if (!tier) return null
  const className =
    tier.tone === 'local' || tier.tone === 'nearby'
      ? 'text-[#047857]'
      : tier.tone === 'extended'
        ? 'text-[#a16207]'
        : tier.tone === 'long'
          ? 'text-[#c2410c]'
          : 'text-[#b91c1c]'

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium leading-[15px] ${className}`}>
      <span aria-hidden>{tier.dot}</span>
      <span>
        {tier.tierLabel} · {tier.recommendation}
      </span>
    </span>
  )
}

function VendorResultRow({
  vendor,
  saving,
  selected,
  onSelect,
}: {
  vendor: ExternalVendorDisplayRow
  saving: boolean
  /** Outreach sent; vendor has not submitted the setup form yet. */
  selected?: boolean
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

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <RatingTierBadge tier={vendor.ratingTier} />
            <ConfidenceBadge tier={vendor.confidenceTier} />
          </div>
          <p className="mt-1 text-[10px] text-[#717182]">
            Rating quality: {vendor.ratingTier.qualityLabel}
          </p>

          {distanceLabel ? (
            <div className="mt-1.5 flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <MapPinIcon />
                <p className="text-[11px] leading-[16.5px] text-[#717182]">{distanceLabel}</p>
              </div>
              <DistanceTierBadge tier={vendor.distanceTier} />
            </div>
          ) : vendor.distanceTier ? (
            <div className="mt-1.5">
              <DistanceTierBadge tier={vendor.distanceTier} />
            </div>
          ) : null}

          {vendor.phone || vendor.website ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-3">
              {vendor.phone ? (
                <div className="flex items-center gap-1">
                  <PhoneIcon />
                  <PhoneTelLink phone={vendor.phone} className="text-[11px] text-[#717182]">
                    {vendor.phone}
                  </PhoneTelLink>
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

        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
        <button
          type="button"
          disabled={saving}
          onClick={onSelect}
          aria-pressed={selected}
          className={[
            'inline-flex min-h-[36px] shrink-0 items-center justify-center gap-1 rounded-[10px] px-3 py-2 text-[12px] font-semibold leading-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60',
            selected
              ? 'border border-[#101828] bg-white text-[#101828] hover:bg-[#f9fafb]'
              : 'bg-[#0a4d38] text-white hover:bg-[#083828]',
          ].join(' ')}
        >
          {selected ? (
            <>
              <CheckIcon />
              Selected
            </>
          ) : (
            <>
              <UserPlusIcon />
              Select
            </>
          )}
        </button>
        {vendor.phone ? (
          <CallPhoneButton phone={vendor.phone} label="Call" variant="outline" className="w-full" />
        ) : null}
        </div>
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
  /** Footer dismiss label (default Cancel). */
  cancelLabel?: string
  /** When set, header/footer back uses this instead of fully closing via `onClose`. */
  onBack?: () => void
  workOrderRef?: string | null
  residentName?: string | null
  /** Render only the panel (parent owns overlay, backdrop, and stacking). */
  panelOnly?: boolean
  /** When stacked beside another rail, drop outer rounding on the seam side. */
  stackedPosition?: AdminRightRailStackedPosition
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
  cancelLabel = 'Cancel',
  onBack,
  workOrderRef = null,
  residentName = null,
  panelOnly = false,
  stackedPosition,
}: FindExternalVendorRailProps) {
  const titleId = useId()
  const [verificationVendor, setVerificationVendor] = useState<ExternalVendorDisplayRow | null>(null)
  const [setupMonitoringOpen, setSetupMonitoringOpen] = useState(false)
  const [awaitingRefreshKey, setAwaitingRefreshKey] = useState(0)
  const displayRows = enrichExternalVendorSuggestions(
    suggestions,
    issueCategory,
    locationLabel,
  )
  const searchQuery = buildExternalSearchQueryLabel(issueCategory, locationLabel)
  const providerChip = formatExternalProviderChip(providersUsed)
  const resultCount = displayRows.length
  const verificationStep = verificationVendor != null
  const handleBack = onBack ?? onClose
  const handleDismiss = panelOnly && onBack ? onBack : onClose
  const showBackNav = !panelOnly

  const awaitingVendorKeys = useMemo(() => {
    void awaitingRefreshKey
    const keys = new Set<string>()
    for (const vendor of displayRows) {
      const setupContext = buildVendorSetupContextFromExternalVendor({
        vendorName: vendor.name,
        vendorPhone: vendor.phone,
        vendorWebsite: vendor.website,
        locationLabel,
        issueCategory,
      })
      if (isVendorSetupAwaitingResponse(setupContext)) {
        keys.add(`${vendor.name}-${vendor.primarySource}`)
      }
    }
    return keys
  }, [awaitingRefreshKey, displayRows, issueCategory, locationLabel])

  useEffect(() => {
    if (open) return
    setVerificationVendor(null)
    setSetupMonitoringOpen(false)
  }, [open])

  useEffect(() => {
    setSetupMonitoringOpen(false)
  }, [verificationVendor])

  useEffect(() => {
    if (!open || verificationVendor != null) return
    setAwaitingRefreshKey((key) => key + 1)
    const interval = window.setInterval(() => {
      setAwaitingRefreshKey((key) => key + 1)
    }, 1500)
    return () => window.clearInterval(interval)
  }, [open, verificationVendor])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || saving) return
      if (setupMonitoringOpen) {
        setSetupMonitoringOpen(false)
        return
      }
      if (verificationVendor) {
        setVerificationVendor(null)
        return
      }
      handleDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleDismiss, saving, setupMonitoringOpen, verificationVendor])

  function handleRailDismiss() {
    if (saving) return
    if (setupMonitoringOpen) {
      setSetupMonitoringOpen(false)
      return
    }
    if (verificationVendor) {
      setVerificationVendor(null)
      return
    }
    handleDismiss()
  }

  if (!open) return null

  const panelWidthClass = setupMonitoringOpen
    ? 'max-w-[min(100vw,560px)]'
    : verificationStep
      ? 'max-w-[min(100vw,960px)]'
      : 'max-w-[min(100vw,520px)]'

  const panel = (
      <div
        role="dialog"
        aria-modal={panelOnly ? undefined : true}
        aria-labelledby={titleId}
        className={adminRightRailPanelClass(stackedPosition, panelWidthClass)}
      >
        {!setupMonitoringOpen ? (
        <button
          type="button"
          onClick={handleRailDismiss}
          disabled={saving}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
        >
          <CloseIcon />
        </button>
        ) : null}

        {verificationVendor ? (
          <ExternalVendorVerificationView
            vendor={verificationVendor}
            locationLabel={locationLabel}
            issueCategory={issueCategory}
            workOrderRef={workOrderRef}
            residentName={residentName}
            saving={saving}
            saveError={saveError}
            setupMonitoringOpen={setupMonitoringOpen}
            onSetupMonitoringOpen={() => setSetupMonitoringOpen(true)}
            onSetupMonitoringClose={() => setSetupMonitoringOpen(false)}
            onBack={() => setVerificationVendor(null)}
            onAssign={() => {
              void onSelect(verificationVendor)
            }}
            onReject={() => {
              setVerificationVendor(null)
            }}
          />
        ) : (
        <>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <header className="border-b border-[#e5e7eb] px-6 pb-5 pt-6 pr-12">
            {showBackNav ? (
              <button
                type="button"
                disabled={saving}
                onClick={handleBack}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-[#717182] outline-none hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <ChevronLeftIcon />
                {cancelLabel}
              </button>
            ) : null}
            <div className={`flex flex-wrap items-center gap-2 ${showBackNav ? 'mt-3' : ''}`}>
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
                {displayRows.map((vendor) => {
                  const rowKey = `${vendor.name}-${vendor.primarySource}`
                  return (
                    <VendorResultRow
                      key={rowKey}
                      vendor={vendor}
                      saving={saving}
                      selected={awaitingVendorKeys.has(rowKey)}
                      onSelect={() => setVerificationVendor(vendor)}
                    />
                  )
                })}
              </div>
            ) : null}

            {saveError ? (
              <p className="pb-4 text-[13px] leading-4 text-error" role="alert">
                {saveError}
              </p>
            ) : null}
          </div>
        </div>

        {showBackNav ? (
          <footer className="flex shrink-0 justify-end border-t border-[#e5e7eb] px-6 py-4">
            <button
              type="button"
              disabled={saving}
              onClick={handleBack}
              className="inline-flex min-h-[44px] items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[13px] font-medium text-[#364153] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          </footer>
        ) : null}
        </>
        )}
      </div>
  )

  if (panelOnly) return panel

  return (
    <div className={ADMIN_RIGHT_RAIL_STACK_HOST}>
      <div
        role="presentation"
        className={ADMIN_RIGHT_RAIL_SCRIM}
        aria-hidden
        onClick={handleRailDismiss}
      />
      {panel}
    </div>
  )
}

export default FindExternalVendorRail
