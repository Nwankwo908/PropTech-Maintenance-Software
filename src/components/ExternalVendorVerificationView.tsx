import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PhoneTelLink } from '@/components/CallPhoneButton'
import { profileFromSessionUser } from '@/constants/sidebarAdminProfile'
import type { ExternalVendorDisplayRow } from '@/lib/externalVendorDisplay'
import {
  buildExternalVendorVerificationProfile,
  computeVerificationMetrics,
  mergeVerificationChecklist,
} from '@/lib/externalVendorVerification'
import { supabase } from '@/lib/supabase'
import {
  coiStateFromLookup,
  initialCoiVerificationState,
  isCoiVerificationComplete,
  lookupVendorCoi,
  type VendorCoiVerificationState,
} from '@/lib/vendorCoiVerification'
import {
  initialLicenseVerificationState,
  isLicenseVerificationComplete,
  licenseRequiresManualVerify,
  licenseStateFromLookup,
  lookupVendorLicense,
  manualLicenseVerification,
  verifyManualLicenseNumber,
  type VendorLicenseVerificationState,
} from '@/lib/vendorLicenseVerification'

function ChevronLeftIcon() {
  return (
    <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ShieldCheckIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#007a55]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StarRating({ rating }: { rating: number | null }) {
  const value = rating ?? 0
  return (
    <div className="flex items-center gap-0.5">
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

function VerifiedPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#a4f4cf] bg-[#ecfdf5] px-2 py-0.5 text-[10px] font-semibold leading-[15px] text-[#007a55]">
      <CheckIcon className="size-2.5 text-[#007a55]" />
      Verified
    </span>
  )
}

function PendingPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#fde68a] bg-[#fffbeb] px-2 py-0.5 text-[10px] font-semibold leading-[15px] text-[#a16207]">
      Pending
    </span>
  )
}

function ReadinessGauge({ percent }: { percent: number }) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference

  return (
    <div className="relative mx-auto size-[120px]">
      <svg className="size-full -rotate-90" viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={radius * (100 / 120)} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={radius * (100 / 120)}
          fill="none"
          stroke="#00bc7d"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference * (100 / 120)}
          strokeDashoffset={offset * (100 / 120)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[22px] font-bold leading-none text-[#0a0a0a]">{percent}%</span>
      </div>
    </div>
  )
}

function SimulatedBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full bg-[#f3f4f6] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#6a7282]"
      title="Demo data — not a live external check"
    >
      Simulated
    </span>
  )
}

function SectionCard({
  title,
  badge,
  children,
}: {
  title: string
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-black/10 px-4 py-3.5">
        <h3 className="text-[14px] font-bold leading-5 text-[#0a0a0a]">{title}</h3>
        {badge ?? null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function SecondaryActionButton({
  label,
  onClick,
  destructive = false,
}: {
  label: string
  onClick?: () => void
  destructive?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-[10px] border border-[#e5e7eb] px-4 py-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 ${
        destructive
          ? 'text-[#fb2c36] hover:bg-[#fef2f2]'
          : 'text-[#0a0a0a] hover:bg-[#f9fafb]'
      }`}
    >
      {label}
    </button>
  )
}

function useAdminApproverName(): string {
  const [name, setName] = useState('Admin')

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      const user = data.session?.user
      const meta = user?.user_metadata as { full_name?: string; name?: string } | undefined
      const profile = profileFromSessionUser(user?.email, meta?.full_name ?? meta?.name)
      if (profile?.name) setName(profile.name)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return name
}

export type ExternalVendorVerificationViewProps = {
  vendor: ExternalVendorDisplayRow
  locationLabel: string
  issueCategory?: string | null
  saving?: boolean
  saveError?: string | null
  onBack: () => void
  onAssign: () => void
  onReject: () => void
}

/** Figma 839:1718 — Vendor verification before external assign. */
export function ExternalVendorVerificationView({
  vendor,
  locationLabel,
  issueCategory = null,
  saving = false,
  saveError = null,
  onBack,
  onAssign,
  onReject,
}: ExternalVendorVerificationViewProps) {
  const approverName = useAdminApproverName()
  const [licenseState, setLicenseState] = useState<VendorLicenseVerificationState>(
    initialLicenseVerificationState,
  )
  const [coiState, setCoiState] = useState<VendorCoiVerificationState>(initialCoiVerificationState)
  const [manualLicenseInput, setManualLicenseInput] = useState('')
  const [licenseVerifyError, setLicenseVerifyError] = useState<string | null>(null)
  const [licenseVerifying, setLicenseVerifying] = useState(false)

  const profile = useMemo(
    () => buildExternalVendorVerificationProfile(vendor, { issueCategory, locationLabel }),
    [vendor, issueCategory, locationLabel],
  )

  const checklist = useMemo(
    () => mergeVerificationChecklist(profile.checklist, licenseState, coiState),
    [profile.checklist, licenseState, coiState],
  )

  const metrics = useMemo(
    () => computeVerificationMetrics(profile.checklist, licenseState, coiState),
    [profile.checklist, licenseState, coiState],
  )

  const licenseVerified = isLicenseVerificationComplete(licenseState)
  const coiVerified = isCoiVerificationComplete(coiState)
  const assignBlocked =
    !licenseVerified ||
    licenseState.status === 'checking' ||
    !coiVerified ||
    coiState.status === 'checking'

  useEffect(() => {
    let cancelled = false
    setLicenseState(initialLicenseVerificationState())
    setCoiState(initialCoiVerificationState())
    setManualLicenseInput('')
    setLicenseVerifyError(null)
    setLicenseVerifying(false)

    void lookupVendorLicense(vendor, profile.tradeLabel).then((result) => {
      if (cancelled) return
      setLicenseState(licenseStateFromLookup(result))
    })

    void lookupVendorCoi(vendor).then((result) => {
      if (cancelled) return
      setCoiState(coiStateFromLookup(result))
    })

    return () => {
      cancelled = true
    }
  }, [vendor, profile.tradeLabel])

  async function handleVerifyLicense() {
    setLicenseVerifyError(null)
    setLicenseVerifying(true)
    try {
      const result = await verifyManualLicenseNumber(vendor, manualLicenseInput)
      if (!result.ok) {
        setLicenseVerifyError(result.message)
        return
      }
      setLicenseState((current) =>
        manualLicenseVerification(current, manualLicenseInput.trim(), approverName),
      )
      setManualLicenseInput('')
    } finally {
      setLicenseVerifying(false)
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="border-b border-[#e5e7eb] px-6 pb-4 pt-6 pr-12">
        <button
          type="button"
          disabled={saving}
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[12px] font-medium text-[#717182] outline-none hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
        >
          <ChevronLeftIcon />
          Back to search
        </button>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[18px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]">
            {profile.vendorName}
          </h2>
          <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-4 ${
              metrics.completionPercent >= 100
                ? 'bg-[#ecfdf5] text-[#007a55]'
                : 'bg-[#fffbeb] text-[#a16207]'
            }`}
          >
            {metrics.readinessLabel}
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">Vendor verification</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#a4f4cf] bg-[#fafffd] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[16px] font-bold leading-6 text-[#0a0a0a]">{profile.vendorName}</p>
                  <span className="mt-1 inline-flex rounded bg-[#f3f4f6] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#717182]">
                    {profile.tradeLabel}
                  </span>
                </div>
                {licenseVerified ? <VerifiedPill /> : <PendingPill />}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StarRating rating={profile.rating} />
                <span className="text-[11px] font-semibold text-[#0a0a0a]">
                  {profile.rating != null ? profile.rating.toFixed(1) : '—'}
                </span>
                <span className="text-[11px] text-[#717182]">
                  ({profile.reviewCount != null ? profile.reviewCount : '—'} reviews)
                </span>
              </div>

              <div className="mt-3 grid gap-1 text-[11px] leading-[16.5px] text-[#717182] sm:grid-cols-2">
                {profile.distanceLabel ? <p>{profile.distanceLabel}</p> : null}
                {profile.etaLabel ? <p>{profile.etaLabel}</p> : null}
                {profile.phone ? (
                  <PhoneTelLink phone={profile.phone}>
                    {profile.phone}
                  </PhoneTelLink>
                ) : null}
                {profile.website ? <p>{profile.website}</p> : null}
                {profile.yearsInBusiness != null ? (
                  <p>{profile.yearsInBusiness} years in business</p>
                ) : null}
              </div>
            </div>

            <SectionCard title="Verification Checklist" badge={<SimulatedBadge />}>
              <p className="mb-3 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[10px] leading-[15px] text-[#92400e]">
                Demo only: license and insurance results are simulated, not live checks against the
                state licensing board or insurance carrier.
              </p>
              <ul className="space-y-3">
                {checklist.map((item) => (
                  <li
                    key={item.id}
                    className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                      item.id === 'license' && licenseRequiresManualVerify(licenseState)
                        ? 'border-[#fde68a] bg-[#fffbeb]'
                        : 'border-[#a4f4cf] bg-[#fafffd]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12px] font-semibold text-[#0a0a0a]">{item.title}</p>
                        {item.required ? (
                          <span className="text-[9px] font-bold uppercase tracking-wide text-[#fb2c36]">
                            Required
                          </span>
                        ) : null}
                        {item.id === 'license' || item.id === 'coi' ? <SimulatedBadge /> : null}
                      </div>
                      <p className="mt-0.5 text-[10px] leading-[15px] text-[#717182]">
                        {item.id === 'license' && licenseState.status === 'checking' ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 animate-pulse rounded-full bg-[#155dfc]" aria-hidden />
                            {licenseState.detail}
                          </span>
                        ) : item.id === 'coi' && coiState.status === 'checking' ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 animate-pulse rounded-full bg-[#155dfc]" aria-hidden />
                            {coiState.detail}
                          </span>
                        ) : (
                          <>
                            {item.detail}
                            {item.id === 'coi' && coiState.monitoringActive ? (
                              <span className="mt-0.5 block text-[#6a7282]">
                                Certificial continuous monitoring enrolled
                                {coiState.expirationDate
                                  ? ` · Exp ${coiState.expirationDate}`
                                  : ''}
                              </span>
                            ) : null}
                          </>
                        )}
                      </p>
                      {item.id === 'license' && licenseRequiresManualVerify(licenseState) ? (
                        <div className="mt-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={manualLicenseInput}
                              onChange={(event) => setManualLicenseInput(event.target.value)}
                              placeholder="Enter license number"
                              className="min-h-[36px] min-w-0 flex-1 rounded-[10px] border border-[#d1d5dc] bg-white px-3 py-2 text-[12px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20"
                            />
                            <button
                              type="button"
                              disabled={licenseVerifying || !manualLicenseInput.trim()}
                              onClick={() => void handleVerifyLicense()}
                              className="inline-flex min-h-[36px] shrink-0 items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-2 text-[12px] font-semibold text-[#101828] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] disabled:pointer-events-none disabled:opacity-50"
                            >
                              {licenseVerifying ? 'Checking…' : 'Verify License'}
                            </button>
                          </div>
                          {licenseVerifyError ? (
                            <p className="mt-1.5 text-[10px] leading-[14px] text-[#fb2c36]" role="alert">
                              {licenseVerifyError}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {item.verified ? (
                      <VerifiedPill />
                    ) : item.id === 'license' && licenseState.status === 'checking' ? (
                      <PendingPill />
                    ) : item.id === 'coi' && coiState.status === 'checking' ? (
                      <PendingPill />
                    ) : null}
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          <div className="space-y-4">
            <SectionCard title="Assignment Readiness">
              <div className="flex flex-col items-center py-2">
                <ReadinessGauge percent={metrics.completionPercent} />
                <p className="mt-3 text-[12px] font-semibold text-[#0a0a0a]">Verification Score</p>
                <p
                  className={`mt-0.5 text-[11px] ${
                    metrics.completionPercent >= 100 ? 'text-[#007a55]' : 'text-[#a16207]'
                  }`}
                >
                  {metrics.verificationScoreLabel}
                </p>
              </div>
            </SectionCard>

            <SectionCard title="Pricing vs Market">
              <div className="space-y-3">
                {profile.pricingRows.map((row) => (
                  <div key={row.label}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11px] text-[#717182]">{row.label}</span>
                      <span className="text-[11px] font-semibold text-[#0a0a0a]">{row.vendorPrice}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-[15px] text-[#717182]">{row.marketAverage}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      <div className="shrink-0 px-6 pb-5 pt-3">
        {assignBlocked && !saving ? (
          <p className="mb-3 text-[12px] leading-[18px] text-[#a16207]">
            {licenseState.status === 'checking'
              ? 'Waiting for state licensing API (simulated)…'
              : coiState.status === 'checking'
                ? 'Waiting for Certificial COI verification (simulated)…'
                : !licenseVerified
                  ? 'License verification is required before assigning this vendor.'
                  : !coiVerified
                    ? 'Active COI verification is required before assigning this vendor.'
                    : 'Complete vendor verification before assigning.'}
          </p>
        ) : null}
        <div className="space-y-3">
          <button
            type="button"
            disabled={saving || assignBlocked}
            onClick={onAssign}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] bg-[#0a4d38] px-4 py-2.5 text-[13px] font-medium text-white outline-none transition-colors hover:bg-[#083828] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
          >
            <ShieldCheckIcon />
            {saving ? 'Assigning…' : 'Assign Vendor'}
          </button>

          <SecondaryActionButton label="Reject Vendor" destructive onClick={onReject} />
        </div>

        {saveError ? (
          <p className="mt-3 text-[13px] leading-4 text-error" role="alert">
            {saveError}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default ExternalVendorVerificationView
