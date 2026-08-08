import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { recordActivityLog } from '../graph/recordActivityLog.ts'
import {
  PORTFOLIO_RECOMMENDATION_EVENT,
  type PortfolioRecommendation,
} from './index.ts'
import { evaluatePortfolioIntelligence } from './loadSnapshot.ts'

const DEDUPE_LOOKBACK_DAYS = 7

export type RunProactiveRecommendationsResult = {
  ok: true
  landlordId: string
  evaluated: number
  surfaced: number
  skipped: number
  recommendations: Array<{ deduplicationKey: string; title: string }>
}

async function loadRecentDedupeKeys(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<Map<string, { signature: string; createdAt: string }>> {
  const since = new Date(Date.now() - DEDUPE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('operations_graph_events')
    .select('created_at, metadata')
    .eq('landlord_id', landlordId)
    .eq('event_type', PORTFOLIO_RECOMMENDATION_EVENT)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100)

  const map = new Map<string, { signature: string; createdAt: string }>()
  for (const row of data ?? []) {
    const meta =
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {}
    const key = typeof meta.deduplication_key === 'string' ? meta.deduplication_key : ''
    if (!key || map.has(key)) continue
    map.set(key, {
      signature: typeof meta.signature === 'string' ? meta.signature : '',
      createdAt: String(row.created_at ?? ''),
    })
  }
  return map
}

function shouldSurfaceRecommendation(
  rec: PortfolioRecommendation,
  recent: Map<string, { signature: string; createdAt: string }>,
): boolean {
  const prior = recent.get(rec.deduplicationKey)
  if (!prior) return true
  if (prior.signature && prior.signature !== rec.signature) return true
  return false
}

export async function runProactiveRecommendations(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<RunProactiveRecommendationsResult> {
  const id = landlordId.trim()
  const { recommendations } = await evaluatePortfolioIntelligence(supabase, id)
  const recent = await loadRecentDedupeKeys(supabase, id)

  let surfaced = 0
  let skipped = 0
  const surfacedRows: Array<{ deduplicationKey: string; title: string }> = []

  for (const rec of recommendations) {
    if (!shouldSurfaceRecommendation(rec, recent)) {
      skipped += 1
      continue
    }

    await recordActivityLog(supabase, {
      landlordId: id,
      eventType: PORTFOLIO_RECOMMENDATION_EVENT,
      source: 'automation',
      actorType: 'system',
      metadata: {
        message: rec.message,
        title: rec.title,
        action_label: rec.actionLabel,
        recommendation_kind: rec.kind,
        deduplication_key: rec.deduplicationKey,
        signature: rec.signature,
        confidence: rec.confidence,
        severity: rec.severity,
        building: rec.building ?? undefined,
        unit_label: rec.unitLabel ?? undefined,
        ...rec.metadata,
      },
    })

    surfaced += 1
    surfacedRows.push({ deduplicationKey: rec.deduplicationKey, title: rec.title })
    recent.set(rec.deduplicationKey, {
      signature: rec.signature,
      createdAt: new Date().toISOString(),
    })
  }

  console.info('[portfolioIntelligence] proactive recommendations', {
    landlordId: id,
    evaluated: recommendations.length,
    surfaced,
    skipped,
  })

  return {
    ok: true,
    landlordId: id,
    evaluated: recommendations.length,
    surfaced,
    skipped,
    recommendations: surfacedRows,
  }
}
