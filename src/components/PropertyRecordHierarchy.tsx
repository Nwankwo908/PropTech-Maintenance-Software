import { Link } from 'react-router-dom'

const RECORD_LAYERS = [
  'Property',
  'Unit',
  'Rent Event / Work Order',
  'Vendor',
  'Invoice',
  'Photos / Video',
] as const

export function PropertyRecordHierarchy() {
  return (
    <section className="rounded-[12px] border border-[#eceff1] bg-white px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold leading-5 text-[#111827]">Property record</h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6b7280]">
            Every event on this property is stored in this order, then shown on Property History.
          </p>
        </div>
        <Link
          to="?tab=history"
          className="sa-link shrink-0 text-[13px] font-medium text-[#1447e6] hover:text-[#0a2ea8]"
        >
          Open Property History
        </Link>
      </div>

      <ol className="mt-4 flex flex-col items-start">
        {RECORD_LAYERS.map((label, index) => (
          <li key={label} className="flex flex-col items-start">
            <span className="rounded-[8px] border border-[#eceff1] bg-[#f8fafc] px-3 py-1.5 text-[13px] font-medium text-[#1a1d20]">
              {label}
            </span>
            {index < RECORD_LAYERS.length - 1 ? (
              <span className="px-3 py-1 text-[12px] leading-4 text-[#9ca3af]" aria-hidden>
                ↓
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <p className="text-[12px] leading-5 text-[#6b7280]">
          <span className="font-semibold text-[#364153]">Maintenance: </span>
          Issue → Work → Evidence → Invoice → Property History
        </p>
        <p className="text-[12px] leading-5 text-[#6b7280]">
          <span className="font-semibold text-[#364153]">Rent: </span>
          Rent Due → Landlord Confirmation → Payment History
        </p>
      </div>
    </section>
  )
}
