import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { listScrollKey } from '@/lib/adminListUrlState'

const STORAGE_PREFIX = 'ulo:admin-scroll:'

function readStored(key: string): number | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key)
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

function writeStored(key: string, y: number): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, String(Math.max(0, Math.round(y))))
  } catch {
    // sessionStorage may be unavailable
  }
}

/**
 * Persist / restore scroll on the AdminLayout outlet scroller across list↔detail
 * navigations. Panel-only params (`run`, `thread`) are omitted from the key so
 * opening a work-order panel does not wipe the list scroll position.
 */
export function useAdminScrollRestoration(scrollEl: HTMLElement | null): void {
  const location = useLocation()
  const navType = useNavigationType()
  const key = listScrollKey(location.pathname, location.search)
  const prevKeyRef = useRef(key)
  const lastLayoutKeyRef = useRef(key)
  const scrollElRef = useRef(scrollEl)
  scrollElRef.current = scrollEl

  // Save previous key's position before key changes.
  useEffect(() => {
    const el = scrollElRef.current
    const prev = prevKeyRef.current
    if (prev !== key && el) {
      writeStored(prev, el.scrollTop)
    }
    prevKeyRef.current = key
  }, [key])

  // Save on unmount / leave.
  useEffect(() => {
    return () => {
      const el = scrollElRef.current
      if (el) writeStored(prevKeyRef.current, el.scrollTop)
    }
  }, [])

  // Restore only on browser back/forward. Fresh PUSH into a new list key starts at top.
  // REPLACE (filter typing) and same-key PUSH (panel open) leave scroll alone.
  useLayoutEffect(() => {
    const el = scrollEl
    if (!el) return
    const keyChanged = lastLayoutKeyRef.current !== key
    lastLayoutKeyRef.current = key

    if (navType === 'POP') {
      const stored = readStored(key)
      if (stored != null) el.scrollTop = stored
      return
    }

    if (navType === 'PUSH' && keyChanged) {
      el.scrollTop = 0
    }
  }, [key, navType, scrollEl])

  // Continuously checkpoint while scrolling so refresh / abrupt leave still works.
  useEffect(() => {
    const el = scrollEl
    if (!el) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        writeStored(key, el.scrollTop)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', onScroll)
    }
  }, [key, scrollEl])
}
