export type SavedPropertyInsuranceCard = {
  policyType: string
  building: string
  carrier: string
  policyNumber: string
  premium: string
  coverageAmount: string
  deductible: string
  coverageStartDate: string
  coverageEndDate: string
  dwellingCoverage: string
  otherStructures: string
  liability: string
  lossOfRentalIncome: string
  agent: string
  claimHotline: string
  binderFileName: string | null
  binderFileUrl: string | null
  binderFileSize: number | null
  binderUploadedAt: string | null
}

function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const amount = Number(cleaned)
  return Number.isFinite(amount) ? amount : null
}

function formatUsd(value: string): string {
  const amount = parseAmount(value)
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount)
}

function formatPremium(value: string): string {
  const formatted = formatUsd(value)
  return formatted === '—' ? '—' : `${formatted}/yr`
}

function formatPolicyDate(value: string): string {
  const raw = value.trim()
  if (!raw) return '—'
  const iso = raw.length === 10 ? `${raw}T12:00:00` : raw
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return raw
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatPolicyNumberShort(value: string): string {
  const text = value.trim()
  if (!text) return '—'
  if (text.length <= 8) return text
  return `...${text.slice(-6)}`
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return '—'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function policyTypeLabel(value: string): string {
  const key = value.trim().toLowerCase()
  if (key.includes('commercial')) return 'Commercial'
  if (key.includes('dwelling')) return 'Dwelling'
  return 'Homeowners'
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-start rounded-[8px] bg-[#f9fafb] px-3 py-2">
      <p className="text-[10px] leading-[15px] text-[#99a1af]">{label}</p>
      <p className="w-full pt-0.5 text-[12px] font-semibold leading-4 text-[#1e2939]">{value}</p>
    </div>
  )
}

function DetailRow({
  label,
  value,
  last = false,
}: {
  label: string
  value: string
  last?: boolean
}) {
  return (
    <div
      className={[
        'flex w-full items-center justify-between',
        last ? 'pt-2.5' : 'border-b border-[#f3f4f6] py-2.5',
      ].join(' ')}
    >
      <p className="text-[12px] leading-4 text-[#6a7282]">{label}</p>
      <p className="text-[12px] font-medium leading-4 text-[#1e2939]">{value}</p>
    </div>
  )
}

function downloadBinder(insurance: SavedPropertyInsuranceCard) {
  const href = insurance.binderFileUrl?.trim()
  if (!href) return
  const link = document.createElement('a')
  link.href = href
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.download = insurance.binderFileName?.trim() || 'insurance-policy'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

type PropertyInsurancePolicyCardProps = {
  insurance: SavedPropertyInsuranceCard
  onEdit: () => void
  onDelete: () => void
  className?: string
}

/** Saved policy card — Figma node 1454:1180. */
export function PropertyInsurancePolicyCard({
  insurance,
  onEdit,
  onDelete,
  className,
}: PropertyInsurancePolicyCardProps) {
  const canDownload = Boolean(insurance.binderFileUrl?.trim())
  const typeLabel = policyTypeLabel(insurance.policyType)
  const coverage = insurance.coverageAmount.trim() || insurance.dwellingCoverage
  const actionClass =
    'sa-press inline-flex h-10 w-fit shrink-0 items-center justify-center gap-1.5 rounded-[8px] bg-transparent px-3 py-2 text-[12px] font-medium leading-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#155dfc] focus-visible:ring-offset-2'

  return (
    <div
      className={[
        'flex w-full min-w-0 flex-col overflow-hidden rounded-[12px] border border-solid border-[#e5e7eb] bg-white shadow-[0px_2px_8px_0px_rgba(16,24,40,0.04)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex w-full flex-col gap-3 border-b border-solid border-[#f3f4f6] px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="inline-flex w-fit items-center rounded-full bg-[#eff6ff] px-2 py-0.5 text-[10px] font-medium leading-[15px] text-[#1447e6]">
              {typeLabel}
            </span>
            <h3 className="text-[14px] font-semibold leading-[19.25px] text-[#101828]">
              {typeLabel} Policy - {insurance.building}
            </h3>
            <p className="text-[12px] leading-4 text-[#99a1af]">{insurance.carrier.trim() || '—'}</p>
        </div>
        <div className="flex w-fit shrink-0 flex-wrap items-center justify-end gap-1">
          <button
            type="button"
            disabled={!canDownload}
            onClick={() => downloadBinder(insurance)}
            className={`${actionClass} text-[#4a5565] hover:bg-[#f3f4f6] hover:text-[#1e2939] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[#4a5565]`}
          >
            <svg viewBox="0 0 14 14" fill="none" className="size-[14px]" aria-hidden>
              <path
                d="M7 5.8v3.5M8.8 7.6L7 9.3 5.2 7.6M1.8 9.9V4.1c0-.8.6-1.2 1.2-1.2h3.5L7.6 4.1h3.5c.6 0 1.2.4 1.2 1.2v4.6c0 .8-.6 1.2-1.2 1.2H2.9c-.6 0-1.1-.4-1.1-1.2Z"
                stroke="currentColor"
                strokeWidth="1.17"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Download
          </button>
          <button
            type="button"
            onClick={onEdit}
            className={`${actionClass} text-[#4a5565] hover:bg-[#f3f4f6] hover:text-[#1e2939]`}
          >
            <svg viewBox="0 0 16 16" fill="none" className="size-[14px]" aria-hidden>
              <path
                d="M11.5 2.5l2 2M3 13l.7-3.2L11.2 2.3a1.2 1.2 0 0 1 1.7 0l.8.8a1.2 1.2 0 0 1 0 1.7L5.2 12.3 2 13l1-3.2Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className={`${actionClass} text-[#a03e3e] hover:bg-[#fef2f2] hover:text-[#8a2f2f]`}
          >
            <svg viewBox="0 0 16 16" fill="none" className="size-[14px]" aria-hidden>
              <path
                d="M3.5 4.5h9M6.5 4.5V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7v1.3M5.2 4.5v8.2c0 .6.4 1 1 1h3.6c.6 0 1-.4 1-1V4.5M6.8 7v4M9.2 7v4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Delete
          </button>
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 border-b border-solid border-[#f3f4f6] px-5 py-4">
        <p className="text-[10px] font-semibold uppercase leading-[15px] tracking-[0.5px] text-[#99a1af]">
          Policy Summary
        </p>
        <div className="flex w-full flex-col gap-2">
          <div className="flex gap-2">
            <SummaryTile label="Premium" value={formatPremium(insurance.premium)} />
            <SummaryTile label="Coverage" value={formatUsd(coverage)} />
          </div>
          <div className="flex gap-2">
            <SummaryTile label="Deductible" value={formatUsd(insurance.deductible)} />
            <SummaryTile label="Start" value={formatPolicyDate(insurance.coverageStartDate)} />
          </div>
          <div className="flex gap-2">
            <SummaryTile label="Expires" value={formatPolicyDate(insurance.coverageEndDate)} />
            <SummaryTile label="Policy #" value={formatPolicyNumberShort(insurance.policyNumber)} />
          </div>
        </div>
      </div>

      <div className="flex w-full flex-col gap-3 border-b border-solid border-[#f3f4f6] px-5 py-4">
        <p className="text-[10px] font-semibold uppercase leading-[15px] tracking-[0.5px] text-[#99a1af]">
          Extracted Details
        </p>
        <div className="flex w-full flex-col gap-2">
          <DetailRow label="Dwelling Coverage" value={formatUsd(insurance.dwellingCoverage || coverage)} />
          <DetailRow label="Other Structures" value={formatUsd(insurance.otherStructures)} />
          <DetailRow label="Liability" value={formatUsd(insurance.liability)} />
          <DetailRow label="Loss of Rental Income" value={formatUsd(insurance.lossOfRentalIncome)} />
          <DetailRow label="Agent" value={insurance.agent.trim() || '—'} />
          <DetailRow label="Claim Hotline" value={insurance.claimHotline.trim() || '—'} last />
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 px-5 py-4">
        <div className="flex items-center justify-between">
          <p className="text-[12px] leading-4 text-[#99a1af]">File size</p>
          <p className="text-[12px] leading-4 text-[#4a5565]">{formatFileSize(insurance.binderFileSize)}</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[12px] leading-4 text-[#99a1af]">Uploaded</p>
          <p className="text-[12px] leading-4 text-[#4a5565]">
            {formatPolicyDate(insurance.binderUploadedAt ?? '')}
          </p>
        </div>
      </div>
    </div>
  )
}
