import {
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { adminSessionInvokeHeaders, ADMIN_SESSION_REQUIRED } from '@/lib/adminSessionHeaders'

export function resolveThumbtackOauthUrl(): string | null {
  const explicit = import.meta.env.VITE_THUMBTACK_OAUTH_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/thumbtack-oauth`
  return null
}

async function parseAdminJson(res: Response): Promise<unknown> {
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Thumbtack connect: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    const base = err.error ?? `Thumbtack connect failed (${res.status})`
    if (res.status === 401) throw new Error(ADMIN_SESSION_REQUIRED)
    throw new Error(base)
  }
  return body
}

export async function getThumbtackOauthStatus(input: {
  url: string
  secret?: string
  landlordId: string
}): Promise<{ connected: boolean }> {
  const url = new URL(input.url.trim())
  url.searchParams.set('landlordId', input.landlordId.trim())
  const res = await fetchAdminEdgeFunction(url.toString(), {
    method: 'GET',
    headers: await adminSessionInvokeHeaders(true),
  })
  return (await parseAdminJson(res)) as { connected: boolean }
}

export async function startThumbtackOauth(input: {
  url: string
  secret?: string
  landlordId: string
  returnOrigin: string
  returnPath?: string
}): Promise<{ authorizeUrl: string }> {
  const res = await fetchAdminEdgeFunction(input.url.trim(), {
    method: 'POST',
    headers: await adminSessionInvokeHeaders(true),
    body: JSON.stringify({
      action: 'start',
      landlordId: input.landlordId.trim(),
      returnOrigin: input.returnOrigin,
      returnPath: input.returnPath,
    }),
  })
  return (await parseAdminJson(res)) as { authorizeUrl: string }
}

export async function exchangeThumbtackOauth(input: {
  url: string
  secret?: string
  code: string
  state: string
  returnOrigin: string
}): Promise<{ ok: true; returnPath: string }> {
  const res = await fetchAdminEdgeFunction(input.url.trim(), {
    method: 'POST',
    headers: await adminSessionInvokeHeaders(true),
    body: JSON.stringify({
      action: 'exchange',
      code: input.code,
      state: input.state,
      returnOrigin: input.returnOrigin,
    }),
  })
  return (await parseAdminJson(res)) as { ok: true; returnPath: string }
}
