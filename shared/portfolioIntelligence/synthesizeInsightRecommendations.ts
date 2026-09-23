/**
 * Property Insights recommendation layer.
 * Aggregates stay deterministic; this module synthesizes grounded recommendations,
 * merges overlapping signals, ranks by urgency/confidence, and falls back to plain cards.
 */

import {
  INSIGHT_SYNTHESIS_LOW_CONFIDENCE,
  type InsightRecommendationActionType,
  type PortfolioInsightFinding,
  type PortfolioInsightTag,
  type PortfolioInsightTicketSummary,
  type SynthesizedInsightCard,
} from './types.ts'

export type InsightSynthesisModelItem = {
  sourceTags: PortfolioInsightTag[]
  /** Cards sharing a non-null mergeGroup are combined into one recommendation. */
  mergeGroup?: string | null
  recommendation: string
  urgency: number
  confidence: number
  actionType: InsightRecommendationActionType
  /** When true, drop this signal (nothing worth flagging). */
  omit?: boolean
}

export type InsightSynthesisModelResult = {
  recommendations: InsightSynthesisModelItem[]
}

export type ApplyInsightSynthesisOptions = {
  /** When true, treat as failed call and return plain aggregates only. */
  failed?: boolean
  lowConfidenceThreshold?: number
}

const ACTION_LABELS: Record<InsightRecommendationActionType, string | null> = {
  schedule_inspection: 'Schedule inspection',
  schedule_building_inspection: 'Schedule building inspection',
  schedule_unit_walkthrough: 'Schedule unit walkthrough',
  request_diagnostic: 'Request diagnostic',
  nudge_vendor: 'Nudge vendor',
  flag_for_review: 'Flag for review',
  none: null,
}

function clampScore(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function defaultActionForTag(
  tag: PortfolioInsightTag,
  score: number,
): InsightRecommendationActionType {
  if (tag === 'PREVENT FUTURE REPAIRS') return 'schedule_inspection'
  if (tag === 'RECURRING ISSUES' || tag === 'RISK') return 'request_diagnostic'
  if (tag === 'VENDOR RESPONSE' && score < 70) return 'nudge_vendor'
  return 'none'
}

function findingByTag(
  findings: PortfolioInsightFinding[],
): Map<PortfolioInsightTag, PortfolioInsightFinding> {
  const map = new Map<PortfolioInsightTag, PortfolioInsightFinding>()
  for (const finding of findings) map.set(finding.tag, finding)
  return map
}

function unionTicketMeta(
  cards: Array<Pick<SynthesizedInsightCard, 'ticketIds' | 'ticketSummaries'>>,
): { ticketIds: string[]; ticketSummaries: PortfolioInsightTicketSummary[] } {
  const ticketIds: string[] = []
  const ticketSummaries: PortfolioInsightTicketSummary[] = []
  const seen = new Set<string>()
  for (const card of cards) {
    for (const summary of card.ticketSummaries) {
      if (seen.has(summary.id)) continue
      seen.add(summary.id)
      ticketIds.push(summary.id)
      ticketSummaries.push(summary)
    }
    for (const id of card.ticketIds) {
      if (seen.has(id)) continue
      seen.add(id)
      ticketIds.push(id)
      ticketSummaries.push({ id, description: 'Maintenance request' })
    }
  }
  return { ticketIds, ticketSummaries }
}

/** Plain aggregate cards — current Overview behavior when synthesis is unavailable. */
export function buildFallbackInsightRecommendations(
  findings: PortfolioInsightFinding[],
): SynthesizedInsightCard[] {
  return findings.map((finding, index) => {
    const actionType = defaultActionForTag(finding.tag, finding.score)
    const ticketIds = finding.ticketIds ?? []
    const ticketSummaries = finding.ticketSummaries ?? []
    return {
      id: `fallback-${finding.tag}-${index}`,
      sourceTags: [finding.tag],
      tag: finding.tag,
      text: finding.text,
      aggregateText: finding.text,
      urgency: clampScore(finding.score, 50),
      confidence: 70,
      actionType,
      actionLabel: ACTION_LABELS[actionType],
      ticketIds,
      ticketSummaries,
      unitId: finding.unitId ?? null,
      unitLabel: finding.unitLabel ?? null,
      categoryLabel: finding.categoryLabel ?? null,
      building: finding.building ?? null,
      requestCount: finding.requestCount ?? null,
      responseRate: finding.responseRate ?? null,
      assignedCount: finding.assignedCount ?? null,
      mode: 'fallback' as const,
    }
  })
}

function ticketSetsOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const set = new Set(a)
  return b.some((id) => set.has(id))
}

/**
 * Merge cards that share underlying ticket IDs (or an explicit merge group from synthesis).
 * Keeps the higher urgency/confidence recommendation text.
 */
export function mergeInsightRecommendations(
  cards: SynthesizedInsightCard[],
): SynthesizedInsightCard[] {
  if (cards.length <= 1) return cards

  const parent = cards.map((_, i) => i)
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]!)
    return parent[i]!
  }
  const unite = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const left = cards[i]!
      const right = cards[j]!
      const sameGroup =
        left.id.startsWith('merge:') &&
        right.id.startsWith('merge:') &&
        left.id === right.id
      if (sameGroup || ticketSetsOverlap(left.ticketIds, right.ticketIds)) {
        unite(i, j)
      }
    }
  }

  const groups = new Map<number, SynthesizedInsightCard[]>()
  for (let i = 0; i < cards.length; i++) {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(cards[i]!)
    groups.set(root, list)
  }

  const merged: SynthesizedInsightCard[] = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      merged.push(group[0]!)
      continue
    }
    const primary = [...group].sort((a, b) => {
      const scoreA = a.urgency * (a.confidence / 100)
      const scoreB = b.urgency * (b.confidence / 100)
      return scoreB - scoreA
    })[0]!
    const meta = unionTicketMeta(group)
    const sourceTags = [...new Set(group.flatMap((c) => c.sourceTags))]
    const actionType =
      group.find((c) => c.actionType !== 'none')?.actionType ?? primary.actionType
    merged.push({
      ...primary,
      id: `merged-${sourceTags.join('+')}`,
      sourceTags,
      ticketIds: meta.ticketIds,
      ticketSummaries: meta.ticketSummaries,
      actionType,
      actionLabel: ACTION_LABELS[actionType],
      unitId: group.find((c) => c.unitId)?.unitId ?? primary.unitId,
      unitLabel: group.find((c) => c.unitLabel)?.unitLabel ?? primary.unitLabel,
      categoryLabel: group.find((c) => c.categoryLabel)?.categoryLabel ?? primary.categoryLabel,
      building: group.find((c) => c.building)?.building ?? primary.building,
      requestCount:
        Math.max(...group.map((c) => c.requestCount ?? 0), primary.requestCount ?? 0) ||
        primary.requestCount,
      aggregateText: group.map((c) => c.aggregateText).join(' '),
      mode: group.every((c) => c.mode === 'fallback') ? 'fallback' : primary.mode,
    })
  }
  return merged
}

/** Rank by urgency × confidence (highest first). */
export function rankInsightRecommendations(
  cards: SynthesizedInsightCard[],
): SynthesizedInsightCard[] {
  return [...cards].sort((a, b) => {
    const scoreA = a.urgency * (a.confidence / 100)
    const scoreB = b.urgency * (b.confidence / 100)
    if (scoreB !== scoreA) return scoreB - scoreA
    return a.tag.localeCompare(b.tag)
  })
}

function cardFromFinding(
  finding: PortfolioInsightFinding,
  overlay: {
    text: string
    urgency: number
    confidence: number
    actionType: InsightRecommendationActionType
    mode: 'openai' | 'fallback'
    sourceTags?: PortfolioInsightTag[]
    mergeId?: string
  },
): SynthesizedInsightCard {
  return {
    id: overlay.mergeId ?? `${overlay.mode}-${finding.tag}`,
    sourceTags: overlay.sourceTags ?? [finding.tag],
    tag: finding.tag,
    text: overlay.text,
    aggregateText: finding.text,
    urgency: clampScore(overlay.urgency, finding.score),
    confidence: clampScore(overlay.confidence, 70),
    actionType: overlay.actionType,
    actionLabel: ACTION_LABELS[overlay.actionType],
    ticketIds: finding.ticketIds ?? [],
    ticketSummaries: finding.ticketSummaries ?? [],
    unitId: finding.unitId ?? null,
    unitLabel: finding.unitLabel ?? null,
    categoryLabel: finding.categoryLabel ?? null,
    building: finding.building ?? null,
    requestCount: finding.requestCount ?? null,
    responseRate: finding.responseRate ?? null,
    assignedCount: finding.assignedCount ?? null,
    mode: overlay.mode,
  }
}

const VALID_ACTIONS = new Set<InsightRecommendationActionType>([
  'schedule_inspection',
  'schedule_building_inspection',
  'schedule_unit_walkthrough',
  'request_diagnostic',
  'nudge_vendor',
  'flag_for_review',
  'none',
])

const VALID_TAGS = new Set<PortfolioInsightTag>([
  'RECURRING ISSUES',
  'RISK',
  'PREVENT FUTURE REPAIRS',
  'VENDOR RESPONSE',
])

export function normalizeInsightSynthesisModelResult(
  raw: unknown,
): InsightSynthesisModelResult | null {
  if (!raw || typeof raw !== 'object') return null
  const list = (raw as { recommendations?: unknown }).recommendations
  if (!Array.isArray(list) || list.length === 0) return null

  const recommendations: InsightSynthesisModelItem[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const tagsRaw = Array.isArray(row.sourceTags) ? row.sourceTags : []
    const sourceTags = tagsRaw
      .map((t) => String(t ?? '').trim().toUpperCase())
      .filter((t): t is PortfolioInsightTag => VALID_TAGS.has(t as PortfolioInsightTag))
    if (sourceTags.length === 0) continue
    const recommendation = String(row.recommendation ?? '').trim()
    if (!recommendation) continue
    const actionRaw = String(row.actionType ?? 'none')
      .trim()
      .toLowerCase() as InsightRecommendationActionType
    const actionType = VALID_ACTIONS.has(actionRaw) ? actionRaw : 'none'
    recommendations.push({
      sourceTags,
      mergeGroup:
        typeof row.mergeGroup === 'string' && row.mergeGroup.trim()
          ? row.mergeGroup.trim()
          : null,
      recommendation: recommendation.slice(0, 320),
      urgency: clampScore(row.urgency, 50),
      confidence: clampScore(row.confidence, 50),
      actionType,
      omit: row.omit === true,
    })
  }
  return recommendations.length > 0 ? { recommendations } : null
}

/**
 * Apply model synthesis (or fall back to plain aggregates).
 * - Call failure → plain cards
 * - Low confidence → keep card but use plain aggregate text
 * - omit:true → drop card
 * - Same ticket IDs / mergeGroup → one card
 * - Rank by urgency × confidence
 */
export function applyInsightSynthesis(
  findings: PortfolioInsightFinding[],
  model: InsightSynthesisModelResult | null,
  options: ApplyInsightSynthesisOptions = {},
): SynthesizedInsightCard[] {
  if (options.failed || !model || findings.length === 0) {
    return rankInsightRecommendations(buildFallbackInsightRecommendations(findings))
  }

  const threshold = options.lowConfidenceThreshold ?? INSIGHT_SYNTHESIS_LOW_CONFIDENCE
  const byTag = findingByTag(findings)
  const cards: SynthesizedInsightCard[] = []

  for (const item of model.recommendations) {
    if (item.omit) continue
    const primaryTag = item.sourceTags.find((tag) => byTag.has(tag)) ?? item.sourceTags[0]
    if (!primaryTag) continue
    const finding = byTag.get(primaryTag)
    if (!finding) continue

    const lowConfidence = item.confidence < threshold
    const relatedFindings = item.sourceTags
      .map((tag) => byTag.get(tag))
      .filter((f): f is PortfolioInsightFinding => Boolean(f))
    const meta = unionTicketMeta(
      relatedFindings.map((f) => ({
        ticketIds: f.ticketIds ?? [],
        ticketSummaries: f.ticketSummaries ?? [],
      })),
    )

    const base = cardFromFinding(finding, {
      text: lowConfidence ? finding.text : item.recommendation,
      urgency: item.urgency,
      confidence: lowConfidence ? 70 : item.confidence,
      actionType: item.actionType,
      mode: lowConfidence ? 'fallback' : 'openai',
      sourceTags: item.sourceTags.filter((tag) => byTag.has(tag)),
      mergeId: item.mergeGroup ? `merge:${item.mergeGroup}` : undefined,
    })
    cards.push({
      ...base,
      ticketIds: meta.ticketIds.length > 0 ? meta.ticketIds : base.ticketIds,
      ticketSummaries:
        meta.ticketSummaries.length > 0 ? meta.ticketSummaries : base.ticketSummaries,
    })
  }

  if (cards.length === 0) {
    return rankInsightRecommendations(buildFallbackInsightRecommendations(findings))
  }

  return rankInsightRecommendations(mergeInsightRecommendations(cards))
}

/** Payload for the synthesis edge — findings + ticket grounding. */
export function buildInsightSynthesisPromptPayload(
  findings: PortfolioInsightFinding[],
): unknown {
  return {
    signals: findings.map((f) => ({
      tag: f.tag,
      aggregateText: f.text,
      score: f.score,
      building: f.building ?? null,
      unitLabel: f.unitLabel ?? null,
      categoryLabel: f.categoryLabel ?? null,
      requestCount: f.requestCount ?? null,
      responseRate: f.responseRate ?? null,
      assignedCount: f.assignedCount ?? null,
      tickets: (f.ticketSummaries ?? []).map((t) => ({
        id: t.id,
        description: t.description,
      })),
    })),
  }
}

export function insightSynthesisSystemPrompt(): string {
  return (
    'You are Ulo, an AI property operations assistant. ' +
    'Given deterministic Property Insights aggregates and the underlying work-order descriptions, ' +
    'return grounded recommendations. Do not invent tickets or stats. ' +
    'If two signals share the same underlying tickets, set the same mergeGroup string. ' +
    'Omit a signal only when nothing is worth flagging (omit:true). ' +
    'actionType must be one of: schedule_inspection, schedule_building_inspection, ' +
    'schedule_unit_walkthrough, request_diagnostic, nudge_vendor, flag_for_review, none. ' +
    'Return ONLY JSON: {"recommendations":[{"sourceTags":["RECURRING ISSUES"],"mergeGroup":null,' +
    '"recommendation":"...","urgency":0-100,"confidence":0-100,"actionType":"none","omit":false}]}'
  )
}
