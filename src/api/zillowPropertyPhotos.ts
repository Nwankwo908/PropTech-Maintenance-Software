import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { formatAdminEdgeUnauthorizedError } from '@/lib/adminEdgeAuth'

export type ZillowPropertyPhotosOk = {
  photos: string[]
  zpid: string | null
  configured: boolean
  rateLimited: boolean
}

export function resolveZillowPropertyPhotosUrl(): string | null {
  const explicit = import.meta.env.VITE_ZILLOW_PROPERTY_PHOTOS_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/zillow-property-photos`
  return null
}

export async function postZillowPropertyPhotos(input: {
  url: string
  secret: string
  address: string
}): Promise<ZillowPropertyPhotosOk> {
  const res = await fetchAdminEdgeFunction(input.url.trim(), {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(input.secret.trim()),
    body: JSON.stringify({ address: input.address.trim() }),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Zillow photos: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    const base = err.error ?? `Zillow photos failed (${res.status})`
    if (res.status === 401 && String(err.error ?? '').toLowerCase() === 'unauthorized') {
      throw new Error(formatAdminEdgeUnauthorizedError(base))
    }
    throw new Error(base)
  }
  const parsed = body as Partial<ZillowPropertyPhotosOk>
  return {
    photos: Array.isArray(parsed.photos)
      ? parsed.photos.filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
      : [],
    zpid: typeof parsed.zpid === 'string' ? parsed.zpid : parsed.zpid != null ? String(parsed.zpid) : null,
    configured: parsed.configured !== false,
    rateLimited: parsed.rateLimited === true,
  }
}
