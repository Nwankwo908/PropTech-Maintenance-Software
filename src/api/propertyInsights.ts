import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import { formatAdminEdgeUnauthorizedError } from '@/lib/adminEdgeAuth'

export type PropertyChartPoint = { date: string; value: number }

export type PropertyInsightsOk = {
  photos: string[]
  yearBuilt: number | null
  homeValue: number | null
  rentEstimate: number | null
  rentLow: number | null
  rentHigh: number | null
  latitude: number | null
  longitude: number | null
  valueHistory: PropertyChartPoint[]
  rentHistory: PropertyChartPoint[]
  valueChangeLabel: string | null
  rentChangeLabel: string | null
  lookupError: string | null
  configured: boolean
}

export function resolvePropertyInsightsUrl(): string | null {
  const explicit = import.meta.env.VITE_PROPERTY_INSIGHTS_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/property-insights`
  return null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.replace(/[$,]/g, ''))
    if (Number.isFinite(n)) return n
  }
  return null
}

function series(raw: unknown): PropertyChartPoint[] {
  if (!Array.isArray(raw)) return []
  const out: PropertyChartPoint[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const date = (row as { date?: unknown }).date
    const value = (row as { value?: unknown }).value
    if (typeof date === 'string' && typeof value === 'number' && Number.isFinite(value)) {
      out.push({ date, value })
    }
  }
  return out
}

export async function postPropertyInsights(input: {
  url: string
  secret: string
  address: string
}): Promise<PropertyInsightsOk> {
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
    throw new Error(`Property data: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    const base = err.error ?? `Property data failed (${res.status})`
    if (res.status === 401 && String(err.error ?? '').toLowerCase() === 'unauthorized') {
      throw new Error(formatAdminEdgeUnauthorizedError(base))
    }
    throw new Error(base)
  }
  const parsed = body as Partial<PropertyInsightsOk>
  return {
    photos: Array.isArray(parsed.photos)
      ? parsed.photos.filter((u): u is string => typeof u === 'string' && u.startsWith('https://'))
      : [],
    yearBuilt: num(parsed.yearBuilt),
    homeValue: num(parsed.homeValue),
    rentEstimate: num(parsed.rentEstimate),
    rentLow: num(parsed.rentLow),
    rentHigh: num(parsed.rentHigh),
    latitude: num(parsed.latitude),
    longitude: num(parsed.longitude),
    valueHistory: series(parsed.valueHistory),
    rentHistory: series(parsed.rentHistory),
    valueChangeLabel: typeof parsed.valueChangeLabel === 'string' ? parsed.valueChangeLabel : null,
    rentChangeLabel: typeof parsed.rentChangeLabel === 'string' ? parsed.rentChangeLabel : null,
    lookupError: typeof parsed.lookupError === 'string' && parsed.lookupError.trim() ? parsed.lookupError : null,
    configured: parsed.configured !== false,
  }
}
