import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { formatAdminEdgeUnauthorizedError } from '@/lib/adminEdgeAuth'

export function resolveHomeDataStreetViewUrl(): string | null {
  const explicit = import.meta.env.VITE_HOME_DATA_STREET_VIEW_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/home-data-street-view`
  return null
}

export async function postHomeDataStreetView(input: {
  url: string
  secret: string
  address: string
  lat?: number | null
  lng?: number | null
}): Promise<Blob> {
  const res = await fetchAdminEdgeFunction(input.url.trim(), {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(input.secret.trim()),
    body: JSON.stringify({
      address: input.address.trim(),
      lat: input.lat ?? undefined,
      lng: input.lng ?? undefined,
    }),
  })
  const contentType = res.headers.get('content-type') ?? ''
  if (!res.ok || !contentType.includes('image')) {
    let message = `Street View failed (${res.status})`
    if (contentType.includes('json')) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      if (body?.error) message = body.error
    }
    if (res.status === 401) throw new Error(formatAdminEdgeUnauthorizedError(message))
    throw new Error(message)
  }
  return res.blob()
}
