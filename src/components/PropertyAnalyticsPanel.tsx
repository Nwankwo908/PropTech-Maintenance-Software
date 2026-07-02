import { Link } from 'react-router-dom'
import type { PropertyAnalyticsSnapshot, PropertyMonthlySpend } from '@/lib/propertyAnalytics'
import {
  formatPropertyChartYTick,
  formatPropertySpendCompact,
  PROPERTY_CHART_BAR_AREA_PX,
  PROPERTY_CHART_Y_MAX,
  PROPERTY_CHART_Y_TICKS,
} from '@/lib/propertyAnalytics'
import {
  formatPmDueLabel,
  formatPmTaskSubtitle,
  pmTaskKindUsesApplianceIcon,
  pmTaskKindUsesInspectionIcon,
  pmTaskKindUsesServiceIcon,
  type PmComplianceTask,
} from '@/lib/pmCompliance'
import applianceRepairIcon from '@/assets/appliance-repair.png'
import inspectionReviewIcon from '@/assets/inspection-review.png'
import pmServiceIcon from '@/assets/pm-service.png'

type PropertyAnalyticsPanelProps = {
  building: string
  analytics: PropertyAnalyticsSnapshot | null
  loading?: boolean
}

function formatSpend(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

function PmComplianceRow({ task }: { task: PmComplianceTask }) {
  const due = formatPmDueLabel(task.dueAt, task.status)
  const taskIcon = pmTaskKindUsesApplianceIcon(task.kind)
    ? applianceRepairIcon
    : pmTaskKindUsesInspectionIcon(task.kind)
      ? inspectionReviewIcon
      : pmTaskKindUsesServiceIcon(task.kind)
        ? pmServiceIcon
        : null

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-1 gap-3">
        {taskIcon ? (
          <img src={taskIcon} alt="" className="mt-0.5 size-8 shrink-0 object-contain" aria-hidden />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-[#0a0a0a]">{task.title}</p>
          <p className="text-[12px] text-[#6a7282]">{task.location}</p>
          <p className="mt-1 text-[12px] leading-5 text-[#4b5563]">{formatPmTaskSubtitle(task)}</p>
          {task.kind === 'appliance' && task.estimatedReplacementCost != null ? (
            <p className="mt-1 text-[12px] font-medium text-[#0a0a0a]">
              Est. replacement {formatSpend(task.estimatedReplacementCost)}
            </p>
          ) : null}
        </div>
      </div>
      <span
        className={
          due.tone === 'danger'
            ? 'text-[#c10007] font-medium'
            : due.tone === 'warning'
              ? 'text-[#c2410c] font-medium'
              : 'text-[#6a7282]'
        }
      >
        {due.label}
      </span>
    </div>
  )
}

function MaintenanceSpendBar({
  month,
  totalPx,
  reactivePx,
  proactivePx,
}: {
  month: PropertyMonthlySpend
  totalPx: number
  reactivePx: number
  proactivePx: number
}) {
  const total = month.proactive + month.reactive
  const tooltipTitle = month.isProjection ? `${month.label} (projected)` : month.label

  return (
    <div
      className={[
        'group relative flex min-w-0 flex-1 flex-col items-center gap-2',
        month.isProjection ? 'opacity-50' : '',
      ].join(' ')}
    >
      <div className="flex h-56 w-full items-end justify-center">
        {totalPx > 0 ? (
          <div className="relative flex w-full max-w-[42px] justify-center">
            <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-[200px] -translate-x-1/2 rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 text-left opacity-0 shadow-[0px_4px_12px_rgba(0,0,0,0.08)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <p className="text-[12px] font-semibold leading-4 text-[#0a0a0a]">{tooltipTitle}</p>
              <div className="mt-1.5 space-y-0.5 text-[11px] leading-4 tabular-nums text-[#6a7282]">
                <p>
                  <span className="text-[#008236]">Proactive:</span> {formatSpend(month.proactive)}
                </p>
                <p>
                  <span className="text-[#c10007]">Reactive:</span> {formatSpend(month.reactive)}
                </p>
                <p className="border-t border-[#f3f4f6] pt-1 font-medium text-[#0a0a0a]">
                  Total: {formatSpend(total)}
                </p>
              </div>
            </div>
            <div
              tabIndex={0}
              aria-label={`${tooltipTitle}: ${formatSpend(month.proactive)} proactive, ${formatSpend(month.reactive)} reactive, ${formatSpend(total)} total`}
              className={[
                'flex w-full flex-col justify-end overflow-hidden rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2',
                month.isProjection ? 'ring-1 ring-dashed ring-[#d1d5dc]' : '',
              ].join(' ')}
              style={{ height: totalPx }}
            >
              {reactivePx > 0 ? <div className="bg-[#fb2c36]" style={{ height: reactivePx }} /> : null}
              {proactivePx > 0 ? <div className="bg-[#00c950]" style={{ height: proactivePx }} /> : null}
            </div>
          </div>
        ) : null}
      </div>
      <span className="text-[11px] leading-4 text-[#6a7282]">
        {month.label}
        {month.isProjection ? '*' : ''}
      </span>
    </div>
  )
}

/** Property detail — Analytics tab: monthly maintenance cost + PM compliance. */
export function PropertyAnalyticsPanel({
  building,
  analytics,
  loading = false,
}: PropertyAnalyticsPanelProps) {
  const buildingShort = building.replace(/\s+Apartments$/i, '').trim()
  const pm = analytics?.pm
  const openPmTasks = pm?.tasks.filter((task) => task.status !== 'completed') ?? []

  return (
    <div className="mt-6 flex flex-col gap-4">
      <section className="rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e7eb] px-6 py-4">
          <div>
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">
              Monthly maintenance cost · {buildingShort} · {new Date().getFullYear()}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] text-[#6a7282]">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-[#00c950]" />
                Proactive
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-[2px] bg-[#fb2c36]" />
                Reactive
              </span>
              <span className="inline-flex items-center gap-1.5 opacity-50">
                <span className="size-2.5 rounded-[2px] border border-dashed border-[#99a1af] bg-[#e5e7eb]" />
                Projected
              </span>
            </div>
          </div>
          <span className="rounded-full bg-[#dbfce7] px-3 py-1 text-[12px] font-medium text-[#008236]">
            {loading || !analytics ? '—' : `${formatPropertySpendCompact(analytics.ytdTotal)} YTD`}
          </span>
        </div>

        <div className="overflow-visible px-6 pb-5 pt-8">
          {loading || !analytics ? (
            <p className="py-12 text-center text-[13px] text-[#6a7282]">Loading maintenance spend…</p>
          ) : (
            <div className="flex gap-3">
              <div
                className="flex h-56 w-9 shrink-0 flex-col justify-between text-right text-[11px] leading-none tabular-nums text-[#6a7282]"
                aria-hidden
              >
                {PROPERTY_CHART_Y_TICKS.map((tick) => (
                  <span key={tick}>{formatPropertyChartYTick(tick)}</span>
                ))}
              </div>
              <div className="relative min-w-0 flex-1">
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 flex h-56 flex-col justify-between"
                  aria-hidden
                >
                  {PROPERTY_CHART_Y_TICKS.map((tick) => (
                    <div
                      key={tick}
                      className={[
                        'w-full border-[#f3f4f6]',
                        tick === 0 ? 'border-b border-[#e5e7eb]' : 'border-t',
                      ].join(' ')}
                    />
                  ))}
                </div>
                <div className="relative flex gap-2 sm:gap-3">
                  {analytics.monthlySpend.map((month) => {
                    const total = month.proactive + month.reactive
                    const totalPx =
                      total > 0
                        ? Math.max(
                            Math.min(
                              Math.round((total / PROPERTY_CHART_Y_MAX) * PROPERTY_CHART_BAR_AREA_PX),
                              PROPERTY_CHART_BAR_AREA_PX,
                            ),
                            4,
                          )
                        : 0
                    const reactivePx = total > 0 ? Math.round((month.reactive / total) * totalPx) : 0
                    const proactivePx = totalPx - reactivePx
                    return (
                      <MaintenanceSpendBar
                        key={month.label}
                        month={month}
                        totalPx={totalPx}
                        reactivePx={reactivePx}
                        proactivePx={proactivePx}
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[#e5e7eb] bg-[#eff6ff] px-6 py-4">
          <p className="text-[13px] leading-6 text-[#1e40af]">
            <span aria-hidden className="mr-1.5">
              💡
            </span>
            {loading || !analytics ? 'Loading insights…' : analytics.insight}
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e5e7eb] px-6 py-4">
          <div>
            <h2 className="text-[16px] font-semibold leading-6 text-[#0a0a0a]">PM compliance</h2>
            <p className="text-[12px] leading-4 text-[#6a7282]">
              {loading || !pm
                ? 'Loading preventive tasks…'
                : pm.totalTasks > 0 || pm.replacementRecommendedCount > 0
                  ? [
                      pm.totalTasks > 0
                        ? `${pm.completedTasks} of ${pm.totalTasks} tasks complete`
                        : null,
                      pm.replacementRecommendedCount > 0
                        ? `${pm.replacementRecommendedCount} replacement${pm.replacementRecommendedCount === 1 ? '' : 's'} recommended`
                        : null,
                      pm.attentionCount > 0 ? `${pm.attentionCount} need attention` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : `Preventive tasks for ${buildingShort} flow from property assets through the workflow engine.`}
            </p>
          </div>
          <span className="text-[13px] font-medium text-[#a65f00]">
            {loading || pm?.compliancePct == null ? '—' : `${pm.compliancePct}% · ${pm.complianceLabel}`}
          </span>
        </div>

        <div className="px-6 py-5">
          <div className="mb-5">
            <div className="flex items-end justify-between gap-3">
              <p className="text-[36px] font-bold leading-none text-[#0a0a0a] tabular-nums">
                {loading || pm?.compliancePct == null ? '—' : `${pm.compliancePct}%`}
              </p>
              <p className="text-[13px] text-[#6a7282]">
                {loading || !pm
                  ? '—'
                  : `${pm.completedTasks} of ${Math.max(pm.totalTasks, pm.completedTasks)} tasks complete`}
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#f3f4f6]">
              <div
                className="h-full rounded-full bg-[#00c950] transition-all duration-300"
                style={{
                  width: loading || pm?.compliancePct == null ? '0%' : `${pm.compliancePct}%`,
                }}
              />
            </div>
            <p className="mt-2 text-[12px] text-[#6a7282]">
              {loading || !pm
                ? '—'
                : pm.attentionCount > 0
                  ? `${pm.attentionCount} overdue or due soon at this property`
                  : openPmTasks.length > 0
                    ? 'No overdue preventive tasks right now'
                    : 'Tasks appear when property assets generate preventive work'}
            </p>
          </div>

          {loading ? (
            <p className="py-6 text-center text-[13px] text-[#6a7282]">Loading tasks…</p>
          ) : openPmTasks.length > 0 ? (
            <div>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-[14px] font-semibold text-[#0a0a0a]">
                    Preventive maintenance tasks
                  </h3>
                  <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">
                    Asset → task → workflow → assignment → completion
                  </p>
                </div>
                <span className="text-[12px] font-medium text-[#6a7282]">
                  {openPmTasks.length} open task{openPmTasks.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="divide-y divide-[#f3f4f6]">
                {openPmTasks.map((task) => (
                  <PmComplianceRow key={task.id} task={task} />
                ))}
              </div>
            </div>
          ) : (
            <p className="py-6 text-center text-[12px] leading-5 text-[#6a7282]">
              No open preventive tasks for {buildingShort} right now.
            </p>
          )}
        </div>

        <div className="border-t border-[#e5e7eb] px-6 py-4 text-center">
          <Link
            to="/admin/workflows"
            className="inline-flex h-9 items-center justify-center rounded-[10px] border border-black/10 bg-white px-4 text-[14px] font-medium text-tertiary transition-colors duration-150 hover:bg-[#e2f5f1]"
          >
            View preventive workflows →
          </Link>
        </div>
      </section>
    </div>
  )
}
