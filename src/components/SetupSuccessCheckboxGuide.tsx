import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import imessageBubbleTail from '@/assets/setup-success/imessage-bubble-tail.svg'

export type GuideBubblePlacement = 'left' | 'right' | 'below' | 'above'

export type GuideLayout = {
  frameTop: number
  frameLeft: number
  frameWidth: number
  frameHeight: number
  squareLength: number
  cursorStartX: number
  cursorStartY: number
  cursorTopLeftX: number
  cursorTopLeftY: number
  cursorTopRightX: number
  cursorTopRightY: number
  cursorBottomRightX: number
  cursorBottomRightY: number
  cursorBottomLeftX: number
  cursorBottomLeftY: number
  cursorEndX: number
  cursorEndY: number
  bubbleTop: number
  bubbleLeft: number
  bubbleWidth: number
  bubblePlacement: GuideBubblePlacement
}

const GUIDE_MESSAGE = 'Select checkbox to initiate onboarding button'
const CURSOR_TIP = 6
const FRAME_PADDING = 10
/** Half of the previous 3.5px coachmark stroke. */
const STROKE_WIDTH = 1.75
const BUBBLE_MAX_WIDTH = 287
const BUBBLE_GAP_PX = 28
const VIEWPORT_INSET = 16
const ESTIMATED_BUBBLE_HEIGHT = 72
const GUIDE_SEQUENCE_MS = 2600
const GUIDE_HOLD_MS = 10_000
const GUIDE_DISSOLVE_MS = 500

function squarePerimeter(width: number, height: number, radius: number): number {
  const r = Math.min(radius, width / 2, height / 2)
  return Math.max(1, 2 * (width + height) - 8 * r + 2 * Math.PI * r)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Place the dashed square and iMessage bubble so both stay on-screen on phones and tablets. */
export function layoutFromFrame(
  frameTop: number,
  frameLeft: number,
  frameWidth: number,
  frameHeight: number,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800,
): GuideLayout {
  const cursorTopLeftX = frameLeft - CURSOR_TIP
  const cursorTopLeftY = frameTop - CURSOR_TIP
  const cursorTopRightX = frameLeft + frameWidth - CURSOR_TIP
  const cursorTopRightY = frameTop - CURSOR_TIP
  const cursorBottomRightX = frameLeft + frameWidth - CURSOR_TIP
  const cursorBottomRightY = frameTop + frameHeight - CURSOR_TIP
  const cursorBottomLeftX = frameLeft - CURSOR_TIP
  const cursorBottomLeftY = frameTop + frameHeight - CURSOR_TIP
  const cursorEndX = frameLeft + frameWidth / 2 - CURSOR_TIP
  const cursorEndY = frameTop + frameHeight / 2 - CURSOR_TIP
  const cursorStartX = Math.round(viewportWidth * 0.5)
  const cursorStartY = Math.min(56, Math.max(12, frameTop - 48))

  const bubbleWidth = Math.min(BUBBLE_MAX_WIDTH, Math.max(180, viewportWidth - VIEWPORT_INSET * 2))
  const maxLeft = Math.max(VIEWPORT_INSET, viewportWidth - VIEWPORT_INSET - bubbleWidth)
  const leftCandidate = frameLeft - bubbleWidth - BUBBLE_GAP_PX
  const rightCandidate = frameLeft + frameWidth + BUBBLE_GAP_PX
  const sideTop = frameTop + frameHeight / 2

  let bubblePlacement: GuideBubblePlacement = 'left'
  let bubbleLeft = leftCandidate
  let bubbleTop = sideTop

  if (leftCandidate >= VIEWPORT_INSET) {
    bubblePlacement = 'left'
    bubbleLeft = leftCandidate
  } else if (rightCandidate + bubbleWidth <= viewportWidth - VIEWPORT_INSET) {
    bubblePlacement = 'right'
    bubbleLeft = rightCandidate
  } else {
    bubbleLeft = clamp(frameLeft + frameWidth / 2 - bubbleWidth / 2, VIEWPORT_INSET, maxLeft)
    const belowTop = frameTop + frameHeight + 12
    const aboveTop = frameTop - ESTIMATED_BUBBLE_HEIGHT - 12
    if (belowTop + ESTIMATED_BUBBLE_HEIGHT <= viewportHeight - VIEWPORT_INSET) {
      bubblePlacement = 'below'
      bubbleTop = belowTop
    } else {
      bubblePlacement = 'above'
      bubbleTop = Math.max(VIEWPORT_INSET, aboveTop)
    }
  }

  bubbleLeft = clamp(bubbleLeft, VIEWPORT_INSET, maxLeft)

  return {
    frameTop,
    frameLeft,
    frameWidth,
    frameHeight,
    squareLength: squarePerimeter(frameWidth, frameHeight, 8),
    cursorStartX,
    cursorStartY,
    cursorTopLeftX,
    cursorTopLeftY,
    cursorTopRightX,
    cursorTopRightY,
    cursorBottomRightX,
    cursorBottomRightY,
    cursorBottomLeftX,
    cursorBottomLeftY,
    cursorEndX,
    cursorEndY,
    bubbleTop,
    bubbleLeft,
    bubbleWidth,
    bubblePlacement,
  }
}

function measureGuideLayout(target: HTMLElement): GuideLayout {
  const rect = target.getBoundingClientRect()
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  return layoutFromFrame(
    rect.top - FRAME_PADDING,
    rect.left - FRAME_PADDING,
    rect.width + FRAME_PADDING * 2,
    rect.height + FRAME_PADDING * 2,
    viewportWidth,
    viewportHeight,
  )
}

function guideCursorVars(layout: GuideLayout): CSSProperties {
  return {
    '--guide-cursor-start-x': `${layout.cursorStartX}px`,
    '--guide-cursor-start-y': `${layout.cursorStartY}px`,
    '--guide-cursor-tl-x': `${layout.cursorTopLeftX}px`,
    '--guide-cursor-tl-y': `${layout.cursorTopLeftY}px`,
    '--guide-cursor-tr-x': `${layout.cursorTopRightX}px`,
    '--guide-cursor-tr-y': `${layout.cursorTopRightY}px`,
    '--guide-cursor-br-x': `${layout.cursorBottomRightX}px`,
    '--guide-cursor-br-y': `${layout.cursorBottomRightY}px`,
    '--guide-cursor-bl-x': `${layout.cursorBottomLeftX}px`,
    '--guide-cursor-bl-y': `${layout.cursorBottomLeftY}px`,
    '--guide-cursor-end-x': `${layout.cursorEndX}px`,
    '--guide-cursor-end-y': `${layout.cursorEndY}px`,
  } as CSSProperties
}

function GuideIMessageBubble({
  layout,
  message,
}: {
  layout: GuideLayout
  message: string
}) {
  const below = layout.bubblePlacement === 'below'
  const above = layout.bubblePlacement === 'above'
  const right = layout.bubblePlacement === 'right'
  return (
    <div
      className={[
        'setup-checkbox-guide-bubble absolute z-[221]',
        below || above ? 'setup-checkbox-guide-bubble-below' : '-translate-y-1/2',
      ].join(' ')}
      style={{
        top: layout.bubbleTop,
        left: layout.bubbleLeft,
        width: layout.bubbleWidth,
      }}
    >
      <div
        className="relative flex w-full flex-col items-start overflow-visible rounded-[20px] border border-[rgba(89,128,191,0.5)] py-2 shadow-[0px_4px_8.05px_rgba(0,0,0,0.25)]"
        style={{
          backgroundImage:
            'linear-gradient(180deg, rgb(115, 158, 224) 0%, rgb(153, 191, 237) 40%, rgb(199, 224, 245) 75%, rgb(224, 237, 247) 100%)',
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-px top-px h-[22px] rounded-t-[18px] rounded-b-[10px]"
          style={{
            backgroundImage:
              'linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.75) 50%, rgba(255,255,255,0) 100%)',
          }}
          aria-hidden
        />
        <div className="relative z-[1] flex w-full items-center px-[10px] pb-[6px] pt-[5px]">
          <p className="min-w-0 flex-1 font-[family-name:var(--font-admin)] text-[16px] font-normal leading-[22px] text-[#1a1a1a]">
            {message}
          </p>
        </div>
        <img
          src={imessageBubbleTail}
          alt=""
          width={12}
          height={15}
          className={[
            'absolute z-[1] max-w-none',
            below
              ? 'left-1/2 top-[-8px] -translate-x-1/2 rotate-180'
              : above
                ? 'bottom-[-8px] left-1/2 -translate-x-1/2'
                : right
                  ? 'bottom-[-1px] left-[-6px] scale-x-[-1]'
                  : 'bottom-[-1px] right-[-6px]',
          ].join(' ')}
          aria-hidden
        />
      </div>
    </div>
  )
}

function GuideCursor({ layout }: { layout: GuideLayout }) {
  const shadowFilterId = useId().replace(/:/g, '')
  return (
    <div
      className="setup-checkbox-guide-cursor pointer-events-none absolute left-0 top-0 z-[222] size-8 overflow-visible"
      style={guideCursorVars(layout)}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-8 overflow-visible" aria-hidden>
        <defs>
          <filter
            id={shadowFilterId}
            x="-400%"
            y="-400%"
            width="900%"
            height="900%"
            colorInterpolationFilters="sRGB"
          >
            <feMorphology in="SourceAlpha" operator="dilate" radius="7.5" result="spread" />
            <feGaussianBlur in="spread" stdDeviation="52.5" result="blur" />
            <feFlood floodColor="#E0F2EF" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          d="M5.5 3.21 18.79 11.4c.97.58.97 2.01 0 2.59L5.5 22.79c-.97.58-2.21-.14-2.21-1.3V4.51c0-1.16 1.24-1.88 2.21-1.3Z"
          fill="#B1DFF1"
          filter={`url(#${shadowFilterId})`}
        />
      </svg>
    </div>
  )
}

type SetupSuccessCheckboxGuideProps = {
  active: boolean
  targetRef: RefObject<HTMLElement | null>
  message?: string
}

export function SetupSuccessCheckboxGuide({
  active,
  targetRef,
  message = GUIDE_MESSAGE,
}: SetupSuccessCheckboxGuideProps) {
  const [layout, setLayout] = useState<GuideLayout | null>(null)
  const [phase, setPhase] = useState<'play' | 'dissolve' | 'gone'>('play')
  const lockedTargetRef = useRef<HTMLElement | null>(null)
  const startedRef = useRef(false)

  useLayoutEffect(() => {
    if (!active) {
      lockedTargetRef.current = null
      startedRef.current = false
      setLayout(null)
      setPhase('play')
      return
    }

    if (!startedRef.current) {
      startedRef.current = true
      setLayout(null)
    }

    const update = (lockIfFound: boolean) => {
      if (lockIfFound && !lockedTargetRef.current && targetRef.current) {
        lockedTargetRef.current = targetRef.current
        lockedTargetRef.current.scrollIntoView({
          block: 'center',
          inline: 'nearest',
          behavior: 'smooth',
        })
      }
      const target = lockedTargetRef.current ?? targetRef.current
      if (!target) return
      setLayout(measureGuideLayout(target))
    }

    const onWindowChange = () => update(false)
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onWindowChange) : null

    update(true)
    if (lockedTargetRef.current && observer) observer.observe(lockedTargetRef.current)

    const poll = window.setInterval(() => {
      if (lockedTargetRef.current) {
        window.clearInterval(poll)
        if (observer) observer.observe(lockedTargetRef.current)
        return
      }
      update(true)
    }, 16)

    window.addEventListener('resize', onWindowChange)
    window.addEventListener('scroll', onWindowChange, true)

    return () => {
      window.clearInterval(poll)
      window.removeEventListener('resize', onWindowChange)
      window.removeEventListener('scroll', onWindowChange, true)
      observer?.disconnect()
    }
  }, [active, targetRef])

  useLayoutEffect(() => {
    if (!active) return
    const dissolveAt = GUIDE_SEQUENCE_MS + GUIDE_HOLD_MS
    const dissolveId = window.setTimeout(() => setPhase('dissolve'), dissolveAt)
    const goneId = window.setTimeout(() => setPhase('gone'), dissolveAt + GUIDE_DISSOLVE_MS)
    return () => {
      window.clearTimeout(dissolveId)
      window.clearTimeout(goneId)
    }
  }, [active])

  if (!active || !layout || phase === 'gone' || typeof document === 'undefined') return null

  const inset = STROKE_WIDTH / 2

  return createPortal(
    <div
      className={`pointer-events-none fixed inset-0 z-[220] overflow-visible${
        phase === 'dissolve' ? ' setup-checkbox-guide-helpers-dissolve' : ''
      }`}
      role="presentation"
      aria-hidden
    >
      <svg
        className="setup-checkbox-guide-square pointer-events-none absolute overflow-visible"
        style={{
          top: layout.frameTop,
          left: layout.frameLeft,
          width: layout.frameWidth,
          height: layout.frameHeight,
        }}
        viewBox={`0 0 ${layout.frameWidth} ${layout.frameHeight}`}
      >
        <rect
          x={inset}
          y={inset}
          width={Math.max(0, layout.frameWidth - STROKE_WIDTH)}
          height={Math.max(0, layout.frameHeight - STROKE_WIDTH)}
          rx="8"
          ry="8"
          fill="none"
          stroke="#186179"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="setup-checkbox-guide-square-stroke"
          strokeDasharray="5 4"
        />
      </svg>
      <GuideCursor layout={layout} />
      <GuideIMessageBubble layout={layout} message={message} />
    </div>,
    document.body,
  )
}
