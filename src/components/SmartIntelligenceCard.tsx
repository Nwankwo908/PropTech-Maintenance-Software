import { Link } from 'react-router-dom'
import bgLogin from '@/assets/BG_Login.png'
import uloLogoSmall from '@/assets/Ulo_Logo_small.png'
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

export function SmartIntelligenceCard({ insights }: { insights: SmartInsight[] }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-2">
        <span className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-white to-[#f0fdf4]">
          <img
            src={bgLogin}
            alt=""
            className="absolute inset-0 size-full object-cover object-center opacity-90"
            aria-hidden
          />
          <img src={uloLogoSmall} alt="" className="relative z-10 size-5 object-contain" aria-hidden />
        </span>
        <h2 className="m-0 flex h-8 items-center text-[15px] font-semibold leading-none text-[#0a0a0a]">
          Ulo insights
        </h2>
      </div>

      {insights.length === 0 ? (
        <p className="mt-4 text-[14px] font-semibold leading-5 text-[#0a0a0a]">You're all caught up</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {insights.map((insight) => (
            <li
              key={insight.id}
              className="rounded-[8px] border border-[#f3f4f6] bg-[#fafafa] px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                  {insight.title}
                </p>
                <span
                  className={`inline-flex shrink-0 rounded-[4px] px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] ${PRIORITY_CLASS[insight.priority]}`}
                >
                  {PRIORITY_LABEL[insight.priority]}
                </span>
              </div>
              {insight.action ? (
                <Link
                  to={insight.action.route}
                  className="sa-link mt-2 inline-flex text-[12px] font-medium text-[#186179]"
                >
                  {insight.action.label} →
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
