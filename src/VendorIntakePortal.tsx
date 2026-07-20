import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { VENDOR_TRADE_OPTIONS } from '@/lib/vendorTrades'
import {
  fileToBase64,
  refreshVendorBackgroundStatus,
  resolveVendorVerification,
  saveVendorVerification,
  startVendorBackgroundCheck,
  submitVendorVerification,
  uploadVendorDocument,
  verifyVendorLicense,
  type VendorVerificationDocument,
  type VendorVerificationSession,
} from '@/api/vendorVerification'
import type {
  VerificationChecklistItem,
  VerificationItemStatus,
} from '@/lib/vendorVerificationChecklist'

const STEPS = [
  { id: 'business', label: 'Business Info' },
  { id: 'license', label: 'License' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'background', label: 'Background' },
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

export function VendorIntakePortal() {
  const { token: rawToken } = useParams<{ token: string }>()
  const token = (rawToken ?? '').trim()

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

  const initializedRef = useRef(false)
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
      setAvailability('active')
    } else {
      // Later refreshes (after an upload/verify): only fold in server-computed
      // license fields (e.g. the scanned number) and never clobber what the
      // vendor has already typed or selected.
      setLicenseState((prev) => s.license.state ?? prev)
      setLicenseNumber((prev) => s.license.number ?? prev)
    }

    if (s.status === 'verified' || s.status === 'needs_review' || s.status === 'submitted') {
      setCompleted(true)
    }
  }, [])

  useEffect(() => {
    let active = true
    if (!token) {
      setInvalid("This link isn't working anymore. Ask the property manager for a new link.")
      setLoading(false)
      return
    }
    resolveVendorVerification(token)
      .then(({ session: s }) => {
        if (!active) return
        hydrate(s)
        setLoading(false)
      })
      .catch((err) => {
        if (!active) return
        setInvalid(err instanceof Error ? err.message : 'This link is not valid.')
        setLoading(false)
      })
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
        setActionError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
        return null
      } finally {
        setBusy(false)
      }
    },
    [hydrate],
  )

  const serviceAreaPatch = useMemo(
    () => ({
      zips: zips
        .split(',')
        .map((z) => z.trim())
        .filter(Boolean),
      cities: cities
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      radiusMiles: radiusMiles.trim() ? Number(radiusMiles.trim()) || null : null,
    }),
    [zips, cities, radiusMiles],
  )

  if (loading) return <LoadingView />
  if (invalid) return <InvalidLinkView message={invalid} />
  if (!session) return <InvalidLinkView message="This link is not valid." />

  if (completed) {
    const checklist = session.checklist
    const verified = checklist.overall === 'verified'
    return (
      <Shell>
        <Card>
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
                ? 'Your profile is complete and the property manager can start sending you work.'
                : 'We received your information. A few items still need review before you can be assigned work.'}
            </p>
          </div>
          <ul className="mt-6 divide-y divide-[#f3f4f6]">
            {checklist.items.map((item) => (
              <ChecklistRow key={item.id} item={item} />
            ))}
          </ul>
          <p className="mt-6 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[11px] leading-4 text-[#92400e]">
            Demo note: license, insurance, and background results are simulated, not live checks.
          </p>
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
              label="License number (optional)"
              value={licenseNumber}
              onChange={setLicenseNumber}
              placeholder="If you have it handy"
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
                  ? `License active (simulated)${session.license.number ? ` · ${session.license.number}` : ''}`
                  : session.license.status === 'expired'
                    ? 'License shows expired (simulated). Upload your license below and we can still proceed.'
                    : 'No match found (simulated). Upload your license below and we can still proceed.'}
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
              <PrimaryButton loading={busy} onClick={goNext}>
                Continue
              </PrimaryButton>
            </div>
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
                  liability (simulated read)
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
            <div className="flex gap-3 pt-2">
              <BackButton onClick={goBack} />
              <PrimaryButton loading={busy} onClick={goNext}>
                Continue
              </PrimaryButton>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <p className="text-[14px] leading-6 text-[#364153]">
              A quick background check keeps residents safe. Select Check Status to complete.
            </p>
            {!session.backgroundCheck.status ? (
              <PrimaryButton
                loading={busy}
                onClick={() => runAction(() => startVendorBackgroundCheck(token))}
              >
                Start background check
              </PrimaryButton>
            ) : (
              <div
                className={`rounded-lg px-3 py-3 text-[13px] ${
                  session.backgroundCheck.status === 'clear'
                    ? 'bg-[#dbfce7] text-[#008236]'
                    : session.backgroundCheck.status === 'consider'
                      ? 'bg-[#fee2e2] text-[#b91c1c]'
                      : 'bg-[#fef9c3] text-[#92400e]'
                }`}
              >
                {session.backgroundCheck.status === 'clear'
                  ? 'Background check clear (simulated Checkr).'
                  : session.backgroundCheck.status === 'consider'
                    ? 'Background check needs review (simulated Checkr).'
                    : 'Background check is processing (simulated Checkr).'}
              </div>
            )}
            {session.backgroundCheck.status === 'pending' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(() => refreshVendorBackgroundStatus(token))}
                className="w-full rounded-[10px] border border-[#186179] px-4 py-2.5 text-[14px] font-semibold text-[#186179] transition-colors hover:bg-[#186179]/5 disabled:opacity-50"
              >
                Check status
              </button>
            ) : null}
            <div className="flex gap-3 pt-2">
              <BackButton onClick={goBack} />
              <PrimaryButton loading={busy} onClick={goNext}>
                Continue
              </PrimaryButton>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-4">
            <FileUpload
              label="Upload your W-9"
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
                disabled={trades.length === 0}
                onClick={async () => {
                  const s = await runAction(() =>
                    submitVendorVerification(token, {
                      tradeCategories: trades,
                      serviceArea: serviceAreaPatch,
                      availability,
                    }),
                  )
                  if (s) setCompleted(true)
                }}
              >
                Submit
              </PrimaryButton>
            </div>
          </div>
        ) : null}
      </Card>
    </Shell>
  )
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
                  number above (simulated scan).
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
