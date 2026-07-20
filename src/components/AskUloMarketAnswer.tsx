import { useEffect, useState } from 'react'
import { AskUloComparableRentals } from '@/components/AskUloComparableRentals'
import { AskUloMarkdown } from '@/components/AskUloMarkdown'
import { AskUloStreetView } from '@/components/AskUloStreetView'
import type { AskUloVisualContext } from '@/api/askUlo'

type Section = { title: string | null; body: string }

function splitMarkdownSections(content: string): Section[] {
  const lines = content.split(/\r?\n/)
  const sections: Section[] = []
  let title: string | null = null
  let buf: string[] = []

  function flush() {
    const body = buf.join('\n').trim()
    if (title == null && !body) return
    sections.push({ title, body })
    buf = []
  }

  for (const line of lines) {
    const m = line.match(/^##\s+(.+)\s*$/)
    if (m) {
      flush()
      title = m[1].trim()
      continue
    }
    buf.push(line)
  }
  flush()
  return sections
}

function isPortfolioSection(title: string | null): boolean {
  return Boolean(title && /portfolio\s*context/i.test(title))
}

function isCompsSection(title: string | null): boolean {
  return Boolean(title && /comparable\s*rentals?/i.test(title))
}

type MarketVisual = Extract<
  AskUloVisualContext,
  { kind: 'market_analysis' | 'comparable_rentals' }
>

type AskUloMarketAnswerProps = {
  content: string
  visual: MarketVisual
  /** Stagger section + rich media reveal for live answers (not chat history). */
  progressive?: boolean
}

function StreetViewSkeleton() {
  return (
    <section className="mt-4" aria-busy="true" aria-label="Loading Street View">
      <div className="mb-2 h-4 w-28 animate-pulse rounded bg-[#e5e7eb]" />
      <div className="h-[220px] w-full animate-pulse rounded-[12px] bg-[#e5e7eb] sm:h-[280px]" />
    </section>
  )
}

function CompsSkeleton() {
  return (
    <section className="mt-4" aria-busy="true" aria-label="Loading comparable rentals">
      <div className="mb-2 h-4 w-40 animate-pulse rounded bg-[#e5e7eb]" />
      <ul className="space-y-3">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="rounded-[12px] border border-[#e5e7eb] bg-[#fafafa] px-3.5 py-3"
          >
            <div className="h-4 w-3/4 max-w-[280px] animate-pulse rounded bg-[#e5e7eb]" />
            <div className="mt-2 h-3 w-1/2 max-w-[160px] animate-pulse rounded bg-[#eceef2]" />
            <div className="mt-1.5 h-3 w-2/5 max-w-[120px] animate-pulse rounded bg-[#eceef2]" />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Market / comps answers with optional Street View + comps UI.
 * Street View only when visual.showStreetView (full market analysis).
 */
export function AskUloMarketAnswer({
  content,
  visual,
  progressive = false,
}: AskUloMarketAnswerProps) {
  const sections = splitMarkdownSections(content)
  const portfolioIdx = sections.findIndex((s) => isPortfolioSection(s.title))
  const compsIdx = sections.findIndex((s) => isCompsSection(s.title))
  const allowStreet = visual.showStreetView !== false && visual.kind === 'market_analysis'
  const showStreet =
    allowStreet &&
    (Boolean(visual.address) || (visual.lat != null && visual.lng != null))
  const streetAfterIdx = portfolioIdx >= 0 ? portfolioIdx : -1
  const hasComps = visual.comps.length > 0

  const [visibleSectionCount, setVisibleSectionCount] = useState(
    progressive ? 0 : sections.length,
  )
  const [streetPhase, setStreetPhase] = useState<'hidden' | 'skeleton' | 'ready'>(
    progressive ? 'hidden' : 'ready',
  )
  const [compsPhase, setCompsPhase] = useState<'hidden' | 'skeleton' | 'ready'>(
    progressive ? 'hidden' : 'ready',
  )

  useEffect(() => {
    if (!progressive) {
      setVisibleSectionCount(sections.length)
      setStreetPhase('ready')
      setCompsPhase('ready')
      return
    }

    setVisibleSectionCount(0)
    setStreetPhase(showStreet ? 'hidden' : 'ready')
    setCompsPhase(hasComps ? 'hidden' : 'ready')

    const timers: number[] = []
    const sectionDelay = 160

    for (let i = 0; i < sections.length; i++) {
      const t = window.setTimeout(() => {
        setVisibleSectionCount(i + 1)

        if (showStreet && streetAfterIdx === i) {
          setStreetPhase('skeleton')
          timers.push(
            window.setTimeout(() => setStreetPhase('ready'), 420),
          )
        }
        if (hasComps && compsIdx === i) {
          setCompsPhase('skeleton')
          timers.push(
            window.setTimeout(() => setCompsPhase('ready'), 520),
          )
        }
      }, sectionDelay * (i + 1))
      timers.push(t)
    }

    // Street / comps when their anchor section is missing
    if (showStreet && streetAfterIdx < 0) {
      timers.push(
        window.setTimeout(() => setStreetPhase('skeleton'), sectionDelay * sections.length + 80),
      )
      timers.push(
        window.setTimeout(() => setStreetPhase('ready'), sectionDelay * sections.length + 500),
      )
    }
    if (hasComps && compsIdx < 0) {
      timers.push(
        window.setTimeout(() => setCompsPhase('skeleton'), sectionDelay * sections.length + 160),
      )
      timers.push(
        window.setTimeout(() => setCompsPhase('ready'), sectionDelay * sections.length + 680),
      )
    }

    return () => {
      for (const id of timers) window.clearTimeout(id)
    }
  }, [
    progressive,
    content,
    sections.length,
    showStreet,
    hasComps,
    streetAfterIdx,
    compsIdx,
  ])

  return (
    <div className="ask-ulo-market-answer">
      {sections.map((section, idx) => {
        if (idx >= visibleSectionCount) return null
        const skipCompsMarkdown = isCompsSection(section.title) && hasComps
        return (
          <div
            key={`${section.title ?? 'lead'}-${idx}`}
            className="ask-ulo-section-enter"
          >
            {section.title && !skipCompsMarkdown ? (
              <AskUloMarkdown content={`## ${section.title}\n\n${section.body}`} />
            ) : !skipCompsMarkdown && section.body ? (
              <AskUloMarkdown content={section.body} />
            ) : null}

            {showStreet && streetAfterIdx === idx ? (
              streetPhase === 'ready' ? (
                <div className="ask-ulo-section-enter">
                  <AskUloStreetView
                    address={visual.address}
                    lat={visual.lat}
                    lng={visual.lng}
                    label={visual.buildingName}
                  />
                </div>
              ) : streetPhase === 'skeleton' ? (
                <StreetViewSkeleton />
              ) : null
            ) : null}

            {compsIdx === idx && hasComps ? (
              compsPhase === 'ready' ? (
                <div className="ask-ulo-section-enter">
                  <AskUloComparableRentals comps={visual.comps} />
                </div>
              ) : compsPhase === 'skeleton' ? (
                <CompsSkeleton />
              ) : null
            ) : null}
          </div>
        )
      })}

      {showStreet && streetAfterIdx < 0 ? (
        streetPhase === 'ready' ? (
          <div className="ask-ulo-section-enter">
            <AskUloStreetView
              address={visual.address}
              lat={visual.lat}
              lng={visual.lng}
              label={visual.buildingName}
            />
          </div>
        ) : streetPhase === 'skeleton' ? (
          <StreetViewSkeleton />
        ) : null
      ) : null}

      {compsIdx < 0 && hasComps ? (
        compsPhase === 'ready' ? (
          <div className="ask-ulo-section-enter">
            <AskUloComparableRentals comps={visual.comps} />
          </div>
        ) : compsPhase === 'skeleton' ? (
          <CompsSkeleton />
        ) : null
      ) : null}
    </div>
  )
}
