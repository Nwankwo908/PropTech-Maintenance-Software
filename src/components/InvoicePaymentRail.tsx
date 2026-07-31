import { useEffect, useId, useState } from 'react'
import {
  ADMIN_RIGHT_RAIL_OVERLAY_HOST,
  ADMIN_RIGHT_RAIL_SCRIM,
  adminRightRailPanelClass,
} from '@/lib/adminRightRail'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import { supabase } from '@/lib/supabase'
import {
  createInvoicePaymentCheckout,
  paymentIconToCheckoutMethod,
  type InvoiceCheckoutPaymentMethod,
} from '@/api/invoicePaymentCheckout'
import applePayIcon from '@/assets/payment/apple-pay.png'
import achBankIcon from '@/assets/payment/ach-bank.png'
import afterpayIcon from '@/assets/payment/afterpay.png'
import klarnaIcon from '@/assets/payment/klarna.png'
import creditCardIcon from '@/assets/payment/credit-card.png'
import chevronRightIcon from '@/assets/payment/chevron-right.svg'
import { getErrorMessage } from '@/lib/errorMessage'

export type InvoicePaymentReview = {
  invoiceId: string
  maintenanceRequestId: string
  totalCost: number
  laborCost: number
  materialCost: number
  taxAmount: number
  unit: string
  building: string | null
  residentName: string
  vendorName: string
  vendorId: string | null
  issueCategory: string | null
  submittedAt: string
  /** Tenant rating for this job (1–5). */
  rating: number | null
  invoiceNumber: string | null
  documentPath: string | null
  /** Vendor roster average when available. */
  vendorRating: number | null
  vendorReviewCount: number | null
}

type RailStep = 'review' | 'confirm' | 'addMethod' | 'addCard' | 'success'

export type InvoicePaymentSuccessDetails = {
  amountPaid: number
  vendorName: string
  sourceLabel: string
  transactionId: string
  paidAt: string
  receiptUrl: string | null
  /** Calendar-year approved payments to this vendor after this payment. */
  ytdPaidTotal?: number | null
}

type PaymentIconId = 'apple' | 'ach' | 'afterpay' | 'klarna' | 'card'

type SavedPaymentMethod =
  | {
      kind: 'card'
      brand: string
      last4: string
      expMonth: string
      expYear: string
      icon: PaymentIconId
    }
  | {
      kind: 'wallet'
      brand: string
      icon: PaymentIconId
    }

type PaymentOptionId = 'apple_pay' | 'ach' | 'afterpay' | 'klarna' | 'card'

const PAYMENT_OPTIONS: Array<{
  id: PaymentOptionId
  label: string
  icon: PaymentIconId
}> = [
  { id: 'apple_pay', label: 'Apple Pay', icon: 'apple' },
  { id: 'ach', label: 'ACH Direct Debit', icon: 'ach' },
  { id: 'afterpay', label: 'Afterpay', icon: 'afterpay' },
  { id: 'klarna', label: 'Klarna', icon: 'klarna' },
  { id: 'card', label: 'Credit or Debit Card', icon: 'card' },
]

const WALLET_META: Record<
  Exclude<PaymentOptionId, 'card'>,
  { brand: string; icon: PaymentIconId }
> = {
  apple_pay: { brand: 'Apple Pay', icon: 'apple' },
  ach: { brand: 'ACH Direct Debit', icon: 'ach' },
  afterpay: { brand: 'Afterpay', icon: 'afterpay' },
  klarna: { brand: 'Klarna', icon: 'klarna' },
}

function iconFromBrand(brand: string): PaymentIconId {
  const normalized = brand.trim().toLowerCase()
  if (normalized.includes('apple')) return 'apple'
  if (normalized.includes('ach') || normalized.includes('bank')) return 'ach'
  if (normalized.includes('afterpay')) return 'afterpay'
  if (normalized.includes('klarna')) return 'klarna'
  if (normalized.includes('paypal')) return 'ach'
  return 'card'
}

function paymentMethodStorageKey(): string {
  return `ulo.invoicePaymentMethod.${getActiveLandlordId()}`
}

function readSavedPaymentMethod(): SavedPaymentMethod | null {
  try {
    const raw = localStorage.getItem(paymentMethodStorageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedPaymentMethod> & {
      last4?: string
      expMonth?: string
      expYear?: string
      icon?: PaymentIconId
    }
    if (!parsed?.brand) return null
    const icon = parsed.icon ?? iconFromBrand(parsed.brand)
    if (parsed.kind === 'wallet') {
      return { kind: 'wallet', brand: parsed.brand, icon }
    }
    if (parsed.last4 && parsed.expMonth && parsed.expYear) {
      return {
        kind: 'card',
        brand: parsed.brand,
        last4: parsed.last4,
        expMonth: parsed.expMonth,
        expYear: parsed.expYear,
        icon: 'card',
      }
    }
    return null
  } catch {
    return null
  }
}

function writeSavedPaymentMethod(method: SavedPaymentMethod | null) {
  try {
    if (!method) {
      localStorage.removeItem(paymentMethodStorageKey())
      return
    }
    localStorage.setItem(paymentMethodStorageKey(), JSON.stringify(method))
  } catch {
    // ignore quota / private mode
  }
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatSubmittedDate(iso: string): string {
  if (!iso.trim()) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatLocation(unit: string, building: string | null): string {
  const unitLabel = unit.trim() ? `Unit ${unit.trim()}` : null
  const buildingLabel = building?.trim() || null
  if (unitLabel && buildingLabel) return `${unitLabel} · ${buildingLabel}`
  return unitLabel ?? buildingLabel ?? '—'
}

function formatServiceType(issueCategory: string | null): string {
  const trade = formatVendorTradeLabel(issueCategory, { emptyLabel: 'Maintenance' })
  if (/repair$/i.test(trade)) return trade
  return `${trade} Repair`
}

function formatInvoiceNumber(review: InvoicePaymentReview): string {
  if (review.invoiceNumber?.trim()) return review.invoiceNumber.trim()
  const year = review.submittedAt
    ? new Date(review.submittedAt).getFullYear()
    : new Date().getFullYear()
  const suffix = review.invoiceId.replace(/-/g, '').slice(0, 4).toUpperCase()
  return `INV-${year}-${suffix}`
}

function fileNameFromPath(path: string | null, invoiceNumber: string): string {
  if (path?.trim()) {
    const parts = path.trim().split('/')
    return parts[parts.length - 1] || path.trim()
  }
  const safe = invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, '')
  return `receipt_${safe || 'invoice'}.pdf`
}

function detectCardBrand(digits: string): string {
  if (/^4/.test(digits)) return 'Visa'
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'Mastercard'
  if (/^3[47]/.test(digits)) return 'Amex'
  if (/^6/.test(digits)) return 'Discover'
  return 'Card'
}

function CloseIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9 9l6 6M15 9l-6 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function WrenchIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.7 6.3a4.2 4.2 0 0 0-5.9 5.9L3 18l3 3 5.8-5.8a4.2 4.2 0 0 0 5.9-5.9l-2.5 2.5-2.5-2.5 2.5-2.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="size-3" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M6 1.2l1.35 2.74 3.02.44-2.18 2.13.52 3.01L6 8.05 3.29 9.52l.52-3.01L1.63 4.38l3.02-.44L6 1.2z"
        fill={filled ? '#f59e0b' : '#e5e7eb'}
      />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v10m0 0l3.5-3.5M12 14l-3.5-3.5M5 19h14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h12m0 0l-4-4m4 4l-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CreditCardIcon() {
  return (
    <svg className="size-6" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 15h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 11V8a4 4 0 1 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <img src={chevronRightIcon} alt="" className="size-4 shrink-0" aria-hidden />
  )
}

function ChevronDownIcon() {
  return (
    <svg className="size-3.5 shrink-0 text-[#6b7280]" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3.5 5.25L7 8.75L10.5 5.25"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="size-2.5" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path
        d="M1.5 5.2L3.8 7.5L8.5 2.5"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PaymentOptionIcon({
  icon,
  size = 'option',
}: {
  icon: PaymentIconId
  size?: 'option' | 'selected'
}) {
  const shellClass =
    size === 'selected'
      ? 'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#e5e7eb] bg-[#f9fafb] text-[#111827]'
      : 'flex h-7 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-[#e5e7eb] bg-[#f9fafb] text-[#111827]'

  const src =
    icon === 'apple'
      ? applePayIcon
      : icon === 'ach'
        ? achBankIcon
        : icon === 'afterpay'
          ? afterpayIcon
          : icon === 'klarna'
            ? klarnaIcon
            : creditCardIcon

  const imgClass =
    icon === 'klarna'
      ? 'h-full w-full object-cover'
      : icon === 'card'
        ? size === 'selected'
          ? 'h-5 w-6 object-contain'
          : 'h-4 w-5 object-contain'
        : size === 'selected'
          ? 'size-6 object-contain'
          : 'size-5 object-contain'

  return (
    <div className={shellClass}>
      <img src={src} alt="" className={imgClass} aria-hidden />
    </div>
  )
}

function paymentMethodLabel(method: SavedPaymentMethod): string {
  if (method.kind === 'wallet') return method.brand
  return `${method.brand} ···· ${method.last4}`
}

function paymentMethodSubtitle(method: SavedPaymentMethod): string | null {
  if (method.kind === 'wallet') {
    if (method.icon === 'ach') return 'US bank account'
    return 'Digital wallet'
  }
  return `Expires ${method.expMonth}/${method.expYear.slice(-2)}`
}

function DocumentThumb() {
  return (
    <div className="flex h-[52px] w-10 shrink-0 flex-col overflow-hidden rounded-[4px] border border-[#e5e7eb] bg-white">
      <div className="flex flex-1 items-center justify-center bg-[#f3f4f6]">
        <span className="text-[8px] font-bold tracking-wide text-[#9ca3af]">PDF</span>
      </div>
      <div className="space-y-0.5 px-1 py-1">
        <div className="h-0.5 rounded bg-[#e5e7eb]" />
        <div className="h-0.5 w-3/4 rounded bg-[#e5e7eb]" />
        <div className="h-0.5 w-1/2 rounded bg-[#e5e7eb]" />
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-[#e5e7eb] bg-white px-3 py-2.5 text-[14px] text-[#111827] outline-none placeholder:text-[#9ca3af] focus:border-[#065f46] focus:ring-1 focus:ring-[#065f46]'

const fieldLabelClass = 'mb-1.5 block text-[12px] font-semibold uppercase text-[#4b5563]'

const CARD_COUNTRIES = [
  'United States',
  'Canada',
  'United Kingdom',
  'Australia',
] as const

function formatCardNumberDisplay(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 19)
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

function formatExpirationDisplay(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)} / ${digits.slice(2)}`
}

function parseExpiration(value: string): { month: string; year: string } | null {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 4) return null
  const month = digits.slice(0, 2)
  const year = digits.slice(2, 4)
  const monthNum = Number(month)
  if (monthNum < 1 || monthNum > 12) return null
  return { month, year }
}

type InvoicePaymentRailProps = {
  open: boolean
  review: InvoicePaymentReview | null
  saving: boolean
  error: string | null
  successDetails?: InvoicePaymentSuccessDetails | null
  onClose: () => void
  onApprove: (note?: string) => void
  onReject: () => void
}

function formatSuccessTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Right rail: Review → Confirm → Add Method → Payment Sent (Figma 1085:363 / 1085:544 / 1087:362 / 1085:467). */
export function InvoicePaymentRail({
  open,
  review,
  saving,
  error,
  successDetails = null,
  onClose,
  onApprove: _onApprove,
  onReject,
}: InvoicePaymentRailProps) {
  const titleId = useId()
  const [step, setStep] = useState<RailStep>(successDetails ? 'success' : 'review')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [downloadBusy, setDownloadBusy] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<SavedPaymentMethod | null>(null)
  const [cardNumber, setCardNumber] = useState('')
  const [expiration, setExpiration] = useState('')
  const [cvc, setCvc] = useState('')
  const [cardholderName, setCardholderName] = useState('')
  const [streetAddress, setStreetAddress] = useState('')
  const [city, setCity] = useState('')
  const [billingState, setBillingState] = useState('')
  const [zip, setZip] = useState('')
  const [country, setCountry] = useState<string>('United States')
  const [saveCard, setSaveCard] = useState(true)
  const [paymentNote, setPaymentNote] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [checkoutBusy, setCheckoutBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setStep('review')
      setCardNumber('')
      setExpiration('')
      setCvc('')
      setCardholderName('')
      setStreetAddress('')
      setCity('')
      setBillingState('')
      setZip('')
      setCountry('United States')
      setSaveCard(true)
      setPaymentNote('')
      setAddError(null)
      setCheckoutBusy(false)
      return
    }
    if (successDetails) {
      setStep('success')
      return
    }
    setStep('review')
    setPaymentMethod(readSavedPaymentMethod())
  }, [open, review?.invoiceId, successDetails])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || saving || checkoutBusy) return
      if (step === 'success') {
        onClose()
        return
      }
      if (step === 'addCard') {
        setStep('addMethod')
        setAddError(null)
        return
      }
      if (step === 'addMethod') {
        setStep('confirm')
        return
      }
      if (step === 'confirm') {
        setStep('review')
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, saving, checkoutBusy, onClose, step])

  useEffect(() => {
    setDownloadUrl(null)
    if (!open || !review?.documentPath?.trim() || !supabase) return

    let cancelled = false
    void (async () => {
      const path = review.documentPath!.trim()
      const buckets = ['maintenance-invoices', 'vendor-documents', 'maintenance_photos']
      for (const bucket of buckets) {
        const { data, error: signError } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, 3600)
        if (cancelled) return
        if (!signError && data?.signedUrl) {
          setDownloadUrl(data.signedUrl)
          return
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, review?.documentPath, review?.invoiceId])

  if (!open) return null

  if (step === 'success' && successDetails) {
    const amountLabel = formatMoney(successDetails.amountPaid)
    return (
      <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
        <div
          role="presentation"
          className={ADMIN_RIGHT_RAIL_SCRIM}
          aria-hidden
          onClick={onClose}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={adminRightRailPanelClass(undefined, 'max-w-[min(100vw,420px)]')}
        >
          <div className="flex min-h-0 flex-1 flex-col justify-between p-6">
            <div className="flex min-h-0 flex-1 flex-col justify-center gap-10 overflow-y-auto overscroll-contain">
              <div className="flex items-start justify-between">
                <span className="size-6 opacity-0" aria-hidden />
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-full bg-[#f9fafb] p-1.5 text-[#6b7280] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2"
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="flex flex-col items-center gap-4">
                <div className="flex size-[72px] items-center justify-center rounded-[36px] bg-[#f0fdf4] text-[#15803d]">
                  <svg className="size-8" viewBox="0 0 32 32" fill="none" aria-hidden>
                    <path
                      d="M8 16.5l5 5 11-12"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="flex w-full flex-col items-center gap-2 text-center">
                  <h2 id={titleId} className="text-[22px] font-bold text-[#111827]">
                    Payment Sent!
                  </h2>
                  <p className="max-w-[280px] text-[14px] text-[#4b5563]">
                    {amountLabel} has been successfully authorized and is on its way to{' '}
                    {successDetails.vendorName}.
                  </p>
                </div>
              </div>

              <div className="flex w-full flex-col gap-3 rounded-lg bg-[#f9fafb] p-4 text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#6b7280]">Recipient</span>
                  <span className="text-right font-semibold text-[#111827]">
                    {successDetails.vendorName}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#6b7280]">Amount Paid</span>
                  <span className="text-right font-semibold text-[#111827]">{amountLabel}</span>
                </div>
                {successDetails.ytdPaidTotal != null ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[#6b7280]">YTD paid to vendor</span>
                    <span className="text-right font-semibold text-[#111827]">
                      {formatMoney(successDetails.ytdPaidTotal)}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#6b7280]">Source</span>
                  <span className="text-right text-[#111827]">{successDetails.sourceLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#6b7280]">Transaction ID</span>
                  <span className="text-right text-[#111827]">
                    {successDetails.transactionId}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[#6b7280]">Timestamp</span>
                  <span className="text-right text-[#111827]">
                    {formatSuccessTimestamp(successDetails.paidAt)}
                  </span>
                </div>
              </div>
              <p className="rounded-lg border border-[#dbeafe] bg-[#eff6ff] px-3 py-2 text-center text-[12px] leading-4 text-[#1e40af]">
                Cumulative payment total updated for 1099-NEC tracking.
              </p>
            </div>

            <div className="mt-6 shrink-0 space-y-3">
              <button
                type="button"
                disabled={!successDetails.receiptUrl}
                onClick={() => {
                  if (!successDetails.receiptUrl) return
                  window.open(successDetails.receiptUrl, '_blank', 'noopener,noreferrer')
                }}
                className="flex w-full items-center justify-center rounded-lg border border-[#e5e7eb] p-3.5 text-[14px] font-semibold text-[#4b5563] outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                View transaction receipt
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex w-full items-center justify-center rounded-lg bg-[#111827] p-3.5 text-[14px] font-semibold text-white outline-none hover:bg-[#030712] focus-visible:ring-2 focus-visible:ring-[#111827] focus-visible:ring-offset-2"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!review) return null

  const invoiceNumber = formatInvoiceNumber(review)
  const displayRating =
    review.vendorRating != null && Number.isFinite(review.vendorRating)
      ? review.vendorRating
      : review.rating
  const reviewCount = review.vendorReviewCount
  const filledStars =
    displayRating != null ? Math.max(0, Math.min(5, Math.round(displayRating))) : 0
  const hasAttachment = Boolean(review.documentPath?.trim())
  const fileName = fileNameFromPath(review.documentPath, invoiceNumber)
  const canConfirmPay = paymentMethod != null && !saving && !checkoutBusy
  const busy = saving || checkoutBusy

  async function handleDownload() {
    if (!downloadUrl) return
    setDownloadBusy(true)
    try {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer')
    } finally {
      setDownloadBusy(false)
    }
  }

  function rememberMethodPreference(
    optionId: PaymentOptionId,
    cardDetails?: {
      brand: string
      last4: string
      expMonth: string
      expYear: string
    },
  ) {
    const option = PAYMENT_OPTIONS.find((entry) => entry.id === optionId)
    const icon = option?.icon ?? 'card'
    const method: SavedPaymentMethod =
      optionId === 'card' && cardDetails
        ? {
            kind: 'card',
            brand: cardDetails.brand,
            last4: cardDetails.last4,
            expMonth: cardDetails.expMonth,
            expYear: cardDetails.expYear,
            icon: 'card',
          }
        : optionId === 'card'
          ? {
              kind: 'card',
              brand: 'Card',
              last4: '····',
              expMonth: '••',
              expYear: '••••',
              icon: 'card',
            }
          : {
              kind: 'wallet',
              brand: WALLET_META[optionId].brand,
              icon,
            }
    writeSavedPaymentMethod(method)
    setPaymentMethod(method)
  }

  async function launchProviderCheckout(
    paymentMethodId: InvoiceCheckoutPaymentMethod,
  ) {
    setAddError(null)
    setCheckoutBusy(true)
    try {
      const { url } = await createInvoicePaymentCheckout({
        invoiceId: review.invoiceId,
        paymentMethod: paymentMethodId,
        note: paymentNote.trim() || undefined,
      })
      window.location.assign(url)
    } catch (err) {
      setAddError(
        getErrorMessage(err, 'Could not start payment checkout.'),
      )
      setCheckoutBusy(false)
    }
  }

  function handleSavePaymentMethod() {
    const digits = cardNumber.replace(/\D/g, '')
    if (digits.length < 12) {
      setAddError('Enter a valid card number.')
      return
    }
    const parsedExp = parseExpiration(expiration)
    if (!parsedExp) {
      setAddError('Enter a valid expiration date (MM / YY).')
      return
    }
    if (cvc.replace(/\D/g, '').length < 3) {
      setAddError('Enter a valid CVV.')
      return
    }
    if (!cardholderName.trim()) {
      setAddError('Enter the cardholder name.')
      return
    }
    if (!streetAddress.trim() || !city.trim() || !billingState.trim() || !zip.trim()) {
      setAddError('Enter a complete billing address.')
      return
    }

    rememberMethodPreference('card', {
      brand: detectCardBrand(digits),
      last4: digits.slice(-4),
      expMonth: parsedExp.month,
      expYear: `20${parsedExp.year}`,
    })
    void launchProviderCheckout('card')
  }

  function handleSelectPaymentOption(optionId: PaymentOptionId) {
    rememberMethodPreference(optionId)
    void launchProviderCheckout(optionId)
  }

  function openAddPaymentMethod() {
    setAddError(null)
    setCardNumber('')
    setExpiration('')
    setCvc('')
    setCardholderName('')
    setStreetAddress('')
    setCity('')
    setBillingState('')
    setZip('')
    setCountry('United States')
    setSaveCard(true)
    setStep('addMethod')
  }

  function resetCardFormAndBack() {
    setAddError(null)
    setStep('addMethod')
  }

  function handleConfirmAndPay() {
    if (!paymentMethod) return
    void launchProviderCheckout(paymentIconToCheckoutMethod(paymentMethod.icon))
  }

  return (
    <div className={ADMIN_RIGHT_RAIL_OVERLAY_HOST}>
      <div
        role="presentation"
        className={ADMIN_RIGHT_RAIL_SCRIM}
        aria-hidden
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={adminRightRailPanelClass(undefined, 'max-w-[min(100vw,420px)]')}
      >
        {step === 'review' ? (
          <div className="flex min-h-0 flex-1 flex-col justify-between p-6">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-4">
                <h2 id={titleId} className="text-[18px] font-bold leading-none text-[#111827]">
                  Review Invoice
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  aria-label="Close"
                  className="rounded-full bg-[#f9fafb] p-1.5 text-[#6b7280] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="flex items-center gap-3 rounded-lg bg-[#f9fafb] p-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f0fdf4] text-[#15803d]">
                  <WrenchIcon />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold text-[#111827]">
                    {review.vendorName}
                  </p>
                  {displayRating != null ? (
                    <div className="mt-0.5 flex items-center gap-1">
                      {Array.from({ length: 5 }, (_, i) => (
                        <StarIcon key={i} filled={i < filledStars} />
                      ))}
                      <p className="text-[11px] text-[#6b7280]">
                        {displayRating.toFixed(1)}
                        {reviewCount != null && reviewCount > 0
                          ? ` (${reviewCount} review${reviewCount === 1 ? '' : 's'})`
                          : ' tenant rating'}
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>

              <section className="space-y-3">
                <h3 className="text-[12px] font-bold uppercase text-[#6b7280]">
                  Invoice Information
                </h3>
                <dl className="space-y-2.5 text-[13px]">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[#6b7280]">Service Type</dt>
                    <dd className="text-right text-[#111827]">
                      {formatServiceType(review.issueCategory)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[#6b7280]">Location</dt>
                    <dd className="text-right text-[#111827]">
                      {formatLocation(review.unit, review.building)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[#6b7280]">Submitted by</dt>
                    <dd className="text-right text-[#111827]">
                      {review.residentName.trim() || '—'}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[#6b7280]">Submitted Date</dt>
                    <dd className="text-right text-[#111827]">
                      {formatSubmittedDate(review.submittedAt)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[#6b7280]">Invoice Number</dt>
                    <dd className="text-right text-[#111827]">{invoiceNumber}</dd>
                  </div>
                </dl>
              </section>

              <section className="space-y-3">
                <h3 className="text-[12px] font-bold uppercase text-[#6b7280]">Line Items</h3>
                <div>
                  <div className="flex items-center justify-between py-2 text-[13px]">
                    <span className="text-[#4b5563]">Service call fee</span>
                    <span className="font-medium text-[#111827]">
                      {formatMoney(review.laborCost)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 text-[13px]">
                    <span className="text-[#4b5563]">Parts &amp; materials</span>
                    <span className="font-medium text-[#111827]">
                      {formatMoney(review.materialCost)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 text-[13px]">
                    <span className="text-[#4b5563]">
                      {(() => {
                        const pretax = review.laborCost + review.materialCost
                        const pct =
                          pretax > 0 && review.taxAmount > 0
                            ? Math.round((review.taxAmount / pretax) * 100)
                            : null
                        return pct != null ? `Tax (${pct}%)` : 'Tax'
                      })()}
                    </span>
                    <span className="font-medium text-[#111827]">
                      {formatMoney(review.taxAmount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-[#e5e7eb] py-3 font-bold text-[#111827]">
                    <span className="text-[14px]">Total Amount</span>
                    <span className="text-[16px]">{formatMoney(review.totalCost)}</span>
                  </div>
                </div>
              </section>

              {hasAttachment ? (
                <section className="space-y-3">
                  <h3 className="text-[12px] font-bold uppercase text-[#6b7280]">
                    Attached Reference
                  </h3>
                  <button
                    type="button"
                    disabled={!downloadUrl || downloadBusy}
                    onClick={() => void handleDownload()}
                    className="flex w-full items-center gap-3 rounded-lg border border-[#e5e7eb] p-3 text-left outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-80"
                  >
                    <DocumentThumb />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[#111827]">{fileName}</p>
                      <p className="text-[11px] text-[#6b7280]">PDF Document</p>
                    </div>
                    <span className="shrink-0 text-[#6b7280]">
                      <DownloadIcon />
                    </span>
                  </button>
                </section>
              ) : null}

              {error ? (
                <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="mt-6 shrink-0 space-y-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => setStep('confirm')}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#065f46] px-4 py-3.5 text-[14px] font-semibold text-white outline-none hover:bg-[#064e3b] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {`Pay now · ${formatMoney(review.totalCost)}`}
                <ArrowRightIcon />
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={onReject}
                className="flex w-full items-center justify-center py-1 text-[13px] font-medium text-[#6b7280] underline outline-none hover:text-[#374151] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                Dispute this invoice
              </button>
            </div>
          </div>
        ) : step === 'addMethod' ? (
          <div className="flex min-h-0 flex-1 flex-col justify-between p-6">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStep('confirm')}
                    disabled={saving}
                    aria-label="Back to confirm payment"
                    className="flex size-7 items-center justify-center rounded-full text-[#111827] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    <BackIcon />
                  </button>
                  <h2 id={titleId} className="text-[18px] font-bold leading-none text-[#111827]">
                    Add Payment Method
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  aria-label="Close"
                  className="flex size-7 items-center justify-center rounded-full text-[#6b7280] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="flex flex-col gap-3">
                {PAYMENT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={busy}
                    onClick={() => handleSelectPaymentOption(option.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-[#e5e7eb] bg-white px-3 py-4 text-left outline-none hover:bg-[#f9fafb] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    <span className="flex items-center gap-4">
                      <PaymentOptionIcon icon={option.icon} />
                      <span className="text-[15px] font-semibold text-[#111827]">
                        {option.label}
                      </span>
                    </span>
                    <ChevronRightIcon />
                  </button>
                ))}
              </div>

              {checkoutBusy ? (
                <p className="text-[13px] text-[#065f46]">
                  Opening secure checkout…
                </p>
              ) : null}

              {addError ? (
                <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
                  {addError}
                </p>
              ) : null}

              <div className="flex items-center gap-2 opacity-90">
                <span className="text-[#6b7280]">
                  <LockIcon />
                </span>
                <p className="text-[12px] leading-[1.4] text-[#6b7280]">
                  Your payment info is securely encrypted.
                </p>
              </div>
            </div>

            <div className="mt-6 shrink-0 pt-4">
              <button
                type="button"
                disabled={saving}
                onClick={() => setStep('review')}
                className="flex w-full items-center justify-center py-1 text-[13px] font-medium text-[#6b7280] underline outline-none hover:text-[#374151] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                Cancel payment
              </button>
            </div>
          </div>
        ) : step === 'addCard' ? (
          <div className="flex min-h-0 flex-1 flex-col justify-between p-6">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={resetCardFormAndBack}
                    disabled={saving}
                    aria-label="Back to payment methods"
                    className="flex size-7 items-center justify-center rounded-full text-[#111827] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    <BackIcon />
                  </button>
                  <h2 id={titleId} className="text-[18px] font-bold leading-none text-[#111827]">
                    Credit or Debit Card
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  aria-label="Close"
                  className="flex size-7 items-center justify-center rounded-full text-[#6b7280] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="flex flex-col gap-3.5">
                <div>
                  <label className={fieldLabelClass} htmlFor="invoice-card-number">
                    Card Number
                  </label>
                  <div className="flex items-center gap-2 rounded-lg border border-[#e5e7eb] bg-white px-3 py-2.5 focus-within:border-[#065f46] focus-within:ring-1 focus-within:ring-[#065f46]">
                    <img
                      src={creditCardIcon}
                      alt=""
                      className="size-4 shrink-0 object-contain"
                      aria-hidden
                    />
                    <input
                      id="invoice-card-number"
                      className="min-w-0 flex-1 bg-transparent text-[14px] text-[#111827] outline-none placeholder:text-[#9ca3af]"
                      inputMode="numeric"
                      autoComplete="cc-number"
                      placeholder="4111 2222 3333 4444"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(formatCardNumberDisplay(e.target.value))}
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <label className={fieldLabelClass} htmlFor="invoice-card-exp">
                      Expiration Date
                    </label>
                    <input
                      id="invoice-card-exp"
                      className={inputClass}
                      inputMode="numeric"
                      autoComplete="cc-exp"
                      placeholder="MM / YY"
                      value={expiration}
                      onChange={(e) => setExpiration(formatExpirationDisplay(e.target.value))}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className={fieldLabelClass} htmlFor="invoice-card-cvv">
                      CVV
                    </label>
                    <input
                      id="invoice-card-cvv"
                      className={inputClass}
                      inputMode="numeric"
                      autoComplete="cc-csc"
                      placeholder="123"
                      value={cvc}
                      onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    />
                  </div>
                </div>

                <div>
                  <label className={fieldLabelClass} htmlFor="invoice-cardholder">
                    Cardholder Name
                  </label>
                  <input
                    id="invoice-cardholder"
                    className={inputClass}
                    autoComplete="cc-name"
                    placeholder="John Doe"
                    value={cardholderName}
                    onChange={(e) => setCardholderName(e.target.value)}
                  />
                </div>
              </div>

              <div className="border-t border-[#e5e7eb]" />

              <div className="flex flex-col gap-3.5">
                <h3 className="text-[13px] font-bold uppercase text-[#111827]">
                  Billing Address
                </h3>

                <div>
                  <label className={fieldLabelClass} htmlFor="invoice-billing-street">
                    Street Address
                  </label>
                  <input
                    id="invoice-billing-street"
                    className={inputClass}
                    autoComplete="billing street-address"
                    placeholder="123 Main St"
                    value={streetAddress}
                    onChange={(e) => setStreetAddress(e.target.value)}
                  />
                </div>

                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <label className={fieldLabelClass} htmlFor="invoice-billing-city">
                      City
                    </label>
                    <input
                      id="invoice-billing-city"
                      className={inputClass}
                      autoComplete="billing address-level2"
                      placeholder="San Francisco"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className={fieldLabelClass} htmlFor="invoice-billing-state">
                      State
                    </label>
                    <input
                      id="invoice-billing-state"
                      className={inputClass}
                      autoComplete="billing address-level1"
                      placeholder="CA"
                      value={billingState}
                      onChange={(e) => setBillingState(e.target.value)}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className={fieldLabelClass} htmlFor="invoice-billing-zip">
                      ZIP
                    </label>
                    <input
                      id="invoice-billing-zip"
                      className={inputClass}
                      autoComplete="billing postal-code"
                      placeholder="94103"
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className={fieldLabelClass} htmlFor="invoice-billing-country">
                    Country
                  </label>
                  <div className="relative">
                    <select
                      id="invoice-billing-country"
                      className={`${inputClass} appearance-none pr-9`}
                      autoComplete="billing country-name"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                    >
                      {CARD_COUNTRIES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                      <ChevronDownIcon />
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSaveCard((prev) => !prev)}
                className="flex w-full items-center gap-2.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2"
              >
                <span
                  className={`flex size-[18px] shrink-0 items-center justify-center rounded ${
                    saveCard ? 'bg-[#611879]' : 'border border-[#d1d5db] bg-white'
                  }`}
                  aria-hidden
                >
                  {saveCard ? <CheckIcon /> : null}
                </span>
                <span className="text-[13px] text-[#4b5563]">
                  Save this card to my account for future payments
                </span>
              </button>

              {addError ? <p className="text-[12px] text-[#b91c1c]">{addError}</p> : null}
            </div>

            <div className="mt-4 shrink-0 space-y-3 pt-4">
              <button
                type="button"
                disabled={busy}
                onClick={handleSavePaymentMethod}
                className="flex w-full items-center justify-center rounded-lg bg-[#065f46] p-3.5 text-[14px] font-semibold text-white outline-none hover:bg-[#064e3b] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                {checkoutBusy ? 'Redirecting to secure checkout…' : 'Add Card'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={resetCardFormAndBack}
                className="flex w-full items-center justify-center py-1 text-[13px] font-medium text-[#6b7280] underline outline-none hover:text-[#374151] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-between p-6">
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between border-b border-[#e5e7eb] pb-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStep('review')}
                    disabled={saving}
                    aria-label="Back to invoice review"
                    className="flex size-7 items-center justify-center rounded-full text-[#111827] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    <BackIcon />
                  </button>
                  <h2 id={titleId} className="text-[18px] font-bold leading-none text-[#111827]">
                    Confirm Payment
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  aria-label="Close"
                  className="flex size-7 items-center justify-center rounded-full text-[#6b7280] outline-none hover:bg-[#f3f4f6] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="flex flex-col items-center gap-1.5 rounded-lg bg-[#f9fafb] p-5 text-center">
                <p className="text-[13px] text-[#6b7280]">You are paying</p>
                <p className="text-[32px] font-bold leading-none text-[#111827]">
                  {formatMoney(review.totalCost)}
                </p>
                <p className="text-[13px] font-medium text-[#4b5563]">to {review.vendorName}</p>
              </div>

              <section className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[11px] font-bold uppercase text-[#6b7280]">
                    Payment Method
                  </h3>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={openAddPaymentMethod}
                    className="text-[13px] font-semibold text-[#065f46] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
                  >
                    {paymentMethod ? 'Change' : 'Add'}
                  </button>
                </div>

                {paymentMethod ? (
                  <div className="flex items-center gap-3 rounded-lg border border-[#e5e7eb] bg-white p-4">
                    <PaymentOptionIcon icon={paymentMethod.icon} size="selected" />
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-[#111827]">
                        {paymentMethodLabel(paymentMethod)}
                      </p>
                      {paymentMethodSubtitle(paymentMethod) ? (
                        <p className="text-[12px] text-[#6b7280]">
                          {paymentMethodSubtitle(paymentMethod)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[#9ca3af] bg-[#f9fafb] p-5 text-center">
                    <div className="flex items-center justify-center rounded-full bg-[rgba(6,95,70,0.05)] p-2.5 text-[#065f46]">
                      <CreditCardIcon />
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-[#111827]">
                        No payment method on file
                      </p>
                      <p className="mt-0.5 text-[12px] text-[#6b7280]">
                        Add a payment method to complete this transfer
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={openAddPaymentMethod}
                      className="rounded-md bg-[#065f46] px-3.5 py-2 text-[13px] font-semibold text-white outline-none hover:bg-[#064e3b] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
                    >
                      Add payment method
                    </button>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase text-[#6b7280]">
                  Add Note for Records
                </h3>
                <textarea
                  value={paymentNote}
                  onChange={(e) => setPaymentNote(e.target.value)}
                  rows={4}
                  placeholder="Add a memo or private note for this payment..."
                  className="h-[100px] w-full resize-none rounded-lg border border-[#e5e7eb] p-3 text-[13px] leading-[1.4] text-[#111827] outline-none placeholder:text-[#9ca3af] focus:border-[#065f46] focus:ring-1 focus:ring-[#065f46]"
                />
              </section>

              <div className="flex items-start gap-2 opacity-80">
                <span className="mt-0.5 text-[#6b7280]">
                  <LockIcon />
                </span>
                <p className="text-[12px] leading-[1.4] text-[#6b7280]">
                  Funds typically arrive in 1-2 business days. Securely encrypted.
                </p>
              </div>

              {error ? (
                <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
                  {error}
                </p>
              ) : null}

              {addError ? (
                <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
                  {addError}
                </p>
              ) : null}
            </div>

            <div className="mt-6 shrink-0 space-y-3">
              <button
                type="button"
                disabled={!canConfirmPay}
                onClick={handleConfirmAndPay}
                className={`flex w-full items-center justify-center rounded-lg px-4 py-3.5 text-[14px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 ${
                  canConfirmPay
                    ? 'bg-[#065f46] text-white hover:bg-[#064e3b]'
                    : 'cursor-not-allowed bg-[#e5e7eb] text-[#9ca3af]'
                }`}
              >
                {checkoutBusy
                  ? 'Redirecting to secure checkout…'
                  : saving
                    ? 'Processing…'
                    : `Confirm & Pay ${formatMoney(review.totalCost)}`}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setStep('review')}
                className="flex w-full items-center justify-center py-1 text-[13px] font-medium text-[#6b7280] underline outline-none hover:text-[#374151] focus-visible:ring-2 focus-visible:ring-[#065f46] focus-visible:ring-offset-2 disabled:opacity-50"
              >
                Cancel payment
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
