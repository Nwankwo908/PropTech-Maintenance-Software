import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PhoneTelLink } from '@/components/CallPhoneButton'
import { ConversationMonitoringPanel } from '@/components/ConversationMonitoringModal'
import { VendorCallFlowModal } from '@/components/VendorCallFlowModal'
import { profileFromSessionUser } from '@/constants/sidebarAdminProfile'
import type { VendorCallContext } from '@/lib/vendorCallFlow'
import type { ExternalVendorDisplayRow } from '@/lib/externalVendorDisplay'
import {
  buildExternalVendorVerificationProfile,
  computeVerificationMetrics,
  mergeVerificationChecklist,
} from '@/lib/externalVendorVerification'
import { supabase } from '@/lib/supabase'
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
import {
  registerVendorSetupConversation,
  resolveVendorSetupConversationId,
  vendorEmailFromWebsite,
  type VendorSetupThreadContext,
} from '@/lib/vendorSetupConversation'
import { hasVendorIntakeSubmission, readVendorIntakeSubmission } from '@/lib/vendorIntakeForm'
import {
  isVendorPricingConfirmedByAdmin,
  markAdminPricingConfirmed,
  readVendorPricingConfirmation,
} from '@/lib/vendorPricingConfirmation'
import {
  initialVendorSetupVerificationState,
  markVendorSetupFormReceived,
  markVendorSetupRequestSent,
  resolveVendorSetupVerificationState,
  type VendorSetupVerificationState,
} from '@/lib/vendorSetupVerification'

function ChevronLeftIcon() {
  return (
    <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
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

function ViewMessageButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[36px] shrink-0 items-center justify-center rounded-[10px] border border-[#bfdbfe] bg-white px-3 py-2 text-[12px] font-medium text-[#155dfc] outline-none transition-colors hover:bg-[#eff6ff] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
    >
      View message
    </button>
  )
}

function ConfirmPricingButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-[36px] shrink-0 items-center justify-center rounded-[10px] border border-[#101828] bg-white px-3 py-2 text-[12px] font-semibold text-[#101828] outline-none transition-colors hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
    >
      Confirm pricing
    </button>
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

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 bg-white">
      <div className="border-b border-black/10 px-4 py-3.5">
        <h3 className="text-[14px] font-bold leading-5 text-[#0a0a0a]">{title}</h3>
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
      className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-[10px] border px-4 py-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 ${
        destructive
          ? 'border-[#ffc9c9] text-[#fb2c36] hover:bg-[#fef2f2]'
          : 'border-black/10 text-[#0a0a0a] hover:bg-[#f9fafb]'
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
  workOrderRef?: string | null
  residentName?: string | null
  saving?: boolean
  saveError?: string | null
  onBack: () => void
  onAssign: () => void
  onReject: () => void
  setupMonitoringOpen?: boolean
  onSetupMonitoringOpen?: () => void
  onSetupMonitoringClose?: () => void
}

/** Figma 839:1718 — Vendor verification before external assign. */
export function ExternalVendorVerificationView({
  vendor,
  locationLabel,
  issueCategory = null,
  workOrderRef = null,
  residentName = null,
  saving = false,
  saveError = null,
  onBack,
  onAssign,
  onReject,
  setupMonitoringOpen = false,
  onSetupMonitoringOpen,
  onSetupMonitoringClose,
}: ExternalVendorVerificationViewProps) {
  const approverName = useAdminApproverName()
  const [callFlowOpen, setCallFlowOpen] = useState(false)
  const [licenseState, setLicenseState] = useState<VendorLicenseVerificationState>(
    initialLicenseVerificationState,
  )
  const [localSetupState, setLocalSetupState] = useState<VendorSetupVerificationState>(
    initialVendorSetupVerificationState,
  )
  const [pricingSyncTick, setPricingSyncTick] = useState(0)
  const pricingSignatureRef = useRef('')
  const [manualLicenseInput, setManualLicenseInput] = useState('')
  const [licenseVerifyError, setLicenseVerifyError] = useState<string | null>(null)
  const [licenseVerifying, setLicenseVerifying] = useState(false)

  const profile = useMemo(
    () => buildExternalVendorVerificationProfile(vendor, { issueCategory, locationLabel }),
    [vendor, issueCategory, locationLabel],
  )

  const setupContext = useMemo<VendorSetupThreadContext>(
    () => ({
      vendorName: vendor.name,
      vendorPhone: vendor.phone,
      vendorEmail: vendorEmailFromWebsite(vendor.website),
      locationLabel,
      tradeLabel: profile.tradeLabel,
    }),
    [vendor.name, vendor.phone, vendor.website, locationLabel, profile.tradeLabel],
  )

  const setupConversationId = useMemo(
    () => resolveVendorSetupConversationId(setupContext),
    [setupContext],
  )

  const setupState = useMemo(
    () => resolveVendorSetupVerificationState(localSetupState, setupConversationId),
    [localSetupState, setupConversationId, pricingSyncTick],
  )

  const intakeSubmission = useMemo(
    () => readVendorIntakeSubmission(setupConversationId),
    [setupConversationId, pricingSyncTick],
  )

  const pricingRows = useMemo(() => {
    if (!intakeSubmission) return profile.pricingRows
    const serviceCall = intakeSubmission.pricing.serviceCallFee.trim()
    const hourly = intakeSubmission.pricing.hourlyRate.trim()
    return profile.pricingRows.map((row) => {
      if (row.label === 'Service call' && serviceCall) {
        const num = Number(serviceCall.replace(/[^\d.]/g, ''))
        const vendorPrice = Number.isFinite(num)
          ? `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : `$${serviceCall}`
        return { ...row, vendorPrice }
      }
      if (row.label === 'Hourly rate' && hourly) {
        const num = Number(hourly.replace(/[^\d.]/g, ''))
        const vendorPrice = Number.isFinite(num)
          ? `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}/hr`
          : `$${hourly}/hr`
        return { ...row, vendorPrice }
      }
      return row
    })
  }, [intakeSubmission, profile.pricingRows])

  const checklist = useMemo(
    () => mergeVerificationChecklist(profile.checklist, licenseState, setupState),
    [profile.checklist, licenseState, setupState],
  )

  const metrics = useMemo(
    () => computeVerificationMetrics(profile.checklist, licenseState, setupState),
    [profile.checklist, licenseState, setupState],
  )

  const callContext = useMemo<VendorCallContext>(
    () => ({
      workOrderRef,
      issueCategory,
      locationLabel,
      residentName,
    }),
    [workOrderRef, issueCategory, locationLabel, residentName],
  )

  const licenseVerified = isLicenseVerificationComplete(licenseState)
  const setupComplete = setupState.status === 'complete'
  const adminPricingConfirmed = isVendorPricingConfirmedByAdmin(setupConversationId)
  const assignBlocked =
    !licenseVerified || licenseState.status === 'checking' || !setupComplete

  function handleAdminConfirmPricing() {
    markAdminPricingConfirmed(setupConversationId)
    setPricingSyncTick((tick) => tick + 1)
  }

  useEffect(() => {
    let cancelled = false
    setLicenseState(initialLicenseVerificationState())
    setManualLicenseInput('')
    setLicenseVerifyError(null)
    setLicenseVerifying(false)
    setLocalSetupState(initialVendorSetupVerificationState())
    setPricingSyncTick(0)
    pricingSignatureRef.current = ''

    void lookupVendorLicense(vendor, profile.tradeLabel).then((result) => {
      if (cancelled) return
      setLicenseState(licenseStateFromLookup(result))
    })

    const intakeTimer = window.setTimeout(() => {
      if (cancelled) return
      registerVendorSetupConversation(setupContext, { sentAtMs: Date.now() })
      setLocalSetupState(markVendorSetupRequestSent())
    }, 900)

    return () => {
      cancelled = true
      window.clearTimeout(intakeTimer)
    }
  }, [vendor, profile.tradeLabel, setupContext])

  useEffect(() => {
    function syncVendorSetupProgress() {
      const conversationId = resolveVendorSetupConversationId(setupContext)
      const pricing = readVendorPricingConfirmation(conversationId)
      const pricingSignature = `${pricing.vendorConfirmedAtMs ?? ''}:${pricing.adminConfirmedAtMs ?? ''}`
      if (pricingSignature !== pricingSignatureRef.current) {
        pricingSignatureRef.current = pricingSignature
        setPricingSyncTick((tick) => tick + 1)
      }

      if (hasVendorIntakeSubmission(conversationId)) {
        setLocalSetupState((current) => {
          if (current.status === 'sending' || current.status === 'awaiting') {
            setPricingSyncTick((tick) => tick + 1)
            return markVendorSetupFormReceived()
          }
          return current
        })
      }
    }

    syncVendorSetupProgress()
    const interval = window.setInterval(syncVendorSetupProgress, 3000)
    return () => window.clearInterval(interval)
  }, [setupContext])

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

  if (setupMonitoringOpen && setupConversationId) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <header className="relative border-b border-[#e5e7eb] px-6 pb-4 pt-6 pr-12">
          <button
            type="button"
            disabled={saving}
            onClick={() => onSetupMonitoringClose?.()}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-[#717182] outline-none hover:text-[#0a0a0a] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <ChevronLeftIcon />
            Back to verification
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSetupMonitoringClose?.()}
            aria-label="Close vendor setup messages"
            className="absolute right-4 top-4 z-10 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <CloseIcon />
          </button>
          <h2 className="mt-3 text-[18px] font-semibold leading-7 tracking-[-0.3px] text-[#0a0a0a]">
            Vendor setup messages
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
            {profile.vendorName} · Ulo outreach and replies
          </p>
        </header>
        <ConversationMonitoringPanel
          conversationId={setupConversationId}
          active={setupMonitoringOpen}
          embedded
          refreshKey={pricingSyncTick}
        />
      </div>
    )
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

            <SectionCard title="Verification Checklist">
              <ul className="space-y-3">
                {checklist.map((item) => (
                  <li
                    key={item.id}
                    className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                      item.id === 'license' && licenseRequiresManualVerify(licenseState)
                        ? 'border-[#fde68a] bg-[#fffbeb]'
                        : item.id === 'vendor-setup' && setupState.status === 'form_received'
                          ? 'border-[#fde68a] bg-[#fffbeb]'
                          : item.id === 'vendor-setup' && setupState.status === 'awaiting'
                            ? 'border-[#bfdbfe] bg-[#eff6ff]'
                            : item.id === 'vendor-setup' && setupState.status === 'sending'
                              ? 'border-[#e0e7ff] bg-[#f5f7ff]'
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
                      </div>
                      <p className="mt-0.5 text-[10px] leading-[15px] text-[#717182]">
                        {item.id === 'license' && licenseState.status === 'checking' ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 animate-pulse rounded-full bg-[#155dfc]" aria-hidden />
                            {licenseState.detail}
                          </span>
                        ) : item.id === 'vendor-setup' && setupState.status === 'sending' ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 animate-pulse rounded-full bg-[#155dfc]" aria-hidden />
                            {setupState.detail}
                          </span>
                        ) : (
                          <>
                            {item.detail}
                            {item.id === 'vendor-setup' && setupState.status === 'awaiting' ? (
                              <span className="mt-0.5 block text-[#6a7282]">
                                Covers insurance, pricing, and availability
                              </span>
                            ) : null}
                            {item.id === 'vendor-setup' && setupState.status === 'form_received' ? (
                              <span className="mt-0.5 block text-[#6a7282]">
                                Review submitted rates in Pricing vs Market, then confirm here once you
                                agree
                              </span>
                            ) : null}
                          </>
                        )}
                      </p>
                      {item.id === 'license' && item.requiresManualVerify ? (
                        <div className="mt-2">
                          <div className="flex items-stretch gap-2">
                            <div className="flex min-h-[36px] min-w-0 flex-1 items-center rounded-[10px] border border-[#e5e7eb] bg-white px-3">
                              <input
                                type="text"
                                value={manualLicenseInput}
                                onChange={(event) => {
                                  setManualLicenseInput(event.target.value)
                                  if (licenseVerifyError) setLicenseVerifyError(null)
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' && manualLicenseInput.trim()) {
                                    void handleVerifyLicense()
                                  }
                                }}
                                placeholder="Enter license number"
                                className="h-full w-full bg-transparent text-[12px] text-[#0a0a0a] outline-none placeholder:text-[#9ca3af]"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={licenseVerifying || !manualLicenseInput.trim()}
                              onClick={() => void handleVerifyLicense()}
                              className="inline-flex min-h-[36px] shrink-0 items-center justify-center rounded-[10px] border border-[#101828] bg-white px-3 py-2 text-[12px] font-semibold text-[#101828] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] disabled:pointer-events-none disabled:opacity-50"
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
                      {item.id === 'vendor-setup' &&
                      setupState.status === 'form_received' &&
                      !adminPricingConfirmed ? (
                        <div className="mt-2">
                          <ConfirmPricingButton onClick={handleAdminConfirmPricing} />
                        </div>
                      ) : null}
                    </div>
                    {item.verified ? (
                      <VerifiedPill />
                    ) : item.requiresViewMessageAction ? (
                      <ViewMessageButton onClick={() => onSetupMonitoringOpen?.()} />
                    ) : item.id === 'license' && licenseState.status === 'checking' ? (
                      <PendingPill />
                    ) : item.id === 'vendor-setup' && setupState.status === 'sending' ? (
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

            <SectionCard title="Work Order Fit">
              <ul className="space-y-1.5">
                {profile.workOrderFit.map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <CheckIcon className="mt-0.5 size-[13px] shrink-0 text-[#00bc7d]" />
                    <span className="text-[11px] leading-[16.5px] text-[#0a0a0a]">{line}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>

            <SectionCard title="Pricing vs Market">
              <div className="space-y-3">
                {pricingRows.map((row) => (
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

        <div className="mt-4 rounded-2xl border border-black/10 bg-white p-5">
          <h3 className="text-[14px] font-bold leading-5 text-[#0a0a0a]">Admin Actions</h3>
          {assignBlocked && !saving ? (
            <p className="mt-2 text-[12px] leading-[18px] text-[#a16207]">
              {licenseState.status === 'checking'
                ? 'Waiting for state licensing API…'
                : !licenseVerified
                  ? 'License verification is required before assigning this vendor.'
                  : setupState.status === 'form_received'
                    ? 'Confirm pricing with the vendor before assigning.'
                    : setupState.status === 'awaiting' || setupState.status === 'sending'
                      ? 'Vendor setup (insurance, pricing, availability) must be complete before assigning.'
                      : 'Complete vendor verification before assigning.'}
            </p>
          ) : null}
          <div className="mt-4 space-y-3">
            <button
              type="button"
              disabled={saving || assignBlocked}
              onClick={onAssign}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] bg-[#0a4d38] px-4 py-2.5 text-[13px] font-medium text-white outline-none transition-colors hover:bg-[#083828] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60"
            >
              <ShieldCheckIcon />
              {saving ? 'Assigning…' : 'Assign Vendor'}
            </button>

            <div className="grid gap-2 sm:grid-cols-2">
              {profile.phone ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setCallFlowOpen(true)}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[10px] border border-black/10 bg-white px-4 py-2.5 text-[13px] font-medium text-[#0a0a0a] outline-none transition-colors hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                >
                  <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path
                      d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Call Vendor
                </button>
              ) : (
                <SecondaryActionButton label="Call Vendor" />
              )}
              <SecondaryActionButton label="Reject Vendor" destructive onClick={onReject} />
            </div>
          </div>
        </div>

        {saveError ? (
          <p className="mt-4 text-[13px] leading-4 text-error" role="alert">
            {saveError}
          </p>
        ) : null}
      </div>

      {profile.phone ? (
        <VendorCallFlowModal
          open={callFlowOpen}
          onClose={() => setCallFlowOpen(false)}
          vendorName={profile.vendorName}
          vendorPhone={profile.phone}
          context={callContext}
        />
      ) : null}
    </div>
  )
}

export default ExternalVendorVerificationView
