/**
 * POST synthesize-property-insights (ADMIN_REASSIGN_SECRET via x-admin-reassign-secret).
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import {
  withCanonicalInsightActionLabels,
  type PortfolioInsightFinding,
  type SynthesizedInsightCard,
} from '@shared/portfolioIntelligence'

export type SynthesizePropertyInsightsOk = {
  cards: SynthesizedInsightCard[]
  mode: 'openai' | 'fallback'
}

export function resolveSynthesizePropertyInsightsUrl(): string | null {
  const explicit = import.meta.env.VITE_SYNTHESIZE_PROPERTY_INSIGHTS_URL?.trim()
  if (explicit) return explicit
  const base = import.meta.env.VITE_SUPABASE_URL?.trim()?.replace(/\/$/, '')
  if (base) return `${base}/functions/v1/synthesize-property-insights`
  return null
}

export async function postSynthesizePropertyInsights(input: {
  url: string
  secret: string
  findings: PortfolioInsightFinding[]
}): Promise<SynthesizePropertyInsightsOk> {
  const url = input.url.trim()
  const secret = input.secret.trim()
  if (!url || !secret) {
    throw new Error('Property insight synthesis: missing URL or secret')
  }

  const res = await fetchAdminEdgeFunction(url, {
    method: 'POST',
    headers: adminEdgeInvokeHeaders(secret),
    body: JSON.stringify({ findings: input.findings }),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(`Property insight synthesis: invalid JSON (${res.status})`)
  }
  if (!res.ok) {
    const err = body as { error?: string }
    throw new Error(err.error ?? `Property insight synthesis failed (${res.status})`)
  }
  return body as SynthesizePropertyInsightsOk
}

const CACHE_KEY_PREFIX = 'ulo.propertyInsightSynthesis.'

type CachedSynthesis = { fingerprint: string; cards: SynthesizedInsightCard[] }

/** Same findings (counts, labels, tickets) → same fingerprint. */
export function propertyInsightFindingsFingerprint(findings: PortfolioInsightFinding[]): string {
  const text = JSON.stringify(findings)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

export function readCachedPropertyInsightCards(
  landlordId: string,
  findings: PortfolioInsightFinding[],
): SynthesizedInsightCard[] | null {
  try {
    const raw = window.localStorage.getItem(`${CACHE_KEY_PREFIX}${landlordId}`)
    if (!raw) return null
    const cached = JSON.parse(raw) as CachedSynthesis
    if (cached.fingerprint !== propertyInsightFindingsFingerprint(findings)) return null
    return Array.isArray(cached.cards) ? withCanonicalInsightActionLabels(cached.cards) : null
  } catch {
    return null
  }
}

function writeCachedPropertyInsightCards(
  landlordId: string,
  fingerprint: string,
  cards: SynthesizedInsightCard[],
): void {
  try {
    window.localStorage.setItem(
      `${CACHE_KEY_PREFIX}${landlordId}`,
      JSON.stringify({ fingerprint, cards } satisfies CachedSynthesis),
    )
  } catch {
    // Storage full or blocked — next load just synthesizes again.
  }
}

const inFlight = new Map<string, Promise<SynthesizePropertyInsightsOk>>()

/**
 * Overview insight cards: OpenAI runs only when the findings change.
 * Reuses the saved cards for identical findings and shares one request across
 * concurrent mounts. Fallback (non-AI) results are not saved so the next load retries.
 */
export async function synthesizePropertyInsightsCached(input: {
  url: string
  secret: string
  landlordId: string
  findings: PortfolioInsightFinding[]
}): Promise<SynthesizePropertyInsightsOk> {
  const cached = readCachedPropertyInsightCards(input.landlordId, input.findings)
  if (cached) return { cards: cached, mode: 'openai' }

  const fingerprint = propertyInsightFindingsFingerprint(input.findings)
  const flightKey = `${input.landlordId}:${fingerprint}`
  const pending = inFlight.get(flightKey)
  if (pending) return pending

  const request = postSynthesizePropertyInsights(input)
    .then((result) => {
      const cards = withCanonicalInsightActionLabels(result.cards)
      if (result.mode === 'openai') {
        writeCachedPropertyInsightCards(input.landlordId, fingerprint, cards)
      }
      return { ...result, cards }
    })
    .finally(() => {
      inFlight.delete(flightKey)
    })
  inFlight.set(flightKey, request)
  return request
}
