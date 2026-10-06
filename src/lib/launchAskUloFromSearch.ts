import {
  clearAskUloPromptAutoSent,
  stashAskUloPendingPrompt,
} from '@/lib/askUloPendingPrompt'
import { sameOriginHref } from '@/lib/inAppRouterPath'

/** Keep in sync with AskUloContext URL keys. */
const ASK_ULO = 'askUlo'
const ASK_ULO_CHAT = 'askUloChat'
const ASK_ULO_DOCK = 'askUloDock'
const ASK_ULO_Q = 'askUloQ'

/** AskUloProvider listens and preventDefaults when it can handle SPA navigation. */
export const ASK_ULO_LAUNCH_EVENT = 'ulo-ask-ulo-launch'

export type AskUloLaunchDetail = {
  prompt: string
  docked?: boolean
}

let lastLaunchAt = 0
let lastLaunchPrompt = ''

/**
 * Open docked Ask Ulo and auto-send `prompt`.
 * Prefers in-app handling via AskUloProvider; falls back to a full document load
 * when the provider is not mounted (e.g. outside /admin).
 */
export function launchAskUloFromSearch(prompt: string, opts?: { docked?: boolean }): void {
  const q = prompt.trim()
  if (!q || typeof window === 'undefined') return

  // Document-capture + React handlers can both fire for one click.
  const now = Date.now()
  if (q === lastLaunchPrompt && now - lastLaunchAt < 800) return
  lastLaunchAt = now
  lastLaunchPrompt = q

  clearAskUloPromptAutoSent()
  stashAskUloPendingPrompt(q)

  const detail: AskUloLaunchDetail = {
    prompt: q,
    docked: opts?.docked !== false,
  }
  const event = new CustomEvent<AskUloLaunchDetail>(ASK_ULO_LAUNCH_EVENT, {
    detail,
    cancelable: true,
  })
  window.dispatchEvent(event)
  if (event.defaultPrevented) return

  const params = new URLSearchParams(window.location.search)
  params.set(ASK_ULO, '1')
  params.delete(ASK_ULO_CHAT)
  params.set(ASK_ULO_Q, q)
  if (opts?.docked === false) params.delete(ASK_ULO_DOCK)
  else params.set(ASK_ULO_DOCK, '1')

  const pathname = window.location.pathname.startsWith('/admin')
    ? window.location.pathname
    : '/admin'
  const nextHref = sameOriginHref(`${pathname}?${params.toString()}`)
  if (window.location.href === nextHref) {
    window.location.reload()
    return
  }
  window.location.href = nextHref
}
