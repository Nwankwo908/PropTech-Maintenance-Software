import { Link } from 'react-router-dom'
import { ADMIN_ATTENTION_ACTION_CLASS } from '@/lib/adminRightRail'
import type { SmartInsight, SmartInsightPriority } from '@/lib/smartIntelligence'

const PRIORITY_LABEL: Record<SmartInsightPriority, string> = {
  urgent: 'Urgent',
  attention: 'Needs Attention',
  upcoming: 'Upcoming',
  info: 'Update',
}

const PRIORITY_CLASS: Record<SmartInsightPriority, string> = {
  urgent: 'bg-[#ffe2e2] text-[#c10007]',
  attention: 'bg-[#ffedd5] text-[#c2410c]',
  upcoming: 'bg-[#e0f2fe] text-[#0369a1]',
  info: 'bg-[#f3f4f6] text-[#4a5565]',
}

const actionButtonClass =
  'sa-press inline-flex shrink-0 items-center rounded-[8px] bg-[#70ABC5] px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90'

export function SmartIntelligenceCard({
  insights,
  lastRentReminderLabel = null,
  rentHistorySelected = false,
  onViewRentHistory,
  onEditResident,
}: {
  insights: SmartInsight[]
  /** Automatic rent reminder send time — rent reminder outreach stays disabled. */
  lastRentReminderLabel?: string | null
  rentHistorySelected?: boolean
  onViewRentHistory?: () => void
  /** Opens the Edit Resident right rail (Review Lease). */
  onEditResident?: () => void
}) {
  const hasRentInsight = insights.some((insight) => insight.type === 'rent')

  const rentHistoryButton =
    onViewRentHistory != null ? (
      <button
        type="button"
        onClick={onViewRentHistory}
        aria-pressed={rentHistorySelected}
        style={{ color: '#611879' }}
        className={`${ADMIN_ATTENTION_ACTION_CLASS} bg-transparent px-0 ${
          rentHistorySelected ? 'underline' : ''
        }`}
      >
        View rent history
      </button>
    ) : null

  return (
    <section className="min-w-0 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <h2 className="m-0 text-[15px] font-semibold leading-none text-[#0a0a0a]">
        Needs your attention
      </h2>

      {insights.length === 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">You're all caught up</p>
          {rentHistoryButton}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {insights.map((insight) => {
            const showRentHistory =
              insight.type === 'rent' &&
              insight.id === insights.find((item) => item.type === 'rent')?.id
            return (
              <li
                key={insight.id}
                className="rounded-[8px] border border-[#f3f4f6] bg-[#fafafa] px-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span
                    className={`inline-flex shrink-0 rounded-[4px] px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] ${PRIORITY_CLASS[insight.priority]}`}
                  >
                    {PRIORITY_LABEL[insight.priority]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                      {insight.title}
                    </p>
                    {insight.type === 'rent' ? (
                      <p className="mt-1 text-[12px] leading-4 text-[#6a7282]">
                        Last rent reminder · {lastRentReminderLabel ?? 'None sent yet'}
                      </p>
                    ) : null}
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-3">
                    {insight.action ? (
                      insight.action.intent === 'edit_resident' && onEditResident ? (
                        <button type="button" onClick={onEditResident} className={actionButtonClass}>
                          {insight.action.label}
                        </button>
                      ) : (
                        <Link to={insight.action.route} className={actionButtonClass}>
                          {insight.action.label}
                        </Link>
                      )
                    ) : null}
                    {showRentHistory ? rentHistoryButton : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!hasRentInsight ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] leading-4 text-[#6a7282]">
            Last rent reminder · {lastRentReminderLabel ?? 'None sent yet'}
          </p>
          {rentHistoryButton}
        </div>
      ) : null}
    </section>
  )
}
