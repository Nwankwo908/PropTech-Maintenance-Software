import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fileToBase64,
  resolveVendorVerification,
  submitVendorVerification,
  uploadVendorDocument,
  type VendorVerificationDocument,
  type VendorVerificationSession,
} from '@/api/vendorVerification'
import { checkboxInputClassName } from '@/components/TableCheckbox'
import { getErrorMessage } from '@/lib/errorMessage'
import {
  TERMS_SECTION_6_3_HREF,
  VENDOR_SELF_REPRESENTATION_ACK_BODY,
  vendorSelfRepresentationAckFromProgress,
  vendorSelfRepresentationAckProgressPatch,
} from '@/lib/vendorSelfRepresentationAck'
import { VENDOR_TRADE_OPTIONS } from '@/lib/vendorTrades'
import { US_STATE_OPTIONS, citiesForState, usStateCodeFromLabel } from '@/lib/usLocations'

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
  className,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  className?: string
}) {
  return (
    <label className={['block min-w-0', className].filter(Boolean).join(' ')}>
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

function firstListValue(list?: string[]): string {
  return list?.find((item) => typeof item === 'string' && item.trim())?.trim() ?? ''
}

function parseCenterAddress(center?: string | null): {
  city: string
  state: string
  zip: string
} {
  const raw = (center ?? '').trim()
  if (!raw) return { city: '', state: '', zip: '' }
  const zipMatch = raw.match(/\b(\d{5})(?:-\d{4})?\b/)
  const zip = zipMatch?.[1] ?? ''
  const withoutZip = raw.replace(/\b\d{5}(?:-\d{4})?\b/g, '').replace(/,\s*$/, '').trim()
  const parts = withoutZip.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) {
    const state = usStateCodeFromLabel(parts[parts.length - 1])
    if (state) {
      return { city: parts.slice(0, -1).join(', '), state, zip }
    }
    return { city: parts[0]!, state: '', zip }
  }
  return { city: withoutZip, state: usStateCodeFromLabel(withoutZip), zip }
}

const TRAVEL_RADIUS_MIN = 5
const TRAVEL_RADIUS_MAX = 100
const TRAVEL_RADIUS_DEFAULT = 25

function clampTravelRadius(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return TRAVEL_RADIUS_DEFAULT
  return Math.min(TRAVEL_RADIUS_MAX, Math.max(TRAVEL_RADIUS_MIN, Math.round(n)))
}

function serviceAreaFieldsFromSession(session: VendorVerificationSession): {
  city: string
  state: string
  zip: string
  radiusMiles: number
} {
  const parsed = parseCenterAddress(session.serviceArea.centerAddress)
  return {
    city: firstListValue(session.serviceArea.cities) || parsed.city,
    state:
      usStateCodeFromLabel(firstListValue(session.serviceArea.counties)) || parsed.state,
    zip: firstListValue(session.serviceArea.zips) || parsed.zip,
    radiusMiles: clampTravelRadius(session.serviceArea.radiusMiles),
  }
}

function buildServiceAreaPatch(input: {
  city: string
  state: string
  zip: string
  radiusMiles: number
}): VendorVerificationSession['serviceArea'] {
  const city = input.city.trim()
  const state = usStateCodeFromLabel(input.state)
  const zip = input.zip.trim()
  const centerAddress = [city, state, zip].filter(Boolean).join(', ') || null
  return {
    cities: city ? [city] : [],
    counties: state ? [state] : [],
    zips: zip ? [zip] : [],
    radiusMiles: clampTravelRadius(input.radiusMiles),
    centerAddress,
  }
}

const portalSelectClass =
  'mt-1.5 w-full cursor-pointer appearance-none rounded-[10px] border border-[#d1d5dc] bg-white py-2.5 pl-3 pr-10 text-[15px] outline-none transition-colors focus:border-[#186179] focus:ring-2 focus:ring-[#186179]/20'

function SelectChevron() {
  return (
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6a7282]" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" className="size-4">
        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      </svg>
    </span>
  )
}

function TravelRadiusSlider({
  miles,
  onChange,
}: {
  miles: number
  onChange: (value: number) => void
}) {
  const pct =
    ((clampTravelRadius(miles) - TRAVEL_RADIUS_MIN) /
      (TRAVEL_RADIUS_MAX - TRAVEL_RADIUS_MIN)) *
    100
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-[#364153]">How far will you travel?</span>
        <span className="text-[15px] font-semibold tabular-nums text-[#186179]">
          {clampTravelRadius(miles)} mi
        </span>
      </div>
      <input
        type="range"
        min={TRAVEL_RADIUS_MIN}
        max={TRAVEL_RADIUS_MAX}
        step={5}
        value={clampTravelRadius(miles)}
        onChange={(event) => onChange(clampTravelRadius(event.target.value))}
        aria-label="Travel radius in miles"
        className="ulo-travel-radius mt-3 w-full cursor-pointer"
        style={{ ['--ulo-radius-pct' as string]: `${pct}%` }}
      />
      <div className="mt-1 flex justify-between text-[11px] leading-4 text-[#6a7282]">
        <span>{TRAVEL_RADIUS_MIN} mi</span>
        <span>{TRAVEL_RADIUS_MAX} mi</span>
      </div>
    </div>
  )
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
  const [serviceCity, setServiceCity] = useState('')
  const [serviceState, setServiceState] = useState('')
  const [serviceZip, setServiceZip] = useState('')
  const [travelRadiusMiles, setTravelRadiusMiles] = useState(TRAVEL_RADIUS_DEFAULT)
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
      const area = serviceAreaFieldsFromSession(s)
      setServiceCity(area.city)
      setServiceState(area.state)
      setServiceZip(area.zip)
      setTravelRadiusMiles(area.radiusMiles)
      setAttested(vendorSelfRepresentationAckFromProgress(s.progress))
    } else {
      setLicenseNumber((prev) => s.license.number ?? prev)
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
    const area = serviceAreaFieldsFromSession(s)
    setServiceCity(area.city)
    setServiceState(area.state)
    setServiceZip(area.zip)
    setTravelRadiusMiles(area.radiusMiles)
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
    Boolean(serviceState.trim()) &&
    Boolean(serviceCity.trim()) &&
    Boolean(/^\d{5}(?:-\d{4})?$/.test(serviceZip.trim())) &&
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
            hint="Recommended for licensed trades"
            value={licenseNumber}
            onChange={setLicenseNumber}
          />
          <div>
            <span className="text-[13px] font-medium text-[#364153]">Insurance</span>
            <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">
              Recommended — At least $500,000 in General Liability insurance coverage.
            </p>
            <div className="mt-1.5 space-y-2">
              <FileUpload
                label="Upload certificate of insurance (PDF or photo)"
                accept="image/*,application/pdf"
                busy={busy}
                done={session.documents.some((d) => d.kind === 'coi')}
                onFile={async (file) => {
                  setBusy(true)
                  setActionError(null)
                  try {
                    const b64 = await fileToBase64(file)
                    const { session: s } = await uploadVendorDocument(token, {
                      kind: 'coi',
                      fileName: file.name,
                      contentType: file.type || 'application/octet-stream',
                      dataBase64: b64,
                    })
                    setSession(s)
                  } catch (err) {
                    setActionError(getErrorMessage(err, 'Could not upload that file. Try again.'))
                  } finally {
                    setBusy(false)
                  }
                }}
              />
              <UploadedDocs docs={session.documents.filter((d) => d.kind === 'coi')} />
            </div>
          </div>

          <div className="border-t border-[#f3f4f6] pt-4">
            <h2 className="text-[15px] font-semibold text-[#0a0a0a]">Where do you provide service?</h2>
            <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">
              We’ll use this to send jobs near you.
            </p>
            <div className="mt-3 space-y-4">
              <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(4.75rem,0.7fr)] gap-2">
                <label className="block min-w-0">
                  <span className="text-[13px] font-medium text-[#364153]">State</span>
                  <div className="relative">
                    <select
                      value={serviceState}
                      onChange={(event) => {
                        const next = event.target.value
                        setServiceState(next)
                        const allowed = citiesForState(next)
                        if (serviceCity && !allowed.includes(serviceCity)) setServiceCity('')
                      }}
                      className={`${portalSelectClass} ${!serviceState ? 'text-[#9ca3af]' : 'text-[#0a0a0a]'}`}
                      aria-label="Service state"
                    >
                      <option value="">State</option>
                      {US_STATE_OPTIONS.map((state) => (
                        <option key={state.code} value={state.code}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                    <SelectChevron />
                  </div>
                </label>
                <label className="block min-w-0">
                  <span className="text-[13px] font-medium text-[#364153]">City</span>
                  <div className="relative">
                    <select
                      value={serviceCity}
                      onChange={(event) => setServiceCity(event.target.value)}
                      disabled={!serviceState}
                      className={`${portalSelectClass} ${!serviceCity ? 'text-[#9ca3af]' : 'text-[#0a0a0a]'} disabled:cursor-not-allowed disabled:bg-[#f9fafb] disabled:text-[#9ca3af]`}
                      aria-label="Service city"
                    >
                      <option value="">
                        {serviceState ? 'Select city' : 'Select state first'}
                      </option>
                      {(serviceCity && !citiesForState(serviceState).includes(serviceCity)
                        ? [serviceCity, ...citiesForState(serviceState)]
                        : citiesForState(serviceState)
                      ).map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))}
                    </select>
                    <SelectChevron />
                  </div>
                </label>
                <Field
                  label="ZIP"
                  placeholder="60614"
                  value={serviceZip}
                  onChange={setServiceZip}
                />
              </div>
              <TravelRadiusSlider miles={travelRadiusMiles} onChange={setTravelRadiusMiles} />
            </div>
          </div>

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
                const { session: s } = await submitVendorVerification(token, {
                  businessName,
                  email,
                  phone,
                  tradeCategories: [trade],
                  licenseNumber,
                  serviceArea: buildServiceAreaPatch({
                    city: serviceCity,
                    state: serviceState,
                    zip: serviceZip,
                    radiusMiles: travelRadiusMiles,
                  }),
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

function UploadedDocs({ docs }: { docs: VendorVerificationDocument[] }) {
  if (docs.length === 0) return null
  return (
    <ul className="space-y-2">
      {docs.map((doc) => {
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
