import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  buildVendorIntakeJobDetails,
  emptyVendorIntakeForm,
  readVendorIntakeSubmission,
  submitVendorIntakeForm,
  type VendorIntakeFormData,
  type VendorIntakeSession,
  type VendorIntakeSubmission,
} from '@/lib/vendorIntakeForm'
import {
  vendorPricingWorkOrderConfirmedBody,
  vendorPricingWorkOrderConfirmedHeadline,
} from '@/lib/vendorOutreachCopy'
import {
  isVendorPricingConfirmedByVendor,
  markVendorPricingConfirmed,
} from '@/lib/vendorPricingConfirmation'
import {
  isCoiScanProcessing,
  scanCoiDocument,
  type CoiScanProgress,
} from '@/lib/vendorCoiDocumentScanner'

const STEPS = [
  { id: 'insurance', label: 'Insurance', title: 'Insurance details' },
  { id: 'pricing', label: 'Pricing', title: 'Your rates' },
  { id: 'availability', label: 'Availability', title: 'Your availability' },
] as const

function UploadIcon() {
  return (
    <svg className="size-5 text-[#155dfc]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M12 16V4m0 0 4 4m-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" strokeLinecap="round" />
    </svg>
  )
}

function SparkleIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.2 4.2L17.5 8 13.2 9.2 12 13.5 10.8 9.2 6.5 8l4.3-1.8L12 2z" />
    </svg>
  )
}

function CoiScanBanner({
  scan,
  confidence,
}: {
  scan: CoiScanProgress
  confidence: number | null
}) {
  if (scan.stage === 'failed') {
    return (
      <div className="rounded-[12px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2.5">
        <p className="text-[12px] font-medium text-[#b91c1c]">{scan.label}</p>
        <p className="mt-0.5 text-[11px] text-[#991b1b]">Enter insurance details manually below.</p>
      </div>
    )
  }

  if (isCoiScanProcessing(scan.stage)) {
    return (
      <div className="rounded-[12px] border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-[#155dfc]" aria-hidden />
          <p className="text-[12px] font-medium text-[#1d4ed8]">{scan.label}</p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#dbeafe]">
          <div
            className="h-full rounded-full bg-[#155dfc] transition-all duration-300"
            style={{ width: `${scan.progress}%` }}
          />
        </div>
      </div>
    )
  }

  if (scan.stage === 'complete' && confidence != null) {
    return (
      <div className="rounded-[12px] border border-[#a4f4cf] bg-[#ecfdf5] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-[#047857]">
          <SparkleIcon className="size-3.5 text-[#047857]" />
          Document scanner filled insurance details from your COI
        </p>
        <p className="mt-0.5 text-[11px] text-[#047857]">
          Review and edit if needed · {Math.round(confidence * 100)}% extraction confidence
        </p>
      </div>
    )
  }

  return null
}

function CalendarIcon() {
  return (
    <svg className="size-4 text-[#9ca3af]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
    </svg>
  )
}

function MapPinIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  )
}

function WrenchIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-3.3-3.3 2.1-2.1Z" strokeLinejoin="round" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckSquareIcon() {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 12l2.5 2.5L16 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function WizardProgress({ step }: { step: number }) {
  const percent = ((step + 1) / STEPS.length) * 100
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[12px] font-medium text-[#6a7282]">
        <span>{`Step ${step + 1} of ${STEPS.length}`}</span>
        <span>{STEPS[step].label}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[#e5e7eb]">
        <div
          className="h-full rounded-full bg-[#00a669] transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function TogglePair({
  value,
  onChange,
  options,
}: {
  value: string | boolean | null
  onChange: (next: string | boolean) => void
  options: Array<{ value: string | boolean; label: string }>
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className={`inline-flex h-11 items-center justify-center rounded-[12px] border px-3 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 ${
              selected
                ? 'border-[#101828] bg-[#f9fafb] text-[#0a0a0a]'
                : 'border-[#e5e7eb] bg-white text-[#364153] hover:bg-[#f9fafb]'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function FieldLabel({
  title,
  hint,
  htmlFor,
}: {
  title: string
  hint?: string
  htmlFor?: string
}) {
  return (
    <div className="mb-2">
      <label htmlFor={htmlFor} className="block text-[14px] font-semibold text-[#0a0a0a]">
        {title}
      </label>
      {hint ? <p className="mt-0.5 text-[12px] leading-[18px] text-[#6a7282]">{hint}</p> : null}
    </div>
  )
}

function formatRate(value: string, suffix = ''): string {
  const digits = value.replace(/[^\d.]/g, '')
  if (!digits) return '—'
  const num = Number(digits)
  if (!Number.isFinite(num)) return value.trim() || '—'
  return `$${num.toLocaleString(undefined, { maximumFractionDigits: 0 })}${suffix}`
}

function SuccessView() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f9fafb] px-6 py-12">
      <div className="w-full max-w-md rounded-[20px] border border-[#e5e7eb] bg-white p-8 text-center shadow-[0px_8px_24px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#ecfdf5] text-[#007a55]">
          <CheckSquareIcon />
        </div>
        <h1 className="mt-4 text-[22px] font-bold tracking-[-0.3px] text-[#0a0a0a]">
          {vendorPricingWorkOrderConfirmedHeadline()}
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-[#6a7282]">
          {vendorPricingWorkOrderConfirmedBody()}
        </p>
      </div>
    </div>
  )
}

function PricingConfirmationView({
  vendorName,
  submission,
  confirming,
  onConfirm,
}: {
  vendorName: string
  submission: VendorIntakeSubmission
  confirming: boolean
  onConfirm: () => void
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[#f9fafb] px-6 py-12">
      <div className="w-full max-w-md rounded-[20px] border border-[#e5e7eb] bg-white p-8 shadow-[0px_8px_24px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#eff6ff] text-[#155dfc]">
          <CheckSquareIcon />
        </div>
        <h1 className="mt-4 text-center text-[22px] font-bold tracking-[-0.3px] text-[#0a0a0a]">
          Confirm your rates
        </h1>
        <p className="mt-2 text-center text-[14px] leading-6 text-[#6a7282]">
          Thanks{vendorName ? `, ${vendorName.split(' ')[0]}` : ''}. Your quick form is on file. Confirm
          the pricing below — the property manager must also agree before you&apos;re assigned.
        </p>

        <div className="mt-6 space-y-3 rounded-[14px] border border-[#e5e7eb] bg-[#f9fafb] p-4">
          <div className="flex items-start justify-between gap-3">
            <span className="text-[13px] text-[#6a7282]">Service call fee</span>
            <span className="text-[13px] font-semibold text-[#0a0a0a]">
              {formatRate(submission.pricing.serviceCallFee)}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-[13px] text-[#6a7282]">Hourly labor rate</span>
            <span className="text-[13px] font-semibold text-[#0a0a0a]">
              {formatRate(submission.pricing.hourlyRate, '/hr')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="text-[13px] text-[#6a7282]">Emergency jobs</span>
            <span className="text-[13px] font-semibold text-[#0a0a0a]">
              {submission.pricing.acceptsEmergency ? 'Yes' : 'No'}
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={confirming}
          onClick={onConfirm}
          className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] bg-[#00a669] px-4 text-[15px] font-semibold text-white outline-none transition-colors hover:bg-[#009966] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          <CheckSquareIcon />
          {confirming ? 'Confirming…' : 'Confirm pricing'}
        </button>
      </div>
    </div>
  )
}

export type VendorIntakeWizardProps = {
  session: VendorIntakeSession
}

export function VendorIntakeWizard({ session }: VendorIntakeWizardProps) {
  const coiInputId = useId()
  const coiScanAbortRef = useRef<AbortController | null>(null)
  const existingSubmission = useMemo(
    () => readVendorIntakeSubmission(session.conversationId),
    [session.conversationId],
  )
  const [step, setStep] = useState(0)
  const [submitted, setSubmitted] = useState(existingSubmission != null)
  const [vendorPricingConfirmed, setVendorPricingConfirmed] = useState(() =>
    isVendorPricingConfirmedByVendor(session.conversationId),
  )
  const [form, setForm] = useState<VendorIntakeFormData>(
    existingSubmission ?? emptyVendorIntakeForm(),
  )
  const [submitting, setSubmitting] = useState(false)
  const [confirmingPricing, setConfirmingPricing] = useState(false)
  const [coiScan, setCoiScan] = useState<CoiScanProgress>({
    stage: 'idle',
    label: '',
    progress: 0,
  })
  const [coiScanConfidence, setCoiScanConfidence] = useState<number | null>(null)

  const jobDetails = useMemo(() => buildVendorIntakeJobDetails(session), [session])
  const coiScanning = isCoiScanProcessing(coiScan.stage)

  useEffect(() => {
    return () => {
      coiScanAbortRef.current?.abort()
    }
  }, [])

  function updateInsurance(patch: Partial<VendorIntakeFormData['insurance']>) {
    setForm((current) => ({ ...current, insurance: { ...current.insurance, ...patch } }))
  }

  function updatePricing(patch: Partial<VendorIntakeFormData['pricing']>) {
    setForm((current) => ({ ...current, pricing: { ...current.pricing, ...patch } }))
  }

  function updateAvailability(patch: Partial<VendorIntakeFormData['availability']>) {
    setForm((current) => ({ ...current, availability: { ...current.availability, ...patch } }))
  }

  async function handleCoiUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    coiScanAbortRef.current?.abort()
    const controller = new AbortController()
    coiScanAbortRef.current = controller

    setCoiScanConfidence(null)
    setCoiScan({ stage: 'uploading', label: 'Uploading COI…', progress: 5 })
    updateInsurance({
      coiFileName: file.name,
      generalLiability: '',
      workersComp: null,
      policyExpiration: '',
    })

    try {
      const result = await scanCoiDocument(
        file,
        (progress) => setCoiScan(progress),
        controller.signal,
      )
      updateInsurance({
        coiFileName: result.fileName,
        generalLiability: result.extracted.generalLiability,
        workersComp: result.extracted.workersComp,
        policyExpiration: result.extracted.policyExpiration,
      })
      setCoiScanConfidence(result.confidence)
    } catch {
      if (controller.signal.aborted) return
      setCoiScan({
        stage: 'failed',
        label: 'Could not read this COI — try a clearer scan or PDF.',
        progress: 0,
      })
    } finally {
      event.target.value = ''
    }
  }

  const insuranceValid =
    !coiScanning &&
    form.insurance.generalLiability.trim().length > 0 &&
    form.insurance.workersComp != null &&
    form.insurance.policyExpiration.trim().length > 0

  const pricingValid =
    form.pricing.serviceCallFee.trim().length > 0 &&
    form.pricing.hourlyRate.trim().length > 0 &&
    form.pricing.acceptsEmergency != null

  const availabilityValid = form.availability.canTakeJobToday != null

  const activeSubmission = useMemo(
    () => (submitted ? readVendorIntakeSubmission(session.conversationId) ?? existingSubmission : null),
    [submitted, session.conversationId, existingSubmission],
  )

  if (submitted && vendorPricingConfirmed) {
    return <SuccessView />
  }

  if (submitted && activeSubmission) {
    return (
      <PricingConfirmationView
        vendorName={session.vendorName}
        submission={activeSubmission}
        confirming={confirmingPricing}
        onConfirm={() => {
          setConfirmingPricing(true)
          markVendorPricingConfirmed(session.conversationId)
          setVendorPricingConfirmed(true)
          setConfirmingPricing(false)
        }}
      />
    )
  }

  return (
    <div className="min-h-dvh bg-[#f9fafb] px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 rounded-[20px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
          <WizardProgress step={step} />

          <div className="mt-6">
            {step === 0 ? (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[24px] font-bold tracking-[-0.4px] text-[#0a0a0a]">
                    {STEPS[0].title}
                  </h1>
                  <p className="mt-1 text-[14px] leading-6 text-[#6a7282]">
                    We need proof of insurance to protect the property and tenant.
                  </p>
                </div>

                <div>
                  <FieldLabel title="Certificate of Insurance (COI)" htmlFor={coiInputId} />
                  <label
                    htmlFor={coiInputId}
                    className={`flex flex-col items-center justify-center rounded-[14px] border border-dashed px-4 py-8 text-center transition-colors ${
                      coiScanning
                        ? 'cursor-wait border-[#bfdbfe] bg-[#eff6ff]'
                        : 'cursor-pointer border-[#d1d5db] bg-[#fafafa] hover:border-[#155dfc] hover:bg-[#f8fbff]'
                    }`}
                  >
                    <UploadIcon />
                    <span className="mt-2 text-[13px] font-medium text-[#155dfc]">
                      {form.insurance.coiFileName ?? 'Upload COI document'}
                    </span>
                    <span className="mt-1 text-[11px] text-[#9ca3af]">
                      PDF, JPG, or PNG · max 10 MB · document scanner auto-fills details
                    </span>
                    <input
                      id={coiInputId}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="sr-only"
                      disabled={coiScanning}
                      onChange={(event) => void handleCoiUpload(event)}
                    />
                  </label>
                  {coiScan.stage !== 'idle' ? (
                    <div className="mt-3">
                      <CoiScanBanner scan={coiScan} confidence={coiScanConfidence} />
                    </div>
                  ) : null}
                </div>

                <div className={coiScanning ? 'pointer-events-none opacity-60' : undefined}>
                  <FieldLabel title="General Liability coverage" />
                  <div className="flex h-11 items-center rounded-[12px] border border-[#e5e7eb] bg-white px-3">
                    <span className="mr-2 text-[14px] text-[#6a7282]">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.insurance.generalLiability}
                      onChange={(event) => updateInsurance({ generalLiability: event.target.value })}
                      placeholder="e.g. 1,000,000"
                      disabled={coiScanning}
                      className="h-full w-full bg-transparent text-[14px] text-[#0a0a0a] outline-none placeholder:text-[#9ca3af]"
                    />
                  </div>
                </div>

                <div className={coiScanning ? 'pointer-events-none opacity-60' : undefined}>
                  <FieldLabel title="Workers' Compensation" />
                  <TogglePair
                    value={form.insurance.workersComp}
                    onChange={(next) => updateInsurance({ workersComp: next as 'active' | 'inactive' })}
                    options={[
                      { value: 'active', label: 'Active' },
                      { value: 'inactive', label: 'Not active' },
                    ]}
                  />
                </div>

                <div className={coiScanning ? 'pointer-events-none opacity-60' : undefined}>
                  <FieldLabel title="Policy expiration date" />
                  <div className="relative flex h-11 items-center rounded-[12px] border border-[#e5e7eb] bg-white px-3">
                    <input
                      type="date"
                      value={form.insurance.policyExpiration}
                      onChange={(event) => updateInsurance({ policyExpiration: event.target.value })}
                      disabled={coiScanning}
                      className="h-full w-full bg-transparent text-[14px] text-[#0a0a0a] outline-none"
                    />
                    <CalendarIcon />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!insuranceValid}
                  onClick={() => setStep(1)}
                  className="inline-flex h-12 w-full items-center justify-center rounded-[14px] bg-[#00a669] text-[15px] font-semibold text-white outline-none transition-colors hover:bg-[#009966] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                >
                  Continue →
                </button>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[24px] font-bold tracking-[-0.4px] text-[#0a0a0a]">
                    {STEPS[1].title}
                  </h1>
                  <p className="mt-1 text-[14px] leading-6 text-[#6a7282]">
                    We'll share these rates with the property manager before you're assigned.
                  </p>
                </div>

                <div>
                  <FieldLabel
                    title="Service call fee"
                    hint="Charged just to show up, before any work begins"
                  />
                  <div className="flex h-11 items-center rounded-[12px] border border-[#e5e7eb] bg-white px-3">
                    <span className="mr-2 text-[14px] text-[#6a7282]">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.pricing.serviceCallFee}
                      onChange={(event) => updatePricing({ serviceCallFee: event.target.value })}
                      placeholder="0"
                      className="h-full w-full bg-transparent text-[14px] text-[#0a0a0a] outline-none placeholder:text-[#9ca3af]"
                    />
                  </div>
                </div>

                <div>
                  <FieldLabel title="Hourly labor rate" />
                  <div className="flex gap-2">
                    <div className="flex h-11 min-w-0 flex-1 items-center rounded-[12px] border border-[#e5e7eb] bg-white px-3">
                      <span className="mr-2 text-[14px] text-[#6a7282]">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={form.pricing.hourlyRate}
                        onChange={(event) => updatePricing({ hourlyRate: event.target.value })}
                        placeholder="0"
                        className="h-full w-full bg-transparent text-[14px] text-[#0a0a0a] outline-none placeholder:text-[#9ca3af]"
                      />
                    </div>
                    <div className="inline-flex h-11 items-center rounded-[12px] border border-[#e5e7eb] bg-[#f9fafb] px-3 text-[13px] font-medium text-[#6a7282]">
                      /hr
                    </div>
                  </div>
                </div>

                <div>
                  <FieldLabel title="Do you accept emergency jobs?" />
                  <TogglePair
                    value={form.pricing.acceptsEmergency}
                    onChange={(next) => updatePricing({ acceptsEmergency: next as boolean })}
                    options={[
                      { value: true, label: 'Yes' },
                      { value: false, label: 'No' },
                    ]}
                  />
                </div>

                <div className="grid grid-cols-[auto,1fr] gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(0)}
                    className="inline-flex h-12 items-center justify-center rounded-[14px] border border-[#e5e7eb] bg-white px-5 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={!pricingValid}
                    onClick={() => setStep(2)}
                    className="inline-flex h-12 items-center justify-center rounded-[14px] bg-[#00a669] px-5 text-[15px] font-semibold text-white outline-none transition-colors hover:bg-[#009966] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    Continue →
                  </button>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-5">
                <div>
                  <h1 className="text-[24px] font-bold tracking-[-0.4px] text-[#0a0a0a]">
                    {STEPS[2].title}
                  </h1>
                  <p className="mt-1 text-[14px] leading-6 text-[#6a7282]">
                    The tenant is waiting — let us know if you can take this today.
                  </p>
                </div>

                <div className="rounded-[14px] border border-[#bfdbfe] bg-[#eff6ff] p-4">
                  <p className="text-[13px] font-semibold text-[#1d4ed8]">Job details</p>
                  <ul className="mt-3 space-y-2 text-[13px] leading-5 text-[#1d4ed8]">
                    <li className="flex items-start gap-2">
                      <MapPinIcon />
                      <span>{jobDetails.locationLine}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <WrenchIcon />
                      <span>{jobDetails.tradeLine}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <ClockIcon />
                      <span>{jobDetails.urgencyLine}</span>
                    </li>
                  </ul>
                </div>

                <div>
                  <FieldLabel title="Can you take this job today?" />
                  <TogglePair
                    value={form.availability.canTakeJobToday}
                    onChange={(next) => updateAvailability({ canTakeJobToday: next as boolean })}
                    options={[
                      { value: true, label: "Yes, I'm available" },
                      { value: false, label: 'No, not today' },
                    ]}
                  />
                </div>

                <div>
                  <FieldLabel title="Anything else to add? (optional)" />
                  <textarea
                    value={form.availability.notes}
                    onChange={(event) => updateAvailability({ notes: event.target.value })}
                    rows={4}
                    placeholder="e.g. I need access to the basement shutoff, or parts may need to be sourced..."
                    className="w-full resize-none rounded-[12px] border border-[#e5e7eb] bg-white px-3 py-2.5 text-[14px] leading-6 text-[#0a0a0a] outline-none placeholder:text-[#9ca3af] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                  />
                </div>

                <div className="grid grid-cols-[auto,1fr] gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="inline-flex h-12 items-center justify-center rounded-[14px] border border-[#e5e7eb] bg-white px-5 text-[14px] font-medium text-[#0a0a0a] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={!availabilityValid || submitting}
                    onClick={() => {
                      setSubmitting(true)
                      submitVendorIntakeForm(session, form)
                      setSubmitted(true)
                      setSubmitting(false)
                    }}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-[#00a669] px-4 text-[14px] font-semibold text-white outline-none transition-colors hover:bg-[#009966] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <CheckSquareIcon />
                    {submitting ? 'Submitting…' : 'Submit quick form'}
                  </button>
                </div>

                <p className="text-center text-[11px] leading-4 text-[#9ca3af]">
                  By submitting, you confirm this information is accurate. You&apos;ll confirm pricing
                  on the next step; the property manager must agree before assignment.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <p className="text-center text-[11px] text-[#9ca3af]">
          Quick verification form · {session.vendorName}
        </p>
      </div>
    </div>
  )
}

export default VendorIntakeWizard
