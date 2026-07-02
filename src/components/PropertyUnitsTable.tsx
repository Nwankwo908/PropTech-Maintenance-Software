import { Link } from 'react-router-dom'
import type { PropertyUnitRow } from '@/lib/propertyUnitRows'
import { propertyResidentDetailPath } from '@/lib/propertyRoutes'

function formatBalance(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function OccupancyBadge({ status }: { status: PropertyUnitRow['occupancyStatus'] }) {
  if (status === 'occupied') {
    return (
      <span className="inline-flex rounded-[4px] bg-[#dcfce7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#008236]">
        Occupied
      </span>
    )
  }

  return (
    <span className="inline-flex rounded-[4px] bg-[#f3f4f6] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#6a7282]">
      Vacant
    </span>
  )
}

type PropertyUnitsTableProps = {
  building: string
  rows: PropertyUnitRow[]
  loading?: boolean
}

/** Property detail — Units tab table (Figma property overview). */
export function PropertyUnitsTable({ building, rows, loading = false }: PropertyUnitsTableProps) {
  if (loading) {
    return (
      <div className="mt-6 rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <p className="text-center text-[13px] text-[#6a7282]">Loading units…</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <p className="text-center text-[13px] text-[#6a7282]">No units found for this property.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b border-[#e5e7eb] bg-[#fafafa]">
              {['Unit', 'Resident', 'Status', 'Open workflow', 'Balance', 'Lease ends'].map(
                (heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-5 py-3 text-left text-[12px] font-medium leading-4 text-[#6a7282]"
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[#f3f4f6] last:border-b-0">
                <td className="whitespace-nowrap px-5 py-4 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                  {row.unitDisplay}
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-[14px] leading-5 text-[#364153]">
                  {row.residentId && row.residentName ? (
                    <Link
                      to={propertyResidentDetailPath(building, row.residentId)}
                      className="font-medium text-[#186179] transition-colors hover:text-[#0f4d5f] hover:underline"
                    >
                      {row.residentName}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-4">
                  <OccupancyBadge status={row.occupancyStatus} />
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-[14px] leading-5 text-[#364153]">
                  {row.openWorkflowLabel ?? '—'}
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-[14px] leading-5 tabular-nums text-[#364153]">
                  {row.occupancyStatus === 'occupied' ? formatBalance(row.balanceDue) : '—'}
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-[14px] leading-5 text-[#364153]">
                  {row.leaseEndLabel ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
