import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { TableCheckbox } from '@/components/TableCheckbox'
import {
  formatPropertyHealthTooltip,
  type PropertyHealthBuildingRow,
  type PropertyHealthStatus,
} from '@/lib/propertyHealth'

export const HEALTH_BADGE_STYLES: Record<PropertyHealthStatus, string> = {
  healthy: 'bg-[#dbfce7] text-[#008236]',
  monitor: 'bg-[#fef9c2] text-[#a65f00]',
  at_risk: 'bg-[#ffe2e2] text-[#c10007]',
  pending_setup: 'bg-[#f3f4f6] text-[#6a7282]',
}

export const HEALTH_BADGE_LABELS: Record<PropertyHealthStatus, string> = {
  healthy: 'HEALTHY',
  monitor: 'MONITOR',
  at_risk: 'AT RISK',
  pending_setup: 'PENDING SETUP',
}

export const HEALTH_BAR_STYLES: Record<PropertyHealthStatus, string> = {
  healthy: 'bg-[#00c950]',
  monitor: 'bg-[#fdc700]',
  at_risk: 'bg-[#fb2c36]',
  pending_setup: 'bg-[#d1d5dc]',
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-3.5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-3.5">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.8M18 20a5 5 0 0 0-3-4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
      <path d="M12 17.3l-6.18 3.7 1.64-7.03L2 9.24l7.19-.61L12 2l2.81 6.63 7.19.61-5.46 4.73L18.18 21z" />
    </svg>
  )
}

type PropertyHealthBuildingGridProps = {
  className?: string
  loading: boolean
  buildings: PropertyHealthBuildingRow[]
  totalUnits: number
  emptyCtaHref?: string
  emptyCtaLabel?: string
  headerAction?: ReactNode
  showMonthlySpend?: boolean
  formatSpend?: (amount: number) => string
  monthlySpendByBuilding?: Map<string, number>
  selection?: {
    selectedBuildings: Set<string>
    onToggleBuilding: (building: string) => void
    allSelected: boolean
    someSelected: boolean
    onToggleAll: () => void
  }
}

export function PropertyHealthBuildingGrid({
  className = '',
  loading,
  buildings,
  totalUnits,
  emptyCtaHref = '/admin/users',
  emptyCtaLabel = 'Add your first property',
  headerAction,
  showMonthlySpend = false,
  formatSpend,
  monthlySpendByBuilding,
  selection,
}: PropertyHealthBuildingGridProps) {
  return (
    <section
      className={`flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] ${className}`.trim()}
    >
      <div className="flex items-center justify-between gap-4 border-b border-[#e5e7eb] px-6 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {selection ? (
            <div className="pt-0.5">
              <TableCheckbox
                aria-label="Select all properties"
                disabled={loading || buildings.length === 0}
                checked={selection.allSelected}
                indeterminate={selection.someSelected}
                onChange={selection.onToggleAll}
              />
            </div>
          ) : null}
          <div>
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
              Property Health
            </h2>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              {buildings.length} propert{buildings.length === 1 ? 'y' : 'ies'} · {totalUnits} units
            </p>
          </div>
        </div>
        {headerAction}
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2 2xl:grid-cols-3">
        {loading ? (
          <p className="col-span-full px-2 py-8 text-center text-[13px] text-[#6a7282]">
            Loading…
          </p>
        ) : buildings.length === 0 ? (
          <div className="col-span-full px-2 py-10 text-center">
            <p className="text-[13px] text-[#6a7282]">
              No properties yet. Add buildings and units to start tracking operational health.
            </p>
            <Link
              to={emptyCtaHref}
              className="mt-3 inline-block rounded-[10px] bg-[#101828] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1e2939]"
            >
              {emptyCtaLabel}
            </Link>
          </div>
        ) : (
          buildings.map((b) => {
            const selected = selection?.selectedBuildings.has(b.building) ?? false
            return (
            <div
              key={b.building}
              className={[
                'group flex flex-col gap-3 rounded-[10px] border bg-white p-4 transition-[border-color,box-shadow,background-color] duration-150',
                selected
                  ? 'border-[#0030b5]/35 ring-1 ring-[#0030b5]/15 hover:border-[#0030b5]/50 hover:shadow-[0px_4px_12px_rgba(0,48,181,0.08)]'
                  : 'border-[#e5e7eb] hover:border-[#101828]/20 hover:bg-[#fafafa] hover:shadow-[0px_4px_12px_rgba(0,0,0,0.06)]',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] border border-[#e5e7eb] text-[#364153] transition-[border-color,background-color] duration-150 group-hover:border-[#101828]/15 group-hover:bg-[#f9fafb]">
                    <BuildingIcon />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                      {b.building}
                    </p>
                    <p className="text-[12px] leading-4 text-[#6a7282]">
                      {b.unitCount} unit{b.unitCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-start gap-2">
                  <span
                    className={`rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${HEALTH_BADGE_STYLES[b.status]}`}
                  >
                    {HEALTH_BADGE_LABELS[b.status]}
                  </span>
                  {selection ? (
                    <div
                      className={[
                        'pt-0.5',
                        selected
                          ? 'block'
                          : 'hidden group-hover:block group-focus-within:block',
                      ].join(' ')}
                    >
                      <TableCheckbox
                        aria-label={`Select ${b.building}`}
                        checked={selected}
                        onChange={() => selection.onToggleBuilding(b.building)}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
              <div
                title={formatPropertyHealthTooltip(b.components)}
                aria-label={formatPropertyHealthTooltip(b.components)}
              >
                {b.status === 'pending_setup' ? (
                  <>
                    <p className="text-[28px] font-bold leading-8 text-[#6a7282]">—</p>
                    <p className="text-[12px] leading-4 text-[#6a7282]">
                      Pending setup — activate units to score health
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#f3f4f6]">
                      <div className="h-full w-0 rounded-full bg-[#d1d5dc]" />
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[28px] font-bold leading-8 text-[#0a0a0a] tabular-nums">
                      {b.score}
                      <span className="text-[12px] font-normal text-[#6a7282]"> / 100 health</span>
                    </p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#f3f4f6]">
                      <div
                        className={`h-full rounded-full ${HEALTH_BAR_STYLES[b.status]}`}
                        style={{ width: `${b.score}%` }}
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[#f3f4f6] pt-3 text-[12px] leading-4 text-[#6a7282]">
                <span className="flex items-center gap-1.5">
                  <ClockIcon />
                  <span className="font-semibold text-[#0a0a0a]">{b.openTickets}</span> open
                </span>
                <span className="flex items-center gap-1.5">
                  <UsersIcon />
                  <span className="font-semibold text-[#0a0a0a] tabular-nums">
                    {b.occupancyPct}%
                  </span>{' '}
                  occ.
                </span>
                <span className="col-span-2 flex items-center gap-1.5">
                  <span className={b.residentRating != null ? 'text-[#f59e0b]' : 'text-[#d1d5db]'}>
                    <StarIcon />
                  </span>
                  {b.residentRating != null ? (
                    <>
                      <span className="font-semibold text-[#0a0a0a] tabular-nums">
                        {b.residentRating.toFixed(1)}
                      </span>
                      /5.0 · {b.feedbackCount} review{b.feedbackCount === 1 ? '' : 's'}
                    </>
                  ) : (
                    <span>No resident feedback yet</span>
                  )}
                </span>
                {showMonthlySpend && formatSpend && monthlySpendByBuilding ? (
                  <span className="col-span-2 flex items-center justify-between">
                    <span>30-day maintenance</span>
                    <span className="font-semibold text-[#0a0a0a] tabular-nums">
                      {formatSpend(monthlySpendByBuilding.get(b.building) ?? 0)}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
            )
          })
        )}
      </div>
    </section>
  )
}
