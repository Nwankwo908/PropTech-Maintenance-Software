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
const SETTLE_RETRY_NAV_AT = 8
/** Prefer ready host; never leave Next stuck — hard-cap ~6s. */
const SETTLE_MAX_TRIES = 150
/** Do not arm a route tip on the wrong page before this many tries (~2.5s). */
const SETTLE_MIN_OFF_ROUTE_TRIES = 60
/** If React Router navigate never lands, full-assign (tip step is in sessionStorage). */
const SETTLE_HARD_ASSIGN_AT = 45

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
      let lastNavAt = -SETTLE_RETRY_NAV_AT
      const tick = () => {
        tries += 1
        const dest = navigateTo ?? tryDemoAttentionGuideRouteForStep(nextStep)
        // Use React Router location only — window.pathname can desync after
        // history.replaceState and falsely report Messages while Overview is mounted.
        const pathname = locationRef.current.pathname
        const onPage = !dest || tipRouteMatchesLocation(pathname, dest)
        if (dest && !onPage && tries - lastNavAt >= SETTLE_RETRY_NAV_AT) {
          lastNavAt = tries
          prefetchTipRouteChunk(dest)
          if (tries >= SETTLE_HARD_ASSIGN_AT) {
            // SPA navigate stuck (HMR / history desync) — full load; tip resumes.
            assignAdminPath(dest)
            return
          }
          goAdminPath(navigate, dest)
        }
        const ready =
          onPage && isTryDemoTipDestinationReady(nextStep, pathname)
        if (ready) {
          finishSettle(nextStep)
          return
        }
        // On-page but host slow — arm so Tooltip can morph with fallbacks.
        if (onPage && tries >= SETTLE_MAX_TRIES) {
          finishSettle(nextStep)
          return
        }
        // Still off-route: keep navigating; only hard-arm after min wait + max.
        if (!onPage && tries >= SETTLE_MAX_TRIES && tries >= SETTLE_MIN_OFF_ROUTE_TRIES) {
          if (dest) assignAdminPath(dest)
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
      // One atomic close + navigate to Messages (empty search strips askUlo*).
      // Do not call setDocked after this — it would navigate back to /admin.
      withTryDemoTipAnimateSuppress(() => {
        closeAskUlo({
          preserveTip: true,
          navigateTo: plan.navigateTo ?? '/admin/communication',
        })
      })
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
