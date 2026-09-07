import { isAnalyticsEnabled } from './isAnalyticsEnabled'
import { isAnonymousUuid, pickClarityTags } from './sanitize'

declare global {
  interface Window {
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] }
  }
}

function projectId(): string {
  return (import.meta.env.VITE_CLARITY_PROJECT_ID ?? '').trim()
}

function callClarity(...args: unknown[]): void {
  try {
    if (!isAnalyticsEnabled()) return
    if (typeof window.clarity !== 'function') return
    window.clarity(...args)
  } catch {
    /* never affect the app */
  }
}

function loadClarity(id: string): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`script[data-ulo-clarity="${id}"]`)) return

  window.clarity =
    window.clarity ||
    function clarityStub(...args: unknown[]) {
      const fn = window.clarity as { q?: unknown[] }
      fn.q = fn.q || []
      fn.q.push(args)
    }

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(id)}`
  script.dataset.uloClarity = id
  document.head.appendChild(script)
}

export function initClarity(): void {
  try {
    if (!isAnalyticsEnabled()) return
    const id = projectId()
    if (!id) return
    loadClarity(id)
  } catch {
    /* never affect the app */
  }
}

/** Anonymous UUID only. Never pass a friendly name, email, or phone. */
export function clarityIdentifyAnonymous(anonymousId: string): void {
  if (!isAnonymousUuid(anonymousId)) return
  callClarity('identify', anonymousId)
}

export function claritySetApprovedTags(input: Record<string, unknown> | null | undefined): void {
  const tags = pickClarityTags(input)
  for (const [key, value] of Object.entries(tags)) {
    callClarity('set', key, value)
  }
}
