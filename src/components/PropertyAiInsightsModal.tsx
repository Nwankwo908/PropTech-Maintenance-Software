import { useEffect, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  type PropertyAiInsights,
  type PropertyAiRecommendation,
} from '@/lib/propertyAiInsights'
import { workflowOperationsPath } from '@/lib/adminWorkflowKanban'

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg className="size-4 text-[#0a0a0a]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.2 4.2L17.5 8 13.2 9.2 12 13.5 10.8 9.2 6.5 8l4.3-1.8L12 2zm7 9 1 3.5L23.5 16l-3.5 1-1 3.5-1-3.5-3.5-1 3.5-1 1-3.5zm-14 0 1 3.5L9.5 16l-3.5 1-1 3.5-1-3.5L.5 16l3.5-1 1-3.5z" />
    </svg>
  )
}

function TaskDotIcon() {
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-[#f9fafb]">
      <span className="size-2 rounded-full bg-[#9ca3af]" aria-hidden />
    </span>
  )
}

type PropertyAiInsightsModalProps = {
  open: boolean
  insights: PropertyAiInsights | null
  onClose: () => void
}

function RecommendationRow({
  recommendation,
  onStart,
}: {
  recommendation: PropertyAiRecommendation
  onStart: (recommendation: PropertyAiRecommendation) => void
}) {
  return (
    <li className="flex items-center gap-3 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3">
      <TaskDotIcon />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">{recommendation.title}</p>
        <p className="mt-0.5 text-[12px] leading-4 text-[#6a7282]">
          Impact +{recommendation.impactPoints} health · ETA {recommendation.etaLabel}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onStart(recommendation)}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#0a0a0a] px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-[#1f2937]"
      >
        Start
        <span aria-hidden>→</span>
      </button>
    </li>
  )
}

/** AI health improvement recommendations (Figma property detail — Building health). */
export function PropertyAiInsightsModal({
  open,
  insights,
  onClose,
}: PropertyAiInsightsModalProps) {
  const titleId = useId()
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !insights) return null

  const progressPct = Math.min(100, insights.currentScore)
  const gainPct = Math.min(100 - progressPct, insights.totalGain)

  function handleStart(recommendation: PropertyAiRecommendation) {
    onClose()
    if (recommendation.action.type === 'workflow_run') {
      navigate(workflowOperationsPath(recommendation.action.workflowRunId))
      return
    }
    navigate(recommendation.action.href)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div role="presentation" className="absolute inset-0 bg-black/40" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[min(100vw,560px)] overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white shadow-[0px_8px_24px_rgba(0,0,0,0.12)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 rounded-lg p-1 text-[#9ca3af] outline-none hover:bg-black/5 hover:text-[#364153] focus-visible:ring-2 focus-visible:ring-[#0030b5] focus-visible:ring-offset-2"
        >
          <CloseIcon />
        </button>

        <div className="px-6 pb-6 pt-6">
          <div className="flex items-start gap-3 pr-8">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-[#e5e7eb] bg-[#f9fafb]">
              <SparkleIcon />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="text-[18px] font-semibold leading-7 text-[#0a0a0a]">
                AI Insights
              </h2>
              <p className="text-[13px] leading-5 text-[#6a7282]">
                Generated just now · {insights.building}
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-[10px] border border-[#e5e7eb] bg-[#fafafa] px-4 py-4">
            <p className="text-[14px] leading-5 text-[#364153]">
              Health could improve from{' '}
              <span className="font-semibold text-[#0a0a0a]">{insights.currentScore}</span> to{' '}
              <span className="font-semibold text-[#008236]">{insights.projectedScore}</span> by:
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#e5e7eb]">
                <div
                  className="h-full rounded-l-full bg-[#008236]"
                  style={{ width: `${progressPct}%` }}
                />
                {gainPct > 0 ? (
                  <div
                    className="h-full bg-[#86efac]"
                    style={{ width: `${gainPct}%` }}
                  />
                ) : null}
              </div>
              <span className="shrink-0 text-[14px] font-semibold tabular-nums text-[#008236]">
                +{insights.totalGain}
              </span>
            </div>
          </div>

          <ul className="mt-4 flex flex-col gap-3">
            {insights.recommendations.map((recommendation) => (
              <RecommendationRow
                key={recommendation.id}
                recommendation={recommendation}
                onStart={handleStart}
              />
            ))}
          </ul>

          <p className="mt-5 text-[12px] leading-4 text-[#9ca3af]">
            Recommendations are based on open workflows, vendor SLAs, and lease data for this
            property.
          </p>
        </div>
      </div>
    </div>
  )
}
