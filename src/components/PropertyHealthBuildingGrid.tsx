import { Link, useNavigate } from 'react-router-dom'
import type { ReactNode, Ref } from 'react'
import { inAppRouterPath } from '@/lib/inAppRouterPath'
import { TableCheckbox } from '@/components/TableCheckbox'
import {
  resolvePropertyHealthPendingMessage,
  shouldShowPropertyHealthScore,
  type PropertyHealthBuildingRow,
  type PropertyHealthStatus,
} from '@/lib/propertyHealth'

export const HEALTH_BADGE_STYLES: Record<PropertyHealthStatus, string> = {
  excellent: 'bg-[#dbfce7] text-[#008236]',
  good: 'bg-[#dbfce7] text-[#008236]',
  fair: 'bg-[#fef9c2] text-[#a65f00]',
  needs_attention: 'bg-[#ffedd4] text-[#9f2d00]',
  high_risk: 'bg-[#ffe2e2] text-[#c10007]',
  healthy: 'bg-[#dbfce7] text-[#008236]',
  monitor: 'bg-[#fef9c2] text-[#a65f00]',
  at_risk: 'bg-[#ffe2e2] text-[#c10007]',
  active: 'bg-[#dbfce7] text-[#008236]',
  pending_setup: 'bg-[#f3f4f6] text-[#6a7282]',
  unknown: 'bg-[#f3f4f6] text-[#6a7282]',
}

export const HEALTH_BADGE_LABELS: Record<PropertyHealthStatus, string> = {
  excellent: 'EXCELLENT',
  good: 'GOOD',
  fair: 'FAIR',
  needs_attention: 'NEEDS ATTENTION',
  high_risk: 'HIGH RISK',
  healthy: 'HEALTHY',
  monitor: 'MONITOR',
  at_risk: 'AT RISK',
  active: 'ACTIVE',
  pending_setup: 'PENDING SETUP',
  unknown: 'UNKNOWN',
}

export const HEALTH_BAR_STYLES: Record<PropertyHealthStatus, string> = {
  excellent: 'bg-[#00c950]',
  good: 'bg-[#00c950]',
  fair: 'bg-[#fdc700]',
  needs_attention: 'bg-[#ff8904]',
  high_risk: 'bg-[#fb2c36]',
  healthy: 'bg-[#00c950]',
  monitor: 'bg-[#fdc700]',
  at_risk: 'bg-[#fb2c36]',
  active: 'bg-[#d1d5dc]',
  pending_setup: 'bg-[#d1d5dc]',
  unknown: 'bg-[#d1d5dc]',
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-5">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" />
    </svg>
  )
}

function WorkOrderIcon() {
  return (
    <svg
      viewBox="3 2 14 17"
      fill="currentColor"
      className="size-3.5 shrink-0"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M14,3H11.97748a2,2,0,0,0-4,0H6A2.002,2.002,0,0,0,4,5V16a2.002,2.002,0,0,0,2,2h8a2.002,2.002,0,0,0,2-2V5A2.002,2.002,0,0,0,14,3Zm1,13a1.0013,1.0013,0,0,1-1,1H6a1.0013,1.0013,0,0,1-1-1V5A1.0013,1.0013,0,0,1,6,4,1.00036,1.00036,0,0,0,7,5h6a1.00036,1.00036,0,0,0,1-1,1.0013,1.0013,0,0,1,1,1Zm-1.5-4v-.5a3.5,3.5,0,0,0-7,0V12a.5.5,0,0,0,0,1h7a.5.5,0,0,0,0-1Zm-6,0v-.5a2.48947,2.48947,0,0,1,1-1.98724V10a.5.5,0,0,0,1,0V9.0506a2.49566,2.49566,0,0,1,1,0V10a.5.5,0,0,0,1,0V9.51276A2.48947,2.48947,0,0,1,12.5,11.5V12Z"
      />
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

function TrashIcon({ className = 'size-3.5 shrink-0' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type PropertyHealthBuildingGridProps = {
  className?: string
  /** Shrink columns to the panel width — no horizontal scroll (Overview side-by-side). */
  fitContainer?: boolean
  loading: boolean
  buildings: PropertyHealthBuildingRow[]
  totalUnits: number
  /**
   * Portfolio building count for the section subtitle. Defaults to `buildings.length`.
   * Pass the full portfolio count when `buildings` is a preview slice (e.g. overview).
   */
  buildingCount?: number
  emptyCtaHref?: string
  emptyCtaLabel?: string
  /** When set, empty-state CTA is a button (opens rail) instead of a link. */
  onEmptyCtaClick?: () => void
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
    onClearSelection?: () => void
    onDeleteSelected?: () => void
    deleteSelectedSaving?: boolean
  }
  onBuildingOpen?: (building: string) => void
  /** Same-origin property detail path (React Router). Prefer this over navigating in onBuildingOpen. */
  buildingHref?: (building: string) => string
  /** Optional React Router location state (e.g. setup-success coachmark). */
  buildingLinkState?: (building: string) => unknown
  /** Highlight the first property row (Get set up for success coachmark). */
  firstCardRef?: Ref<HTMLElement | null>
}

const HEADER_BTN =
  'sa-press inline-flex shrink-0 items-center justify-center rounded-[10px] bg-transparent px-4 py-2 text-[13px] font-medium leading-5 text-[#186179] disabled:pointer-events-none disabled:opacity-50'

const HEADER_BTN_GHOST =
  'sa-press inline-flex shrink-0 items-center justify-center rounded-[10px] bg-transparent px-4 py-2 text-[13px] font-medium leading-5 text-[#6a7282] hover:bg-[#f3f4f6] disabled:pointer-events-none disabled:opacity-50'

const HEADER_BTN_DANGER =
  'sa-press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-transparent px-4 py-2 text-[13px] font-medium leading-5 text-[#b52a00] hover:bg-[#fff4f0] disabled:pointer-events-none disabled:opacity-50'

const TH_CLASS = 'px-4 py-3 text-[12px] font-medium text-[#6a7282] sm:px-6'
const TD_CLASS = 'px-4 py-3.5 text-[14px] leading-5 text-[#0a0a0a] sm:px-6'
/** Match section header inset (px-4 / sm:px-6) so left/right edges line up. */
const TH_CLASS_FIT = 'px-4 py-2.5 text-left text-[11px] font-medium leading-4 text-[#6a7282] sm:px-6'
const TD_CLASS_FIT = 'px-4 py-2.5 text-left text-[13px] leading-4 text-[#0a0a0a] sm:px-6'

function propertyHealthSubtitle(propertyCount: number): string {
  if (propertyCount <= 0) {
    return 'Add your first property to start tracking its health.'
  }
  if (propertyCount === 1) {
    return 'See how your 1 property is doing and whether it needs attention.'
  }
  return `See which of your ${propertyCount} properties are in great shape and which need attention.`
}

export function PropertyHealthBuildingGrid({
  className = '',
  fitContainer = false,
  loading,
  buildings,
  totalUnits,
  buildingCount,
  emptyCtaHref = '/admin/properties',
  emptyCtaLabel = 'Add your first property',
  onEmptyCtaClick,
  headerAction,
  showMonthlySpend = false,
  formatSpend,
  monthlySpendByBuilding,
  selection,
  onBuildingOpen,
  buildingHref,
  buildingLinkState,
  firstCardRef,
}: PropertyHealthBuildingGridProps) {
  const navigate = useNavigate()
  const selectedCount = selection?.selectedBuildings.size ?? 0
  const propertyCount = buildingCount ?? buildings.length
  const columnCount =
    6 + (selection ? 1 : 0) + (showMonthlySpend ? 1 : 0)
  const th = fitContainer ? TH_CLASS_FIT : TH_CLASS
  const td = fitContainer ? TD_CLASS_FIT : TD_CLASS
  const numericAlign = fitContainer ? 'text-left' : 'text-right'

  return (
    <section
      className={`flex min-w-0 flex-col rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)] ${className}`.trim()}
    >
      <div className="relative z-10 flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-[#e5e7eb] px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
            My Properties
          </h2>
          <p className="text-[12px] leading-4 text-[#6a7282]">
            {selectedCount > 0 ? (
              <>
                <span className="font-medium text-[#0a0a0a]">{selectedCount}</span>
                {selectedCount === 1 ? ' property selected' : ' properties selected'}
                {' · '}
                {totalUnits} units
              </>
            ) : (
              propertyHealthSubtitle(propertyCount)
            )}
          </p>
        </div>
        <div className="relative z-10 flex min-w-0 flex-wrap items-center justify-end gap-2">
          {selection ? (
            <>
              {!selection.allSelected ? (
                <button
                  type="button"
                  disabled={loading || buildings.length === 0}
                  onClick={selection.onToggleAll}
                  className={HEADER_BTN}
                >
                  Select all
                </button>
              ) : null}
              {selectedCount > 0 && selection.onClearSelection ? (
                <button
                  type="button"
                  onClick={selection.onClearSelection}
                  className={HEADER_BTN_GHOST}
                >
                  Clear selection
                </button>
              ) : null}
              {selectedCount > 0 && selection.onDeleteSelected ? (
                <button
                  type="button"
                  disabled={selection.deleteSelectedSaving}
                  onClick={selection.onDeleteSelected}
                  className={HEADER_BTN_DANGER}
                >
                  <TrashIcon />
                  {selection.deleteSelectedSaving ? 'Deleting…' : 'Delete selected'}
                </button>
              ) : null}
            </>
          ) : null}
          {headerAction}
        </div>
      </div>
      <div
        className={
          fitContainer
            ? 'min-w-0 flex-1 overflow-hidden'
            : 'overflow-x-auto overscroll-x-contain'
        }
      >
        <table
          className={
            fitContainer
              ? 'w-full table-fixed border-collapse text-left'
              : 'min-w-full border-collapse text-left'
          }
        >
          <thead>
            <tr className="border-b border-[#e5e7eb]">
              {selection ? (
                <th className="w-12 px-4 py-3">
                  <TableCheckbox
                    aria-label="Select all visible properties"
                    disabled={loading || buildings.length === 0}
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected && !selection.allSelected}
                    onChange={selection.onToggleAll}
                  />
                </th>
              ) : null}
              <th className={`${th} ${fitContainer ? 'w-[28%]' : ''}`}>Property</th>
              <th className={`${th} ${numericAlign} tabular-nums ${fitContainer ? 'w-[10%]' : ''}`}>
                Units
              </th>
              <th className={`${th} ${fitContainer ? 'w-[18%]' : ''}`}>Health</th>
              <th className={`${th} ${fitContainer ? 'w-[16%]' : ''}`}>Score</th>
              <th className={`${th} ${numericAlign} tabular-nums ${fitContainer ? 'w-[14%]' : ''}`}>
                {fitContainer ? 'WOs' : 'Work orders'}
              </th>
              <th className={`${th} ${numericAlign} tabular-nums ${fitContainer ? 'w-[14%]' : ''}`}>
                {fitContainer ? 'Occ.' : 'Occupancy'}
              </th>
              {showMonthlySpend ? (
                <th className={`${th} ${numericAlign} tabular-nums`}>Monthly cost</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columnCount}
                  className="px-6 py-10 text-center text-[14px] text-[#6a7282]"
                >
                  Loading…
                </td>
              </tr>
            ) : buildings.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-6 py-10 text-center">
                  <p className="text-[14px] text-[#6a7282]">
                    No properties yet. Add buildings and units to start tracking operational
                    health.
                  </p>
                  {onEmptyCtaClick ? (
                    <button
                      type="button"
                      onClick={onEmptyCtaClick}
                      className="sa-press mt-3 inline-block rounded-[10px] bg-[#101828] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1e2939]"
                    >
                      {emptyCtaLabel}
                    </button>
                  ) : (
                    <Link
                      to={inAppRouterPath(emptyCtaHref)}
                      className="sa-press mt-3 inline-block rounded-[10px] bg-[#101828] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#1e2939]"
                    >
                      {emptyCtaLabel}
                    </Link>
                  )}
                </td>
              </tr>
            ) : (
              buildings.map((b, index) => {
                const selected = selection?.selectedBuildings.has(b.building) ?? false
                const href = buildingHref ? inAppRouterPath(buildingHref(b.building)) : null
                const rowOpens = Boolean(href || onBuildingOpen)
                const rowRef =
                  index === 0
                    ? (node: HTMLTableRowElement | null) => {
                        if (typeof firstCardRef === 'function') firstCardRef(node)
                        else if (firstCardRef) firstCardRef.current = node
                      }
                    : undefined
                const openRow = () => {
                  onBuildingOpen?.(b.building)
                  if (href) {
                    navigate(href, { state: buildingLinkState?.(b.building) })
                  }
                }
                const showScore = shouldShowPropertyHealthScore(b.status)
                const healthTitle =
                  b.status === 'unknown'
                    ? resolvePropertyHealthPendingMessage(b.pendingReason)
                    : showScore
                      ? `${b.score} of 100 health`
                      : resolvePropertyHealthPendingMessage(b.pendingReason)

                return (
                  <tr
                    key={b.building}
                    ref={rowRef}
                    style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                    className={[
                      'sa-enter border-b border-[#f3f4f6] last:border-b-0',
                      rowOpens ? 'cursor-pointer hover:bg-[#fafafa]' : '',
                      selected ? 'bg-[#f8f9ff]' : '',
                    ].join(' ')}
                    onClick={rowOpens ? openRow : undefined}
                    onKeyDown={
                      rowOpens
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openRow()
                            }
                          }
                        : undefined
                    }
                    tabIndex={rowOpens ? 0 : undefined}
                  >
                    {selection ? (
                      <td
                        className="w-12 px-4 py-3.5"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <TableCheckbox
                          aria-label={`Select ${b.building}`}
                          checked={selected}
                          onChange={() => selection.onToggleBuilding(b.building)}
                        />
                      </td>
                    ) : null}
                    <td className={td}>
                      <div className="flex min-w-0 items-center gap-2.5">
                        {!fitContainer ? (
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-[#e5e7eb] text-[#364153]">
                            <BuildingIcon />
                          </span>
                        ) : null}
                        <span className="truncate font-medium">{b.building}</span>
                      </div>
                    </td>
                    <td className={`${td} ${numericAlign} tabular-nums text-[#364153]`}>
                      {b.unitCount}
                    </td>
                    <td className={td}>
                      <span
                        className={`inline-flex max-w-full truncate rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${HEALTH_BADGE_STYLES[b.status]}`}
                        title={healthTitle}
                      >
                        {fitContainer
                          ? HEALTH_BADGE_LABELS[b.status].replace('NEEDS ATTENTION', 'NEEDS ATTN')
                          : HEALTH_BADGE_LABELS[b.status]}
                      </span>
                    </td>
                    <td className={td} title={healthTitle}>
                      <div className={fitContainer ? 'min-w-0' : 'min-w-[7rem]'}>
                        <p className="tabular-nums">
                          {showScore ? (
                            <>
                              <span className="font-semibold">{b.score}</span>
                              <span className="text-[12px] text-[#6a7282]"> / 100</span>
                            </>
                          ) : (
                            <span className="text-[#6a7282]">—</span>
                          )}
                        </p>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#f3f4f6]">
                          <div
                            className={`sa-bar h-full rounded-full ${
                              showScore ? HEALTH_BAR_STYLES[b.status] : 'bg-[#d1d5dc]'
                            }`}
                            style={{ width: showScore ? `${b.score}%` : '0%' }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className={`${td} ${numericAlign} tabular-nums`}>
                      <span
                        className={`inline-flex items-center gap-1.5 text-[#364153] ${
                          fitContainer ? 'justify-start' : 'justify-end'
                        }`}
                      >
                        {!fitContainer ? <WorkOrderIcon /> : null}
                        <span className="font-medium text-[#0a0a0a]">{b.openTickets}</span>
                      </span>
                    </td>
                    <td className={`${td} ${numericAlign} tabular-nums`}>
                      <span
                        className={`inline-flex items-center gap-1.5 text-[#364153] ${
                          fitContainer ? 'justify-start' : 'justify-end'
                        }`}
                      >
                        {!fitContainer ? <UsersIcon /> : null}
                        <span className="font-medium text-[#0a0a0a]">{b.occupancyPct}%</span>
                      </span>
                    </td>
                    {showMonthlySpend && formatSpend && monthlySpendByBuilding ? (
                      <td className={`${td} ${numericAlign} font-medium tabular-nums`}>
                        {formatSpend(monthlySpendByBuilding.get(b.building) ?? 0)}
                      </td>
                    ) : showMonthlySpend ? (
                      <td className={`${td} ${numericAlign} text-[#6a7282]`}>—</td>
                    ) : null}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
