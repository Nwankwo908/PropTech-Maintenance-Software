import { useEffect, type RefObject } from 'react'

const NEEDS_ATTENTION_SELECTOR = '.onb-review-needs-attention'
const GLOW_CLASS = 'onb-review-field-glow'
const TEXT_GLOW_CLASS = 'onb-review-attention-text-glow'
const GLOW_MS = 2600

/** Find the Required / Needs review label that belongs to this input. */
function relatedAttentionText(fieldEl: Element): HTMLElement | null {
  let scope: Element | null = fieldEl.parentElement
  for (let depth = 0; depth < 5 && scope; depth += 1) {
    const label = scope.querySelector<HTMLElement>('.onb-review-attention-label')
    if (label) return label
    scope = scope.parentElement
  }
  return null
}

/**
 * When a Required / needs-review input scrolls into view, pulse its border glow
 * and the matching attention label for a few seconds. Re-triggers only after
 * the field leaves the viewport.
 */
export function useReviewAttentionScrollGlow(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const inView = new WeakSet<Element>()
    const glowedThisVisit = new WeakSet<Element>()
    const glowTimers = new Map<Element, number>()

    const clearGlow = (el: Element) => {
      el.classList.remove(GLOW_CLASS)
      relatedAttentionText(el)?.classList.remove(TEXT_GLOW_CLASS)
      const timer = glowTimers.get(el)
      if (timer != null) {
        window.clearTimeout(timer)
        glowTimers.delete(el)
      }
    }

    const startGlow = (el: Element) => {
      clearGlow(el)
      el.classList.add(GLOW_CLASS)
      relatedAttentionText(el)?.classList.add(TEXT_GLOW_CLASS)
      glowTimers.set(
        el,
        window.setTimeout(() => {
          el.classList.remove(GLOW_CLASS)
          relatedAttentionText(el)?.classList.remove(TEXT_GLOW_CLASS)
          glowTimers.delete(el)
        }, GLOW_MS),
      )
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target
          if (entry.isIntersecting) {
            if (inView.has(el)) continue
            inView.add(el)
            if (!glowedThisVisit.has(el)) {
              glowedThisVisit.add(el)
              startGlow(el)
            }
          } else {
            inView.delete(el)
            glowedThisVisit.delete(el)
            clearGlow(el)
          }
        }
      },
      { threshold: 0.55, rootMargin: '0px 0px -6% 0px' },
    )

    const observed = new Set<Element>()
    const syncObserved = () => {
      const next = new Set(root.querySelectorAll(NEEDS_ATTENTION_SELECTOR))
      for (const el of observed) {
        if (!next.has(el)) {
          observer.unobserve(el)
          observed.delete(el)
          inView.delete(el)
          glowedThisVisit.delete(el)
          clearGlow(el)
        }
      }
      for (const el of next) {
        if (observed.has(el)) continue
        observed.add(el)
        observer.observe(el)
      }
    }

    syncObserved()
    const mutations = new MutationObserver(syncObserved)
    mutations.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      mutations.disconnect()
      observer.disconnect()
      for (const el of observed) clearGlow(el)
      glowTimers.clear()
    }
  }, [rootRef])
}
