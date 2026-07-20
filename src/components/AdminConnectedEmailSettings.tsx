import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  EMAIL_AUTOMATION_TOGGLES,
  EMAIL_DISCOVERY_CATEGORIES,
  EMAIL_PRIVACY_POINTS,
  getConnectedEmailAccount,
  getDiscoveredDocumentBuckets,
  getEmailActivityFeed,
  getEmailRecommendedActions,
  getRecentlyDiscoveredDocuments,
  type EmailConfidenceLevel,
  type EmailDocumentStatus,
} from '@/lib/connectedEmailIntegration'

const sectionCardClass =
  'rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

const selectClass =
  'h-10 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-2 pl-3 pr-10 text-[14px] tracking-[-0.1504px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

function SelectChevron() {
  return (
    <svg
      className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-[#6a7282]"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StatusChip({
  label,
  tone,
}: {
  label: string
  tone: 'success' | 'warning' | 'neutral'
}) {
  const styles = {
    success: 'bg-[#ecfdf3] text-[#067647] border-[#abefc6]',
    warning: 'bg-[#fffaeb] text-[#b54708] border-[#fedf89]',
    neutral: 'bg-[#f3f4f6] text-[#364153] border-[#e5e7eb]',
  }
  return (
    <span
      className={[
        'inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em]',
        styles[tone],
      ].join(' ')}
    >
      {label}
    </span>
  )
}

function ConfidenceBadge({ level }: { level: EmailConfidenceLevel }) {
  if (level === 'high') {
    return <StatusChip label="High confidence" tone="success" />
  }
  return <StatusChip label="Medium confidence" tone="warning" />
}

function DocumentStatusChip({ status }: { status: EmailDocumentStatus }) {
  if (status === 'ready') return <StatusChip label="Ready" tone="success" />
  return <StatusChip label="Needs review" tone="warning" />
}

function CategoryIcon({ name }: { name: string }) {
  const cls = 'size-5 text-[#155dfc]'
  if (name === 'property') {
    return (
      <svg className={cls} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M3.5 9.5L10 3.5L16.5 9.5V16.5H3.5V9.5Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (name === 'resident') {
    return (
      <svg className={cls} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M4.5 16.5C5.5 13.5 7.5 12 10 12C12.5 12 14.5 13.5 15.5 16.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (name === 'vendor') {
    return (
      <svg className={cls} viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M4 7H16L14.5 16.5H5.5L4 7Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M7 7V5.5C7 4.12 8.12 3 9.5 3H10.5C11.88 3 13 4.12 13 5.5V7" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )
  }
  return (
    <svg className={cls} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 3.5V16.5M6 7.5H14M6 12.5H14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ProviderLogo({ provider }: { provider: string }) {
  const initial = provider.charAt(0)
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#f3f4f6] text-[14px] font-semibold text-[#101828]">
      {initial}
    </div>
  )
}

function SettingsToggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative h-6 w-11 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#155dfc]/30 focus-visible:ring-offset-2',
          checked ? 'bg-[#101828]' : 'bg-[#e5e7eb]',
        ].join(' ')}
      >
        <span
          className={[
            'pointer-events-none absolute top-1 left-1 size-4 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

function SectionCard({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
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

function OutlineButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-[10px] border border-[#e5e7eb] bg-white px-3.5 py-2 text-[13px] font-medium tracking-[-0.1504px] text-[#101828] transition-colors hover:bg-[#f9fafb]',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function PrimaryButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center justify-center rounded-[10px] bg-[#101828] px-4 py-2.5 text-[14px] font-medium tracking-[-0.1504px] text-white transition-colors hover:bg-[#1f2937]',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function ConfidenceBar({ percent }: { percent: number }) {
  const tone = percent >= 95 ? 'bg-[#12b76a]' : percent >= 85 ? 'bg-[#f79009]' : 'bg-[#f04438]'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#eef0f3]">
        <div className={['h-full rounded-full', tone].join(' ')} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-[13px] font-medium text-[#101828]">{percent}%</span>
    </div>
  )
}

export function AdminConnectedEmailSettings() {
  const attachmentsOnlyId = useId()
  const pdfsId = useId()
  const spreadsheetsId = useId()
  const imagesId = useId()
  const scannedId = useId()

  const [fileTypes, setFileTypes] = useState({
    attachmentsOnly: true,
    pdfs: true,
    spreadsheets: true,
    images: false,
    scanned: false,
  })
  const [dateRange, setDateRange] = useState('90')
  const [folder, setFolder] = useState('inbox')
  const [scanFrequency, setScanFrequency] = useState<'daily' | 'weekly' | 'manual'>('daily')
  const [automation, setAutomation] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(EMAIL_AUTOMATION_TOGGLES.map((item) => [item.id, item.defaultOn])),
  )

  const discoveredBuckets = getDiscoveredDocumentBuckets()
  const recentlyDiscovered = getRecentlyDiscoveredDocuments()
  const recommendedActions = getEmailRecommendedActions()
  const activityFeed = getEmailActivityFeed()
  const connectedAccount = getConnectedEmailAccount()
  const totalDocuments = discoveredBuckets.reduce((sum, bucket) => sum + bucket.count, 0)

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
          <div className="max-w-3xl">
            <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
              Connected Email
            </h1>
            <p className="mt-2 text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
              Connect your email so Ulo can find leases, invoices, inspection reports, and other property
              documents. Nothing is imported without your approval.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OutlineButton>
              <GoogleIcon />
              Connect Gmail
            </OutlineButton>
            <OutlineButton>
              <OutlookIcon />
              Connect Outlook
            </OutlineButton>
            <OutlineButton>
              <MicrosoftIcon />
              Connect Microsoft 365
            </OutlineButton>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <SectionCard
            title="Connected accounts"
            action={<StatusChip label="1 active" tone="neutral" />}
          >
            <div className="flex flex-col gap-4 rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <ProviderLogo provider={connectedAccount.provider} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-semibold tracking-[-0.1504px] text-[#101828]">
                      {connectedAccount.provider}
                    </p>
                    <StatusChip label="Connected" tone="success" />
                  </div>
                  <p className="text-[13px] tracking-[-0.1504px] text-[#6a7282]">
                    {connectedAccount.email}
                  </p>
                  <p className="text-[12px] tracking-[-0.1504px] text-[#9ca3af]">
                    Last sync {connectedAccount.lastSyncLabel}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <OutlineButton>Sync now</OutlineButton>
                <button
                  type="button"
                  className="px-2 py-2 text-[13px] font-medium tracking-[-0.1504px] text-[#b42318] transition-colors hover:text-[#912018]"
                >
                  Disconnect
                </button>
              </div>
            </div>
          </SectionCard>

          <section>
            <h2 className="text-[16px] font-semibold leading-6 tracking-[-0.1504px] text-[#101828]">
              What Ulo can find
            </h2>
            <p className="mt-1 text-[14px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
              Ulo scans for property-related attachments and organizes them before you review.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {EMAIL_DISCOVERY_CATEGORIES.map((category) => (
                <div
                  key={category.id}
                  className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-[10px] bg-[#eff6ff]">
                      <CategoryIcon name={category.icon} />
                    </span>
                    <h3 className="text-[14px] font-semibold tracking-[-0.1504px] text-[#101828]">
                      {category.title}
                    </h3>
                  </div>
                  <ul className="mt-4 space-y-1.5">
                    {category.items.map((item) => (
                      <li
                        key={item}
                        className="text-[13px] leading-5 tracking-[-0.1504px] text-[#6a7282]"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <SectionCard
            title="Search preferences"
            description="Tell Ulo where to look and which file types matter most."
          >
            <p className="text-[13px] font-medium tracking-[-0.1504px] text-[#364153]">File types</p>
            <div className="mt-3 flex flex-wrap gap-4">
              {[
                { id: attachmentsOnlyId, key: 'attachmentsOnly' as const, label: 'Attachments only' },
                { id: pdfsId, key: 'pdfs' as const, label: 'PDFs' },
                { id: spreadsheetsId, key: 'spreadsheets' as const, label: 'Spreadsheets' },
                { id: imagesId, key: 'images' as const, label: 'Images' },
                { id: scannedId, key: 'scanned' as const, label: 'Scanned documents' },
              ].map((item) => (
                <label key={item.key} htmlFor={item.id} className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    id={item.id}
                    type="checkbox"
                    checked={fileTypes[item.key]}
                    onChange={(e) =>
                      setFileTypes((current) => ({ ...current, [item.key]: e.target.checked }))
                    }
                    className="size-4 rounded border-[#d1d5db] text-[#155dfc] focus:ring-[#155dfc]/30"
                  />
                  <span className="text-[13px] tracking-[-0.1504px] text-[#364153]">{item.label}</span>
                </label>
              ))}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="email-date-range" className="mb-1.5 block text-[13px] font-medium text-[#364153]">
                  Date range
                </label>
                <div className="relative">
                  <select
                    id="email-date-range"
                    className={selectClass}
                    value={dateRange}
                    onChange={(e) => setDateRange(e.target.value)}
                  >
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="180">Last 6 months</option>
                    <option value="365">Last 12 months</option>
                  </select>
                  <SelectChevron />
                </div>
              </div>
              <div>
                <label htmlFor="email-folder" className="mb-1.5 block text-[13px] font-medium text-[#364153]">
                  Folder
                </label>
                <div className="relative">
                  <select
                    id="email-folder"
                    className={selectClass}
                    value={folder}
                    onChange={(e) => setFolder(e.target.value)}
                  >
                    <option value="inbox">Inbox</option>
                    <option value="sent">Sent</option>
                    <option value="all">All mail</option>
                  </select>
                  <SelectChevron />
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Documents found"
            description="AI-classified results ready for your review."
            action={
              <span className="text-[13px] font-medium tracking-[-0.1504px] text-[#6a7282]">
                {totalDocuments} total
              </span>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {discoveredBuckets.map((bucket) => (
                <div
                  key={bucket.id}
                  className="flex flex-col rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[28px] font-semibold leading-none tracking-[-0.04em] text-[#101828]">
                      {bucket.count}
                    </p>
                    <ConfidenceBadge level={bucket.confidence} />
                  </div>
                  <p className="mt-2 text-[14px] font-medium tracking-[-0.1504px] text-[#101828]">
                    {bucket.label}
                  </p>
                  <button
                    type="button"
                    className="mt-4 inline-flex w-full items-center justify-center rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-2 text-[13px] font-medium tracking-[-0.1504px] text-[#101828] transition-colors hover:bg-[#f3f4f6]"
                  >
                    Review
                  </button>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Recently discovered documents"
            action={
              <button
                type="button"
                className="admin-quiet-text-action"
              >
                View all
              </button>
            }
          >
            <div className="overflow-x-auto rounded-[10px] border border-[#eef0f3]">
              <table className="min-w-full text-left">
                <thead className="bg-[#f9fafb] text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Document</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Property</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Confidence</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef0f3] bg-white">
                  {recentlyDiscovered.map((document) => (
                    <tr key={document.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[#f3f4f6] text-[#364153]">
                            <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                              <path
                                d="M4.5 2.5H9.5L12.5 5.5V13.5H4.5V2.5Z"
                                stroke="currentColor"
                                strokeWidth="1.4"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span className="text-[13px] font-medium text-[#101828]">{document.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-[#6a7282]">{document.category}</td>
                      <td className="px-4 py-3 text-[13px] text-[#6a7282]">{document.property}</td>
                      <td className="px-4 py-3 text-[13px] text-[#6a7282]">{document.dateLabel}</td>
                      <td className="px-4 py-3">
                        <ConfidenceBar percent={document.confidencePercent} />
                      </td>
                      <td className="px-4 py-3">
                        <DocumentStatusChip status={document.status} />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="rounded-[8px] px-2.5 py-1.5 text-[13px] font-medium text-[#155dfc] transition-colors hover:bg-[#eff6ff]"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard title="Automation settings" description="Choose how often Ulo scans and what to notify you about.">
            <p className="text-[13px] font-medium tracking-[-0.1504px] text-[#364153]">Check frequency</p>
            <div className="mt-3 inline-flex rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] p-1">
              {(['daily', 'weekly', 'manual'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setScanFrequency(option)}
                  className={[
                    'rounded-[8px] px-4 py-2 text-[13px] font-medium capitalize tracking-[-0.1504px] transition-colors',
                    scanFrequency === option
                      ? 'bg-white text-[#101828] shadow-[0px_1px_2px_rgba(0,0,0,0.06)]'
                      : 'text-[#6a7282] hover:text-[#101828]',
                  ].join(' ')}
                >
                  {option}
                </button>
              ))}
            </div>

            <div className="mt-6 divide-y divide-[#eef0f3] border-t border-[#eef0f3]">
              {EMAIL_AUTOMATION_TOGGLES.map((item) => (
                <SettingsToggle
                  key={item.id}
                  id={`email-automation-${item.id}`}
                  label={item.label}
                  checked={automation[item.id] ?? false}
                  onChange={(checked) =>
                    setAutomation((current) => ({ ...current, [item.id]: checked }))
                  }
                />
              ))}
            </div>
          </SectionCard>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-6 xl:sticky xl:top-6 xl:w-[300px]">
          <SectionCard title="Recommended actions">
            <ul className="space-y-4">
              {recommendedActions.map((action) => (
                <li key={action.id} className="rounded-[10px] border border-[#eef0f3] bg-[#f9fafb] p-4">
                  <p className="text-[14px] font-semibold tracking-[-0.1504px] text-[#101828]">
                    {action.title}
                  </p>
                  <p className="mt-1 text-[13px] leading-5 tracking-[-0.1504px] text-[#6a7282]">
                    {action.detail}
                  </p>
                </li>
              ))}
            </ul>
            <PrimaryButton className="mt-5 w-full">Review recommendations</PrimaryButton>
          </SectionCard>

          <SectionCard title="Your privacy">
            <ul className="space-y-3">
              {EMAIL_PRIVACY_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-[13px] leading-5 text-[#364153]">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#ecfdf3] text-[#067647]">
                    <svg className="size-3" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path
                        d="M2.5 6L5 8.5L9.5 3.5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Activity">
            <ul className="space-y-4">
              {activityFeed.map((item) => (
                <li key={item.id}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9ca3af]">
                    {item.dayLabel}
                  </p>
                  <p className="mt-1 text-[13px] leading-5 tracking-[-0.1504px] text-[#364153]">
                    {item.message}
                  </p>
                </li>
              ))}
            </ul>
          </SectionCard>
        </aside>
      </div>
    </>
  )
}

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 3.2C9.4 3.2 10.5 3.8 11.2 4.6L13.4 2.4C12.1 1.2 10.2 0.5 8 0.5C4.9 0.5 2.3 2.4 1.2 5.1L3.6 6.9C4.2 4.9 5.9 3.2 8 3.2Z"
        fill="#EA4335"
      />
      <path
        d="M15.5 8.2C15.5 7.7 15.5 7.2 15.4 6.7H8V9.5H12.1C11.9 10.4 11.4 11.2 10.6 11.7V13.6H13.1C14.6 12.2 15.5 10.2 15.5 8.2Z"
        fill="#4285F4"
      />
      <path
        d="M3.6 9.1C3.4 8.7 3.3 8.3 3.3 7.9C3.3 7.5 3.4 7.1 3.6 6.7V4.8H1.2C0.6 5.9 0.2 7.1 0.2 8.4C0.2 9.7 0.6 10.9 1.2 12L3.6 9.1Z"
        fill="#FBBC05"
      />
      <path
        d="M8 15.8C10.2 15.8 12.1 15.1 13.1 13.6L10.6 11.7C9.9 12.2 9 12.5 8 12.5C5.9 12.5 4.2 10.8 3.6 8.8L1.2 10.6C2.3 13.3 4.9 15.2 8 15.8Z"
        fill="#34A853"
      />
    </svg>
  )
}

function OutlookIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1" y="3" width="9" height="10" rx="1.5" fill="#0078D4" />
      <path d="M6 6H12.5C13.3 6 14 6.7 14 7.5V11.5C14 12.3 13.3 13 12.5 13H6V6Z" fill="#0078D4" />
      <circle cx="5" cy="8" r="2.2" fill="white" />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="5.5" height="5.5" fill="#F25022" />
      <rect x="9" y="1.5" width="5.5" height="5.5" fill="#7FBA00" />
      <rect x="1.5" y="9" width="5.5" height="5.5" fill="#00A4EF" />
      <rect x="9" y="9" width="5.5" height="5.5" fill="#FFB900" />
    </svg>
  )
}
