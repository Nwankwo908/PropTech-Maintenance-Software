import { useEffect, useId, useState } from 'react'
import { ADMIN_FILTER_TRIGGER_CLASS } from '@/components/AdminActiveFilterChips'
import { PaymentStatusChip } from '@/components/PaymentStatusChip'
import propertyHistoryMediaIcon from '@/assets/property-history-media.svg'
import {
  formatPropertyHistoryAmount,
  type PropertyHistoryRow,
} from '@/lib/propertyHistory'
import { resolveSmsMediaItems } from '@/lib/smsMedia'

type PropertyHistoryPanelProps = {
  rows: PropertyHistoryRow[]
  loading?: boolean
  error?: string | null
  units?: Array<{ id: string; unitLabel: string }>
  unitFilter?: string | null
  onUnitFilterChange?: (unitLabel: string | null) => void
}

export function PropertyHistoryPanel({
  rows,
  loading = false,
  error = null,
  units = [],
  unitFilter = null,
  onUnitFilterChange,
}: PropertyHistoryPanelProps) {
  const unitSelectId = useId()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [mediaUrls, setMediaUrls] = useState<Record<string, string[]>>({})

  useEffect(() => {
    const row = rows.find((entry) => entry.id === expandedId)
    if (!row || row.mediaPaths.length === 0 || mediaUrls[row.id]) return
    let cancelled = false
    void resolveSmsMediaItems(row.mediaPaths).then((resolved) => {
      if (cancelled) return
      const urls = resolved.map((item) => item.url).filter(Boolean)
      setMediaUrls((current) => ({ ...current, [row.id]: urls }))
    })
    return () => {
      cancelled = true
    }
  }, [expandedId, mediaUrls, rows])

  if (loading) {
    return (
      <div className="mt-6 flex flex-col gap-6">
        <Header />
        <div className="rounded-[16px] border border-[#eceff1] bg-white px-6 py-10">
          <p className="text-center text-[13px] text-[#6b7280]">Loading property history…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-6 flex flex-col gap-6">
        <Header />
        <div className="rounded-[16px] border border-[#fecaca] bg-[#fef2f2] px-6 py-10">
          <p className="text-center text-[13px] text-[#991b1b]">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-start gap-3">
        <Header />
        {units.length > 1 && onUnitFilterChange ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={unitSelectId} className="text-[12px] font-semibold text-[#68717a]">
              Unit
            </label>
            <div className="relative">
              <select
                id={unitSelectId}
                value={unitFilter ?? ''}
                onChange={(event) => onUnitFilterChange(event.target.value || null)}
                className={`${ADMIN_FILTER_TRIGGER_CLASS} min-w-[160px] appearance-none pr-9`}
              >
                <option value="">All units</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.unitLabel}>
                    {unit.unitLabel}
                  </option>
                ))}
              </select>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#364153]"
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[16px] border border-[#eceff1] bg-white px-6 py-10">
          <p className="text-center text-[13px] text-[#6b7280]">
            No property history yet. Completed maintenance and rent will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-[#eceff1] bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[960px] w-full border-collapse">
              <thead>
                <tr className="border-b border-[#eceff1] text-left text-[12px] font-semibold text-[#68717a]">
                  <th className="w-[120px] px-6 py-3.5 font-semibold">Unit</th>
                  <th className="w-[180px] px-0 py-3.5 font-semibold">Contact type</th>
                  <th className="w-[100px] px-0 py-3.5 font-semibold">Status</th>
                  <th className="px-4 py-3.5 font-semibold">Event</th>
                  <th className="w-[140px] px-0 py-3.5 font-semibold">Invoice</th>
                  <th className="w-[80px] px-0 py-3.5 text-left font-semibold">Amount</th>
                  <th className="w-[110px] px-0 py-3.5 text-left font-semibold">Payment date</th>
                  <th className="w-[120px] px-6 py-3.5 font-semibold">Media</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id
                  const amountClass = 'font-semibold text-[#1a1d20]'
                  return (
                    <tr key={row.id} className="border-b border-[#eceff1] last:border-b-0">
                      <td className="px-6 py-4 text-[14px] font-semibold text-[#1a1d20]">{row.unitLabel}</td>
                      <td className="py-4 pr-4 text-[14px] font-medium text-[#68717a]">{row.contactName}</td>
                      <td className="py-4 pr-4">
                        <PaymentStatusChip status={row.paymentStatus} />
                      </td>
                      <td className="px-4 py-4 text-[14px] font-medium text-[#68717a]">{row.event}</td>
                      <td className="py-4 pr-4 text-[14px] font-medium text-[#68717a]">{row.vendorInvoice}</td>
                      <td className={`py-4 pr-4 text-left text-[14px] ${amountClass}`}>
                        {formatPropertyHistoryAmount(row.amount)}
                      </td>
                      <td className="py-4 pr-4 text-left text-[14px] font-medium text-[#68717a]">
                        {row.dateLabel}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          disabled={row.mediaCount === 0}
                          onClick={() => setExpandedId(expanded ? null : row.id)}
                          className="flex items-center gap-2 text-left disabled:cursor-default"
                        >
                          <img
                            src={propertyHistoryMediaIcon}
                            alt=""
                            width={16}
                            height={16}
                            className="size-4 shrink-0"
                          />
                          <span className="text-[12px] font-normal text-[#68717a]">{row.mediaLabel}</span>
                        </button>
                        {expanded && row.mediaCount > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(mediaUrls[row.id] ?? []).map((url) => (
                              <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
                                <img src={url} alt="" className="size-16 rounded-[8px] object-cover" />
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-[18px] font-bold leading-normal text-[#111827]">Property History</h2>
      <p className="text-[14px] font-normal leading-normal text-[#6b7280]">
        Track completed maintenance (issue, work order, invoice) and rent (payment status and amount due).
      </p>
    </div>
  )
}
