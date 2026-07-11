import type { PropertyActiveVendorRow } from '@/lib/propertyVendorRows'
import { CallPhoneButton } from '@/components/CallPhoneButton'

type PropertyVendorsListProps = {
  rows: PropertyActiveVendorRow[]
  loading?: boolean
  onMessageVendor?: (ticketId: string) => void
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-3.5" aria-hidden>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" strokeLinejoin="round" />
    </svg>
  )
}

/** Property detail — Vendors tab: vendors actively working orders at this building. */
export function PropertyVendorsList({
  rows,
  loading = false,
  onMessageVendor,
}: PropertyVendorsListProps) {
  const intro =
    'Keep track of your vendors, assign work orders, and manage repairs in one place.'

  if (loading) {
    return (
      <div className="mt-6 rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <p className="text-center text-[13px] text-[#6a7282]">Loading vendors…</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <p className="text-[13px] leading-5 text-[#6a7282]">{intro}</p>
        <div className="rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <p className="text-center text-[14px] font-medium text-[#0a0a0a]">
            No vendors actively working orders at this property.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <p className="text-[13px] leading-5 text-[#6a7282]">{intro}</p>
      {rows.map((vendor) => (
        <section
          key={vendor.vendorId}
          className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f3f4f6] px-5 py-4">
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">{vendor.vendorName}</h3>
              <p className="mt-0.5 text-[13px] leading-5 text-[#6a7282]">
                {vendor.trade} · {vendor.activeJobCount} active order{vendor.activeJobCount === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <CallPhoneButton phone={vendor.phone} label="Call vendor" variant="outline" />
              <span className="inline-flex rounded-full bg-[#dbfce7] px-2.5 py-0.5 text-[12px] font-medium text-[#008236]">
                On site
              </span>
            </div>
          </header>

          <ul>
            {vendor.workOrders.map((order, index) => (
              <li
                key={order.ticketId}
                className={index > 0 ? 'border-t border-[#f3f4f6]' : undefined}
              >
                <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">{order.title}</p>
                    <p className="mt-0.5 text-[13px] leading-5 text-[#6a7282]">
                      {order.metaLine} · {order.statusLabel}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`inline-flex rounded-[4px] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${order.priorityClassName}`}
                    >
                      {order.priorityLabel}
                    </span>
                    {onMessageVendor ? (
                      <button
                        type="button"
                        onClick={() => onMessageVendor(order.ticketId)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] font-medium text-[#364153] hover:bg-[#f9fafb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
                      >
                        <MessageIcon />
                        Message
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
