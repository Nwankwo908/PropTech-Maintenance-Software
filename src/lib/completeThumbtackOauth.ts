import {
  exchangeThumbtackOauth,
  resolveThumbtackOauthUrl,
} from '@/api/thumbtackOauth'
import { getAdminEdgeSecret } from '@/lib/adminEdgeAuth'
import { thumbtackOauthParamsFromSearch } from '@/lib/uloAppUrl'

const HANDLED_KEY = 'ulo.thumbtack.oauth.handled'
export const THUMBTACK_CONNECTED_QUERY = 'thumbtack'
export const THUMBTACK_CONNECTED_VALUE = 'connected'

let inFlight: Promise<{
  handled: boolean
  returnPath?: string
  error?: string
}> | null = null
let inFlightState: string | null = null

export function thumbtackJustConnected(search: string): boolean {
  const raw = search.startsWith('?') ? search.slice(1) : search
  return new URLSearchParams(raw).get(THUMBTACK_CONNECTED_QUERY) === THUMBTACK_CONNECTED_VALUE
}

export function thumbtackConnectFailed(search: string): boolean {
  const raw = search.startsWith('?') ? search.slice(1) : search
  return new URLSearchParams(raw).get(THUMBTACK_CONNECTED_QUERY) === 'error'
}

export const THUMBTACK_OAUTH_PAGE_MESSAGE = 'ulo.thumbtack.oauth'

export function notifyThumbtackOauthOpener(payload: { ok: boolean; error?: string }): boolean {
  if (typeof window === 'undefined' || !window.opener || window.opener === window) return false
  try {
    window.opener.postMessage({ type: THUMBTACK_OAUTH_PAGE_MESSAGE, ...payload }, '*')
  } catch {
    /* ignore */
  }
  window.close()
  return true
}

/**
 * Finish Thumbtack authorization_code on any /admin URL.
 * Must run even while Overview is still loading — otherwise the code expires
 * or is stripped and in-app messaging still thinks the account is disconnected.
 */
export async function completeThumbtackOauthFromSearch(search: string): Promise<{
  handled: boolean
  returnPath?: string
  error?: string
}> {
  if (thumbtackConnectFailed(search)) {
    return {
      handled: true,
      error: 'Thumbtack could not finish sign-in. Click Connect Thumbtack to try again.',
    }
  }
  const oauth = thumbtackOauthParamsFromSearch(search)
  if (!oauth) return { handled: false }
  if (inFlight && inFlightState === oauth.state) return inFlight
  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(HANDLED_KEY) === oauth.state) {
    return { handled: true }
  }

  inFlightState = oauth.state
  inFlight = finishThumbtackOauth(oauth)
  try {
    return await inFlight
  } finally {
    inFlight = null
    inFlightState = null
  }
}

async function finishThumbtackOauth(oauth: {
  code: string
  state: string
  error: string | null
}): Promise<{
  handled: boolean
  returnPath?: string
  error?: string
}> {
  if (oauth.error || !oauth.code) {
    return {
      handled: true,
      error: oauth.error
        ? 'Thumbtack sign-in was cancelled. Click Connect Thumbtack to try again.'
        : 'Thumbtack did not return a sign-in code. Click Connect Thumbtack to try again.',
    }
  }
  const url = resolveThumbtackOauthUrl()
  const secret = getAdminEdgeSecret()
  if (!url || !secret) {
    return {
      handled: true,
      error: 'Thumbtack connect is not configured for this dashboard.',
    }
  }
  try {
    const result = await exchangeThumbtackOauth({
      url,
      secret,
      code: oauth.code,
      state: oauth.state,
      returnOrigin: window.location.origin,
    })
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(HANDLED_KEY, oauth.state)
    }
    const path = result.returnPath || '/admin'
    const join = path.includes('?') ? '&' : '?'
    return {
      handled: true,
      returnPath: `${path}${join}${THUMBTACK_CONNECTED_QUERY}=${THUMBTACK_CONNECTED_VALUE}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not finish Thumbtack sign-in.'
    return { handled: true, error: message }
  }
}
