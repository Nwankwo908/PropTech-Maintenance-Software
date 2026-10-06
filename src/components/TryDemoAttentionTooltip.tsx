import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { playUiClickSound } from '@/lib/uiClickSound'

const VIEWPORT_INSET = 12
/** Fixed gap between spotlight cutout and tooltip card (all tip pages). */
const TOOLTIP_GAP = 14
const TOOLTIP_WIDTH = 300
const HOLE_PAD = 6
const MORPH_MS = 360
const CONTENT_FADE_MS = 160
/** Fallback until the card is measured in the DOM. */
const ESTIMATED_TOOLTIP_HEIGHT = 220

type HoleRect = { top: number; left: number; width: number; height: number }

type TooltipCoords = {
  top: number
  left: number
  width: number
  placement: 'below' | 'above' | 'inside' | 'left'
  /** Horizontal pointer offset for above/below placements. */
  pointerLeft: number
  /** Vertical pointer offset for left placement (points right at the rail). */
  pointerTop: number
}

export type TryDemoTooltipSide = 'auto' | 'left'

function rectFromElement(el: HTMLElement): DOMRect | null {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return null
  if (el.dataset.tryDemoSpotlightCluster === '1') {
    const childRects = Array.from(el.children)
      .map((child) => (child as HTMLElement).getBoundingClientRect())
      .filter((r) => r.width > 0 || r.height > 0)
    if (childRects.length > 0) {
      const top = Math.min(...childRects.map((r) => r.top))
      const left = Math.min(...childRects.map((r) => r.left))
      const right = Math.max(...childRects.map((r) => r.right))
      const bottom = Math.max(...childRects.map((r) => r.bottom))
      return {
        top,
        left,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        x: left,
        y: top,
        toJSON: () => ({}),
      } as DOMRect
    }
  }
  return rect
}

function measureHoleFromElements(
  elements: HTMLElement[],
  opts?: { skipClamp?: boolean },
): HoleRect | null {
  const rects = elements
    .map((el) => rectFromElement(el))
    .filter((r): r is DOMRect => r != null)
  if (rects.length === 0) return null
  const top = Math.min(...rects.map((r) => r.top))
  const left = Math.min(...rects.map((r) => r.left))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  const raw: HoleRect = {
    top: Math.max(0, top - HOLE_PAD),
    left: Math.max(0, left - HOLE_PAD),
    width: right - left + HOLE_PAD * 2,
    height: bottom - top + HOLE_PAD * 2,
  }
  if (opts?.skipClamp) return raw
  return clampHoleForReadableScrim(raw)
}

/**
 * Keep a scrim frame + tooltip room only for near-fullscreen targets.
 * Do not shrink tall page sections like Needs Your Attention / Portfolio Snapshot.
 * Step 5 (Ask Ulo full) skips this via skipHoleClamp so the whole Ask Ulo panel stays clear.
 */
function clampHoleForReadableScrim(hole: HoleRect): HoleRect {
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const coversMostWidth = hole.width >= viewportWidth * 0.85
  const coversMostHeight = hole.height >= viewportHeight * 0.85
  if (!coversMostWidth || !coversMostHeight) return hole
  const width = Math.min(hole.width, viewportWidth * 0.72)
  const height = Math.min(hole.height, viewportHeight * 0.58)
  return {
    top: hole.top + (hole.height - height) / 2,
    left: hole.left + (hole.width - width) / 2,
    width,
    height,
  }
}

function measureTooltip(
  hole: HoleRect,
  tooltipHeight: number,
  side: TryDemoTooltipSide = 'auto',
): TooltipCoords {
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const width = Math.min(TOOLTIP_WIDTH, Math.max(240, viewportWidth - VIEWPORT_INSET * 2))

  // Step 5 (docked Ask Ulo): sit to the left of the right rail with a right pointer.
  if (side === 'left') {
    const left = Math.max(VIEWPORT_INSET, hole.left - TOOLTIP_GAP - width)
    const maxTop = Math.max(VIEWPORT_INSET, viewportHeight - VIEWPORT_INSET - tooltipHeight)
    const preferredTop = hole.top + hole.height / 2 - tooltipHeight / 2
    const top = Math.min(maxTop, Math.max(VIEWPORT_INSET, preferredTop))
    const pointerTop = Math.min(
      tooltipHeight - 18,
      Math.max(18, hole.top + hole.height / 2 - top),
    )
    return {
      top,
      left,
      width,
      placement: 'left',
      pointerLeft: width,
      pointerTop,
    }
  }

  const maxLeft = Math.max(VIEWPORT_INSET, viewportWidth - VIEWPORT_INSET - width)
  const preferredLeft = hole.left + hole.width / 2 - width / 2
  const left = Math.min(maxLeft, Math.max(VIEWPORT_INSET, preferredLeft))
  const pointerLeft = Math.min(
    width - 18,
    Math.max(18, hole.left + hole.width / 2 - left),
  )

  const belowTop = hole.top + hole.height + TOOLTIP_GAP
  if (belowTop + tooltipHeight <= viewportHeight - VIEWPORT_INSET) {
    return { top: belowTop, left, width, placement: 'below', pointerLeft, pointerTop: 0 }
  }

  const aboveTop = hole.top - tooltipHeight - TOOLTIP_GAP
  if (aboveTop >= VIEWPORT_INSET) {
    return { top: aboveTop, left, width, placement: 'above', pointerLeft, pointerTop: 0 }
  }

  // Large clear UI (step 6): keep TOOLTIP_GAP inside the cutout near the top.
  return {
    top: Math.min(
      viewportHeight - VIEWPORT_INSET - tooltipHeight,
      Math.max(VIEWPORT_INSET, hole.top + TOOLTIP_GAP),
    ),
    left: Math.min(maxLeft, Math.max(VIEWPORT_INSET, hole.left + TOOLTIP_GAP)),
    width,
    placement: 'inside',
    pointerLeft: 24,
    pointerTop: 0,
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** True when the target can be spotlighted without scrolling the page. */
function isComfortablyInView(target: HTMLElement): boolean {
  const rect = target.getBoundingClientRect()
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const pad = 24
  return rect.top >= pad && rect.bottom <= viewportHeight - pad && rect.height > 0
}

type TryDemoAttentionTooltipProps = {
  active: boolean
  /** Section that stays clear of the scrim (Needs Your Attention, Portfolio Snapshot, …). */
  targetRef?: RefObject<HTMLElement | null>
  /**
   * Optional DOM id for a target outside this tree (e.g. top-bar Ask Ulo / search).
   * Used when set; otherwise `targetRef`.
   */
  targetId?: string | null
  /** Extra clear regions unioned into the cutout (e.g. past chats on step 6). */
  extraTargetIds?: string[]
  /** When true, do not shrink near-fullscreen cutouts (step 6 Ask Ulo UI). */
  skipHoleClamp?: boolean
  /** Bump when the spotlight target changes so the hole remeasures and scrolls. */
  spotlightKey?: string | number
  /**
   * `left` = place the card to the left of the cutout with a right-pointing
   * pointer (docked Ask Ulo rail). Default auto uses above/below.
   */
  side?: TryDemoTooltipSide
  title: string
  body: string
  pageLabel: string
  onNext?: () => void
}

/**
 * Try Demo Overview tip: single cutout scrim + card.
 * In-view step changes morph the cutout; off-screen targets instant-scroll then snap
 * so scroll never fights CSS transitions.
 */
function resolveSpotlightElements(
  targetRef: RefObject<HTMLElement | null> | undefined,
  targetId: string | null | undefined,
  extraTargetIds: string[] | undefined,
): HTMLElement[] {
  const elements: HTMLElement[] = []
  if (targetId?.trim()) {
    const primary = document.getElementById(targetId.trim())
    if (primary) elements.push(primary)
  } else if (targetRef?.current) {
    elements.push(targetRef.current)
  }
  for (const id of extraTargetIds ?? []) {
    const el = document.getElementById(id)
    if (el && !elements.includes(el)) elements.push(el)
  }
  return elements
}

export function TryDemoAttentionTooltip({
  active,
  targetRef,
  targetId = null,
  extraTargetIds = [],
  skipHoleClamp = false,
  spotlightKey = 0,
  side = 'auto',
  title,
  body,
  pageLabel,
  onNext,
}: TryDemoAttentionTooltipProps) {
  const [hole, setHole] = useState<HoleRect | null>(null)
  const [tooltip, setTooltip] = useState<TooltipCoords | null>(null)
  const [animateGeometry, setAnimateGeometry] = useState(false)
  const [contentVisible, setContentVisible] = useState(true)
  const [displayed, setDisplayed] = useState({ title, body, pageLabel })
  const holeRef = useRef<HoleRect | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const tooltipHeightRef = useRef(ESTIMATED_TOOLTIP_HEIGHT)
  const morphTimerRef = useRef<number | null>(null)
  const contentTimerRef = useRef<number | null>(null)
  const activeKeyRef = useRef<string | number | null>(null)
  const resolvedTargetKeyRef = useRef<string | null>(null)
  const extraKey = (extraTargetIds ?? []).join('|')

  useLayoutEffect(() => {
    if (!active) {
      holeRef.current = null
      activeKeyRef.current = null
      resolvedTargetKeyRef.current = null
      setHole(null)
      setTooltip(null)
      setAnimateGeometry(false)
      setContentVisible(true)
      if (morphTimerRef.current != null) window.clearTimeout(morphTimerRef.current)
      if (contentTimerRef.current != null) window.clearTimeout(contentTimerRef.current)
      return
    }

    let cancelled = false
    const reduceMotion = prefersReducedMotion()
    const isStepChange = activeKeyRef.current != null && activeKeyRef.current !== spotlightKey
    activeKeyRef.current = spotlightKey
    // Force a fresh resolve for this step — do not keep a prior cutout when the
    // Ask Ulo panel has not mounted yet.
    resolvedTargetKeyRef.current = null
    const extraIds = extraKey ? extraKey.split('|').filter(Boolean) : []

    const holesEqual = (a: HoleRect, b: HoleRect) =>
      a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height

    const applyHole = (next: HoleRect, withMotion: boolean) => {
      if (cancelled) return
      if (holeRef.current && holesEqual(holeRef.current, next)) return
      holeRef.current = next
      setAnimateGeometry(withMotion && !reduceMotion)
      setHole(next)
      setTooltip(measureTooltip(next, tooltipHeightRef.current, side))
    }

    const readHole = () => {
      const elements = resolveSpotlightElements(targetRef, targetId, extraIds)
      if (elements.length === 0) return null
      return measureHoleFromElements(elements, { skipClamp: skipHoleClamp })
    }

    const targetKeyFor = (elements: HTMLElement[]) =>
      `${spotlightKey}:${targetId ?? ''}:${extraKey}:${elements
        .map((el) => `${el.id}:${Math.round(el.getBoundingClientRect().width)}`)
        .join(',')}`

    const run = () => {
      const elements = resolveSpotlightElements(targetRef, targetId, extraIds)
      if (elements.length === 0) return false

      const targetKey = targetKeyFor(elements)
      const isNewTarget = resolvedTargetKeyRef.current !== targetKey
      const primary = elements[0]!
      const inView = isComfortablyInView(primary)
      const shouldMorph =
        isStepChange &&
        !isNewTarget &&
        inView &&
        holeRef.current != null &&
        !reduceMotion

      if (!inView) {
        primary.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
      }

      const next = measureHoleFromElements(elements, { skipClamp: skipHoleClamp })
      if (!next) return false
      resolvedTargetKeyRef.current = targetKey
      applyHole(next, shouldMorph && !isNewTarget)

      if (shouldMorph && !isNewTarget) {
        if (morphTimerRef.current != null) window.clearTimeout(morphTimerRef.current)
        morphTimerRef.current = window.setTimeout(() => {
          if (!cancelled) setAnimateGeometry(false)
        }, MORPH_MS + 40)
      }
      return true
    }

    if (isStepChange && !reduceMotion) {
      setContentVisible(false)
      if (contentTimerRef.current != null) window.clearTimeout(contentTimerRef.current)
      contentTimerRef.current = window.setTimeout(() => {
        if (cancelled) return
        setDisplayed({ title, body, pageLabel })
        setContentVisible(true)
      }, CONTENT_FADE_MS)
    } else {
      setDisplayed({ title, body, pageLabel })
      setContentVisible(true)
    }

    let raf2 = 0
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (!cancelled) run()
      })
    })

    const onResize = () => {
      const next = readHole()
      if (next) applyHole(next, false)
    }
    window.addEventListener('resize', onResize)

    let attempts = 0
    const poll = window.setInterval(() => {
      attempts += 1
      if (run() || attempts > 60) window.clearInterval(poll)
    }, 32)

    // Only watch until the step's targets appear — do not re-apply on every
    // portal/React DOM mutation (that looped setState and blanked the screen).
    const observer = new MutationObserver(() => {
      if (cancelled || resolvedTargetKeyRef.current) return
      if (resolveSpotlightElements(targetRef, targetId, extraIds).length > 0) {
        if (run()) observer.disconnect()
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
      window.clearInterval(poll)
      window.removeEventListener('resize', onResize)
      observer.disconnect()
      if (morphTimerRef.current != null) window.clearTimeout(morphTimerRef.current)
      if (contentTimerRef.current != null) window.clearTimeout(contentTimerRef.current)
    }
  }, [
    active,
    targetRef,
    targetId,
    extraKey,
    skipHoleClamp,
    spotlightKey,
    side,
    title,
    body,
    pageLabel,
  ])

  useLayoutEffect(() => {
    if (!active || !hole || !cardRef.current) return
    const height = cardRef.current.getBoundingClientRect().height
    if (height <= 0) return
    if (Math.abs(height - tooltipHeightRef.current) < 1) return
    tooltipHeightRef.current = height
    setTooltip(measureTooltip(hole, height, side))
  }, [active, hole, side, displayed.title, displayed.body, displayed.pageLabel, contentVisible])

  if (!active || !hole || !tooltip || typeof document === 'undefined') return null

  function handleNext() {
    playUiClickSound()
    onNext?.()
  }

  const geometryTransition = animateGeometry
    ? `top ${MORPH_MS}ms var(--sa-ease), left ${MORPH_MS}ms var(--sa-ease), width ${MORPH_MS}ms var(--sa-ease), height ${MORPH_MS}ms var(--sa-ease)`
    : 'none'

  const cardTransition = animateGeometry
    ? `top ${MORPH_MS}ms var(--sa-ease), left ${MORPH_MS}ms var(--sa-ease), width ${MORPH_MS}ms var(--sa-ease)`
    : 'none'

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[220]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="try-demo-attention-tip-title"
    >
      {/* Visual dim only — tip copy stays above; cutout keeps UI components clear. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute rounded-[12px]"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: '0 0 0 9999px rgba(16, 24, 40, 0.55)',
            outline: '2px solid rgba(255, 255, 255, 0.85)',
            transition: geometryTransition,
          }}
        />
      </div>

      <div
        className="pointer-events-auto absolute z-[221]"
        style={{
          top: tooltip.top,
          left: tooltip.left,
          width: tooltip.width,
          transition: cardTransition,
        }}
      >
        <div
          ref={cardRef}
          className="relative rounded-[12px] bg-[#1a1a1a] px-4 pb-3.5 pt-4 text-left shadow-[0_16px_40px_rgba(0,0,0,0.35)]"
        >
          {tooltip.placement === 'left' ? (
            <span
              className="absolute size-3 -translate-y-1/2 rotate-45 bg-[#1a1a1a]"
              style={{
                right: -6,
                top: tooltip.pointerTop,
                transition: animateGeometry ? `top ${MORPH_MS}ms var(--sa-ease)` : 'none',
              }}
              aria-hidden
            />
          ) : tooltip.placement !== 'inside' ? (
            <span
              className={[
                'absolute size-3 -translate-x-1/2 rotate-45 bg-[#1a1a1a]',
                tooltip.placement === 'below' ? 'top-[-6px]' : 'bottom-[-6px]',
              ].join(' ')}
              style={{
                left: tooltip.pointerLeft,
                transition: animateGeometry ? `left ${MORPH_MS}ms var(--sa-ease)` : 'none',
              }}
              aria-hidden
            />
          ) : null}
          <div
            style={{
              opacity: contentVisible ? 1 : 0,
              transform: contentVisible ? 'translateY(0)' : 'translateY(4px)',
              transition: prefersReducedMotion()
                ? 'none'
                : `opacity ${CONTENT_FADE_MS}ms var(--sa-ease), transform ${CONTENT_FADE_MS}ms var(--sa-ease)`,
            }}
          >
            <h2
              id="try-demo-attention-tip-title"
              className="text-[16px] font-semibold leading-5 tracking-[-0.01em] text-white"
            >
              {displayed.title}
            </h2>
            <p className="mt-1.5 text-[13px] font-normal leading-5 text-white/90">{displayed.body}</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[12px] font-medium leading-4 tabular-nums text-white/55">
                {displayed.pageLabel}
              </p>
              <button
                type="button"
                onClick={handleNext}
                className="sa-press inline-flex h-8 min-w-[72px] items-center justify-center rounded-lg bg-white px-3 text-[13px] font-semibold text-[#1a1a1a] outline-none hover:bg-white/95 focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a]"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
