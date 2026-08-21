import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  UnitOccupancyStatusMenu,
  type UnitOccupancyStatus,
} from '@/components/UnitOccupancyStatusMenu'
import type { PropertyUnitRow } from '@/lib/propertyUnitRows'
import { propertyDetailPath, residentDetailPath } from '@/lib/propertyRoutes'

function formatBalance(amount: number): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

type PropertyUnitsTableProps = {
  building: string
  propertyId?: string
  rows: PropertyUnitRow[]
  loading?: boolean
  onOccupancyStatusChange?: (
    unitId: string,
    status: UnitOccupancyStatus,
  ) => void | Promise<void | boolean>
}

/** Property detail — Units tab table (Figma property overview). */
export function PropertyUnitsTable({
  building,
  propertyId,
  rows,
  loading = false,
  onOccupancyStatusChange,
}: PropertyUnitsTableProps) {
  const location = useLocation()
  const [statusOverrides, setStatusOverrides] = useState<
    Partial<Record<string, UnitOccupancyStatus>>
  >({})

  // Drop optimistic overrides once persisted row status catches up.
  useEffect(() => {
    setStatusOverrides((prev) => {
      let changed = false
      const next = { ...prev }
      for (const row of rows) {
        if (next[row.id] != null && next[row.id] === row.occupancyStatus) {
          delete next[row.id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [rows])

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

  const backToUnits =
    propertyId != null && propertyId.trim()
      ? propertyDetailPath(propertyId, 'units')
      : propertyDetailPath(building, 'units')

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
                    className="whitespace-nowrap px-5 py-3 text-left text-[12px] font-medium leading-4 tracking-[0.02em] text-[#6a7282]"
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = statusOverrides[row.id] ?? row.occupancyStatus
              const showOccupiedFields = status === 'occupied'

              return (
                <tr key={row.id} className="border-b border-[#f3f4f6] last:border-b-0">
                  <td className="whitespace-nowrap px-5 py-4 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                    {row.unitDisplay}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-[14px] leading-5 text-[#364153]">
                    {row.residentId && row.residentName ? (
                      <Link
                        to={residentDetailPath(row.residentId)}
                        state={{ from: `${location.pathname}${location.search}` || backToUnits }}
                        className="sa-link font-medium text-[#186179] hover:text-[#0f4d5f] hover:underline"
                      >
                        {row.residentName}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <UnitOccupancyStatusMenu
                      status={status}
                      onStatusChange={(next) => {
                        setStatusOverrides((prev) => ({ ...prev, [row.id]: next }))
                        void (async () => {
                          const result = await onOccupancyStatusChange?.(row.id, next)
                          if (result === false) {
                            setStatusOverrides((prev) => {
                              const copy = { ...prev }
                              delete copy[row.id]
                              return copy
                            })
                          }
                        })()
                      }}
                    />
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-[14px] leading-5 text-[#364153]">
                    {row.openWorkflowLabel ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-[14px] leading-5 tabular-nums text-[#364153]">
                    {showOccupiedFields ? formatBalance(row.balanceDue) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-[14px] leading-5 text-[#364153]">
                    {showOccupiedFields ? (row.leaseEndLabel ?? '—') : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
