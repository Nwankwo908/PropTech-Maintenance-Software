import { Link } from 'react-router-dom'
import type { PropertyResidentCard } from '@/lib/propertyResidentCards'
import { propertyResidentDetailPath } from '@/lib/propertyRoutes'

type PropertyResidentsGridProps = {
  building: string
  residents: PropertyResidentCard[]
  loading?: boolean
}

function ResidentCard({ resident, building }: { resident: PropertyResidentCard; building: string }) {
  return (
    <Link
      to={propertyResidentDetailPath(building, resident.id)}
      className="block rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] transition-colors hover:border-[#d1d5dc] hover:bg-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-[13px] font-semibold text-[#6a7282]">
          {resident.initials}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold leading-5 text-[#0a0a0a]">
            {resident.name}
          </h3>
          <p className="mt-0.5 text-[13px] leading-5 text-[#6a7282]">{resident.unitDisplay}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[12px] leading-4 text-[#6a7282]">Lease ends</p>
          <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
            {resident.leaseEndLabel}
          </p>
        </div>
        <div>
          <p className="text-[12px] leading-4 text-[#6a7282]">Balance</p>
          <p className="mt-1 text-[14px] font-semibold leading-5 tabular-nums text-[#0a0a0a]">
            {resident.balanceLabel}
          </p>
        </div>
      </div>
    </Link>
  )
}

/** Property detail — Residents tab card grid (Figma property overview). */
export function PropertyResidentsGrid({
  building,
  residents,
  loading = false,
}: PropertyResidentsGridProps) {
  if (loading) {
    return (
      <div className="mt-6 rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <p className="text-center text-[13px] text-[#6a7282]">Loading residents…</p>
      </div>
    )
  }

  if (residents.length === 0) {
    return (
      <div className="mt-6 rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-10 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <p className="text-center text-[13px] text-[#6a7282]">No residents found for this property.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {residents.map((resident) => (
        <ResidentCard key={resident.id} resident={resident} building={building} />
      ))}
    </div>
  )
}
