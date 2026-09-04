/**
 * Structured evidence organizer — one place that combines tool/DB facts
 * before OpenAI writes the answer.
 *
 * Combines results, dedupes, ranks strongest sources, attaches dates +
 * jurisdiction, marks stale rows, and splits internal vs legal vs market.
 * Do not flatten into generic bullets before this packet exists.
 */

import type { AskUloCapability } from "../routing/capability.ts"
import type { AskUloQuestionSubject } from "../routing/detectSubject.ts"
import type { DomainToolId } from "../tools/_shared/registry.ts"
import type { EvidenceItem } from "../tools/_shared/toolResult.ts"
import type { AskUloCitation } from "./searchInternalData.ts"
import { LEGAL_STALENESS_DAYS, isStale } from "./sourceFreshness.ts"

export type AskUloEvidenceScope = {
  organizationId: string
  propertyId?: string
  unitId?: string
  dateRange?: { from: string; to: string }
}

export type AskUloToolExecution = {
  tool: DomainToolId | string
  arguments: Record<string, unknown>
  resultCount: number
  success: boolean
  error?: string
}

export type WorkOrderEvidence = {
  id: string
  displayId?: string | null
  propertyName?: string | null
  unitLabel?: string | null
  title?: string | null
  description?: string | null
  category?: string | null
  priority?: string | null
  urgency?: string | null
  status?: string | null
  workflowStage?: string | null
  slaState?: string | null
  vendorName?: string | null
  estimate?: number | null
  laborEstimate?: number | null
  approvalRequired?: boolean | null
  completionDate?: string | null
  daysOpen?: number | null
}

export type WorkflowEvidence = {
  id: string
  templateId?: string | null
  status?: string | null
  stage?: string | null
  escalationReason?: string | null
  dueAt?: string | null
  completedAt?: string | null
  maintenanceRequestId?: string | null
  vendorId?: string | null
}

export type PropertyInsightEvidence = {
  tag: string
  text: string
  requestCount?: number | null
  building?: string | null
  unitLabel?: string | null
  categoryLabel?: string | null
}

export type AwaitingDecisionEvidence = {
  kind: string
  label: string
  building?: string | null
  unitLabel?: string | null
  category?: string | null
  reason: string
  priority?: string | null
  ageHours?: number | null
}

export type VendorEvidence = {
  vendorId: string
  name: string
  metric?: string | null
  score?: number | null
  category?: string | null
  completedJobs?: number | null
  acceptedJobs?: number | null
  activeJobs?: number | null
}

export type ResidentEvidenceRow = {
  residentId: string
  name: string
  unitLabel?: string | null
  propertyName?: string | null
  balanceDue?: number | null
  daysOverdue?: number | null
  leaseEndDate?: string | null
  workflowRunId?: string | null
}

export type PropertyEvidence = {
  propertyId?: string | null
  name: string
  metric?: string | null
  score?: number | null
  openWorkOrders?: number | null
}

export type OperationGraphEvidence = {
  eventId?: string
  eventType: string
  occurredAt?: string | null
  summary?: string | null
  maintenanceRequestId?: string | null
  vendorId?: string | null
  residentId?: string | null
}

export type AskUloEvidenceBundle = {
  subject: AskUloQuestionSubject
  capability: AskUloCapability
  scope: AskUloEvidenceScope
  toolExecutions: AskUloToolExecution[]
  findings: {
    workOrders?: WorkOrderEvidence[]
    workflows?: WorkflowEvidence[]
    insights?: PropertyInsightEvidence[]
    decisions?: AwaitingDecisionEvidence[]
    vendors?: VendorEvidence[]
    residents?: ResidentEvidenceRow[]
    properties?: PropertyEvidence[]
    events?: OperationGraphEvidence[]
  }
  /** True when at least one finding array has records. */
  hasEvidence: boolean
}

/** Channel for organized facts fed to synthesis. */
export type EvidenceChannel = "internal" | "legal" | "market"

export type OrganizedEvidenceFact = {
  id: string
  channel: EvidenceChannel
  source: string
  label: string
  excerpt?: string
  url?: string | null
  /** ISO date (YYYY-MM-DD) when known. */
  asOf?: string | null
  stale: boolean
  /** Higher = stronger / more relevant for this turn. */
  strength: number
  entityIds?: Record<string, string | null>
}

export type EvidenceJurisdiction = {
  stateCode?: string | null
  cityLabel?: string | null
  citySlug?: string | null
  countyLabel?: string | null
  countryCode?: string | null
}

/**
 * Canonical pre-synthesis packet — internal ops vs legal vs market vs gaps.
 */
export type AskUloEvidencePacket = {
  internal: OrganizedEvidenceFact[]
  legal: OrganizedEvidenceFact[]
  market: OrganizedEvidenceFact[]
  missing: string[]
  meta: {
    asOf: string
    jurisdiction: EvidenceJurisdiction
    subject: AskUloQuestionSubject
    capability: AskUloCapability
    hasEvidence: boolean
    staleCount: number
    toolExecutions: AskUloToolExecution[]
  }
}

const OPS_STALENESS_DAYS = 90
const MARKET_STALENESS_DAYS = 60

function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function extractIsoDate(v: string | null | undefined): string | null {
  if (!v) return null
  const m = /(\d{4}-\d{2}-\d{2})/.exec(v)
  return m?.[1] ?? null
}

function dedupeKey(fact: OrganizedEvidenceFact): string {
  return `${fact.channel}|${fact.id}|${fact.source}|${fact.label}`.toLowerCase()
}

function dedupeFacts(facts: OrganizedEvidenceFact[]): OrganizedEvidenceFact[] {
  const seen = new Map<string, OrganizedEvidenceFact>()
  for (const f of facts) {
    const key = dedupeKey(f)
    const prev = seen.get(key)
    if (!prev || f.strength > prev.strength) seen.set(key, f)
  }
  return Array.from(seen.values())
}

function rankFacts(facts: OrganizedEvidenceFact[]): OrganizedEvidenceFact[] {
  return [...facts].sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength
    if (a.stale !== b.stale) return a.stale ? 1 : -1
    const aDate = a.asOf ?? ""
    const bDate = b.asOf ?? ""
    return bDate.localeCompare(aDate)
  })
}

function citationStrength(c: AskUloCitation): number {
  if (c.sourceTier === "primary_official") return 100
  if (c.sourceTier === "agency_guidance") return 80
  if (c.tool === "structured") return 70
  if (c.tool === "legal_rag") return 60
  if (c.tool === "market_data") return 55
  if (c.tool === "ops_graph") return 50
  return 40
}

function fromCitation(
  c: AskUloCitation,
  channel: EvidenceChannel,
  index: number,
  now: Date,
  staleDays: number,
): OrganizedEvidenceFact {
  const asOf = extractIsoDate(c.lastUpdatedOn ?? c.effectiveOn ?? null)
  return {
    id: `${channel}-cite-${index}-${c.title.slice(0, 40)}`,
    channel,
    source: c.citation ?? c.tool,
    label: c.title,
    excerpt: c.excerpt,
    url: c.url ?? null,
    asOf,
    stale: isStale(asOf, staleDays, now),
    strength: citationStrength(c) + (asOf && !isStale(asOf, staleDays, now) ? 5 : 0),
  }
}

function fromBullet(
  bullet: string,
  channel: EvidenceChannel,
  source: string,
  index: number,
  strength: number,
  now: Date,
): OrganizedEvidenceFact {
  const asOf = extractIsoDate(bullet)
  return {
    id: `${channel}-bullet-${index}`,
    channel,
    source,
    label: bullet.slice(0, 120),
    excerpt: bullet,
    asOf,
    stale: asOf ? isStale(asOf, channel === "legal" ? LEGAL_STALENESS_DAYS : MARKET_STALENESS_DAYS, now) : false,
    strength,
  }
}

function fromEvidenceItem(
  item: EvidenceItem,
  channel: EvidenceChannel,
  strength: number,
  now: Date,
  asOf?: string | null,
): OrganizedEvidenceFact {
  const date = extractIsoDate(asOf ?? null)
  return {
    id: item.id,
    channel,
    source: item.source,
    label: item.label,
    excerpt: item.excerpt,
    url: item.url ?? null,
    asOf: date,
    stale: date ? isStale(date, OPS_STALENESS_DAYS, now) : false,
    strength,
    entityIds: item.entityIds,
  }
}

function factsFromBundle(
  bundle: AskUloEvidenceBundle,
  now: Date,
): OrganizedEvidenceFact[] {
  const out: OrganizedEvidenceFact[] = []
  const f = bundle.findings

  for (const w of f.workOrders ?? []) {
    const priorityBoost =
      (w.priority ?? "").toLowerCase().includes("emergency") ||
        (w.priority ?? "").toLowerCase().includes("critical")
        ? 20
        : (w.priority ?? "").toLowerCase().includes("high")
        ? 12
        : 0
    const days = typeof w.daysOpen === "number" ? w.daysOpen : 0
    out.push({
      id: w.id,
      channel: "internal",
      source: "maintenance_requests+workflow_runs",
      label: w.title || w.category || w.id,
      excerpt: [
        w.propertyName,
        w.unitLabel ? `Unit ${w.unitLabel}` : null,
        w.category,
        w.status,
        days > 0 ? `${days}d open` : null,
        w.vendorName ? `vendor ${w.vendorName}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      asOf: extractIsoDate(w.completionDate ?? null) ?? todayIso(now),
      stale: days > OPS_STALENESS_DAYS,
      strength: 70 + priorityBoost + Math.min(days, 30),
      entityIds: {
        maintenance_request_id: w.displayId ?? w.id,
        property_name: w.propertyName ?? null,
        unit: w.unitLabel ?? null,
      },
    })
  }

  for (const r of f.residents ?? []) {
    const balance = typeof r.balanceDue === "number" ? r.balanceDue : 0
    const overdue = typeof r.daysOverdue === "number" ? r.daysOverdue : 0
    out.push({
      id: r.residentId,
      channel: "internal",
      source: "users.balance_due+rent_collection",
      label: r.name,
      excerpt: [
        r.propertyName,
        r.unitLabel ? `Unit ${r.unitLabel}` : null,
        balance > 0 ? `$${Math.round(balance)} due` : null,
        overdue > 0 ? `${overdue}d overdue` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      asOf: extractIsoDate(r.leaseEndDate ?? null) ?? todayIso(now),
      stale: false,
      strength: 75 + Math.min(Math.round(balance / 100), 40) + Math.min(overdue, 20),
      entityIds: {
        resident_id: r.residentId,
        workflow_run_id: r.workflowRunId ?? null,
        property_name: r.propertyName ?? null,
        unit: r.unitLabel ?? null,
      },
    })
  }

  for (const v of f.vendors ?? []) {
    out.push({
      id: v.vendorId,
      channel: "internal",
      source: `vendors.${v.metric ?? "rank"}`,
      label: v.name,
      excerpt: [
        v.category,
        v.metric,
        typeof v.score === "number" ? `score ${v.score}` : null,
        typeof v.activeJobs === "number" ? `${v.activeJobs} active` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      asOf: todayIso(now),
      stale: false,
      strength: 65 + (typeof v.score === "number" ? Math.min(v.score, 30) : 0),
      entityIds: { vendor_id: v.vendorId },
    })
  }

  for (const d of f.decisions ?? []) {
    const age = typeof d.ageHours === "number" ? d.ageHours : 0
    out.push({
      id: `decision-${d.kind}-${d.label}`,
      channel: "internal",
      source: "awaiting_decisions",
      label: d.label,
      excerpt: [d.building, d.unitLabel, d.category, d.reason, d.priority]
        .filter(Boolean)
        .join(" · "),
      asOf: todayIso(now),
      stale: age > OPS_STALENESS_DAYS * 24,
      strength: 85 + Math.min(Math.floor(age / 24), 20),
    })
  }

  for (const i of f.insights ?? []) {
    out.push({
      id: `insight-${i.tag}-${i.text.slice(0, 40)}`,
      channel: "internal",
      source: "property_insights",
      label: i.tag,
      excerpt: i.text,
      asOf: todayIso(now),
      stale: false,
      strength: 60 + (typeof i.requestCount === "number" ? Math.min(i.requestCount, 20) : 0),
    })
  }

  for (const p of f.properties ?? []) {
    out.push({
      id: p.propertyId ?? p.name,
      channel: "internal",
      source: "property_ranking",
      label: p.name,
      excerpt: [
        p.metric,
        typeof p.score === "number" ? `score ${p.score}` : null,
        typeof p.openWorkOrders === "number" ? `${p.openWorkOrders} open` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      asOf: todayIso(now),
      stale: false,
      strength: 55 + (typeof p.score === "number" ? Math.min(p.score, 25) : 0),
      entityIds: { property_id: p.propertyId ?? null },
    })
  }

  for (const e of f.events ?? []) {
    const asOf = extractIsoDate(e.occurredAt ?? null)
    out.push({
      id: e.eventId ?? `${e.eventType}-${e.occurredAt ?? "na"}`,
      channel: "internal",
      source: "operations_graph_events",
      label: e.eventType,
      excerpt: e.summary ?? undefined,
      asOf,
      stale: isStale(asOf, OPS_STALENESS_DAYS, now),
      strength: 45 + (asOf && !isStale(asOf, OPS_STALENESS_DAYS, now) ? 10 : 0),
      entityIds: {
        maintenance_request_id: e.maintenanceRequestId ?? null,
        vendor_id: e.vendorId ?? null,
        resident_id: e.residentId ?? null,
      },
    })
  }

  for (const w of f.workflows ?? []) {
    out.push({
      id: w.id,
      channel: "internal",
      source: "workflow_runs",
      label: w.templateId ?? w.id,
      excerpt: [w.status, w.stage, w.escalationReason].filter(Boolean).join(" · "),
      asOf: extractIsoDate(w.dueAt ?? w.completedAt ?? null) ?? todayIso(now),
      stale: false,
      strength: 50,
      entityIds: {
        maintenance_request_id: w.maintenanceRequestId ?? null,
        vendor_id: w.vendorId ?? null,
      },
    })
  }

  return out
}

export type BuildOrganizedEvidenceInput = {
  bundle: AskUloEvidenceBundle
  jurisdiction?: EvidenceJurisdiction | null
  legal?: {
    bullets?: string[]
    citations?: AskUloCitation[]
  } | null
  market?: {
    bullets?: string[]
    citations?: AskUloCitation[]
    provider?: string | null
  } | null
  structured?: {
    bullets?: string[]
    citations?: AskUloCitation[]
  } | null
  ops?: {
    bullets?: string[]
    citations?: AskUloCitation[]
  } | null
  /** Extra ToolResult.evidence rows (e.g. searchLateRent). */
  toolEvidence?: Array<{ channel?: EvidenceChannel; items: EvidenceItem[]; asOf?: string | null }>
  missing?: string[]
  now?: Date
}

/**
 * Combine tool/DB results into the canonical evidence packet for synthesis.
 */
export function buildOrganizedEvidencePacket(
  input: BuildOrganizedEvidenceInput,
): AskUloEvidencePacket {
  const now = input.now ?? new Date()
  const asOf = todayIso(now)
  const jurisdiction: EvidenceJurisdiction = {
    stateCode: input.jurisdiction?.stateCode ?? null,
    cityLabel: input.jurisdiction?.cityLabel ?? null,
    citySlug: input.jurisdiction?.citySlug ?? null,
    countyLabel: input.jurisdiction?.countyLabel ?? null,
    countryCode: input.jurisdiction?.countryCode ?? null,
  }

  let internal = factsFromBundle(input.bundle, now)
  let legal: OrganizedEvidenceFact[] = []
  let market: OrganizedEvidenceFact[] = []

  if (input.ops?.citations?.length) {
    internal.push(
      ...input.ops.citations.map((c, i) =>
        fromCitation(c, "internal", i, now, OPS_STALENESS_DAYS)
      ),
    )
  } else if (input.ops?.bullets?.length) {
    internal.push(
      ...input.ops.bullets.slice(0, 12).map((b, i) =>
        fromBullet(b, "internal", "ops_graph", i, 48, now)
      ),
    )
  }

  if (input.legal?.citations?.length) {
    legal = input.legal.citations.map((c, i) =>
      fromCitation(c, "legal", i, now, LEGAL_STALENESS_DAYS)
    )
  }
  if (input.legal?.bullets?.length) {
    legal.push(
      ...input.legal.bullets.slice(0, 12).map((b, i) =>
        fromBullet(b, "legal", "legal_rag", i, 55, now)
      ),
    )
  }
  if (input.structured?.citations?.length) {
    legal.push(
      ...input.structured.citations.map((c, i) =>
        fromCitation(c, "legal", 100 + i, now, LEGAL_STALENESS_DAYS)
      ),
    )
  } else if (input.structured?.bullets?.length) {
    legal.push(
      ...input.structured.bullets.slice(0, 8).map((b, i) =>
        fromBullet(b, "legal", "structured_compliance", i, 58, now)
      ),
    )
  }

  const marketBoost =
    input.market?.provider === "rentcast"
      ? 15
      : input.market?.provider === "zillow_rapidapi"
      ? 10
      : 0
  if (input.market?.citations?.length) {
    market = input.market.citations.map((c, i) => {
      const fact = fromCitation(c, "market", i, now, MARKET_STALENESS_DAYS)
      return { ...fact, strength: fact.strength + marketBoost }
    })
  }
  if (input.market?.bullets?.length) {
    market.push(
      ...input.market.bullets.slice(0, 12).map((b, i) => {
        const fact = fromBullet(b, "market", input.market?.provider ?? "market_data", i, 50, now)
        return { ...fact, strength: fact.strength + marketBoost }
      }),
    )
  }

  for (const group of input.toolEvidence ?? []) {
    const channel = group.channel ?? "internal"
    const mapped = group.items.map((item, i) =>
      fromEvidenceItem(item, channel, 72 - i, now, group.asOf)
    )
    if (channel === "legal") legal.push(...mapped)
    else if (channel === "market") market.push(...mapped)
    else internal.push(...mapped)
  }

  internal = rankFacts(dedupeFacts(internal)).slice(0, 40)
  legal = rankFacts(dedupeFacts(legal)).slice(0, 24)
  market = rankFacts(dedupeFacts(market)).slice(0, 24)

  const missingSet = new Set<string>()
  for (const m of input.missing ?? []) {
    const t = m.trim()
    if (t) missingSet.add(t)
  }
  for (const exec of input.bundle.toolExecutions) {
    if (!exec.success && exec.error) {
      missingSet.add(`${exec.tool}: ${exec.error}`)
    } else if (exec.success && exec.resultCount === 0) {
      missingSet.add(`${exec.tool}: no matching records`)
    }
  }

  const staleCount =
    internal.filter((f) => f.stale).length +
    legal.filter((f) => f.stale).length +
    market.filter((f) => f.stale).length

  const hasEvidence =
    internal.length > 0 || legal.length > 0 || market.length > 0

  return {
    internal,
    legal,
    market,
    missing: Array.from(missingSet),
    meta: {
      asOf,
      jurisdiction,
      subject: input.bundle.subject,
      capability: input.bundle.capability,
      hasEvidence,
      staleCount,
      toolExecutions: input.bundle.toolExecutions,
    },
  }
}

/** Compact prompt block — prefer this over dumping every raw packet section. */
export function formatOrganizedEvidenceBlock(packet: AskUloEvidencePacket): string {
  const j = packet.meta.jurisdiction
  const jurisLine = [
    j.stateCode ? `state=${j.stateCode}` : null,
    j.cityLabel ? `city=${j.cityLabel}` : null,
    j.countyLabel ? `county=${j.countyLabel}` : null,
  ]
    .filter(Boolean)
    .join(", ") || "unspecified"

  const fmt = (facts: OrganizedEvidenceFact[], limit: number): string => {
    if (facts.length === 0) return "(none)"
    return facts
      .slice(0, limit)
      .map((f) => {
        const bits = [
          f.label,
          f.excerpt && f.excerpt !== f.label ? f.excerpt : null,
          f.asOf ? `asOf=${f.asOf}` : null,
          f.stale ? "STALE" : null,
          `src=${f.source}`,
        ]
          .filter(Boolean)
          .join(" | ")
        return `- ${bits}`
      })
      .join("\n")
  }

  const missing =
    packet.missing.length > 0
      ? packet.missing.map((m) => `- ${m}`).join("\n")
      : "(none)"

  return (
    `ORGANIZED EVIDENCE (canonical — prefer these facts; do not invent missing ones):\n` +
    `asOf=${packet.meta.asOf}; jurisdiction: ${jurisLine}; ` +
    `staleCount=${packet.meta.staleCount}; subject=${packet.meta.subject}\n\n` +
    `INTERNAL (portfolio / ops — landlord systems):\n${fmt(packet.internal, 20)}\n\n` +
    `LEGAL (jurisdiction-scoped rules / guidance):\n${fmt(packet.legal, 12)}\n\n` +
    `MARKET (external rent / comps / indexes):\n${fmt(packet.market, 12)}\n\n` +
    `MISSING (do not invent):\n${missing}`
  )
}

export function summarizeEvidencePacket(packet: AskUloEvidencePacket): Record<string, unknown> {
  return {
    asOf: packet.meta.asOf,
    subject: packet.meta.subject,
    capability: packet.meta.capability,
    hasEvidence: packet.meta.hasEvidence,
    staleCount: packet.meta.staleCount,
    jurisdiction: packet.meta.jurisdiction,
    counts: {
      internal: packet.internal.length,
      legal: packet.legal.length,
      market: packet.market.length,
      missing: packet.missing.length,
    },
    topInternal: packet.internal.slice(0, 5).map((f) => f.label),
    topLegal: packet.legal.slice(0, 3).map((f) => f.label),
    topMarket: packet.market.slice(0, 3).map((f) => f.label),
  }
}

export function emptyEvidenceBundle(input: {
  subject: AskUloQuestionSubject
  capability: AskUloCapability
  organizationId: string
  propertyId?: string | null
}): AskUloEvidenceBundle {
  return {
    subject: input.subject,
    capability: input.capability,
    scope: {
      organizationId: input.organizationId,
      ...(input.propertyId ? { propertyId: input.propertyId } : {}),
    },
    toolExecutions: [],
    findings: {},
    hasEvidence: false,
  }
}

export function recordToolExecution(
  bundle: AskUloEvidenceBundle,
  execution: AskUloToolExecution,
): void {
  bundle.toolExecutions.push(execution)
}

export function finalizeEvidenceBundle(bundle: AskUloEvidenceBundle): AskUloEvidenceBundle {
  const f = bundle.findings
  const hasEvidence = Boolean(
    (f.workOrders && f.workOrders.length > 0) ||
      (f.workflows && f.workflows.length > 0) ||
      (f.insights && f.insights.length > 0) ||
      (f.decisions && f.decisions.length > 0) ||
      (f.vendors && f.vendors.length > 0) ||
      (f.residents && f.residents.length > 0) ||
      (f.properties && f.properties.length > 0) ||
      (f.events && f.events.length > 0),
  )
  return { ...bundle, hasEvidence }
}

/** Compact summary for logging / eval — not for synthesis prose. */
export function summarizeEvidenceBundle(bundle: AskUloEvidenceBundle): Record<string, unknown> {
  const counts: Record<string, number> = {}
  for (const [k, v] of Object.entries(bundle.findings)) {
    if (Array.isArray(v)) counts[k] = v.length
  }
  return {
    subject: bundle.subject,
    capability: bundle.capability,
    hasEvidence: bundle.hasEvidence,
    toolExecutions: bundle.toolExecutions.map((t) => ({
      tool: t.tool,
      resultCount: t.resultCount,
      success: t.success,
    })),
    findingCounts: counts,
  }
}

/** @deprecated Prefer OrganizedEvidenceFact — kept for EvidenceItem adapters. */
export type { EvidenceItem }
