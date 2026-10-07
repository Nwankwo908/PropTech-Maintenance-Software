import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from '@/components/landing/LandingIcons'
import { playUiClickSound } from '@/lib/uiClickSound'
import {
  TRY_DEMO_ACTIVE_TASKS_KANBAN_COLUMN_COUNT,
  TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID,
  TRY_DEMO_SPOTLIGHT_ASK_ULO_ID,
  TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID,
  TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID,
  TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID,
  TRY_DEMO_SPOTLIGHT_RESIDENTS_ROWS_ID,
  TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID,
  TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID,
  isTryDemoRouteMorphStep,
  tipRouteMatchesLocation,
} from '@/lib/tryDemoAttentionGuide'

const VIEWPORT_INSET = 12
/** Fixed gap between spotlight cutout and tooltip card (all tip pages). */
const TOOLTIP_GAP = 14
const TOOLTIP_WIDTH = 300
const HOLE_PAD = 6
const MORPH_MS = 520
/** Longer ease for Ask Ulo rail → full so the tip card does not jump. */
const ASK_ULO_LAYOUT_MORPH_MS = 720
/** Same glide for every tip step (same-page and cross-route). */
const STEP_GLIDE_MS = 640
const ROUTE_MORPH_MS = 720
const CONTENT_FADE_MS = 240
/** Fallback until the card is measured in the DOM. */
const ESTIMATED_TOOLTIP_HEIGHT = 220
/** Min gutter width before a left tip falls back to inside placement. */
const LEFT_TIP_MIN_GUTTER = 160

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
  // Table row-groups often report 0×0 — union children first when marked as a cluster.
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
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return null
  return rect
}

function holeFromRect(rect: DOMRect, opts?: { skipClamp?: boolean }): HoleRect {
  const raw: HoleRect = {
    top: Math.max(0, rect.top - HOLE_PAD),
    left: Math.max(0, rect.left - HOLE_PAD),
    width: rect.width + HOLE_PAD * 2,
    height: rect.height + HOLE_PAD * 2,
  }
  if (opts?.skipClamp) return raw
  return clampHoleForReadableScrim(raw)
}

function measureHoleFromElements(
  elements: HTMLElement[],
  opts?: { skipClamp?: boolean; separate?: boolean },
): HoleRect[] {
  const rects = elements
    .map((el) => rectFromElement(el))
    .filter((r): r is DOMRect => r != null && (r.width > 0 || r.height > 0))
  if (rects.length === 0) return []
  if (opts?.separate) {
    return rects.map((rect) => holeFromRect(rect, opts))
  }
  const top = Math.min(...rects.map((r) => r.top))
  const left = Math.min(...rects.map((r) => r.left))
  const right = Math.max(...rects.map((r) => r.right))
  const bottom = Math.max(...rects.map((r) => r.bottom))
  return [
    holeFromRect(
      {
        top,
        left,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        x: left,
        y: top,
        toJSON: () => ({}),
      } as DOMRect,
      opts,
    ),
  ]
}

function holesEqual(a: HoleRect[], b: HoleRect[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (hole, i) =>
        hole.top === b[i]!.top &&
        hole.left === b[i]!.left &&
        hole.width === b[i]!.width &&
        hole.height === b[i]!.height,
    )
  )
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function interpolateHole(a: HoleRect, b: HoleRect, t: number): HoleRect {
  return {
    top: lerp(a.top, b.top, t),
    left: lerp(a.left, b.left, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
  }
}

function unionHole(holes: HoleRect[]): HoleRect {
  let top = Infinity
  let left = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const hole of holes) {
    top = Math.min(top, hole.top)
    left = Math.min(left, hole.left)
    right = Math.max(right, hole.left + hole.width)
    bottom = Math.max(bottom, hole.top + hole.height)
  }
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

/** Align hole lists so RAF can always lerp (pad / collapse) instead of snapping. */
function alignHoleLists(
  from: HoleRect[],
  to: HoleRect[],
): { from: HoleRect[]; to: HoleRect[] } {
  if (from.length === to.length) return { from, to }
  if (from.length === 1 && to.length > 1) {
    return { from: to.map(() => from[0]!), to }
  }
  if (to.length === 1 && from.length > 1) {
    return { from, to: from.map(() => to[0]!) }
  }
  return { from: [unionHole(from)], to: [unionHole(to)] }
}

/** Soft ease for small same-page tip glides. */
function easeOutQuint(t: number): number {
  return 1 - (1 - t) ** 5
}

/** Smoother mid-travel ease for large route / Ask Ulo cutout jumps. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function adminScrollRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector('[data-admin-scroll-root]') as HTMLElement | null
}

/** Wait until the admin scroller (or window) stops moving after a tip scroll. */
function waitForScrollSettle(timeoutMs = 700): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || timeoutMs <= 0) {
      resolve()
      return
    }
    const root = adminScrollRoot()
    const started = performance.now()
    let lastY = root ? root.scrollTop : window.scrollY
    let lastX = root ? root.scrollLeft : window.scrollX
    let stableSince: number | null = null
    let raf = 0
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      root?.removeEventListener('scrollend', onScrollEnd)
      window.removeEventListener('scrollend', onScrollEnd)
      window.cancelAnimationFrame(raf)
      resolve()
    }
    const onScrollEnd = () => finish()
    const tick = () => {
      const y = root ? root.scrollTop : window.scrollY
      const x = root ? root.scrollLeft : window.scrollX
      const now = performance.now()
      if (Math.abs(y - lastY) < 1 && Math.abs(x - lastX) < 1) {
        if (stableSince == null) stableSince = now
        else if (now - stableSince >= 80) {
          finish()
          return
        }
      } else {
        stableSince = null
        lastY = y
        lastX = x
      }
      if (now - started >= timeoutMs) {
        finish()
        return
      }
      raf = window.requestAnimationFrame(tick)
    }
    root?.addEventListener('scrollend', onScrollEnd, { once: true })
    window.addEventListener('scrollend', onScrollEnd, { once: true })
    raf = window.requestAnimationFrame(tick)
  })
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

  const measureInside = (): TooltipCoords => {
    const maxLeft = Math.max(VIEWPORT_INSET, viewportWidth - VIEWPORT_INSET - width)
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

  // Step 4 (docked Ask Ulo) + step 6 (Messages): left of cutout, right pointer.
  // Shrink into the sidebar / left gutter so the card stays left of the spotlight.
  if (side === 'left') {
    const gutter = hole.left - VIEWPORT_INSET - TOOLTIP_GAP
    if (gutter < LEFT_TIP_MIN_GUTTER) return measureInside()

    const tipWidth = Math.min(width, gutter)
    const left = Math.max(VIEWPORT_INSET, hole.left - TOOLTIP_GAP - tipWidth)
    const maxTop = Math.max(VIEWPORT_INSET, viewportHeight - VIEWPORT_INSET - tooltipHeight)
    const tallHole = hole.height > tooltipHeight * 1.35
    const preferredTop = tallHole
      ? hole.top + TOOLTIP_GAP
      : hole.top + hole.height / 2 - tooltipHeight / 2
    const top = Math.min(maxTop, Math.max(VIEWPORT_INSET, preferredTop))
    const anchorY = tallHole
      ? hole.top + Math.min(48, hole.height * 0.12)
      : hole.top + hole.height / 2
    const pointerTop = Math.min(tooltipHeight - 18, Math.max(18, anchorY - top))
    return {
      top,
      left,
      width: tipWidth,
      placement: 'left',
      pointerLeft: tipWidth,
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

  // Large clear UI (Messages / Active Tasks): tip inside the cutout near the top.
  return measureInside()
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * True when the target is already on-screen enough to measure a cutout.
 * Sticky top-bar targets (Search / Ask Ulo) sit within ~0–20px of the tip —
 * requiring a 24px inset made step 3 scroll-loop forever and never morph.
 * Cluster hosts (tbody first-five rows) use child union geometry — raw tbody
 * is often 0×0 and would otherwise scroll-loop forever.
 */
function isComfortablyInView(target: HTMLElement): boolean {
  const rect = rectFromElement(target) ?? target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth
  // Any overlap with the viewport counts as ready (sticky headers included).
  return (
    rect.bottom > 4 &&
    rect.top < viewportHeight - 4 &&
    rect.right > 4 &&
    rect.left < viewportWidth - 4
  )
}

/** Prefer the first measurable child for scrollIntoView on 0×0 tbody hosts. */
function scrollAnchorForSpotlight(target: HTMLElement): HTMLElement {
  if (target.dataset.tryDemoSpotlightCluster === '1') {
    const child = Array.from(target.children).find((el) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      return r.width > 0 || r.height > 0
    }) as HTMLElement | undefined
    if (child) return child
  }
  return target
}

type TryDemoAttentionTooltipProps = {
  active: boolean
  /**
   * Host settle gate. While false, hold the prior cutout and withhold new tip
   * copy. When true, morph to the destination host and reveal copy.
   */
  armed?: boolean
  /** Section that stays clear of the scrim (Needs Your Attention, Portfolio Snapshot, …). */
  targetRef?: RefObject<HTMLElement | null>
  /**
   * Optional DOM id for a target outside this tree (e.g. top-bar Ask Ulo / search).
   * Used when set; otherwise `targetRef`.
   */
  targetId?: string | null
  /** Extra clear regions (unioned, or kept separate when `separateHoles`). */
  extraTargetIds?: string[]
  /** When true, do not shrink near-fullscreen cutouts (Ask Ulo full / Messages). */
  skipHoleClamp?: boolean
  /**
   * When true, each spotlight target stays its own clear region instead of
   * one bounding-box hole.
   */
  separateHoles?: boolean
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
  /** Dismiss the tip tour early (close icon). */
  onClose?: () => void
}

/**
 * Prefer a measurable host when duplicate ids exist (e.g. mobile + desktop headers).
 */
function resolveElementByIdPreferVisible(id: string): HTMLElement | null {
  const matches = Array.from(document.querySelectorAll('[id]')).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.id === id,
  )
  if (matches.length === 0) return null
  const visible = matches.find((el) => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  })
  return visible ?? matches[0] ?? null
}

/**
 * Try Demo tip: persistent cutout scrim + card.
 * Same-page and cross-route step changes morph the hole when possible; while the
 * next page’s targets are mounting, the previous cutout is held so the scrim
 * does not flash off.
 */
function resolveSpotlightElements(
  targetRef: RefObject<HTMLElement | null> | undefined,
  targetId: string | null | undefined,
  extraTargetIds: string[] | undefined,
): HTMLElement[] {
  const elements: HTMLElement[] = []
  if (targetId?.trim()) {
    const primary = resolveElementByIdPreferVisible(targetId.trim())
    if (primary) elements.push(primary)
  } else if (targetRef?.current) {
    elements.push(targetRef.current)
  }
  for (const id of extraTargetIds ?? []) {
    const el = resolveElementByIdPreferVisible(id)
    if (el && !elements.includes(el)) elements.push(el)
  }
  return elements
}

export function TryDemoAttentionTooltip({
  active,
  armed = true,
  targetRef,
  targetId = null,
  extraTargetIds = [],
  skipHoleClamp = false,
  separateHoles = false,
  spotlightKey = 0,
  side = 'auto',
  title,
  body,
  pageLabel,
  onNext,
  onClose,
}: TryDemoAttentionTooltipProps) {
  const maskId = useId().replace(/:/g, '')
  const [holes, setHoles] = useState<HoleRect[]>([])
  const [tooltip, setTooltip] = useState<TooltipCoords | null>(null)
  const [animateGeometry, setAnimateGeometry] = useState(false)
  const [contentVisible, setContentVisible] = useState(true)
  const [scrimOpacity, setScrimOpacity] = useState(1)
  const [displayed, setDisplayed] = useState({ title, body, pageLabel })
  const holesRef = useRef<HoleRect[]>([])
  const cardRef = useRef<HTMLDivElement | null>(null)
  const tooltipHeightRef = useRef(ESTIMATED_TOOLTIP_HEIGHT)
  const morphTimerRef = useRef<number | null>(null)
  const morphRafRef = useRef<number | null>(null)
  const contentTimerRef = useRef<number | null>(null)
  const activeKeyRef = useRef<string | number | null>(null)
  /** One clean morph per spotlight key — blocks morph-then-remorph. */
  const morphCommittedKeyRef = useRef<string | number | null>(null)
  /** Messages / Residents: allow one remorph after list rows finish loading. */
  const messagesFinalRemorphDoneRef = useRef(false)
  /** Route morphs: tip copy stays hidden until destination cutout commits. */
  const contentRevealedRef = useRef(false)
  /** Require two identical layouts before morphing (avoids mid-layout jumps). */
  const stableLayoutRef = useRef<{ sig: string; hits: number } | null>(null)
  const scrollInFlightRef = useRef(false)
  /** One scrollIntoView per Residents/Vendors tip step (avoid 0×0 tbody loops). */
  const tableRowsScrolledKeyRef = useRef<string | number | null>(null)
  const sideRef = useRef(side)
  sideRef.current = side
  const extraKey = (extraTargetIds ?? []).join('|')
  const tracksAskUloShell =
    targetId === TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID ||
    targetId === TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID
  const tracksAskUloContent = targetId === TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID

  useLayoutEffect(() => {
    if (!active) {
      holesRef.current = []
      activeKeyRef.current = null
      morphCommittedKeyRef.current = null
      messagesFinalRemorphDoneRef.current = false
      contentRevealedRef.current = false
      stableLayoutRef.current = null
      scrollInFlightRef.current = false
      tableRowsScrolledKeyRef.current = null
      setHoles([])
      setTooltip(null)
      setAnimateGeometry(false)
      setContentVisible(true)
      setScrimOpacity(1)
      if (morphTimerRef.current != null) window.clearTimeout(morphTimerRef.current)
      if (morphRafRef.current != null) window.cancelAnimationFrame(morphRafRef.current)
      if (contentTimerRef.current != null) window.clearTimeout(contentTimerRef.current)
      return
    }

    // Host settle: keep prior cutout + prior tip copy until destination is ready.
    // Do not blank the card — empty shell + frozen hole is what looks like a "stuck" tip.
    if (!armed) {
      if (contentTimerRef.current != null) window.clearTimeout(contentTimerRef.current)
      return
    }

    let cancelled = false
    const reduceMotion = prefersReducedMotion()
    const isStepChange = activeKeyRef.current != null && activeKeyRef.current !== spotlightKey
    activeKeyRef.current = spotlightKey
    if (isStepChange) {
      morphCommittedKeyRef.current = null
      messagesFinalRemorphDoneRef.current = false
      contentRevealedRef.current = false
      stableLayoutRef.current = null
      tableRowsScrolledKeyRef.current = null
    }
    const extraIds = extraKey ? extraKey.split('|').filter(Boolean) : []
    const routeMorph =
      typeof spotlightKey === 'number' && isTryDemoRouteMorphStep(spotlightKey)
    const morphMs = tracksAskUloShell
      ? ASK_ULO_LAYOUT_MORPH_MS
      : routeMorph
        ? ROUTE_MORPH_MS
        : isStepChange
          ? STEP_GLIDE_MS
          : MORPH_MS
    // Copy crossfade tracks hole/card morph so text does not hard-cut beside motion.
    const contentFadeMs = Math.round(morphMs * 0.4)

    const applyHolesInstant = (next: HoleRect[]) => {
      if (cancelled || next.length === 0) return
      if (holesEqual(holesRef.current, next)) return
      holesRef.current = next
      setAnimateGeometry(false)
      setHoles(next)
      setTooltip(measureTooltip(next[0]!, tooltipHeightRef.current, sideRef.current))
    }

    const morphToHoles = (next: HoleRect[]) => {
      if (cancelled || next.length === 0) return
      if (holesEqual(holesRef.current, next)) return

      const from = holesRef.current
      // First step (or empty): instant placement is expected — not a bug.
      if (reduceMotion || from.length === 0) {
        applyHolesInstant(next)
        return
      }

      const aligned = alignHoleLists(from, next)
      if (morphRafRef.current != null) window.cancelAnimationFrame(morphRafRef.current)
      if (morphTimerRef.current != null) window.clearTimeout(morphTimerRef.current)

      const started = performance.now()
      setAnimateGeometry(false)
      const ease =
        tracksAskUloShell || routeMorph ? easeInOutCubic : easeOutQuint

      const tick = (now: number) => {
        if (cancelled) return
        const t = ease(Math.min(1, (now - started) / morphMs))
        const frame = aligned.from.map((hole, i) =>
          interpolateHole(hole, aligned.to[i]!, t),
        )
        holesRef.current = frame
        setHoles(frame)
        setTooltip(measureTooltip(frame[0]!, tooltipHeightRef.current, sideRef.current))
        if (t < 1) {
          morphRafRef.current = window.requestAnimationFrame(tick)
          return
        }
        holesRef.current = next
        setHoles(next)
        setTooltip(measureTooltip(next[0]!, tooltipHeightRef.current, sideRef.current))
      }

      morphRafRef.current = window.requestAnimationFrame(tick)
    }

    const tracksMessagesSection = targetId === TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID
    const tracksPropertiesSection = targetId === TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID
    const tracksUloActivity = targetId === TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID
    const tableRowsHostId =
      targetId === TRY_DEMO_SPOTLIGHT_RESIDENTS_ROWS_ID ||
      targetId === TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID
        ? targetId
        : null
    const tracksTableRowsHost = tableRowsHostId != null
    const tableRowsReadyAttr =
      tableRowsHostId === TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID
        ? 'data-try-demo-vendors-ready'
        : 'data-try-demo-residents-ready'
    const tracksActiveTasksRow =
      typeof targetId === 'string' &&
      targetId.startsWith('try-demo-spotlight-active-tasks-first-row')
    const needsLayoutGate =
      tracksMessagesSection ||
      tracksPropertiesSection ||
      tracksTableRowsHost ||
      tracksUloActivity ||
      tracksActiveTasksRow ||
      tracksAskUloShell

    const layoutReady = (elements: HTMLElement[]): boolean => {
      if (elements.length === 0) return false
      const messagesEl = tracksMessagesSection
        ? document.getElementById(TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID)
        : null
      // Never settle step 6 on Dashboard under a leftover Ask Ulo hole.
      const onMessagesPage =
        !tracksMessagesSection ||
        tipRouteMatchesLocation(window.location.pathname, '/admin/communication')
      const messagesReadyAttr =
        messagesEl?.getAttribute('data-try-demo-messages-ready') === '1'
      // Morph as soon as the Messages host is on-page and measurable. Remorph
      // once when threads finish loading (see listFullyReady below).
      const messagesHole = messagesEl ? rectFromElement(messagesEl) : null
      const messagesReady =
        !tracksMessagesSection ||
        (onMessagesPage &&
          messagesEl != null &&
          (messagesReadyAttr ||
            (messagesHole != null && messagesHole.height >= 100)))
      const messagesTallEnough =
        !tracksMessagesSection ||
        (onMessagesPage && messagesHole != null && messagesHole.height >= 100)
      const propertiesEl = tracksPropertiesSection
        ? document.getElementById(TRY_DEMO_SPOTLIGHT_PROPERTIES_SECTION_ID)
        : null
      const onOverviewPage =
        !tracksPropertiesSection && !tracksUloActivity
          ? true
          : tipRouteMatchesLocation(window.location.pathname, '/admin')
      const propertiesReady =
        !tracksPropertiesSection ||
        (onOverviewPage &&
          propertiesEl?.getAttribute('data-try-demo-properties-ready') === '1')
      const propertiesTallEnough =
        !tracksPropertiesSection ||
        (propertiesEl != null && propertiesEl.getBoundingClientRect().height >= 120)
      const tableRowsEl = tracksTableRowsHost
        ? document.getElementById(tableRowsHostId)
        : null
      // Never settle Residents/Vendors cutouts on Overview under the prior hole.
      const tableRowsExpectedRoute =
        tableRowsHostId === TRY_DEMO_SPOTLIGHT_RESIDENTS_ROWS_ID
          ? '/admin/residents'
          : tableRowsHostId === TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID
            ? '/admin/vendors'
            : null
      const onTableRowsPage =
        !tracksTableRowsHost ||
        tipRouteMatchesLocation(window.location.pathname, tableRowsExpectedRoute)
      // Use cluster-aware rect (tbody children) — raw tbody is often 0×0.
      const tableRowsHole = tableRowsEl ? rectFromElement(tableRowsEl) : null
      const tableRowsReadyAttrValue =
        tableRowsEl?.getAttribute(tableRowsReadyAttr) === '1'
      const tableRowsCount = Number(
        tableRowsEl?.getAttribute(
          tableRowsHostId === TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID
            ? 'data-try-demo-vendors-rows'
            : 'data-try-demo-residents-rows',
        ) ?? '0',
      )
      // Wait for loaded first-five rows (or empty table) — not the loading row.
      // Tall fallback covers slow ready-attr updates after rows paint.
      const tableRowsReady =
        !tracksTableRowsHost ||
        (onTableRowsPage &&
          tableRowsEl != null &&
          (tableRowsReadyAttrValue ||
            (tableRowsHole != null && tableRowsHole.height >= 240)))
      const tableRowsTallEnough =
        !tracksTableRowsHost ||
        (onTableRowsPage &&
          tableRowsHole != null &&
          tableRowsHole.height >=
            (tableRowsReadyAttrValue && tableRowsCount === 0 ? 80 : 160))
      const uloActivityEl = tracksUloActivity
        ? resolveElementByIdPreferVisible(TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID)
        : null
      const uloActivityReady =
        !tracksUloActivity ||
        (onOverviewPage &&
          uloActivityEl?.getAttribute('data-try-demo-ulo-activity-ready') === '1')
      const uloActivityHole = uloActivityEl ? rectFromElement(uloActivityEl) : null
      const uloActivityTallEnough =
        !tracksUloActivity ||
        (uloActivityHole != null && uloActivityHole.height >= 120)
      const activeTasksHost = tracksActiveTasksRow
        ? document.querySelector('[data-try-demo-active-tasks-ready]')
        : null
      const activeTasksReady =
        !tracksActiveTasksRow ||
        activeTasksHost?.getAttribute('data-try-demo-active-tasks-ready') === '1'
      const activeTasksComplete =
        !tracksActiveTasksRow ||
        (activeTasksReady &&
          elements.length >= TRY_DEMO_ACTIVE_TASKS_KANBAN_COLUMN_COUNT)
      const primary = elements[0]!
      const rect = primary.getBoundingClientRect()
      const askUloSized =
        !tracksAskUloShell || (rect.width >= 200 && rect.height >= 120)
      // Step 5: wait until Ask Ulo is fully expanded (copy/UI only — not left rail / chrome).
      const askUloContentEl = tracksAskUloContent
        ? document.getElementById(TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID)
        : null
      const askUloShell = tracksAskUloContent
        ? document.getElementById(TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID)
        : null
      const shellWidth = askUloShell?.getBoundingClientRect().width ?? 0
      const askUloFullEnough =
        !tracksAskUloContent ||
        (askUloContentEl?.getAttribute('data-try-demo-ask-ulo-content-ready') ===
          '1' &&
          askUloShell?.classList.contains('ask-ulo-shell--full') === true &&
          // Wider than the docked rail (~440px) so we never freeze mid-expand.
          shellWidth >= 520 &&
          rect.width >= 240 &&
          rect.height >= 120)
      return (
        messagesReady &&
        messagesTallEnough &&
        propertiesReady &&
        propertiesTallEnough &&
        tableRowsReady &&
        tableRowsTallEnough &&
        uloActivityReady &&
        uloActivityTallEnough &&
        activeTasksComplete &&
        askUloSized &&
        askUloFullEnough
      )
    }

    const scrollBlock = (): ScrollLogicalPosition =>
      tracksMessagesSection || tracksPropertiesSection || tracksTableRowsHost
        ? 'start'
        : tracksActiveTasksRow
          ? 'center'
          : 'nearest'

    /** Bucket geometry so sub-pixel / KPI jitter does not reset the settle counter. */
    const geometrySig = (next: HoleRect[]) =>
      next
        .map((h) => {
          const q = (n: number) => Math.round(n / 8) * 8
          return `${q(h.left)}:${q(h.top)}:${q(h.width)}x${q(h.height)}`
        })
        .join('|')

    const run = (opts?: { morph?: boolean; force?: boolean }) => {
      const elements = resolveSpotlightElements(targetRef, targetId, extraIds)
      // Hold the previous cutout while the next page’s targets mount (no flash).
      if (elements.length === 0) return false

      const ready = layoutReady(elements)
      // Keep prior hole visible until Messages / Active Tasks / Ask Ulo / Properties / table rows settle.
      if (needsLayoutGate && !ready) return false

      const primary = elements[0]!
      // Top-bar Search + Ask Ulo cluster is sticky — never scroll-chase it.
      const skipScroll =
        targetId === TRY_DEMO_SPOTLIGHT_ASK_ULO_ID ||
        targetId === TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID
      // Messages / Properties: pin admin scroller to top (hosts start at page top).
      if (tracksMessagesSection || tracksPropertiesSection) {
        const scrollRoot = adminScrollRoot()
        if (scrollRoot && scrollRoot.scrollTop > 2) {
          scrollRoot.scrollTo({ top: 0, behavior: 'auto' })
        }
      } else if (tracksTableRowsHost) {
        // Step 9/10 first-five hosts sit below title/filters — one-shot scroll
        // the first row into view, then measure (do not gate on tbody 0×0).
        if (!isComfortablyInView(primary) && tableRowsScrolledKeyRef.current !== spotlightKey) {
          tableRowsScrolledKeyRef.current = spotlightKey
          scrollAnchorForSpotlight(primary).scrollIntoView({
            block: 'start',
            inline: 'nearest',
            behavior: 'auto',
          })
        }
      } else if (!skipScroll && !isComfortablyInView(primary)) {
        if (!scrollInFlightRef.current) {
          scrollInFlightRef.current = true
          primary.scrollIntoView({
            block: scrollBlock(),
            inline: 'nearest',
            behavior: reduceMotion ? 'auto' : 'smooth',
          })
          void waitForScrollSettle(reduceMotion ? 0 : 700).then(() => {
            scrollInFlightRef.current = false
            if (!cancelled) run({ morph: true })
          })
        }
        return false
      }

      const next = measureHoleFromElements(elements, {
        skipClamp: skipHoleClamp,
        separate: separateHoles,
      })
      if (next.length === 0) return false

      // Fully ready = conversations finished loading (threads or empty inbox).
      const messagesFullyReady =
        tracksMessagesSection &&
        document
          .getElementById(TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID)
          ?.getAttribute('data-try-demo-messages-ready') === '1'
      const tableRowsHostEl = tracksTableRowsHost
        ? document.getElementById(tableRowsHostId)
        : null
      const tableRowsCountForRemorph = Number(
        tableRowsHostEl?.getAttribute(
          tableRowsHostId === TRY_DEMO_SPOTLIGHT_VENDORS_ROWS_ID
            ? 'data-try-demo-vendors-rows'
            : 'data-try-demo-residents-rows',
        ) ?? '0',
      )
      const tableRowsFullyReady =
        tracksTableRowsHost &&
        tableRowsHostEl?.getAttribute(tableRowsReadyAttr) === '1' &&
        tableRowsCountForRemorph > 0
      const uloActivityFullyReady =
        tracksUloActivity &&
        resolveElementByIdPreferVisible(TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID)?.getAttribute(
          'data-try-demo-ulo-activity-ready',
        ) === '1'
      const askUloContentFullyReady =
        tracksAskUloContent &&
        document
          .getElementById(TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID)
          ?.getAttribute('data-try-demo-ask-ulo-content-ready') === '1' &&
        document
          .getElementById(TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID)
          ?.classList.contains('ask-ulo-shell--full') === true
      const listFullyReady =
        messagesFullyReady ||
        tableRowsFullyReady ||
        uloActivityFullyReady ||
        askUloContentFullyReady
      const tracksListSection =
        tracksMessagesSection ||
        tracksTableRowsHost ||
        tracksUloActivity ||
        tracksAskUloContent

      // Already completed the one morph for this step — only tiny post-settle nudges,
      // except Messages / Residents / Vendors / Activity / Ask Ulo full may remorph once.
      if (morphCommittedKeyRef.current === spotlightKey) {
        if (
          listFullyReady &&
          !messagesFinalRemorphDoneRef.current &&
          holesRef.current.length > 0
        ) {
          const changed = !holesEqual(holesRef.current, next)
          const prev = holesRef.current[0]!
          const grew =
            next[0]!.height - prev.height > 40 || next[0]!.width - prev.width > 40
          // Messages / table rows: remorph on any geometry change after load.
          // The old >40px gate skipped step 6 when the loading block was already tall.
          const shouldRemorph =
            changed &&
            (grew ||
              tracksMessagesSection ||
              tracksTableRowsHost ||
              tracksUloActivity ||
              tracksAskUloContent)
          messagesFinalRemorphDoneRef.current = true
          if (shouldRemorph) {
            let targetHoles = next
            if (tracksTableRowsHost) {
              scrollAnchorForSpotlight(primary).scrollIntoView({
                block: 'start',
                inline: 'nearest',
                behavior: 'auto',
              })
              const afterScroll = measureHoleFromElements(elements, {
                skipClamp: skipHoleClamp,
                separate: separateHoles,
              })
              if (afterScroll.length > 0) targetHoles = afterScroll
            }
            if (!reduceMotion) morphToHoles(targetHoles)
            else applyHolesInstant(targetHoles)
            return true
          }
        }
        if (!holesEqual(holesRef.current, next)) applyHolesInstant(next)
        return Boolean(!tracksListSection || listFullyReady)
      }

      // Wait for two identical (bucketed) layouts so we morph once — unless force.
      // List / Activity / Ask Ulo full: one confirming frame so expands cannot stall.
      const sig = `${String(spotlightKey)}:${geometrySig(next)}`
      const stable = stableLayoutRef.current
      const needHits = tracksListSection ? 1 : 2
      if (!opts?.force) {
        if (!stable || stable.sig !== sig) {
          stableLayoutRef.current = { sig, hits: 1 }
          return false
        }
        stable.hits += 1
        if (stable.hits < needHits && !reduceMotion) return false
      }

      const wantMorph =
        Boolean(opts?.morph) && holesRef.current.length > 0 && !reduceMotion

      morphCommittedKeyRef.current = spotlightKey
      if (listFullyReady) messagesFinalRemorphDoneRef.current = true
      if (wantMorph) morphToHoles(next)
      else applyHolesInstant(next)
      // Route steps: only swap tip copy once the destination cutout is real
      // (avoids "Messages" copy over Dashboard / Ask Ulo).
      if (routeMorph && !contentRevealedRef.current) {
        contentRevealedRef.current = true
        if (contentTimerRef.current != null) window.clearTimeout(contentTimerRef.current)
        setDisplayed({ title, body, pageLabel })
        setContentVisible(true)
      }
      return true
    }

    // Non-route steps: crossfade copy with the hole morph.
    // Route steps: Host only arms after destination route/host is ready — show
    // that step's copy immediately. Waiting on run() morph-commit left Messages+
    // stuck on prior copy ("Ask Ulo, Your Way" / 5 of 11) on the right URL.
    if (contentTimerRef.current != null) window.clearTimeout(contentTimerRef.current)
    if (routeMorph) {
      contentRevealedRef.current = true
      setDisplayed({ title, body, pageLabel })
      setContentVisible(true)
    } else if (isStepChange && !reduceMotion) {
      setContentVisible(false)
      contentTimerRef.current = window.setTimeout(() => {
        if (cancelled) return
        setDisplayed({ title, body, pageLabel })
        setContentVisible(true)
      }, contentFadeMs)
    } else {
      setDisplayed({ title, body, pageLabel })
      setContentVisible(true)
    }

    let raf2 = 0
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (!cancelled) run({ morph: true })
      })
    })

    /** Keep the cutout glued to the target while the page scrolls or resizes. */
    const remasureHoleToTarget = () => {
      if (cancelled) return
      if (scrollInFlightRef.current) return
      if (morphCommittedKeyRef.current !== spotlightKey) return
      // Don't fight an in-flight step morph.
      if (morphRafRef.current != null) return
      const elements = resolveSpotlightElements(targetRef, targetId, extraIds)
      if (!layoutReady(elements)) return
      const next = measureHoleFromElements(elements, {
        skipClamp: skipHoleClamp,
        separate: separateHoles,
      })
      if (next.length > 0) applyHolesInstant(next)
    }
    window.addEventListener('resize', remasureHoleToTarget)

    let scrollFollowRaf = 0
    const onScrollFollow = () => {
      if (cancelled) return
      if (scrollFollowRaf !== 0) return
      scrollFollowRaf = window.requestAnimationFrame(() => {
        scrollFollowRaf = 0
        remasureHoleToTarget()
      })
    }
    const scrollRoot = adminScrollRoot()
    scrollRoot?.addEventListener('scroll', onScrollFollow, { passive: true })
    // Capture nested scrollers (tables, Ask Ulo rails) that are not the admin root.
    window.addEventListener('scroll', onScrollFollow, { passive: true, capture: true })

    let attempts = 0
    const maxPollAttempts =
      routeMorph ||
      tracksMessagesSection ||
      tracksTableRowsHost ||
      tracksUloActivity ||
      tracksAskUloContent
        ? 500
        : 280
    const poll = window.setInterval(() => {
      attempts += 1
      if (scrollInFlightRef.current) return
      // Messages / Residents / Vendors / Activity / Ask Ulo full: keep polling until ready.
      const messagesStillLoading =
        tracksMessagesSection &&
        document
          .getElementById(TRY_DEMO_SPOTLIGHT_MESSAGES_KPI_ID)
          ?.getAttribute('data-try-demo-messages-ready') !== '1'
      const tableRowsStillLoading =
        tracksTableRowsHost &&
        document.getElementById(tableRowsHostId)?.getAttribute(tableRowsReadyAttr) !== '1'
      const uloActivityStillLoading =
        tracksUloActivity &&
        resolveElementByIdPreferVisible(TRY_DEMO_SPOTLIGHT_ULO_ACTIVITY_ID)?.getAttribute(
          'data-try-demo-ulo-activity-ready',
        ) !== '1'
      const askUloStillExpanding =
        tracksAskUloContent &&
        (document
          .getElementById(TRY_DEMO_SPOTLIGHT_ASK_ULO_CONTENT_ID)
          ?.getAttribute('data-try-demo-ask-ulo-content-ready') !== '1' ||
          document
            .getElementById(TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID)
            ?.classList.contains('ask-ulo-shell--full') !== true)
      const listStillLoading =
        messagesStillLoading ||
        tableRowsStillLoading ||
        uloActivityStillLoading ||
        askUloStillExpanding
      const tracksDeferredSection =
        tracksMessagesSection ||
        tracksTableRowsHost ||
        tracksUloActivity ||
        tracksAskUloContent
      if (
        morphCommittedKeyRef.current === spotlightKey &&
        !listStillLoading &&
        (!tracksDeferredSection || messagesFinalRemorphDoneRef.current)
      ) {
        window.clearInterval(poll)
        return
      }
      // Force after a few frames so route / Ask Ulo expands cannot stall on settle jitter.
      const force =
        Boolean(
          routeMorph ||
            tracksMessagesSection ||
            tracksTableRowsHost ||
            tracksUloActivity ||
            tracksAskUloContent,
        ) && attempts >= 12
      const ok = run({ morph: true, force })
      if (ok && !listStillLoading) {
        window.clearInterval(poll)
        return
      }
      if (attempts > maxPollAttempts) {
        // Never leave a route tip as an empty shell if the host never committed.
        if (routeMorph && !contentRevealedRef.current) {
          contentRevealedRef.current = true
          setDisplayed({ title, body, pageLabel })
          setContentVisible(true)
        }
        window.clearInterval(poll)
      }
    }, 32)

    const observer = new MutationObserver(() => {
      if (cancelled) return
      if (scrollInFlightRef.current) return
      if (resolveSpotlightElements(targetRef, targetId, extraIds).length > 0) {
        run({
          morph: true,
          force:
            tracksMessagesSection ||
            tracksTableRowsHost ||
            tracksUloActivity ||
            tracksAskUloContent,
        })
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    const observerStop = window.setTimeout(
      () => observer.disconnect(),
      routeMorph ||
        tracksAskUloShell ||
        tracksMessagesSection ||
        tracksTableRowsHost ||
        tracksUloActivity
        ? 12000
        : 1500,
    )

    // Follow Ask Ulo rail→full width ease so step 5 does not freeze mid-morph.
    const askUloShellEl = tracksAskUloContent
      ? document.getElementById(TRY_DEMO_SPOTLIGHT_ASK_ULO_PANEL_ID)
      : null
    const onAskUloTransitionEnd = (event: TransitionEvent) => {
      if (cancelled) return
      if (event.target !== askUloShellEl) return
      if (event.propertyName !== 'width' && event.propertyName !== 'left') return
      run({ morph: true, force: true })
    }
    askUloShellEl?.addEventListener('transitionend', onAskUloTransitionEnd)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(raf1)
      window.cancelAnimationFrame(raf2)
      if (scrollFollowRaf !== 0) window.cancelAnimationFrame(scrollFollowRaf)
      window.clearInterval(poll)
      window.clearTimeout(observerStop)
      window.removeEventListener('resize', remasureHoleToTarget)
      scrollRoot?.removeEventListener('scroll', onScrollFollow)
      window.removeEventListener('scroll', onScrollFollow, true)
      askUloShellEl?.removeEventListener('transitionend', onAskUloTransitionEnd)
      observer.disconnect()
      if (morphTimerRef.current != null) window.clearTimeout(morphTimerRef.current)
      if (morphRafRef.current != null) window.cancelAnimationFrame(morphRafRef.current)
      if (contentTimerRef.current != null) window.clearTimeout(contentTimerRef.current)
    }
  }, [
    active,
    armed,
    targetRef,
    targetId,
    tracksAskUloShell,
    tracksAskUloContent,
    extraKey,
    skipHoleClamp,
    separateHoles,
    spotlightKey,
    side,
    title,
    body,
    pageLabel,
  ])

  const primaryHole = holes[0] ?? null

  useLayoutEffect(() => {
    if (!active || !primaryHole || !cardRef.current) return
    const height = cardRef.current.getBoundingClientRect().height
    if (height <= 0) return
    if (Math.abs(height - tooltipHeightRef.current) < 1) return
    tooltipHeightRef.current = height
    setTooltip(measureTooltip(primaryHole, height, side))
  }, [
    active,
    primaryHole,
    side,
    displayed.title,
    displayed.body,
    displayed.pageLabel,
    contentVisible,
  ])

  if (!active || holes.length === 0 || !tooltip || typeof document === 'undefined') return null

  function handleNext() {
    // Allow click even while settling — Host no-ops if already advancing.
    // (disabled={!armed} was leaving Next dead when settle hung off-route.)
    playUiClickSound()
    onNext?.()
  }

  function handleClose() {
    playUiClickSound()
    onClose?.()
  }

  const cardMorphMs = tracksAskUloShell
    ? ASK_ULO_LAYOUT_MORPH_MS
    : typeof spotlightKey === 'number' && isTryDemoRouteMorphStep(spotlightKey)
      ? ROUTE_MORPH_MS
      : STEP_GLIDE_MS
  // CSS only for rare live follow; RAF morph drives tip position (no dual motion).
  const cardTransition = animateGeometry
    ? `top ${cardMorphMs}ms var(--sa-ease), left ${cardMorphMs}ms var(--sa-ease), width ${cardMorphMs}ms var(--sa-ease)`
    : 'none'
  const tipContentFadeMs = Math.round(cardMorphMs * 0.4)

  const pointerPlacement = tooltip.placement
  const pointerStyle =
    pointerPlacement === 'left'
      ? {
          top: tooltip.pointerTop,
          right: -6,
          left: 'auto',
          bottom: 'auto',
          opacity: 1,
          transform: 'translateY(-50%) rotate(45deg)',
        }
      : pointerPlacement === 'below'
        ? {
            top: -6,
            left: tooltip.pointerLeft,
            right: 'auto',
            bottom: 'auto',
            opacity: 1,
            transform: 'translateX(-50%) rotate(45deg)',
          }
        : pointerPlacement === 'above'
          ? {
              top: 'auto',
              left: tooltip.pointerLeft,
              right: 'auto',
              bottom: -6,
              opacity: 1,
              transform: 'translateX(-50%) rotate(45deg)',
            }
          : {
              top: 12,
              left: 24,
              right: 'auto',
              bottom: 'auto',
              opacity: 0,
              transform: 'translateX(-50%) rotate(45deg)',
            }

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[250]"
      role="dialog"
      aria-modal="false"
      aria-labelledby="try-demo-attention-tip-title"
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          opacity: scrimOpacity,
          transition: prefersReducedMotion()
            ? 'none'
            : `opacity ${CONTENT_FADE_MS}ms var(--sa-ease)`,
        }}
      >
        <svg className="absolute inset-0 size-full" width="100%" height="100%">
          <defs>
            <mask id={maskId}>
              <rect width="100%" height="100%" fill="white" />
              {holes.map((hole, index) => (
                <rect
                  key={index}
                  x={hole.left}
                  y={hole.top}
                  width={hole.width}
                  height={hole.height}
                  rx="12"
                  ry="12"
                  fill="black"
                />
              ))}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(16, 24, 40, 0.55)"
            mask={`url(#${maskId})`}
          />
          {holes.map((hole, index) => (
            <rect
              key={`outline-${index}`}
              x={hole.left}
              y={hole.top}
              width={hole.width}
              height={hole.height}
              rx="12"
              ry="12"
              fill="none"
              stroke="rgba(255, 255, 255, 0.85)"
              strokeWidth="2"
            />
          ))}
        </svg>
      </div>

      <div
        className="pointer-events-auto absolute z-[1]"
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
          <span
            className="absolute size-3 bg-[#1a1a1a]"
            style={{
              ...pointerStyle,
              // RAF updates pointer each frame — CSS transitions lag and look jumpy.
              transition: 'none',
            }}
            aria-hidden
          />
          {onClose ? (
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close tip"
              className="sa-press absolute right-2 top-2 z-[1] flex size-7 items-center justify-center rounded-[8px] text-white/70 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a]"
            >
              <IconClose className="size-3.5" />
            </button>
          ) : null}
          <div
            style={{
              opacity: contentVisible ? 1 : 0,
              transition: prefersReducedMotion()
                ? 'none'
                : `opacity ${tipContentFadeMs}ms var(--sa-ease)`,
            }}
          >
            <h2
              id="try-demo-attention-tip-title"
              className="pr-7 text-[16px] font-semibold leading-5 tracking-[-0.01em] text-white"
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
