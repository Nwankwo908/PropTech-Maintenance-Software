import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PropertyResidentCard } from '@/lib/propertyResidentCards'
import { propertyResidentDetailPath, propertyResidentDetailPathForBuilding } from '@/lib/propertyRoutes'

type PropertyResidentsGridProps = {
  building: string
  propertyId?: string
  residents: PropertyResidentCard[]
  loading?: boolean
}

function ResidentCard({
  resident,
  building,
  propertyId,
  index,
}: {
  resident: PropertyResidentCard
  building: string
  propertyId?: string
  index: number
}) {
  const navigate = useNavigate()
  const [selecting, setSelecting] = useState(false)
  const path = propertyId
    ? propertyResidentDetailPath(propertyId, resident.id)
    : propertyResidentDetailPathForBuilding(building, resident.id, new Map())

  function handleSelect() {
    if (selecting) return
    setSelecting(true)
    window.setTimeout(() => {
      navigate(path)
    }, 180)
  }

  return (
    <button
      type="button"
      onClick={handleSelect}
      disabled={selecting}
      aria-busy={selecting}
      className={[
        'property-resident-card block w-full rounded-[10px] border bg-white p-5 text-left shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] outline-none',
        selecting
          ? 'border-[#187960] bg-[#e2f5f1] shadow-[0px_4px_14px_rgba(24,121,96,0.14)]'
          : 'border-[#e5e7eb] hover:border-[#187960]/50 hover:bg-[#f8fafc] hover:shadow-[0px_4px_12px_rgba(15,23,42,0.06)]',
        'focus-visible:shadow-[0_0_0_2px_#ffffff,0_0_0_4px_#187960]',
      ].join(' ')}
      style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
    >
      <div className="flex items-start gap-3">
        <span
          className={[
            'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-colors duration-200',
            selecting ? 'bg-[#187960] text-white' : 'bg-[#f3f4f6] text-[#6a7282]',
          ].join(' ')}
        >
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
    </button>
  )
}

/** Property detail — Residents tab card grid (Figma property overview). */
export function PropertyResidentsGrid({
  building,
  propertyId,
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
      {residents.map((resident, index) => (
        <ResidentCard
          key={resident.id}
          resident={resident}
          building={building}
          propertyId={propertyId}
          index={index}
        />
      ))}
    </div>
  )
}
