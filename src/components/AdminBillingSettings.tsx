import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { landlordHasPayments } from '@shared/landlordCapabilities'
import {
  fetchMaintenanceBillingHistory,
  type MaintenanceBillingHistoryItem,
} from '@/api/maintenanceInvoice'
import {
  BETA_INCLUDED_FEATURES,
  BETA_PROGRAM,
  currentActivityMonthLabel,
  FUTURE_BILLING_PREVIEW,
  FUTURE_SUBSCRIPTION_FEATURES,
} from '@/lib/billingBeta'
import {
  formatPaymentMethodExpiry,
  formatPaymentMethodLabel,
  loadBillingPaymentMethod,
  paymentMethodFromCardInput,
  saveBillingPaymentMethod,
} from '@/lib/billingPaymentMethod'
import type { BillingPaymentMethod } from '@/lib/landlordSettings/types'
import { loadLandlordSettings } from '@/lib/landlordSettings'
import { getErrorMessage } from '@/lib/errorMessage'

const sectionCardClass =
  'sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

function SectionCard({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={[sectionCardClass, className].filter(Boolean).join(' ')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

function InvoiceStatusChip({ status }: { status: 'approved' | 'rejected' }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center rounded-full border border-[#abefc6] bg-[#ecfdf3] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#067647]">
        Paid
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-[#fecdca] bg-[#fef3f2] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#b42318]">
      Rejected
    </span>
  )
}

function CheckIcon() {
  return (
    <svg className="size-4 shrink-0 text-[#12b76a]" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PrimaryButton({
  children,
  className = '',
  disabled,
  title,
  onClick,
}: {
  children: React.ReactNode
  className?: string
  disabled?: boolean
  title?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={[
        'sa-press inline-flex items-center justify-center rounded-[10px] bg-[#101828] px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-white hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function OutlineButton({
  children,
  className = '',
  disabled,
  title,
  onClick,
}: {
  children: React.ReactNode
  className?: string
  disabled?: boolean
  title?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={[
        'sa-press inline-flex items-center justify-center rounded-[10px] border border-[#186179] bg-white px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-[#186179] hover:bg-[#e8f2f5] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-[#f3f4f6] text-[#6a7282]">
        {icon}
      </span>
      <p className="mt-4 text-[15px] font-semibold tracking-[-0.1504px] text-[#101828]">{title}</p>
      <p className="mt-2 max-w-md text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9ca3af]">{label}</p>
      <p className="mt-1 text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">{value}</p>
    </div>
  )
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatHistoryDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function billingHistoryTitle(item: MaintenanceBillingHistoryItem): string {
  const invoiceLabel = item.invoiceNumber?.trim() || 'Vendor invoice'
  return `${invoiceLabel} · ${item.vendorName}`
}

function billingHistoryDetail(item: MaintenanceBillingHistoryItem): string {
  const parts: string[] = []
  if (item.unit?.trim()) parts.push(`Unit ${item.unit.trim()}`)
  if (item.issueCategory?.trim()) parts.push(item.issueCategory.trim())
  if (item.status === 'approved' && item.paymentSource) parts.push(item.paymentSource)
  if (item.status === 'rejected' && item.rejectionReason) parts.push(item.rejectionReason)
  if (item.transactionId) parts.push(item.transactionId)
  return parts.join(' · ')
}

export function AdminBillingSettings() {
  if (!landlordHasPayments(getActiveLandlordId())) {
    return <Navigate to="/admin/settings" replace />
  }
  return <AdminBillingSettingsBody />
}

function AdminBillingSettingsBody() {
  const activityMonth = currentActivityMonthLabel()
  const [history, setHistory] = useState<MaintenanceBillingHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [memberSince, setMemberSince] = useState<string>(BETA_PROGRAM.memberSince)
  const [planLabel, setPlanLabel] = useState('Ulo Alpha')
  const [paymentMethod, setPaymentMethod] = useState<BillingPaymentMethod | null>(null)
  const [paymentLoading, setPaymentLoading] = useState(true)
  const [editingPayment, setEditingPayment] = useState(false)
  const [cardNumber, setCardNumber] = useState('')
  const [expiration, setExpiration] = useState('')
  const [paymentBusy, setPaymentBusy] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null)

  useEffect(() => {
    void loadLandlordSettings().then((snapshot) => {
      setPlanLabel(snapshot.planLabel)
      if (snapshot.memberSince) {
        setMemberSince(
          new Date(snapshot.memberSince).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          }),
        )
      }
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setPaymentLoading(true)
    void loadBillingPaymentMethod().then((method) => {
      if (cancelled) return
      setPaymentMethod(method)
      setPaymentLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(null)
    void (async () => {
      try {
        const rows = await fetchMaintenanceBillingHistory()
        if (!cancelled) setHistory(rows)
      } catch (err) {
        if (!cancelled) {
          setHistoryError(
            getErrorMessage(err, 'Could not load billing history.'),
          )
        }
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function openPaymentEditor() {
    setEditingPayment(true)
    setPaymentError(null)
    setPaymentMessage(null)
    setCardNumber('')
    setExpiration('')
  }

  async function handleSavePaymentMethod() {
    const parsed = paymentMethodFromCardInput({ cardNumber, expiration })
    if (!parsed.ok) {
      setPaymentError(parsed.error)
      return
    }
    setPaymentBusy(true)
    setPaymentError(null)
    const result = await saveBillingPaymentMethod(parsed.method)
    setPaymentBusy(false)
    if (!result.ok) {
      setPaymentError(result.error ?? 'Could not save payment method.')
      return
    }
    setPaymentMethod(parsed.method)
    setEditingPayment(false)
    setPaymentMessage('Payment method saved. You will not be charged during Alpha.')
  }

  async function handleRemovePaymentMethod() {
    setPaymentBusy(true)
    setPaymentError(null)
    const result = await saveBillingPaymentMethod(null)
    setPaymentBusy(false)
    if (!result.ok) {
      setPaymentError(result.error ?? 'Could not remove payment method.')
      return
    }
    setPaymentMethod(null)
    setEditingPayment(false)
    setPaymentMessage('Payment method removed.')
  }

  return (
    <>
      <div className="py-6">
        <Link
          to="/admin/settings"
          className="sa-link inline-flex items-center gap-1.5 text-[14px] font-medium tracking-[-0.1504px] text-[#6a7282] hover:text-[#101828]"
        >
          <span aria-hidden>←</span>
          Settings
        </Link>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
              Subscription & Billing
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
              Manage your Ulo subscription and vendor payment activity on {planLabel}.
            </p>
          </div>
          <OutlineButton
            className="self-start"
            onClick={() => {
              window.location.href =
                'mailto:support@ulo.app?subject=Ulo%20Alpha%20feedback'
            }}
          >
            Share feedback
          </OutlineButton>
        </div>
      </div>

      <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <section className="sa-surface overflow-hidden rounded-[10px] border border-[#dbeafe] bg-gradient-to-br from-[#eff6ff] via-white to-[#f9fafb] p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#101828]">
                  {BETA_PROGRAM.name}
                </h2>
                <p className="mt-2 max-w-2xl text-[14px] leading-6 tracking-[-0.1504px] text-[#4b5563]">
                  {BETA_PROGRAM.tagline}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[36px] font-semibold leading-none tracking-[-0.04em] text-[#101828]">
                  {BETA_PROGRAM.priceLabel}
                </p>
                <p className="mt-1 text-[13px] tracking-[-0.1504px] text-[#6a7282]">{BETA_PROGRAM.priceNote}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 border-t border-[#e5e7eb]/80 pt-6 sm:grid-cols-3">
              <MetaItem label="Status" value={BETA_PROGRAM.status} />
              <MetaItem label="Member since" value={memberSince} />
              <MetaItem label="Expiration" value={BETA_PROGRAM.expiration} />
            </div>

            <div className="mt-6 border-t border-[#e5e7eb]/80 pt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6a7282]">
                Included in your Alpha access
              </p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {BETA_INCLUDED_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-[13px] tracking-[-0.1504px] text-[#364153]">
                    <CheckIcon />
                    <span className="capitalize">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <SectionCard title="Program updates" description={`What's included on ${planLabel}.`}>
            <p className="text-[14px] leading-6 tracking-[-0.1504px] text-[#4b5563]">
              Thank you for being an early Ulo customer. On {planLabel}, you receive full product access
              at no subscription charge while we build together.
            </p>
          </SectionCard>

          <SectionCard
            title="Payment method"
            description={`${planLabel} is free. Add a card now so you are ready when paid plans launch — you will not be charged during Alpha.`}
          >
            {paymentLoading ? (
              <p className="py-4 text-[14px] text-[#6a7282]">Loading payment method…</p>
            ) : editingPayment ? (
              <div className="max-w-md space-y-4">
                <div>
                  <label htmlFor="billing-card-number" className="mb-1.5 block text-[13px] font-medium text-[#364153]">
                    Card number
                  </label>
                  <input
                    id="billing-card-number"
                    inputMode="numeric"
                    autoComplete="cc-number"
                    className="sa-surface h-10 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    placeholder="ACCT-000015"
                  />
                </div>
                <div>
                  <label htmlFor="billing-card-exp" className="mb-1.5 block text-[13px] font-medium text-[#364153]">
                    Expiration
                  </label>
                  <input
                    id="billing-card-exp"
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    className="sa-surface h-10 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20"
                    value={expiration}
                    onChange={(e) => setExpiration(e.target.value)}
                    placeholder="MM / YY"
                  />
                </div>
                <p className="text-[12px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                  Card details are stored on your account for future billing setup. Ulo does not charge
                  this card during Alpha.
                </p>
                {paymentError ? (
                  <p className="text-[13px] font-medium tracking-[-0.1504px] text-[#b42318]">{paymentError}</p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <PrimaryButton disabled={paymentBusy} onClick={() => void handleSavePaymentMethod()}>
                    {paymentBusy ? 'Saving…' : 'Save payment method'}
                  </PrimaryButton>
                  <OutlineButton
                    disabled={paymentBusy}
                    onClick={() => {
                      setEditingPayment(false)
                      setPaymentError(null)
                    }}
                  >
                    Cancel
                  </OutlineButton>
                </div>
              </div>
            ) : paymentMethod ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[15px] font-semibold tracking-[-0.1504px] text-[#101828]">
                    {formatPaymentMethodLabel(paymentMethod)}
                  </p>
                  <p className="mt-1 text-[13px] tracking-[-0.1504px] text-[#6a7282]">
                    {formatPaymentMethodExpiry(paymentMethod)} · Not charged during Alpha
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <OutlineButton disabled={paymentBusy} onClick={openPaymentEditor}>
                    Change
                  </OutlineButton>
                  <OutlineButton disabled={paymentBusy} onClick={() => void handleRemovePaymentMethod()}>
                    Remove
                  </OutlineButton>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={
                  <svg className="size-5" viewBox="0 0 20 20" fill="none" aria-hidden>
                    <rect x="2" y="5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M2 8H18" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                }
                title="No payment method on file"
                description={`Ulo is free on ${planLabel}. Add a card when you want to be ready for paid plans later.`}
                action={<OutlineButton onClick={openPaymentEditor}>Add payment method</OutlineButton>}
              />
            )}
            {paymentMessage ? (
              <p className="mt-4 text-[13px] font-medium tracking-[-0.1504px] text-[#067647]">{paymentMessage}</p>
            ) : null}
            {!editingPayment && paymentError ? (
              <p className="mt-4 text-[13px] font-medium tracking-[-0.1504px] text-[#b42318]">{paymentError}</p>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Vendor payment activity"
            description="Payments and rejections for vendor invoices on your properties — not Ulo subscription charges."
            action={
              history.length > 0 ? (
                <span className="text-[13px] font-medium tracking-[-0.1504px] text-[#6a7282]">
                  {history.length} record{history.length === 1 ? '' : 's'}
                </span>
              ) : null
            }
          >
            {historyLoading ? (
              <p className="py-6 text-center text-[14px] text-[#6a7282]">Loading billing history…</p>
            ) : historyError ? (
              <p className="rounded-lg border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">
                {historyError}
              </p>
            ) : history.length === 0 ? (
              <EmptyState
                icon={
                  <svg className="size-5" viewBox="0 0 20 20" fill="none" aria-hidden>
                    <path
                      d="M6 3.5H14L16.5 6V16.5H3.5V3.5H6Z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                    <path d="M7 9H13M7 12H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                }
                title="No billing activity yet"
                description="When you pay or reject a vendor invoice, it will show up here."
              />
            ) : (
              <ul className="divide-y divide-[#eef0f3]">
                {history.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[14px] font-semibold tracking-[-0.1504px] text-[#101828]">
                          {billingHistoryTitle(item)}
                        </p>
                        <InvoiceStatusChip status={item.status} />
                      </div>
                      <p className="mt-1 text-[13px] tracking-[-0.1504px] text-[#6a7282]">
                        {formatHistoryDate(item.eventAt)}
                        {billingHistoryDetail(item) ? ` · ${billingHistoryDetail(item)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <p
                        className={`text-[15px] font-semibold tracking-[-0.1504px] ${
                          item.status === 'rejected' ? 'text-[#b42318]' : 'text-[#101828]'
                        }`}
                      >
                        {item.status === 'rejected' ? '—' : ''}
                        {formatMoney(item.totalCost)}
                      </p>
                      {item.receiptUrl ? (
                        <a
                          href={item.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="sa-link text-[13px] font-medium text-[#065f46] underline hover:text-[#064e3b]"
                        >
                          Receipt
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Workspace activity"
            description="Operational counts for your account will appear here as you use Ulo."
            action={
              <span className="text-[13px] font-medium tracking-[-0.1504px] text-[#6a7282]">{activityMonth}</span>
            }
          >
            <p className="text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
              Activity summaries are not shown until enough real usage data exists for your account.
            </p>
          </SectionCard>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-6 xl:sticky xl:top-6 xl:w-[300px]">
          <SectionCard
            title="Subscription management"
            description="When Ulo exits Alpha, you'll be able to:"
          >
            <ul className="space-y-3">
              {FUTURE_SUBSCRIPTION_FEATURES.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2.5 text-[13px] leading-5 tracking-[-0.1504px] text-[#9ca3af]"
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-[#f9fafb]">
                    <svg className="size-3" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M3 6H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Future billing preview" description="A glimpse of what's coming after Alpha.">
            <div className="grid grid-cols-2 gap-3">
              {FUTURE_BILLING_PREVIEW.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[10px] border border-dashed border-[#e5e7eb] bg-[#f9fafb] px-3 py-4 text-center"
                >
                  <span className="mx-auto flex size-9 items-center justify-center rounded-full bg-white text-[#6a7282] shadow-[0px_1px_2px_rgba(0,0,0,0.04)]">
                    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
                    </svg>
                  </span>
                  <p className="mt-3 text-[12px] font-medium tracking-[-0.1504px] text-[#364153]">{item.label}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#9ca3af]">
                    {'ready' in item && item.ready ? 'Available' : 'Coming soon'}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Need help?"
            description="Questions about Alpha access? We're here for early customers."
          >
            <div className="space-y-2">
              <a
                href="mailto:support@ulo.app?subject=Ulo%20Alpha%20support"
                className="sa-press inline-flex w-full items-center justify-center rounded-[10px] bg-[#101828] px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-white hover:bg-[#1f2937]"
              >
                Contact support
              </a>
              <a
                href="mailto:support@ulo.app?subject=Ulo%20help%20center"
                className="sa-press inline-flex w-full items-center justify-center rounded-[10px] border border-[#186179] bg-white px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-[#186179] hover:bg-[#e8f2f5]"
              >
                Visit help center
              </a>
            </div>
          </SectionCard>
        </aside>
      </div>
    </>
  )
}
