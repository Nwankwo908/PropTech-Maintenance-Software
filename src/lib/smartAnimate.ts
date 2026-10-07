import { flushSync } from 'react-dom'
import { isTryDemoTipAnimateSuppressed } from '@/lib/tryDemoAttentionGuide'

/**
 * Figma-style smart animate: prefer View Transitions when available,
 * otherwise fall through to CSS transitions on the updated DOM.
 * flushSync so React commits inside the VT snapshot window.
 *
 * Try Demo tip advances suppress VT so the tip morph owns the motion.
 */
export function runSmartAnimate(update: () => void): void {
  if (typeof window === 'undefined') {
    update()
    return
  }
  if (isTryDemoTipAnimateSuppressed()) {
    update()
    return
  }
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update()
      return
    }
  } catch {
    // private mode / unsupported
  }
  const doc = document as Document & {
    startViewTransition?: (cb: () => void | Promise<void>) => { finished: Promise<void> }
  }
  if (typeof doc.startViewTransition === 'function') {
    try {
      doc.startViewTransition(() => {
        flushSync(update)
      })
      return
    } catch {
      // fall through
    }
  }
  update()
}
