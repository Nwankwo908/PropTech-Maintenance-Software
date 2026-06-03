import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'

const STAGGER_MS = 400
const DURATION_MS = 1600
const OFFSET_PX = 56

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Animates step cards when the grid scrolls into view (Web Animations API). */
export function useHowItWorksStepsGridRef() {
  const gridRef = useRef<HTMLDivElement>(null)
  const didAnimateRef = useRef(false)

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || prefersReducedMotion()) return

    grid.querySelectorAll<HTMLElement>('.how-it-works-step').forEach((el) => {
      el.style.opacity = '0'
      el.style.transform = `translateX(-${OFFSET_PX}px)`
    })
  }, [])

  useEffect(() => {
    const grid = gridRef.current
    if (!grid || didAnimateRef.current) return

    const playEntrance = () => {
      if (didAnimateRef.current) return
      didAnimateRef.current = true

      const steps = grid.querySelectorAll<HTMLElement>('.how-it-works-step')
      if (prefersReducedMotion()) {
        steps.forEach((el) => {
          el.style.opacity = '1'
          el.style.transform = 'none'
        })
        return
      }

      steps.forEach((el, index) => {
        el.animate(
          [
            { opacity: 0, transform: `translateX(-${OFFSET_PX}px)` },
            { opacity: 1, transform: 'translateX(0)' },
          ],
          {
            duration: DURATION_MS,
            delay: index * STAGGER_MS,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            fill: 'forwards',
          },
        )
      })
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          playEntrance()
          observer.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )

    observer.observe(grid)

    const fallbackMs = window.setTimeout(() => {
      if (!didAnimateRef.current) playEntrance()
    }, 4000)

    return () => {
      window.clearTimeout(fallbackMs)
      observer.disconnect()
    }
  }, [])

  return gridRef
}

export function HowItWorksStepsGrid({
  className = '',
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const gridRef = useHowItWorksStepsGridRef()

  return (
    <div ref={gridRef} className={className}>
      {children}
    </div>
  )
}

export function HowItWorksStepReveal({
  index,
  className = '',
  children,
}: {
  index: number
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={['how-it-works-step', className].filter(Boolean).join(' ')}
      style={{ '--how-it-works-step-index': index } as CSSProperties}
    >
      {children}
    </div>
  )
}
