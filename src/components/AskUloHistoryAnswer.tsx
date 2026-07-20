import { useEffect, useState } from 'react'
import { AskUloHistoryChart } from '@/components/AskUloHistoryChart'
import { AskUloMarkdown } from '@/components/AskUloMarkdown'
import type { AskUloVisualContext } from '@/api/askUlo'

type HistoryVisual = Extract<
  AskUloVisualContext,
  { kind: 'price_history' | 'rent_history' }
>

type AskUloHistoryAnswerProps = {
  content: string
  visual: HistoryVisual
  /** Chart skeleton → chart, then narrative (live answers only). */
  progressive?: boolean
}

function ChartSkeleton() {
  return (
    <section className="mb-4" aria-busy="true" aria-label="Loading chart">
      <div className="mb-2 h-4 w-48 animate-pulse rounded bg-[#e5e7eb]" />
      <div className="h-[220px] w-full animate-pulse rounded-[12px] border border-[#e5e7eb] bg-[#f3f4f6]" />
    </section>
  )
}

/** Price / rent history answer: Zestimate-style chart + narrative markdown. */
export function AskUloHistoryAnswer({
  content,
  visual,
  progressive = false,
}: AskUloHistoryAnswerProps) {
  const [chartPhase, setChartPhase] = useState<'skeleton' | 'ready'>(
    progressive ? 'skeleton' : 'ready',
  )
  const [showNarrative, setShowNarrative] = useState(!progressive)

  useEffect(() => {
    if (!progressive) {
      setChartPhase('ready')
      setShowNarrative(true)
      return
    }
    setChartPhase('skeleton')
    setShowNarrative(false)
    const t1 = window.setTimeout(() => setChartPhase('ready'), 480)
    const t2 = window.setTimeout(() => setShowNarrative(true), 640)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [progressive, visual.title, content])

  return (
    <div className="ask-ulo-history-answer">
      {chartPhase === 'ready' ? (
        <div className="ask-ulo-section-enter">
          <AskUloHistoryChart
            title={visual.title}
            changeLabel={visual.changeLabel}
            valueKind={visual.valueKind}
            series={visual.series}
            buildingName={visual.buildingName}
          />
        </div>
      ) : (
        <ChartSkeleton />
      )}
      {showNarrative && content.trim() ? (
        <div className="ask-ulo-section-enter">
          <AskUloMarkdown content={content} />
        </div>
      ) : progressive && !showNarrative ? (
        <div className="mt-3 space-y-2" aria-hidden>
          <div className="h-3 w-full animate-pulse rounded bg-[#eceef2]" />
          <div className="h-3 w-[92%] animate-pulse rounded bg-[#eceef2]" />
          <div className="h-3 w-[78%] animate-pulse rounded bg-[#eceef2]" />
        </div>
      ) : null}
    </div>
  )
}
