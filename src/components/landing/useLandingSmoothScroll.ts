import { useCallback, useEffect, useRef } from 'react'

const EASE = 0.085
const SETTLE_PX = 0.4

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function maxScrollY(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
}

function clampScroll(y: number): number {
  return Math.max(0, Math.min(maxScrollY(), y))
}

function headerOffsetPx(): number {
  const header = document.querySelector('header.sticky')
  if (header instanceof HTMLElement) return header.getBoundingClientRect().height
  return 80
}

function wheelDeltaY(event: WheelEvent): number {
  let delta = event.deltaY
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= window.innerHeight
  return delta
}

function isNestedScrollTarget(node: EventTarget | null): boolean {
  let el = node instanceof Element ? node : null
  while (el && el !== document.documentElement) {
    const style = window.getComputedStyle(el)
    const canY =
      (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
    const canX =
      (style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1
    if (canY || canX) return true
    el = el.parentElement
  }
  return false
}

/**
 * Eases window scroll toward the wheel/nav target so the landing page
 * follows with a short delay instead of jumping 1:1 with the trackpad.
 */
export function useLandingSmoothScroll() {
  const targetY = useRef(0)
  const currentY = useRef(0)
  const raf = useRef(0)
  const running = useRef(false)

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = 0
    running.current = false
  }, [])

  const tick = useCallback(() => {
    const next = currentY.current + (targetY.current - currentY.current) * EASE
    if (Math.abs(targetY.current - next) < SETTLE_PX) {
      currentY.current = targetY.current
      window.scrollTo(0, currentY.current)
      running.current = false
      raf.current = 0
      return
    }
    currentY.current = next
    window.scrollTo(0, currentY.current)
    raf.current = requestAnimationFrame(tick)
  }, [])

  const start = useCallback(() => {
    if (running.current) return
    running.current = true
    raf.current = requestAnimationFrame(tick)
  }, [tick])

  const scrollToId = useCallback(
    (id: string) => {
      const el = document.getElementById(id)
      if (!el) return

      if (prefersReducedMotion()) {
        el.scrollIntoView({ behavior: 'auto', block: 'start' })
        return
      }

      const top = el.getBoundingClientRect().top + window.scrollY - headerOffsetPx()
      targetY.current = clampScroll(top)
      currentY.current = window.scrollY
      start()
    },
    [start],
  )

  useEffect(() => {
    targetY.current = window.scrollY
    currentY.current = window.scrollY

    if (prefersReducedMotion()) return

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.defaultPrevented) return
      if (isNestedScrollTarget(event.target)) return

      event.preventDefault()
      if (!running.current) {
        currentY.current = window.scrollY
        targetY.current = window.scrollY
      }
      targetY.current = clampScroll(targetY.current + wheelDeltaY(event))
      start()
    }

    const onScroll = () => {
      if (running.current) return
      targetY.current = window.scrollY
      currentY.current = window.scrollY
    }

    const onResize = () => {
      targetY.current = clampScroll(targetY.current)
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      stop()
    }
  }, [start, stop])

  return { scrollToId }
}
