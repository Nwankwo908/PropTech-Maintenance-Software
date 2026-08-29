import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  resolveVendorVerification,
  submitVendorVerification,
  type VendorVerificationSession,
} from '@/api/vendorVerification'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import { getErrorMessage } from '@/lib/errorMessage'
import { parseOptionalUsdAmount } from '@/lib/parseOptionalUsdAmount'
import {
  TERMS_SECTION_6_3_HREF,
  VENDOR_SELF_REPRESENTATION_ACK_BODY,
  vendorSelfRepresentationAckFromProgress,
  vendorSelfRepresentationAckProgressPatch,
} from '@/lib/vendorSelfRepresentationAck'
import { VENDOR_TRADE_OPTIONS } from '@/lib/vendorTrades'

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
        <p className="text-center text-[14px] text-[#6a7282]">Loading your form…</p>
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

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-medium text-[#364153]">{label}</span>
      {hint ? <span className="mt-0.5 block text-[12px] leading-4 text-[#6a7282]">{hint}</span> : null}
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

function insuranceFieldFromSession(session: VendorVerificationSession): string {
  const gl = session.insurance.generalLiability
  if (typeof gl !== 'number' || !Number.isFinite(gl)) return ''
  return String(Math.round(gl))
}

function firstTrade(session: VendorVerificationSession): string {
  const first = session.tradeCategories.find((t) => typeof t === 'string' && t.trim())
  return first?.trim() ?? ''
}

export function VendorIntakePortal() {
  const { token: rawToken } = useParams<{ token: string }>()
  const token = inviteTokenFromPath(rawToken)
  const ackId = useId()

  const [session, setSession] = useState<VendorVerificationSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)

  const [businessName, setBusinessName] = useState('')
  const [trade, setTrade] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [insurance, setInsurance] = useState('')
  const [attested, setAttested] = useState(false)

  const initializedRef = useRef(false)
  const editingAfterSubmitRef = useRef(false)

  const hydrate = useCallback((s: VendorVerificationSession) => {
    setSession(s)
    if (!initializedRef.current) {
      initializedRef.current = true
      setBusinessName(s.businessName ?? '')
      setTrade(firstTrade(s))
      setEmail(s.email ?? '')
      setPhone(s.phone ?? '')
      setLicenseNumber('')
      setInsurance('')
      setAttested(vendorSelfRepresentationAckFromProgress(s.progress))
    } else {
      setLicenseNumber((prev) => s.license.number ?? prev)
      if (typeof s.insurance.generalLiability === 'number') {
        setInsurance((prev) => prev || insuranceFieldFromSession(s))
      }
      if (vendorSelfRepresentationAckFromProgress(s.progress)) setAttested(true)
    }

    if (
      !editingAfterSubmitRef.current &&
      (s.status === 'verified' || s.status === 'needs_review' || s.status === 'submitted')
    ) {
      setCompleted(true)
    }
  }, [])

  const fillFormFromSession = useCallback((s: VendorVerificationSession) => {
    setBusinessName(s.businessName ?? '')
    setTrade(firstTrade(s))
    setEmail(s.email ?? '')
    setPhone(s.phone ?? '')
    setLicenseNumber(s.license.number ?? '')
    setInsurance(insuranceFieldFromSession(s))
    setAttested(vendorSelfRepresentationAckFromProgress(s.progress))
  }, [])

  function startEditSubmittedForm() {
    if (!session) return
    editingAfterSubmitRef.current = true
    fillFormFromSession(session)
    setActionError(null)
    setCompleted(false)
  }

  useEffect(() => {
    let active = true
    if (!token) {
      setInvalid("This link isn't working anymore. Ask the property manager for a new link.")
      setLoading(false)
      return
    }

    const boot = async () => {
      try {
        const { session: s } = await resolveVendorVerification(token)
        if (!active) return
        hydrate(s)
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

  if (loading) return <LoadingView />
  if (invalid) return <InvalidLinkView message={invalid} />
  if (!session) return <InvalidLinkView message="This link is not valid." />

  if (completed) {
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
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#dbfce7]">
                <span className="text-[28px]" aria-hidden>
                  ✓
                </span>
              </div>
              <h1 className="mt-4 text-[22px] font-bold text-[#0a0a0a]">Thank you</h1>
              <p className="mt-2 text-[14px] leading-6 text-[#6a7282]">
                We received your details. The property team will text you here when a job is
                available.
              </p>
            </div>
          </div>
        </Card>
      </Shell>
    )
  }

  const canSubmit =
    Boolean(businessName.trim()) &&
    Boolean(trade.trim()) &&
    Boolean(phone.trim()) &&
    Boolean(email.trim()) &&
    attested

  return (
    <Shell>
      <div className="mb-4">
        <h1 className="text-[20px] font-bold text-[#0a0a0a]">Confirm Your Business Details</h1>
        <p className="mt-1 text-[13px] text-[#6a7282]">
          {session.propertyName
            ? `Getting you set up for ${session.propertyName}. `
            : 'Getting you set up. '}
          About 2 minutes.
        </p>
      </div>
      <Card>
        {actionError ? (
          <p className="mb-4 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
            {actionError}
          </p>
        ) : null}

        <div className="space-y-4">
          <Field
            label="Business"
            placeholder="Vendor / business name"
            value={businessName}
            onChange={setBusinessName}
          />

          <label className="block">
            <span className="text-[13px] font-medium text-[#364153]">Trade</span>
            <select
              value={trade}
              onChange={(e) => setTrade(e.target.value)}
              className="mt-1.5 w-full rounded-[10px] border border-[#d1d5dc] bg-white px-3 py-2.5 text-[15px] text-[#0a0a0a] outline-none focus:border-[#186179] focus:ring-2 focus:ring-[#186179]/20"
            >
              <option value="">Trade / category</option>
              {VENDOR_TRADE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <Field
            label="Phone"
            placeholder="Phone number"
            value={phone}
            onChange={setPhone}
            type="tel"
          />
          <Field
            label="Email"
            placeholder="Email"
            value={email}
            onChange={setEmail}
            type="email"
          />
          <Field
            label="License number"
            hint="Optional · Recommended for licensed trades"
            value={licenseNumber}
            onChange={setLicenseNumber}
          />
          <Field
            label="Insurance"
            hint="Optional · Recommended — $500K minimum GL"
            placeholder="Coverage amount"
            value={insurance}
            onChange={setInsurance}
          />

          <label htmlFor={ackId} className="flex cursor-pointer items-start gap-3 pt-1">
            <input
              id={ackId}
              type="checkbox"
              className={`mt-0.5 ${checkboxInputClassName}`}
              checked={attested}
              disabled={busy}
              onChange={(event) => setAttested(event.target.checked)}
            />
            <span className="text-[14px] leading-5 text-[#364153]">
              {VENDOR_SELF_REPRESENTATION_ACK_BODY}{' '}
              (Links to{' '}
              <Link
                to={TERMS_SECTION_6_3_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#186179] underline underline-offset-2 hover:text-[#0f4a5c]"
                onClick={(event) => event.stopPropagation()}
              >
                Terms Section 6.3
              </Link>
              )
            </span>
          </label>

          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={async () => {
              if (!canSubmit) return
              setBusy(true)
              setActionError(null)
              try {
                const gl = parseOptionalUsdAmount(insurance)
                const { session: s } = await submitVendorVerification(token, {
                  businessName,
                  email,
                  phone,
                  tradeCategories: [trade],
                  licenseNumber,
                  coiGeneralLiability: gl,
                  progress: {
                    self_representation_attestation: vendorSelfRepresentationAckProgressPatch(),
                  },
                })
                setSession(s)
                editingAfterSubmitRef.current = false
                setCompleted(true)
              } catch (err) {
                setActionError(getErrorMessage(err, 'Something went wrong. Try again.'))
              } finally {
                setBusy(false)
              }
            }}
            className="inline-flex w-full items-center justify-center rounded-[10px] bg-[#187960] px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#14654f] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Submit'}
          </button>
        </div>
      </Card>
    </Shell>
  )
}

export default VendorIntakePortal
