import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAskUlo } from '@/components/AskUloContext'
import { TryDemoAttentionTooltip } from '@/components/TryDemoAttentionTooltip'
import { assignAdminPath } from '@/lib/assignAdminPath'
import {
  dismissTryDemoAttentionGuide,
  isTryDemoTipDestinationReady,
  planTryDemoAttentionGuideAdvance,
  readTryDemoAttentionGuideActiveStep,
  scrollTryDemoTipHostIntoView,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS,
  TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED,
  TRY_DEMO_ATTENTION_GUIDE_STEP_EVENT,
  TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES,
  TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES,
  TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS,
  TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL,
  tryDemoAskUloViewModeForStep,
  tryDemoAttentionGuideBody,
  tryDemoAttentionGuideExtraTargetIds,
  tryDemoAttentionGuidePageLabel,
  tryDemoAttentionGuideRouteForStep,
  tryDemoAttentionGuideSeparateHoles,
  tryDemoAttentionGuideSkipHoleClamp,
  tryDemoAttentionGuideTargetId,
  tryDemoAttentionGuideTitle,
  tryDemoAttentionGuideTooltipSide,
  tipRouteMatchesLocation,
  withTryDemoTipAnimateSuppress,
  writeTryDemoAttentionGuideActiveStep,
  type TryDemoAttentionGuideStep,
} from '@/lib/tryDemoAttentionGuide'

const SETTLE_TICK_MS = 40
/**
 * Prefer a ready host. ~12s so a slow kanban/properties fetch can finish
 * instead of arming the tip early (6→7 exceeded 6s).
 */
const SETTLE_MAX_TRIES = 300
/** Do not arm a route tip on the wrong page before this many tries (~2.5s). */
const SETTLE_MIN_OFF_ROUTE_TRIES = 60
/**
 * Full-assign only when the address bar is still on the old page.
 * History updates before this host re-renders; reloading in that gap was the
 * flash on 5→6 and 8→9.
 */
const SETTLE_HARD_ASSIGN_AT = 45
/** Survives assignAdminPath so a hard reload does not drop the timing row. */
const SETTLE_TIMING_KEY = 'ulo.tryDemoSettleTimings'
/** First-paint veil so a last-resort reload does not flash an undimmed page. */
const TIP_HOLD_SCRIM_KEY = 'ulo.tryDemoTipHoldScrim'

type TryDemoSettleTiming = {
  transition: string
  dest: string
  /** performance.now() when Next started this settle. */
  clickedAt: number
  /** Ms after click until React Router location matches dest. Null if it never did. */
  locationMs: number | null
  /** Ms after click until window.location matches dest. */
  windowLocationMs: number | null
  /** Ms after click until the destination page ready signal fires. Null if it never did. */
  readyMs: number | null
  triesAtLocation: number | null
  triesAtReady: number | null
  triesAtEnd: number
  /** Last React Router pathname the host rendered. */
  pathnameAtEnd: string
  /** window.location at the same moment — catches a URL/router desync. */
  windowPathAtEnd: string
  outcome: 'ready' | 'hard-assign' | 'max-on-page' | 'max-off-route'
}

function holdTipScrimForReload(): void {
  document.documentElement.setAttribute('data-try-demo-tip-hold-scrim', '1')
  try {
    window.sessionStorage.setItem(TIP_HOLD_SCRIM_KEY, '1')
  } catch {
    // ignore
  }
}

function clearTipHoldScrim(): void {
  document.documentElement.removeAttribute('data-try-demo-tip-hold-scrim')
  try {
    window.sessionStorage.removeItem(TIP_HOLD_SCRIM_KEY)
  } catch {
    // ignore
  }
}

function recordTryDemoSettleTiming(entry: TryDemoSettleTiming): void {
  console.info('[try-demo-settle]', entry)
  try {
    const raw = window.sessionStorage.getItem(SETTLE_TIMING_KEY)
    const prev = raw ? (JSON.parse(raw) as TryDemoSettleTiming[]) : []
    prev.push(entry)
    window.sessionStorage.setItem(SETTLE_TIMING_KEY, JSON.stringify(prev))
  } catch {
    // ignore quota / private mode
  }
}

function prefetchTipRouteChunk(pathname: string): void {
  const path = pathname.replace(/\/$/, '') || '/'
  if (path === '/admin/communication') {
    void import('@/components/AdminCommunicationDashboard')
    return
  }
  if (path === '/admin/workflows') {
    void import('@/components/AdminWorkflowOperationsDashboard')
    return
  }
  if (path === '/admin/residents') {
    void import('@/components/AdminResidentsDashboard')
    return
  }
  if (path === '/admin/vendors') {
    void import('@/components/AdminVendorsDashboard')
    return
  }
  if (path === '/admin') {
    void import('@/components/AdminOverviewDashboard')
  }
}

function setTipMotionMode(mode: 'glide' | 'hold' | null) {
  if (typeof document === 'undefined') return
  try {
    if (mode == null) document.documentElement.removeAttribute('data-try-demo-tip-motion')
    else document.documentElement.setAttribute('data-try-demo-tip-motion', mode)
  } catch {
    // ignore
  }
}

function goAdminPath(
  navigate: ReturnType<typeof useNavigate>,
  pathname: string,
) {
  navigate({ pathname, search: '' }, { replace: true })
}

/**
 * Layout-level tip host — stays mounted across admin route changes so the
 * scrim/cutout can morph instead of unmounting between steps.
 *
 * Advance contract (every step):
 * 1) Hold prior cutout (`cutoutArmed=false`)
 * 2) Apply Ask Ulo / navigate once
 * 3) Wait until route + host ready
 * 4) Scroll host into view
 * 5) Arm cutout → Tooltip morphs + reveals copy
 */
export function TryDemoAttentionGuideHost() {
  const navigate = useNavigate()
  const location = useLocation()
  const locationRef = useRef(location)
  locationRef.current = location
  const { setDocked: setAskUloDocked, closeAskUlo } = useAskUlo()
  const [step, setStep] = useState<TryDemoAttentionGuideStep | null>(() =>
    readTryDemoAttentionGuideActiveStep(),
  )
  /** False while settling — Tooltip holds prior cutout until destination ready. */
  const [cutoutArmed, setCutoutArmed] = useState(true)
  /** Bumped when settle ends so route correction re-runs after advancingRef clears. */
  const [routeEpoch, setRouteEpoch] = useState(0)
  const settleTimerRef = useRef<number | null>(null)
  const advancingRef = useRef(false)

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    function onTipStep(event: Event) {
      const next = (event as CustomEvent<{ step?: number | null }>).detail?.step
      if (next == null) {
        setStep(null)
        return
      }
      setStep(readTryDemoAttentionGuideActiveStep())
    }
    setStep(readTryDemoAttentionGuideActiveStep())
    window.addEventListener(TRY_DEMO_ATTENTION_GUIDE_STEP_EVENT, onTipStep)
    return () => {
      window.removeEventListener(TRY_DEMO_ATTENTION_GUIDE_STEP_EVENT, onTipStep)
      clearSettleTimer()
      advancingRef.current = false
      setTipMotionMode(null)
    }
  }, [clearSettleTimer])

  // Prefetch the *next* route chunk while the user reads the current tip.
  useEffect(() => {
    if (
      step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO ||
      step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_DOCKED ||
      step === TRY_DEMO_ATTENTION_GUIDE_STEP_ASK_ULO_CHATS
    ) {
      prefetchTipRouteChunk('/admin/communication')
      prefetchTipRouteChunk('/admin/workflows')
      return
    }
    if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_MESSAGES) {
      prefetchTipRouteChunk('/admin/workflows')
      return
    }
    if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_ACTIVE_TASKS) {
      prefetchTipRouteChunk('/admin')
      prefetchTipRouteChunk('/admin/residents')
      return
    }
    if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_PROPERTIES) {
      prefetchTipRouteChunk('/admin/residents')
      prefetchTipRouteChunk('/admin/vendors')
      return
    }
    if (step === TRY_DEMO_ATTENTION_GUIDE_STEP_RESIDENTS) {
      prefetchTipRouteChunk('/admin/vendors')
    }
  }, [step])

  useEffect(() => {
    if (step == null) {
      setTipMotionMode(null)
      return
    }
    setTipMotionMode('glide')
    return () => {
      if (readTryDemoAttentionGuideActiveStep() == null) setTipMotionMode(null)
    }
  }, [step])

  // Correct route mismatches only when not mid-advance (settle owns navigate).
  useEffect(() => {
    if (step == null) return
    if (advancingRef.current) return
    const expected = tryDemoAttentionGuideRouteForStep(step)
    if (!expected) return
    if (tipRouteMatchesLocation(location.pathname, expected)) return
    goAdminPath(navigate, expected)
  }, [step, location.pathname, navigate, routeEpoch])

  // Restore Ask Ulo shell for tip steps 4–5 after remount — never on later steps.
  useEffect(() => {
    if (advancingRef.current) return
    const mode = tryDemoAskUloViewModeForStep(step)
    if (mode === 'docked') withTryDemoTipAnimateSuppress(() => setAskUloDocked(true))
    else if (mode === 'full') withTryDemoTipAnimateSuppress(() => setAskUloDocked(false))
  }, [step, setAskUloDocked])

  // Drop the reload veil once the live tip scrim is up, so the two overlap.
  useEffect(() => {
    if (step == null) {
      clearTipHoldScrim()
      return
    }
    if (!cutoutArmed) return
    const id = window.requestAnimationFrame(() => clearTipHoldScrim())
    return () => window.cancelAnimationFrame(id)
  }, [step, cutoutArmed])

  const dismiss = useCallback(() => {
    clearSettleTimer()
    advancingRef.current = false
    setCutoutArmed(true)
    setTipMotionMode(null)
    dismissTryDemoAttentionGuide()
    setStep(null)
  }, [clearSettleTimer])

  const finishSettle = useCallback(
    (nextStep: TryDemoAttentionGuideStep) => {
      settleTimerRef.current = null
      const dest = tryDemoAttentionGuideRouteForStep(nextStep)
      // Last-chance route fix — advancingRef blocked the route-correction effect.
      if (dest && !tipRouteMatchesLocation(window.location.pathname, dest)) {
        prefetchTipRouteChunk(dest)
        goAdminPath(navigate, dest)
      }
      scrollTryDemoTipHostIntoView(tryDemoAttentionGuideTargetId(nextStep))
      advancingRef.current = false
      setTipMotionMode('glide')
      setCutoutArmed(true)
      setRouteEpoch((n) => n + 1)
    },
    [navigate],
  )

  /**
   * Poll until destination ready, then scroll + arm cutout.
   * Route tips (Messages+): prefer waiting until on-page + host ready so we
   * never arm the Messages tip over Dashboard / a frozen Ask Ulo hole.
   */
  const settleDestination = useCallback(
    (nextStep: TryDemoAttentionGuideStep, navigateTo?: string) => {
      clearSettleTimer()
      let tries = 0
      // advance() already issued the one navigate. Do not call navigate()
      // again until that call has committed (useLocation) or this deadline
      // says it will not. A 320ms retry was cancelling 8→9 mid-commit.
      let navigateIssued = Boolean(navigateTo)
      const clickedAt = performance.now()
      const fromStep = nextStep - 1
      const logRoute = Boolean(navigateTo)
      let locationMs: number | null = null
      let windowLocationMs: number | null = null
      let readyMs: number | null = null
      let triesAtLocation: number | null = null
      let triesAtReady: number | null = null
      let logged = false
      const finishLog = (
        outcome: TryDemoSettleTiming['outcome'],
        pathname: string,
      ) => {
        if (!logRoute || logged) return
        logged = true
        recordTryDemoSettleTiming({
          transition: `${fromStep}→${nextStep}`,
          dest: navigateTo ?? '',
          clickedAt,
          locationMs,
          windowLocationMs,
          readyMs,
          triesAtLocation,
          triesAtReady,
          triesAtEnd: tries,
          pathnameAtEnd: pathname,
          windowPathAtEnd: window.location.pathname,
          outcome,
        })
      }
      const tick = () => {
        tries += 1
        const dest = navigateTo ?? tryDemoAttentionGuideRouteForStep(nextStep)
        // Use React Router location only — window.pathname can desync after
        // history.replaceState and falsely report Messages while Overview is mounted.
        const pathname = locationRef.current.pathname
        const windowPath = window.location.pathname
        // Router location is the rendered page. window.location can move first
        // and still leave Dashboard mounted — do not treat that as landed.
        const onPage = !dest || tipRouteMatchesLocation(pathname, dest)
        const windowOnPage = !dest || tipRouteMatchesLocation(windowPath, dest)
        if (onPage && locationMs == null && dest) {
          locationMs = Math.round(performance.now() - clickedAt)
          triesAtLocation = tries
        }
        if (windowOnPage && windowLocationMs == null && dest) {
          windowLocationMs = Math.round(performance.now() - clickedAt)
        }
        if (dest && !onPage && !navigateIssued) {
          navigateIssued = true
          prefetchTipRouteChunk(dest)
          goAdminPath(navigate, dest)
        } else if (dest && !onPage && tries >= SETTLE_HARD_ASSIGN_AT) {
          finishLog('hard-assign', pathname)
          holdTipScrimForReload()
          assignAdminPath(dest)
          return
        }
        const ready = onPage && isTryDemoTipDestinationReady(nextStep, pathname)
        if (ready && readyMs == null) {
          readyMs = Math.round(performance.now() - clickedAt)
          triesAtReady = tries
        }
        if (ready) {
          finishLog('ready', pathname)
          finishSettle(nextStep)
          return
        }
        // On-page but host slow — arm so Tooltip can morph with fallbacks.
        if (onPage && tries >= SETTLE_MAX_TRIES) {
          finishLog('max-on-page', pathname)
          finishSettle(nextStep)
          return
        }
        // Still off-route: keep navigating; only hard-arm after min wait + max.
        if (!onPage && tries >= SETTLE_MAX_TRIES && tries >= SETTLE_MIN_OFF_ROUTE_TRIES) {
          finishLog('max-off-route', pathname)
          if (dest) {
            holdTipScrimForReload()
            assignAdminPath(dest)
          }
          return
        }
        settleTimerRef.current = window.setTimeout(tick, SETTLE_TICK_MS)
      }
      settleTimerRef.current = window.setTimeout(tick, 0)
    },
    [clearSettleTimer, finishSettle, navigate],
  )

  const advance = useCallback(() => {
    // Mid-settle: force-finish the in-flight step (do not plan another advance).
    if (advancingRef.current) {
      const inFlight = readTryDemoAttentionGuideActiveStep()
      if (inFlight != null) {
        const dest = tryDemoAttentionGuideRouteForStep(inFlight)
        if (dest) {
          prefetchTipRouteChunk(dest)
          goAdminPath(navigate, dest)
        }
        clearSettleTimer()
        finishSettle(inFlight)
      } else {
        advancingRef.current = false
        setCutoutArmed(true)
        clearSettleTimer()
      }
      return
    }
    const current = readTryDemoAttentionGuideActiveStep()
    if (current == null) return
    const plan = planTryDemoAttentionGuideAdvance(current)
    if (plan.kind === 'done') {
      dismiss()
      return
    }

    clearSettleTimer()
    advancingRef.current = true
    setCutoutArmed(false)
    setTipMotionMode('glide')

    // Write destination step first so Ask Ulo close prefers tipRoute=Messages.
    writeTryDemoAttentionGuideActiveStep(plan.step)
    setStep(plan.step)

    if (plan.navigateTo) prefetchTipRouteChunk(plan.navigateTo)

    if (plan.askUlo === 'close-to') {
      // Close the panel only. goAdminPath is the one navigate for 5→6.
      // closeAskUlo's own navigate was racing this and leaving the router on Dashboard.
      withTryDemoTipAnimateSuppress(() => {
        closeAskUlo({
          preserveTip: true,
          skipNavigate: true,
        })
      })
      goAdminPath(navigate, plan.navigateTo ?? '/admin/communication')
    } else if (plan.askUlo === 'full') {
      withTryDemoTipAnimateSuppress(() => setAskUloDocked(false))
      if (plan.navigateTo) goAdminPath(navigate, plan.navigateTo)
    } else if (plan.askUlo === 'docked') {
      withTryDemoTipAnimateSuppress(() => setAskUloDocked(true))
      if (plan.navigateTo) goAdminPath(navigate, plan.navigateTo)
    } else if (plan.navigateTo) {
      goAdminPath(navigate, plan.navigateTo)
    }

    settleDestination(plan.step, plan.navigateTo)
  }, [
    clearSettleTimer,
    closeAskUlo,
    dismiss,
    finishSettle,
    navigate,
    setAskUloDocked,
    settleDestination,
  ])

  if (step == null) return null

  return (
    <TryDemoAttentionTooltip
      active
      armed={cutoutArmed}
      targetId={tryDemoAttentionGuideTargetId(step)}
      spotlightKey={step}
      side={tryDemoAttentionGuideTooltipSide(step)}
      extraTargetIds={tryDemoAttentionGuideExtraTargetIds(step)}
      skipHoleClamp={tryDemoAttentionGuideSkipHoleClamp(step)}
      separateHoles={tryDemoAttentionGuideSeparateHoles(step)}
      title={tryDemoAttentionGuideTitle(step)}
      body={tryDemoAttentionGuideBody(step)}
      pageLabel={tryDemoAttentionGuidePageLabel(step, TRY_DEMO_ATTENTION_GUIDE_STEP_TOTAL)}
      onNext={advance}
      onClose={dismiss}
    />
  )
}
