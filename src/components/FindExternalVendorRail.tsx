import { useEffect, useId, useState } from 'react'
import type { ExternalVendorSuggestionDto } from '@/api/discoverExternalVendors'
import { ExternalVendorVerificationView } from '@/components/ExternalVendorVerificationView'
import {
  ADMIN_RAIL_FOOTER_CLASS,
  ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS,
  ADMIN_RIGHT_RAIL_STACK_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
  type AdminRightRailStackedPosition,
} from '@/lib/adminRightRail'
import {
  buildExternalSearchQueryLabel,
  enrichExternalVendorSuggestions,
  type ExternalVendorDisplayRow,
} from '@/lib/externalVendorDisplay'
import { PhoneTelLink } from '@/components/CallPhoneButton'
import { InviteVendorModal, type InviteVendorPrefill } from '@/components/InviteVendorModal'

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

function VendorResultRow({
  vendor,
  saving,
  selected,
  enterDelayMs,
  onSelect,
  onInvite,
}: {
  vendor: ExternalVendorDisplayRow
  saving: boolean
  /** Outreach sent; vendor has not submitted the setup form yet. */
  selected?: boolean
  enterDelayMs?: number
  onSelect: () => void
  onInvite: () => void
}) {
  const distanceLabel =
    vendor.distanceMiles != null
      ? `${vendor.distanceMiles.toFixed(1)} mi · ${vendor.address ?? ''}`
      : vendor.address

  return (
    <div
      style={enterDelayMs != null ? { animationDelay: `${enterDelayMs}ms` } : undefined}
      className="sa-enter border-b border-[#e5e7eb] py-4 last:border-b-0"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">{vendor.name}</p>

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
            'sa-press inline-flex min-h-[36px] shrink-0 items-center justify-center gap-1 rounded-[10px] px-3 py-2 text-[12px] font-semibold leading-4 outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60',
            selected
              ? 'border border-[#e5e7eb] bg-white text-[#101828] hover:bg-[#f9fafb]'
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
        <button
          type="button"
          disabled={saving}
          onClick={onInvite}
          className="sa-press inline-flex min-h-[36px] shrink-0 items-center justify-center gap-1 rounded-[10px] border border-[#186179] px-3 py-2 text-[12px] font-semibold leading-4 text-[#186179] outline-none hover:bg-[#186179]/5 focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
        >
          Invite to verify
        </button>
        </div>
      </div>
    </div>
  )
}

export type FindExternalVendorRailProps = {
  open: boolean
  onClose: () => void
  onSelect: (
    suggestion: ExternalVendorSuggestionDto,
    compliance?: import('@/components/ExternalVendorVerificationView').ExternalVendorComplianceSnapshot,
  ) => void | Promise<void>
  locationLabel: string
  /** City, State ZIP under the title — no street address. */
  areaLabel?: string | null
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
  areaLabel = null,
  issueCategory = null,
  suggestions,
  loading = false,
  error = null,
  notice = null,
  saving = false,
  saveError = null,
  cancelLabel = 'Cancel',
  onBack,
  panelOnly = false,
  stackedPosition,
}: FindExternalVendorRailProps) {
  const titleId = useId()
  const [verificationVendor, setVerificationVendor] = useState<ExternalVendorDisplayRow | null>(null)
  const [invitePrefill, setInvitePrefill] = useState<InviteVendorPrefill | null>(null)
  const displayRows = enrichExternalVendorSuggestions(
    suggestions,
    issueCategory,
    locationLabel,
  )
  const searchQuery = buildExternalSearchQueryLabel(issueCategory, areaLabel ?? '')
  const resultCount = displayRows.length
  const verificationStep = verificationVendor != null
  const handleBack = onBack ?? onClose
  const handleDismiss = panelOnly && onBack ? onBack : onClose
  const showBackNav = !panelOnly

  useEffect(() => {
    if (open) return
    setVerificationVendor(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || saving) return
      if (verificationVendor) {
        setVerificationVendor(null)
        return
      }
      handleDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleDismiss, saving, verificationVendor])

  function handleRailDismiss() {
    if (saving) return
    if (verificationVendor) {
      setVerificationVendor(null)
      return
    }
    handleDismiss()
  }

  if (!open) return null

  const panelWidthClass = verificationStep
    ? 'max-w-[min(100vw,960px)]'
    : 'max-w-[min(100vw,520px)]'

  const panel = (
      <div
        role="dialog"
        aria-modal={panelOnly ? undefined : true}
        aria-labelledby={titleId}
        className={adminRightRailPanelClass(stackedPosition, panelWidthClass)}
      >
        <button
          type="button"
          onClick={handleRailDismiss}
          disabled={saving}
          aria-label="Close"
          className="sa-press absolute right-4 top-4 z-10 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
        >
          <CloseIcon />
        </button>

        {verificationVendor ? (
          <ExternalVendorVerificationView
            vendor={verificationVendor}
            locationLabel={locationLabel}
            issueCategory={issueCategory}
            saving={saving}
            saveError={saveError}
            onBack={() => setVerificationVendor(null)}
            onAssign={(compliance) => {
              void onSelect(verificationVendor, compliance)
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
                className="sa-link inline-flex items-center gap-1 text-[12px] font-medium text-[#717182] outline-none hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                <ChevronLeftIcon />
                {cancelLabel}
              </button>
            ) : null}
            <h2 id={titleId} className={`${showBackNav ? 'mt-3' : ''} text-[18px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]`}>
              Find External Vendor
            </h2>
            {areaLabel ? (
              <p className="mt-1 text-[12px] leading-[18px] text-[#9ca3af]">{areaLabel}</p>
            ) : null}
          </header>

          <div className="border-b border-[#e5e7eb] bg-[#f9fafb] px-6 py-4">
            <div className="flex items-center gap-2 rounded-[10px] border border-black/10 bg-white px-[13px] py-[9px]">
              <SearchIcon />
              <p className="min-w-0 flex-1 truncate text-[12px] leading-4 text-[#0a0a0a]">{searchQuery}</p>
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
                No outside-network vendors found nearby for this trade. Check that live vendor
                search is configured, or invite a vendor from the roster.
              </p>
            ) : null}

            {!loading && !error && displayRows.length > 0 ? (
              <div>
                {displayRows.map((vendor, index) => {
                  const rowKey = `${vendor.name}-${vendor.primarySource}`
                  return (
                    <VendorResultRow
                      key={rowKey}
                      vendor={vendor}
                      saving={saving}
                      enterDelayMs={Math.min(index, 8) * 40}
                      onSelect={() => setVerificationVendor(vendor)}
                      onInvite={() =>
                        setInvitePrefill({
                          businessName: vendor.name,
                          phone: vendor.phone ?? '',
                          propertyName: locationLabel,
                        })
                      }
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
          <footer className={ADMIN_RAIL_FOOTER_CLASS}>
            <button
              type="button"
              disabled={saving}
              onClick={handleBack}
              className={ADMIN_RAIL_FOOTER_SECONDARY_BUTTON_CLASS}
            >
              {cancelLabel}
            </button>
          </footer>
        ) : null}
        </>
        )}
      </div>
  )

  const inviteModal = (
    <InviteVendorModal
      open={invitePrefill != null}
      prefill={invitePrefill ?? undefined}
      onClose={() => setInvitePrefill(null)}
    />
  )

  if (panelOnly) {
    return (
      <>
        {panel}
        {inviteModal}
      </>
    )
  }

  return (
    <div className={ADMIN_RIGHT_RAIL_STACK_HOST}>
      <div
        role="presentation"
        className={ADMIN_RIGHT_RAIL_SCRIM}
        aria-hidden
        onClick={handleRailDismiss}
      />
      {panel}
      {inviteModal}
    </div>
  )
}

export default FindExternalVendorRail
