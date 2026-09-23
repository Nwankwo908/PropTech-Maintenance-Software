/**
 * POST synthesize-property-insights (ADMIN_REASSIGN_SECRET via x-admin-reassign-secret).
 */

import {
  adminEdgeInvokeHeaders,
  fetchAdminEdgeFunction,
} from '@/api/adminReassignVendor'
import type {
  PortfolioInsightFinding,
  SynthesizedInsightCard,
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
