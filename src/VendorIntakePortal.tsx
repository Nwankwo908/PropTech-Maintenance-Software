import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { VENDOR_TRADE_OPTIONS } from '@/lib/vendorTrades'
import {
  createVendorConnectAccountSession,
  fileToBase64,
  refreshVendorConnectStatus,
  resolveVendorVerification,
  saveVendorVerification,
  submitVendorVerification,
  uploadVendorDocument,
  verifyVendorLicense,
  type VendorStripePayoutMethod,
  type VendorVerificationDocument,
  type VendorVerificationSession,
} from '@/api/vendorVerification'
import type {
  VerificationChecklistItem,
  VerificationItemStatus,
} from '@/lib/vendorVerificationChecklist'
import {
  isTaxEntityType,
  maskTin,
  normalizeTinDigits,
  TAX_ENTITY_OPTIONS,
  taxProfileForEntity,
  tinFieldHint,
  tinFieldLabel,
  type TaxEntityType,
} from '@/lib/vendorW9Tax'
import { getErrorMessage } from '@/lib/errorMessage'
import { StripeConnectEmbeddedOnboarding } from '@/components/StripeConnectEmbeddedOnboarding'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import {
  VENDOR_COI_COVERAGE_ACK_TEXT,
  vendorCoiCoverageAckFromProgress,
  vendorCoiCoverageAckProgressPatch,
} from '@/lib/vendorCoiCoverageAck'

const STEPS = [
  { id: 'business', label: 'Business Info' },
  { id: 'license', label: 'License' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'service', label: 'Tax & Service' },
] as const

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f9fafb] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-[560px]">{children}</div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_8px_24px_rgba(0,0,0,0.06)] sm:p-8">
      {children}
    </div>
  )
}

function LoadingView() {
  return (
    <Shell>
      <Card>
        <p className="text-center text-[14px] text-[#6a7282]">Loading your verification…</p>
      </Card>
    </Shell>
  )
}

function InvalidLinkView({ message }: { message: string }) {
  return (
    <Shell>
      <Card>
        <h1 className="text-[20px] font-bold text-[#0a0a0a]">Link unavailable</h1>
        <p className="mt-2 text-[14px] leading-6 text-[#6a7282]">{message}</p>
      </Card>
    </Shell>
  )
}

function EditDetailsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-5" aria-hidden>
      <path
        d="M14.167 2.5a1.886 1.886 0 0 1 2.666 2.667l-9.5 9.5-3.5.833.833-3.5 9.5-9.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PayoutAccordionChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={`size-5 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
    >
      <path
        d="M5 7.5 10 12.5 15 7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PayoutMethodsList({ methods }: { methods: VendorStripePayoutMethod[] }) {
  if (methods.length === 0) return null
  return (
    <ul className="mt-3 space-y-2">
      {methods.map((method) => (
        <li
          key={method.id}
          className="rounded-[10px] border border-[#dbe4ea] bg-white px-3 py-2.5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-[#101828]">{method.label}</p>
              <p className="mt-0.5 text-[12px] text-[#6a7282]">
                {method.kind === 'bank_account' ? 'Bank account' : 'Debit card'}
                {method.currency ? ` · ${method.currency}` : ''}
              </p>
            </div>
            {method.defaultForCurrency ? (
              <span className="shrink-0 rounded-md bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-semibold text-[#15803d]">
                Default
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-[#364153]">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-[10px] border border-[#d1d5dc] bg-white px-3 py-2.5 text-[15px] text-[#0a0a0a] outline-none transition-colors focus:border-[#186179] focus:ring-2 focus:ring-[#186179]/20"
      />
    </label>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  loading,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="inline-flex w-full items-center justify-center rounded-[10px] bg-[#187960] px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#14654f] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? 'Working…' : children}
    </button>
  )
}

function statusColor(status: VerificationItemStatus): string {
  switch (status) {
    case 'complete':
      return 'bg-[#dbfce7] text-[#008236]'
    case 'action_needed':
      return 'bg-[#fee2e2] text-[#b91c1c]'
    case 'pending':
      return 'bg-[#fef9c3] text-[#92400e]'
    default:
      return 'bg-[#f3f4f6] text-[#6a7282]'
  }
}

function statusLabel(status: VerificationItemStatus): string {
  switch (status) {
    case 'complete':
      return 'Done'
    case 'action_needed':
      return 'Review'
    case 'pending':
      return 'Pending'
    default:
      return 'To do'
  }
}

function ChecklistRow({ item }: { item: VerificationChecklistItem }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-[#0a0a0a]">{item.label}</p>
        <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">{item.detail}</p>
      </div>
      <span
        className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusColor(item.status)}`}
      >
        {statusLabel(item.status)}
      </span>
    </li>
  )
}

function StepHeader({ current }: { current: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-1.5">
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`h-1.5 flex-1 rounded-full ${i <= current ? 'bg-[#186179]' : 'bg-[#e5e7eb]'}`}
          />
        ))}
      </div>
      <p className="mt-3 text-[12px] font-medium uppercase tracking-[0.06em] text-[#6a7282]">
        Step {current + 1} of {STEPS.length} · {STEPS[current].label}
      </p>
    </div>
  )
}

function inviteTokenFromPath(raw: string | undefined): string {
  let token = (raw ?? '').trim()
  if (!token) return ''
  try {
    token = decodeURIComponent(token).trim()
  } catch {
    /* already decoded */
  }
  return token.replace(/[.,;:)\]]+$/g, '')
}

export function VendorIntakePortal() {
  const { token: rawToken } = useParams<{ token: string }>()
  const token = inviteTokenFromPath(rawToken)

  const [session, setSession] = useState<VendorVerificationSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)

  // Local form state
  const [businessName, setBusinessName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [licenseState, setLicenseState] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [trades, setTrades] = useState<string[]>([])
  const [zips, setZips] = useState('')
  const [cities, setCities] = useState('')
  const [radiusMiles, setRadiusMiles] = useState('')
  const [availability, setAvailability] = useState<'active' | 'paused'>('active')
  const [taxEntityType, setTaxEntityType] = useState<TaxEntityType | ''>('')
  const [tin, setTin] = useState('')
  const [tinSavedLast4, setTinSavedLast4] = useState<string | null>(null)
  const [showConnectOnboarding, setShowConnectOnboarding] = useState(false)
  const [coiCoverageAck, setCoiCoverageAck] = useState(false)

  const initializedRef = useRef(false)
  const editingAfterSubmitRef = useRef(false)
  // Documents already on the record when the vendor opened the link. We only
  // acknowledge files uploaded during THIS session, so prior uploads don't look
  // like something the vendor just added.
  const preexistingDocIdsRef = useRef<Set<string>>(new Set())

  const hydrate = useCallback((s: VendorVerificationSession) => {
    setSession(s)

    if (!initializedRef.current) {
      initializedRef.current = true
      preexistingDocIdsRef.current = new Set(s.documents.map((d) => d.id))
      // First load: pre-fill only the details captured on the invite (business,
      // contact, email, phone). Everything else stays blank for the vendor to
      // complete themselves.
      setBusinessName(s.businessName ?? '')
      setContactName(s.contactName ?? '')
      setEmail(s.email ?? '')
      setPhone(s.phone ?? '')
      setLicenseState('')
      setLicenseNumber('')
      setTrades([])
      setZips('')
      setCities('')
      setRadiusMiles('')
      setAvailability(s.availability === 'paused' ? 'paused' : 'active')
      setTaxEntityType(isTaxEntityType(s.taxEntityType) ? s.taxEntityType : '')
      setTin('')
      setTinSavedLast4(s.tinLast4)
      setCoiCoverageAck(vendorCoiCoverageAckFromProgress(s.progress))
    } else {
      // Later refreshes (after an upload/verify): only fold in server-computed
      // license fields (e.g. the scanned number) and never clobber what the
      // vendor has already typed or selected.
      setLicenseState((prev) => s.license.state ?? prev)
      setLicenseNumber((prev) => s.license.number ?? prev)
      if (s.availability === 'active' || s.availability === 'paused') {
        setAvailability(s.availability)
      }
      if (isTaxEntityType(s.taxEntityType)) setTaxEntityType(s.taxEntityType)
      if (s.tinLast4) setTinSavedLast4(s.tinLast4)
      if (vendorCoiCoverageAckFromProgress(s.progress)) setCoiCoverageAck(true)
    }

    if (
      !editingAfterSubmitRef.current &&
      (s.status === 'verified' || s.status === 'needs_review' || s.status === 'submitted')
    ) {
      setCompleted(true)
    }
  }, [])

  const fillFormFromSession = useCallback((s: VendorVerificationSession) => {
    preexistingDocIdsRef.current = new Set()
    setBusinessName(s.businessName ?? '')
    setContactName(s.contactName ?? '')
    setEmail(s.email ?? '')
    setPhone(s.phone ?? '')
    setLicenseState(s.license.state ?? '')
    setLicenseNumber(s.license.number ?? '')
    setTrades(s.tradeCategories ?? [])
    setZips((s.serviceArea.zips ?? []).join(', '))
    setCities((s.serviceArea.cities ?? []).join(', '))
    setRadiusMiles(
      typeof s.serviceArea.radiusMiles === 'number' && Number.isFinite(s.serviceArea.radiusMiles)
        ? String(s.serviceArea.radiusMiles)
        : '',
    )
    setAvailability(s.availability === 'paused' ? 'paused' : 'active')
    setTaxEntityType(isTaxEntityType(s.taxEntityType) ? s.taxEntityType : '')
    setTin('')
    setTinSavedLast4(s.tinLast4)
    setCoiCoverageAck(vendorCoiCoverageAckFromProgress(s.progress))
  }, [])

  function startEditSubmittedForm() {
    if (!session) return
    editingAfterSubmitRef.current = true
    fillFormFromSession(session)
    setActionError(null)
    setStep(0)
    setCompleted(false)
  }

  const fetchVendorConnectClientSecret = useCallback(async () => {
    const { session: s, clientSecret, publishableKey } = await createVendorConnectAccountSession(
      token,
    )
    hydrate(s)
    return { clientSecret, publishableKey }
  }, [hydrate, token])

  async function handleVendorConnectExit() {
    setBusy(true)
    setActionError(null)
    try {
      const { session: s } = await refreshVendorConnectStatus(token)
      hydrate(s)
      if (s.stripeConnectReady) {
        setShowConnectOnboarding(false)
      }
    } catch (err) {
      setActionError(getErrorMessage(err, 'Could not refresh payout status.'))
    } finally {
      setBusy(false)
    }
  }

  function openEmbeddedPayouts() {
    setActionError(null)
    setShowConnectOnboarding(true)
  }

  useEffect(() => {
    let active = true
    if (!token) {
      setInvalid("This link isn't working anymore. Ask the property manager for a new link.")
      setLoading(false)
      return
    }

    const connectParam = new URLSearchParams(window.location.search).get('connect')
    const returningFromConnect =
      connectParam === 'return' || connectParam === 'refresh'

    const boot = async () => {
      try {
        if (returningFromConnect) {
          setStep(STEPS.findIndex((s) => s.id === 'service'))
          const { session: s } = await refreshVendorConnectStatus(token)
          if (!active) return
          hydrate(s)
          // Drop the query flag so refresh doesn't re-hit Stripe every time.
          const url = new URL(window.location.href)
          url.searchParams.delete('connect')
          window.history.replaceState({}, '', url.toString())
        } else {
          const { session: s } = await resolveVendorVerification(token)
          if (!active) return
          hydrate(s)
        }
      } catch (err) {
        if (!active) return
        setInvalid(getErrorMessage(err, 'This link is not valid.'))
      } finally {
        if (active) setLoading(false)
      }
    }

    void boot()
    return () => {
      active = false
    }
  }, [token, hydrate])

  const runAction = useCallback(
    async (fn: () => Promise<{ session: VendorVerificationSession }>) => {
      setBusy(true)
      setActionError(null)
      try {
        const { session: s } = await fn()
        hydrate(s)
        return s
      } catch (err) {
        setActionError(getErrorMessage(err, 'Something went wrong. Try again.'))
        return null
      } finally {
        setBusy(false)
      }
    },
    [hydrate],
  )

  const serviceAreaPatch = useMemo(() => {
    const zipsList = zips
      .split(',')
      .map((z) => z.trim())
      .filter(Boolean)
    const citiesList = cities
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
    return {
      zips: zipsList,
      cities: citiesList,
      radiusMiles: radiusMiles.trim() ? Number(radiusMiles.trim()) || null : null,
      centerAddress: citiesList[0] ?? zipsList[0] ?? null,
    }
  }, [zips, cities, radiusMiles])

  const taxProfile = taxEntityType ? taxProfileForEntity(taxEntityType) : null

  if (loading) return <LoadingView />
  if (invalid) return <InvalidLinkView message={invalid} />
  if (!session) return <InvalidLinkView message="This link is not valid." />

  if (completed) {
    const checklist = session.checklist
    const verified = checklist.overall === 'verified'
    const capacityPaused = availability === 'paused'
    return (
      <Shell>
        <Card>
          <div className="relative">
            <button
              type="button"
              onClick={startEditSubmittedForm}
              className="absolute right-0 top-0 inline-flex size-9 items-center justify-center rounded-[10px] text-[#6a7282] transition-colors hover:bg-[#f3f4f6] hover:text-[#186179]"
              aria-label="Edit your information"
            >
              <EditDetailsIcon />
            </button>
            <div className="text-center">
            <div
              className={`mx-auto flex size-14 items-center justify-center rounded-full ${verified ? 'bg-[#dbfce7]' : 'bg-[#fef9c3]'}`}
            >
              <span className="text-[28px]" aria-hidden>
                {verified ? '✓' : '⏳'}
              </span>
            </div>
            <h1 className="mt-4 text-[22px] font-bold text-[#0a0a0a]">
              {verified ? "You're verified!" : 'Thanks — almost there'}
            </h1>
            <p className="mt-2 text-[14px] leading-6 text-[#6a7282]">
              {verified
                ? 'Your account is active. Use the toggle below when you need to pause or resume new job offers.'
                : 'We received your information. A few items still need review before you can be assigned work.'}
              </p>
            </div>
          </div>
          {verified ? (
            <div className="mt-6 rounded-[12px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
              <p className="text-[13px] font-semibold text-[#0a0a0a]">Job offers</p>
              <p className="mt-1 text-[12px] leading-5 text-[#6a7282]">
                Capacity is separate from verification. Pausing stops new jobs only — work you
                already accepted stays on your schedule.
              </p>
              <div className="mt-3 flex gap-2">
                {(['active', 'paused'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        const prev = availability
                        setAvailability(opt)
                        const s = await runAction(() =>
                          saveVendorVerification(token, { availability: opt }),
                        )
                        if (!s) setAvailability(prev)
                      })()
                    }}
                    className={`flex-1 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-50 ${
                      availability === opt
                        ? 'bg-[#186179] text-white'
                        : 'bg-white text-[#364153] ring-1 ring-[#e5e7eb] hover:bg-[#f3f4f6]'
                    }`}
                  >
                    {opt === 'active' ? 'Accepting work' : 'Paused'}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-[#6a7282]">
                {capacityPaused
                  ? 'Paused — no new job offers. Reply RESUME by text anytime.'
                  : 'Accepting work — reply PAUSE by text anytime to stop new offers.'}
              </p>
            </div>
          ) : null}
          <ul className="mt-6 divide-y divide-[#f3f4f6]">
            {checklist.items.map((item) => (
              <ChecklistRow key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      </Shell>
    )
  }

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  // Only files uploaded in this session — never pre-existing ones on the record.
  const sessionDocs = session.documents.filter((d) => !preexistingDocIdsRef.current.has(d.id))
  const docsOfKind = (kind: VendorVerificationDocument['kind']) =>
    sessionDocs.filter((d) => d.kind === kind)
  const hasDocKind = (kind: VendorVerificationDocument['kind']) =>
    session.documents.some((d) => d.kind === kind)

  const licenseStatus = (session.license.status ?? '').toLowerCase()
  const hasLicense =
    (licenseState.trim().length > 0 && licenseNumber.trim().length > 0) ||
    hasDocKind('license') ||
    Boolean(session.license.number?.trim()) ||
    ['verified', 'active', 'manual_verified'].includes(licenseStatus)
  const hasCoi = hasDocKind('coi') || session.insurance.generalLiability != null
  const hasServiceArea =
    serviceAreaPatch.zips.length > 0 ||
    serviceAreaPatch.cities.length > 0 ||
    (serviceAreaPatch.radiusMiles != null && serviceAreaPatch.radiusMiles > 0)
  const canSubmit =
    session.stripeConnectReady && trades.length > 0 && hasServiceArea

  return (
    <Shell>
      <div className="mb-4">
        <h1 className="text-[20px] font-bold text-[#0a0a0a]">Vendor verification form</h1>
        <p className="mt-1 text-[13px] text-[#6a7282]">
          {session.propertyName
            ? `Getting you set up for ${session.propertyName}. `
            : 'Getting you set up. '}
          Takes about 5 minutes.
        </p>
      </div>
      <Card>
        <StepHeader current={step} />

        {actionError ? (
          <p className="mb-4 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
            {actionError}
          </p>
        ) : null}

        {step === 0 ? (
          <div className="space-y-4">
            <Field label="Business name" value={businessName} onChange={setBusinessName} />
            <Field label="Your name" value={contactName} onChange={setContactName} />
            <Field label="Email" value={email} onChange={setEmail} type="email" />
            <Field label="Mobile phone" value={phone} onChange={setPhone} type="tel" />
            <PrimaryButton
              loading={busy}
              onClick={async () => {
                const s = await runAction(() =>
                  saveVendorVerification(token, {
                    businessName,
                    contactName,
                    email,
                    phone,
                  }),
                )
                if (s) goNext()
              }}
            >
              Continue
            </PrimaryButton>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            <p className="text-[14px] leading-6 text-[#364153]">
              Confirm your professional license. We&apos;ll check it against the state licensing
              board.
            </p>
            <Field label="License state (e.g. IL)" value={licenseState} onChange={setLicenseState} />
            <Field
              label="License number"
              value={licenseNumber}
              onChange={setLicenseNumber}
            />
            {session.license.status ? (
              <div
                className={`rounded-lg px-3 py-2 text-[13px] ${
                  ['verified', 'active', 'manual_verified'].includes(session.license.status)
                    ? 'bg-[#dbfce7] text-[#008236]'
                    : 'bg-[#fef9c3] text-[#92400e]'
                }`}
              >
                {['verified', 'active', 'manual_verified'].includes(session.license.status)
                  ? `License active${session.license.number ? ` · ${session.license.number}` : ''}`
                  : session.license.status === 'expired'
                    ? 'License shows expired. Upload your license below and we can still proceed.'
                    : 'No match found. Upload your license below and we can still proceed.'}
              </div>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction(() => verifyVendorLicense(token, { licenseState, licenseNumber }))}
              className="w-full rounded-[10px] border border-[#186179] px-4 py-2.5 text-[14px] font-semibold text-[#186179] transition-colors hover:bg-[#186179]/5 disabled:opacity-50"
            >
              Verify license
            </button>
            <FileUpload
              label="Or upload your license (PDF/photo)"
              accept="image/*,application/pdf"
              busy={busy}
              done={docsOfKind('license').length > 0}
              onFile={async (file) => {
                const b64 = await fileToBase64(file)
                await runAction(() =>
                  uploadVendorDocument(token, {
                    kind: 'license',
                    fileName: file.name,
                    contentType: file.type || 'application/octet-stream',
                    dataBase64: b64,
                  }),
                )
              }}
            />
            <UploadedDocs docs={docsOfKind('license')} />
            <div className="flex gap-3 pt-2">
              <BackButton onClick={goBack} />
              <PrimaryButton
                loading={busy}
                disabled={!hasLicense}
                onClick={async () => {
                  if (!hasLicense) return
                  if (licenseState.trim() && licenseNumber.trim()) {
                    const s = await runAction(() =>
                      verifyVendorLicense(token, { licenseState, licenseNumber }),
                    )
                    if (s) goNext()
                    return
                  }
                  goNext()
                }}
              >
                Continue
              </PrimaryButton>
            </div>
            {!hasLicense ? (
              <p className="text-[12px] leading-5 text-[#9a3412]">
                Enter your license state and number, or upload your license, to continue.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <p className="text-[14px] leading-6 text-[#364153]">
              Upload your Certificate of Insurance (COI). We look for at least $1M general liability
              and that the property owner is listed as additional insured.
            </p>
            {session.insurance.generalLiability != null ? (
              <div className="rounded-lg border border-[#e5e7eb] bg-[#f9fafb] px-3 py-3 text-[13px] text-[#364153]">
                <p>
                  <strong>${session.insurance.generalLiability.toLocaleString()}</strong> general
                  liability
                </p>
                {session.insurance.expiration ? (
                  <p className="mt-0.5">Valid through {session.insurance.expiration}</p>
                ) : null}
                <p className="mt-0.5">
                  {session.insurance.additionalInsured
                    ? 'Owner is listed as additional insured. '
                    : 'Please make sure the owner is added as additional insured — your carrier can add this at no cost.'}
                </p>
              </div>
            ) : null}
            <FileUpload
              label="Upload COI (PDF/photo)"
              accept="image/*,application/pdf"
              busy={busy}
              done={docsOfKind('coi').length > 0}
              onFile={async (file) => {
                const b64 = await fileToBase64(file)
                await runAction(() =>
                  uploadVendorDocument(token, {
                    kind: 'coi',
                    fileName: file.name,
                    contentType: file.type || 'application/octet-stream',
                    dataBase64: b64,
                  }),
                )
              }}
            />
            <UploadedDocs docs={docsOfKind('coi')} />
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className={`mt-0.5 ${checkboxInputClassName}`}
                checked={coiCoverageAck}
                disabled={busy}
                onChange={(event) => setCoiCoverageAck(event.target.checked)}
              />
              <span className="text-[14px] leading-5 text-[#364153]">{VENDOR_COI_COVERAGE_ACK_TEXT}</span>
            </label>
            <div className="flex gap-3 pt-2">
              <BackButton onClick={goBack} />
              <PrimaryButton
                loading={busy}
                disabled={!hasCoi || !coiCoverageAck}
                onClick={async () => {
                  if (!hasCoi) {
                    setActionError('Upload your insurance certificate to continue.')
                    return
                  }
                  if (!coiCoverageAck) {
                    setActionError('Confirm your general liability coverage to continue.')
                    return
                  }
                  const saved = await runAction(() =>
                    saveVendorVerification(token, {
                      progress: {
                        ...(session?.progress ?? {}),
                        coi_coverage_attestation: vendorCoiCoverageAckProgressPatch(),
                      },
                    }),
                  )
                  if (saved) goNext()
                }}
              >
                Continue
              </PrimaryButton>
            </div>
            {!hasCoi ? (
              <p className="text-[12px] leading-5 text-[#9a3412]">
                Upload your Certificate of Insurance to continue.
              </p>
            ) : !coiCoverageAck ? (
              <p className="text-[12px] leading-5 text-[#9a3412]">
                Confirm your general liability coverage to continue.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <div className="rounded-[12px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
              <p className="text-[13px] font-semibold text-[#0a0a0a]">
                Tax entity (W-9){' '}
                <span className="font-medium text-[#6a7282]">Optional</span>
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[#6a7282]">
                Add this if you need it for 1099 reporting. Sole proprietors: SSN. LLCs/corps: EIN.
              </p>
              <label className="mt-3 block">
                <span className="text-[13px] font-medium text-[#364153]">Entity type</span>
                <select
                  value={taxEntityType}
                  onChange={(e) => {
                    const next = e.target.value
                    setTaxEntityType(isTaxEntityType(next) ? next : '')
                    setTin('')
                    if (isTaxEntityType(next)) {
                      const nextTin = taxProfileForEntity(next).tinType
                      if (session.tinType && session.tinType !== nextTin) {
                        setTinSavedLast4(null)
                      }
                    } else {
                      setTinSavedLast4(null)
                    }
                  }}
                  className="mt-1.5 w-full rounded-[10px] border border-[#d1d5dc] bg-white px-3 py-2.5 text-[15px] text-[#0a0a0a] outline-none focus:border-[#186179] focus:ring-2 focus:ring-[#186179]/20"
                >
                  <option value="">Select entity type…</option>
                  {TAX_ENTITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              {taxProfile ? (
                <div className="mt-3 space-y-2">
                  <p className="text-[12px] leading-5 text-[#364153]">
                    Uses <strong>{taxProfile.tinType.toUpperCase()}</strong> ·{' '}
                    {taxProfile.w9Variant === 'individual' ? 'Individual' : 'Business'} W-9 ·{' '}
                    {taxProfile.tax1099Treatment === 'nec'
                      ? 'Eligible for 1099-NEC'
                      : 'Corporation — typically no 1099'}
                  </p>
                  <Field
                    label={tinFieldLabel(taxProfile.tinType)}
                    value={tin}
                    onChange={setTin}
                    type="text"
                    placeholder={
                      tinSavedLast4
                        ? `Saved ${maskTin(taxProfile.tinType, tinSavedLast4)} — enter to update`
                        : taxProfile.tinType === 'ssn'
                          ? 'XXX-XX-XXXX'
                          : 'XX-XXXXXXX'
                    }
                  />
                  <p className="text-[11px] leading-4 text-[#6a7282]">
                    {tinFieldHint(taxProfile.tinType)} We store only the last four digits for
                    display.
                  </p>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !taxEntityType ||
                      (normalizeTinDigits(tin).length === 0 && !tinSavedLast4)
                    }
                    onClick={async () => {
                      if (!taxEntityType) return
                      const digits = normalizeTinDigits(tin)
                      const patch =
                        digits.length > 0
                          ? { taxEntityType, tin: digits }
                          : { taxEntityType }
                      const s = await runAction(() => saveVendorVerification(token, patch))
                      if (s?.tinLast4) {
                        setTinSavedLast4(s.tinLast4)
                        setTin('')
                      }
                    }}
                    className="w-full rounded-[10px] border border-[#186179] px-4 py-2.5 text-[14px] font-semibold text-[#186179] transition-colors hover:bg-[#186179]/5 disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Save tax details'}
                  </button>
                </div>
              ) : null}
            </div>

            <FileUpload
              label="Upload your W-9 (optional)"
              accept="image/*,application/pdf"
              busy={busy}
              done={docsOfKind('w9').length > 0}
              onFile={async (file) => {
                const b64 = await fileToBase64(file)
                await runAction(() =>
                  uploadVendorDocument(token, {
                    kind: 'w9',
                    fileName: file.name,
                    contentType: file.type || 'application/octet-stream',
                    dataBase64: b64,
                  }),
                )
              }}
            />
            <UploadedDocs docs={docsOfKind('w9')} />

            <div className="overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-[#f9fafb]">
              {session.stripeConnectReady ? (
                <div className="p-4">
                  <p className="text-[13px] font-semibold text-[#0a0a0a]">Payout account</p>
                  <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">
                    Confirm this is the account where you want invoice payments deposited.
                  </p>
                  <p className="mt-3 text-[13px] font-medium text-[#15803d]">
                    Payout account connected
                  </p>
                  {session.payoutMethods.length > 0 ? (
                    <PayoutMethodsList methods={session.payoutMethods} />
                  ) : (
                    <p className="mt-2 text-[12px] text-[#6a7282]">
                      Stripe is still finishing your account. Tap refresh in a moment if your bank
                      details don’t appear.
                    </p>
                  )}
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        await runAction(() => refreshVendorConnectStatus(token))
                      }}
                      className="rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f3f4f6] disabled:opacity-50"
                    >
                      Refresh status
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={openEmbeddedPayouts}
                      className="rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f3f4f6] disabled:opacity-50"
                      aria-expanded={showConnectOnboarding}
                    >
                      Update payout account
                    </button>
                  </div>
                  {showConnectOnboarding ? (
                    <div className="mt-4 border-t border-[#e5e7eb] pt-4">
                      <StripeConnectEmbeddedOnboarding
                        fetchClientSecret={fetchVendorConnectClientSecret}
                        onExit={() => void handleVendorConnectExit()}
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setShowConnectOnboarding(false)}
                        className="mt-2 w-full text-center text-[13px] font-medium text-[#186179] hover:underline disabled:opacity-50"
                      >
                        Close payout setup
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    aria-expanded={showConnectOnboarding}
                    onClick={() => {
                      if (showConnectOnboarding) {
                        setShowConnectOnboarding(false)
                        return
                      }
                      openEmbeddedPayouts()
                    }}
                    className="flex w-full items-center justify-between gap-3 bg-[#186179] px-4 py-2.5 text-left text-[14px] font-semibold text-white transition-colors hover:bg-[#145066] disabled:opacity-50"
                  >
                    <span>Set up payouts</span>
                    <PayoutAccordionChevron expanded={showConnectOnboarding} />
                  </button>
                  {showConnectOnboarding ? (
                    <div className="border-t border-[#d1d5dc] bg-white p-4">
                      <p className="text-[13px] leading-5 text-[#6a7282]">
                        Set up payouts so you can get paid when invoices are approved. Takes a few
                        minutes — you stay on this page.
                      </p>
                      <StripeConnectEmbeddedOnboarding
                        fetchClientSecret={fetchVendorConnectClientSecret}
                        onExit={() => void handleVendorConnectExit()}
                      />
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div>
              <span className="text-[13px] font-medium text-[#364153]">Trades you handle</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {VENDOR_TRADE_OPTIONS.map((opt) => {
                  const selected = trades.includes(opt.value)
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() =>
                        setTrades((prev) =>
                          prev.includes(opt.value)
                            ? prev.filter((t) => t !== opt.value)
                            : [...prev, opt.value],
                        )
                      }
                      className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                        selected
                          ? 'bg-[#186179] text-white'
                          : 'bg-[#f3f4f6] text-[#364153] hover:bg-[#e5e7eb]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <Field label="Service ZIP codes (comma separated)" value={zips} onChange={setZips} />
            <Field label="Cities served (comma separated)" value={cities} onChange={setCities} />
            <Field
              label="Service radius (miles, optional)"
              value={radiusMiles}
              onChange={setRadiusMiles}
              type="number"
            />

            <div>
              <span className="text-[13px] font-medium text-[#364153]">Availability</span>
              <div className="mt-2 flex gap-2">
                {(['active', 'paused'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAvailability(opt)}
                    className={`flex-1 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition-colors ${
                      availability === opt
                        ? 'bg-[#186179] text-white'
                        : 'bg-[#f3f4f6] text-[#364153] hover:bg-[#e5e7eb]'
                    }`}
                  >
                    {opt === 'active' ? 'Accepting work' : 'Paused'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <BackButton onClick={goBack} />
              <PrimaryButton
                loading={busy}
                disabled={!canSubmit}
                onClick={async () => {
                  if (!session.stripeConnectReady) {
                    setActionError('Set up your payout account to finish.')
                    return
                  }
                  if (trades.length === 0) {
                    setActionError('Select at least one trade to finish.')
                    return
                  }
                  if (!hasServiceArea) {
                    setActionError('Add the ZIP codes or cities you serve to finish.')
                    return
                  }
                  const startedW9 =
                    Boolean(taxEntityType) ||
                    Boolean(tin.trim()) ||
                    docsOfKind('w9').length > 0 ||
                    session.w9Received
                  if (startedW9) {
                    if (!taxEntityType) {
                      setActionError('Choose your business entity type for the W-9.')
                      return
                    }
                    const digits = normalizeTinDigits(tin)
                    if (!tinSavedLast4 && digits.length === 0) {
                      setActionError(
                        taxProfile?.tinType === 'ssn'
                          ? 'Enter your Social Security number.'
                          : 'Enter your Employer Identification Number (EIN).',
                      )
                      return
                    }
                  }
                  const digits = normalizeTinDigits(tin)
                  const s = await runAction(() =>
                    submitVendorVerification(token, {
                      tradeCategories: trades,
                      serviceArea: serviceAreaPatch,
                      availability,
                      ...(taxEntityType
                        ? {
                            taxEntityType,
                            ...(digits.length > 0 ? { tin: digits } : {}),
                          }
                        : {}),
                    }),
                  )
                  if (s) {
                    editingAfterSubmitRef.current = false
                    setCompleted(true)
                  }
                }}
              >
                Submit
              </PrimaryButton>
            </div>
            {!canSubmit ? (
              <p className="text-[12px] leading-5 text-[#9a3412]">
                {submitHint(session.stripeConnectReady, trades.length > 0, hasServiceArea)}
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>
    </Shell>
  )
}

function submitHint(
  payoutReady: boolean,
  hasTrades: boolean,
  hasServiceArea: boolean,
): string {
  const missing: string[] = []
  if (!payoutReady) missing.push('set up your payout account')
  if (!hasTrades) missing.push('select at least one trade')
  if (!hasServiceArea) missing.push('add ZIP codes or cities you serve')
  if (missing.length === 0) return ''
  const first = missing[0] ?? ''
  const rest = missing.slice(1)
  const list =
    rest.length === 0
      ? first
      : rest.length === 1
        ? `${first} and ${rest[0]}`
        : `${first}, ${rest[0]}, and ${rest[1]}`
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} to submit.`
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[10px] border border-[#d1d5dc] px-4 py-3 text-[15px] font-semibold text-[#364153] transition-colors hover:bg-[#f3f4f6]"
    >
      Back
    </button>
  )
}

function UploadedDocs({ docs }: { docs: VendorVerificationDocument[] }) {
  if (docs.length === 0) return null
  return (
    <ul className="space-y-2">
      {docs.map((doc) => {
        const parsed = (doc.parsed ?? {}) as Record<string, unknown>
        const scannedNumber =
          typeof parsed.licenseNumber === 'string' ? parsed.licenseNumber : null
        const uploadedOn = doc.uploadedAt
          ? new Date(doc.uploadedAt).toLocaleDateString()
          : null
        return (
          <li
            key={doc.id}
            className="flex items-start gap-3 rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2.5"
          >
            <span
              aria-hidden
              className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#dbfce7] text-[12px] font-bold text-[#008236]"
            >
              ✓
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-[#0a0a0a]">
                {doc.fileName ?? 'Uploaded document'}
              </p>
              <p className="mt-0.5 text-[12px] text-[#008236]">
                Uploaded{uploadedOn ? ` · ${uploadedOn}` : ''}
              </p>
              {scannedNumber ? (
                <p className="mt-0.5 text-[12px] text-[#6a7282]">
                  We read license #{scannedNumber} from this document and filled in your license
                  number above.
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function FileUpload({
  label,
  accept,
  onFile,
  busy,
  done,
}: {
  label: string
  accept: string
  onFile: (file: File) => void | Promise<void>
  busy?: boolean
  done?: boolean
}) {
  return (
    <label
      className={`flex cursor-pointer flex-col items-center justify-center rounded-[10px] border-2 border-dashed px-4 py-6 text-center transition-colors ${
        done ? 'border-[#00a63e] bg-[#f0fdf4]' : 'border-[#d1d5dc] bg-[#f9fafb] hover:border-[#186179]'
      } ${busy ? 'pointer-events-none opacity-60' : ''}`}
    >
      <span className="text-[13px] font-medium text-[#364153]">
        {done ? '✓ Uploaded — tap to replace' : label}
      </span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void onFile(file)
          e.target.value = ''
        }}
      />
    </label>
  )
}

export default VendorIntakePortal
