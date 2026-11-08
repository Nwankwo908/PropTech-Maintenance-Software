import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Toggle `data-scrolling` while the user is actively scrolling so CSS can
 * show the scrollbar only during that window (see `.admin-scroll-on-scroll`).
 */
export function useScrollVisibleScrollbar(hideAfterMs = 700): {
  scrolling: boolean
  onScroll: () => void
} {
  const [scrolling, setScrolling] = useState(false)
  const hideTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current)
      }
    }
  }, [])

  const onScroll = useCallback(() => {
    setScrolling(true)
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current)
    }
    hideTimerRef.current = window.setTimeout(() => {
      setScrolling(false)
      hideTimerRef.current = null
    }, hideAfterMs)
  }, [hideAfterMs])

  return { scrolling, onScroll }
}
