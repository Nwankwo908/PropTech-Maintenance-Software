import { Link } from 'react-router-dom'
import {
  BETA_ACCOMPLISHMENTS,
  BETA_INCLUDED_FEATURES,
  BETA_LATEST_IMPROVEMENTS,
  BETA_PROGRAM,
  currentActivityMonthLabel,
  FUTURE_BILLING_PREVIEW,
  FUTURE_SUBSCRIPTION_FEATURES,
  MONTHLY_ACTIVITY_STATS,
} from '@/lib/billingBeta'

const sectionCardClass =
  'rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

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

function StatusChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#abefc6] bg-[#ecfdf3] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#067647]">
      <span className="size-1.5 rounded-full bg-[#12b76a]" aria-hidden />
      {label}
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
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center justify-center rounded-[10px] bg-[#101828] px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-white transition-colors hover:bg-[#1f2937]',
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
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-[#101828] transition-colors hover:bg-[#f9fafb]',
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

export function AdminBillingSettings() {
  const activityMonth = currentActivityMonthLabel()

  return (
    <>
      <div className="py-6">
        <Link
          to="/admin/settings"
          className="inline-flex items-center gap-1.5 text-[14px] font-medium tracking-[-0.1504px] text-[#6a7282] transition-colors hover:text-[#101828]"
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
              Manage your Ulo subscription, beta access, and future billing information.
            </p>
          </div>
          <OutlineButton className="self-start">
            <svg className="mr-2 size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M2.5 3.5H13.5L11.5 9.5C10.8 11.4 9.1 12.5 7.5 12.5C5.9 12.5 4.2 11.4 3.5 9.5L2.5 3.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            Share feedback
          </OutlineButton>
        </div>
      </div>

      <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <section className="overflow-hidden rounded-[10px] border border-[#dbeafe] bg-gradient-to-br from-[#eff6ff] via-white to-[#f9fafb] p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip label="Beta access" />
                  <StatusChip label="Active" />
                </div>
                <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-[#101828]">
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
              <MetaItem label="Member since" value={BETA_PROGRAM.memberSince} />
              <MetaItem label="Expiration" value={BETA_PROGRAM.expiration} />
            </div>

            <div className="mt-6 border-t border-[#e5e7eb]/80 pt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6a7282]">
                Included in your beta access
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

          <SectionCard
            title="You're helping build Ulo"
            action={
              <span className="rounded-full border border-[#e5e7eb] bg-[#f9fafb] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#364153]">
                {BETA_PROGRAM.version}
              </span>
            }
          >
            <p className="text-[14px] leading-6 tracking-[-0.1504px] text-[#4b5563]">
              Thank you for being an early Ulo customer. Your feedback directly shapes what we ship next—and
              during beta you receive the full product at no cost.
            </p>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9ca3af]">
                  Current version
                </p>
                <p className="mt-2 text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">
                  {BETA_PROGRAM.version} (Released this month)
                </p>
              </div>
              <div className="rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9ca3af]">
                  Latest improvements
                </p>
                <ul className="mt-2 space-y-1.5">
                  {BETA_LATEST_IMPROVEMENTS.map((item) => (
                    <li key={item} className="text-[14px] capitalize tracking-[-0.1504px] text-[#101828]">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <PrimaryButton>Give feedback</PrimaryButton>
              <OutlineButton>Report a bug</OutlineButton>
              <OutlineButton>View release notes</OutlineButton>
            </div>
          </SectionCard>

          <SectionCard title="Payment method">
            <EmptyState
              icon={
                <svg className="size-5" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <rect x="2" y="5" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M2 8H18" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              }
              title="No payment method required"
              description="Ulo is currently free during beta. You won't be charged while participating in the beta program."
              action={<OutlineButton>Learn about future plans</OutlineButton>}
            />
          </SectionCard>

          <SectionCard title="Billing history">
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
              title="No billing activity"
              description="Invoices and payment history will appear here once paid subscriptions become available."
            />
          </SectionCard>

          <SectionCard
            title="Your activity this month"
            description="Snapshot of your Ulo workspace activity."
            action={
              <span className="text-[13px] font-medium tracking-[-0.1504px] text-[#6a7282]">{activityMonth}</span>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {MONTHLY_ACTIVITY_STATS.map((stat) => (
                <div
                  key={stat.id}
                  className="rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] px-4 py-4"
                >
                  <p className="text-[24px] font-semibold leading-none tracking-[-0.03em] text-[#101828]">
                    {stat.value}
                  </p>
                  <p className="mt-2 text-[13px] leading-5 tracking-[-0.1504px] text-[#6a7282]">{stat.label}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="What Ulo helped you accomplish"
            description="Value delivered during your beta participation."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {BETA_ACCOMPLISHMENTS.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[10px] border border-[#eef0f3] bg-gradient-to-br from-white to-[#f9fafb] p-5"
                >
                  <p className="text-[28px] font-semibold leading-none tracking-[-0.04em] text-[#101828]">
                    {item.value}
                  </p>
                  <p className="mt-3 text-[14px] font-semibold tracking-[-0.1504px] text-[#101828]">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[13px] tracking-[-0.1504px] text-[#6a7282]">{item.detail}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-6 xl:sticky xl:top-6 xl:w-[300px]">
          <SectionCard
            title="Subscription management"
            description="When Ulo exits beta, you'll be able to:"
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

          <SectionCard title="Future billing preview" description="A glimpse of what's coming after beta.">
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
                    Coming soon
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Need help?"
            description="Questions about beta access? We're here for early customers."
          >
            <div className="space-y-2">
              <PrimaryButton className="w-full">Contact support</PrimaryButton>
              <OutlineButton className="w-full">Visit help center</OutlineButton>
            </div>
          </SectionCard>
        </aside>
      </div>
    </>
  )
}
