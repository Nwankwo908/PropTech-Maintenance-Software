/**
 * Property-level ranking packet for Ask Ulo comparison / prioritization questions.
 * Ranks every accessible building using severity-first signals — never volume alone.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { buildPropertyRankingIncompleteSignal } from "./incompleteEvidence.ts"

export type PropertyRankSignal = {
  label: string
  severityBand: 1 | 2 | 3 | 4 | 5 | 6 | 7
}

export type RankedProperty = {
  building: string
  rankScore: number
  healthScore: number | null
  healthDelta4w: number | null
  openWorkOrders: number
  criticalWorkOrders: number
  agingWorkOrders: number
  oldestOpenDays: number | null
  escalatedWorkflows: number
  awaitingDecision: number
  repeatHotspots: string[]
  vacancyUnits: number
  trackedUnits: number
  occupancyPct: number | null
  signals: PropertyRankSignal[]
  whyLines: string[]
  recommendedActions: string[]
}

export type PropertyRankingResult = {
  available: boolean
  canRank: boolean
  missingData: string[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  ranked: RankedProperty[]
  top: RankedProperty | null
  watch: RankedProperty[]
  portfolioOpenWorkOrders: number
}

const OPEN_VENDOR_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
]

const CRITICAL_RE = /\b(critical|emergency|urgent|high)\b/i
const AGING_MS = 72 * 60 * 60 * 1000
const REPEAT_WINDOW_MS = 45 * 24 * 60 * 60 * 1000
const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000
const NEUTRAL = 50

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

function normalizeBuilding(raw: string | null | undefined): string | null {
  const t = typeof raw === "string" ? raw.trim() : ""
  return t || null
}

function isAwaitingDecision(status: string, meta: Record<string, unknown> | null): boolean {
  if (status === "escalated") return true
  const step = String(meta?.current_step ?? meta?.step ?? meta?.stage ?? "").toLowerCase()
  return (
    step.includes("awaiting") ||
    step.includes("landlord") ||
    step.includes("decision") ||
    step.includes("human") ||
    Boolean(meta?.awaiting_landlord) ||
    Boolean(meta?.needs_landlord_decision)
  )
}

function buildingFromWorkflowMeta(meta: Record<string, unknown> | null): string | null {
  return (
    normalizeBuilding(
      typeof meta?.building === "string"
        ? meta.building
        : typeof meta?.property_name === "string"
          ? meta.property_name
          : null,
    )
  )
}

type Agg = {
  building: string
  open: Array<Record<string, unknown>>
  recent: Array<Record<string, unknown>>
  escalated: number
  awaiting: number
  units: Array<Record<string, unknown>>
  occupied: number
}

function emptyAgg(building: string): Agg {
  return {
    building,
    open: [],
    recent: [],
    escalated: 0,
    awaiting: 0,
    units: [],
    occupied: 0,
  }
}

function scoreProperty(agg: Agg, now: number): RankedProperty {
  const critical = agg.open.filter((t) => {
    const pri = `${t.priority ?? ""} ${t.urgency ?? ""}`
    return CRITICAL_RE.test(pri)
  })
  const aging = agg.open.filter((t) => {
    const created = new Date(String(t.created_at)).getTime()
    if (Number.isNaN(created)) return false
    if (now - created >= AGING_MS) return true
    if (t.due_at) {
      const due = new Date(String(t.due_at)).getTime()
      return !Number.isNaN(due) && due < now
    }
    return false
  })

  let oldestOpenDays: number | null = null
  for (const t of agg.open) {
    const created = new Date(String(t.created_at)).getTime()
    if (Number.isNaN(created)) continue
    const days = Math.floor((now - created) / (24 * 60 * 60 * 1000))
    if (oldestOpenDays == null || days > oldestOpenDays) oldestOpenDays = days
  }

  const hotspotCounts = new Map<string, number>()
  for (const t of agg.recent) {
    const cat =
      typeof t.issue_category === "string" && t.issue_category.trim()
        ? t.issue_category.trim()
        : "maintenance"
    hotspotCounts.set(cat, (hotspotCounts.get(cat) ?? 0) + 1)
  }
  const repeatHotspots = [...hotspotCounts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${n} ${cat} requests in the last 45 days`)

  const trackedUnits = agg.units.length
  const occupancyPct =
    trackedUnits > 0 ? Math.round((agg.occupied / trackedUnits) * 100) : null
  const vacancyUnits = trackedUnits > 0 ? Math.max(0, trackedUnits - agg.occupied) : 0

  const openRate =
    trackedUnits > 0
      ? new Set(
          agg.open
            .map((t) => String(t.unit ?? "").toLowerCase().replace(/^unit\s+/, "").trim())
            .filter(Boolean),
        ).size / trackedUnits
      : 0
  const openMaintScore = trackedUnits > 0 ? clampScore(100 * (1 - openRate)) : NEUTRAL
  const vacancyScore = occupancyPct != null ? clampScore(occupancyPct) : NEUTRAL
  const unitCatCounts = new Map<string, number>()
  for (const t of agg.recent) {
    const unitKey = String(t.unit ?? "").toLowerCase().replace(/^unit\s+/, "").trim()
    if (!unitKey) continue
    const cat = String(t.issue_category ?? "general").toLowerCase()
    const key = `${unitKey}|${cat}`
    unitCatCounts.set(key, (unitCatCounts.get(key) ?? 0) + 1)
  }
  const unitsWithRepeat = new Set<string>()
  for (const [key, count] of unitCatCounts) {
    if (count >= 2) unitsWithRepeat.add(key.split("|")[0]!)
  }
  const repeatScore =
    trackedUnits > 0
      ? clampScore(100 * (1 - unitsWithRepeat.size / trackedUnits))
      : NEUTRAL
  const healthScore =
    trackedUnits > 0
      ? clampScore(
          openMaintScore * 0.4 +
            NEUTRAL * 0.2 +
            vacancyScore * 0.15 +
            NEUTRAL * 0.1 +
            repeatScore * 0.1 +
            NEUTRAL * 0.05,
        )
      : null

  let healthDelta4w: number | null = null
  if (healthScore != null && trackedUnits > 0) {
    const thenOpen = agg.open.filter((t) => {
      const created = new Date(String(t.created_at)).getTime()
      return !Number.isNaN(created) && created < now - FOUR_WEEKS_MS
    })
    const thenRate =
      new Set(
        thenOpen
          .map((t) => String(t.unit ?? "").toLowerCase().replace(/^unit\s+/, "").trim())
          .filter(Boolean),
      ).size / trackedUnits
    const thenOpenScore = clampScore(100 * (1 - thenRate))
    const thenHealth = clampScore(
      thenOpenScore * 0.4 +
        NEUTRAL * 0.2 +
        vacancyScore * 0.15 +
        NEUTRAL * 0.1 +
        repeatScore * 0.1 +
        NEUTRAL * 0.05,
    )
    healthDelta4w = healthScore - thenHealth
  }

  // Priority bands (higher = worse). Volume alone is weakest.
  const signals: PropertyRankSignal[] = []
  let rankScore = 0

  if (critical.length > 0) {
    signals.push({
      label: `${critical.length} critical/urgent work order${critical.length === 1 ? "" : "s"}`,
      severityBand: 1,
    })
    rankScore += 1000 * critical.length
    if (oldestOpenDays != null && oldestOpenDays >= 7) {
      signals.push({
        label: `Oldest open request is about ${oldestOpenDays} days old`,
        severityBand: 1,
      })
      rankScore += 200 + oldestOpenDays
    }
  }

  if (agg.escalated > 0 || agg.awaiting > 0) {
    if (agg.escalated > 0) {
      signals.push({
        label: `${agg.escalated} item${agg.escalated === 1 ? "" : "s"} that require your attention`,
        severityBand: 2,
      })
      rankScore += 700 * agg.escalated
    }
    if (agg.awaiting > 0) {
      signals.push({
        label: `${agg.awaiting} item${agg.awaiting === 1 ? "" : "s"} waiting on your decision`,
        severityBand: 2,
      })
      rankScore += 500 * agg.awaiting
    }
  }

  if (aging.length > 0) {
    signals.push({
      label: `${aging.length} repair request${aging.length === 1 ? "" : "s"} that have been waiting longer than expected`,
      severityBand: 3,
    })
    rankScore += 300 * aging.length
  }

  if (repeatHotspots.length > 0) {
    signals.push({
      label: `Repeat issues: ${repeatHotspots[0]}`,
      severityBand: 4,
    })
    rankScore += 250 * repeatHotspots.length
  }

  if (occupancyPct != null && occupancyPct < 90 && vacancyUnits > 0) {
    signals.push({
      label: `Occupancy ${occupancyPct}% (${vacancyUnits} vacant of ${trackedUnits})`,
      severityBand: 5,
    })
    rankScore += 150 * vacancyUnits + (90 - occupancyPct)
  }

  if (healthDelta4w != null && healthDelta4w <= -5) {
    signals.push({
      label: `Property Health fell about ${Math.abs(healthDelta4w)} points over ~4 weeks`,
      severityBand: 6,
    })
    rankScore += 120 * Math.abs(healthDelta4w)
  }

  // Volume last — never enough alone to beat severity elsewhere
  if (agg.open.length > 0) {
    signals.push({
      label: `${agg.open.length} open work order${agg.open.length === 1 ? "" : "s"}`,
      severityBand: 7,
    })
    rankScore += 10 * agg.open.length
  }

  if (healthScore != null && healthScore < 55) {
    rankScore += (55 - healthScore) * 5
  }

  const whyLines = signals
    .sort((a, b) => a.severityBand - b.severityBand)
    .slice(0, 4)
    .map((s) => s.label)

  const recommendedActions: string[] = []
  if (critical.length > 0) {
    recommendedActions.push(
      "Review critical/urgent requests first and confirm resident safety or habitability.",
    )
  }
  if (agg.escalated > 0) {
    recommendedActions.push(
      "Follow up on items that require your attention — assign the job to a different vendor or make the pending decision.",
    )
  }
  if (aging.length > 0 && recommendedActions.length < 3) {
    recommendedActions.push(
      "Prioritize repair requests that have been waiting longer than expected and confirm vendors are responding on time.",
    )
  }
  if (repeatHotspots.length > 0 && recommendedActions.length < 4) {
    recommendedActions.push(
      `Investigate the recurring issue pattern (${repeatHotspots[0]}) with a broader inspection if needed.`,
    )
  }
  if (vacancyUnits > 0 && occupancyPct != null && occupancyPct < 90 && recommendedActions.length < 4) {
    recommendedActions.push("Address vacancy pressure — leasing readiness and make-ready on empty units.")
  }
  if (recommendedActions.length === 0 && agg.open.length > 0) {
    recommendedActions.push("Work the open maintenance backlog starting with the oldest tickets.")
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push("Keep monitoring — no hard risk signals stood out for this building.")
  }

  return {
    building: agg.building,
    rankScore,
    healthScore,
    healthDelta4w,
    openWorkOrders: agg.open.length,
    criticalWorkOrders: critical.length,
    agingWorkOrders: aging.length,
    oldestOpenDays,
    escalatedWorkflows: agg.escalated,
    awaitingDecision: agg.awaiting,
    repeatHotspots,
    vacancyUnits,
    trackedUnits,
    occupancyPct,
    signals,
    whyLines,
    recommendedActions: recommendedActions.slice(0, 4),
  }
}

export async function propertyRankingLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<PropertyRankingResult> {
  const landlordId = input.landlordId.trim()
  const now = Date.now()
  const missingData: string[] = []

  if (!landlordId) {
    return {
      available: false,
      canRank: false,
      missingData: ["landlord id"],
      bullets: ["Property ranking unavailable: missing landlord id."],
      citations: [],
      markdown: "I cannot rank properties without a landlord context.",
      ranked: [],
      top: null,
      watch: [],
      portfolioOpenWorkOrders: 0,
    }
  }

  const [ticketsRes, recentTicketsRes, workflowsRes, unitsRes, residentsRes] = await Promise.all([
    supabase
      .from("maintenance_request_enriched")
      .select(
        "id, building, unit, issue_category, priority, urgency, vendor_work_status, created_at, due_at, description",
      )
      .eq("landlord_id", landlordId)
      .in("vendor_work_status", OPEN_VENDOR_STATUSES)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("maintenance_request_enriched")
      .select("id, building, unit, issue_category, vendor_work_status, created_at")
      .eq("landlord_id", landlordId)
      .gte("created_at", new Date(now - REPEAT_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("workflow_runs")
      .select("id, status, template_id, updated_at, metadata, created_at")
      .eq("landlord_id", landlordId)
      .in("status", ["active", "escalated"])
      .order("updated_at", { ascending: false })
      .limit(80),
    supabase
      .from("units")
      .select("id, unit_label, building, status")
      .eq("landlord_id", landlordId)
      .limit(500),
    supabase
      .from("users")
      .select("id, full_name, unit, building, status")
      .eq("landlord_id", landlordId)
      .limit(500),
  ])

  if (ticketsRes.error) {
    console.error("[ask_ulo/ranking] tickets", ticketsRes.error.message)
    missingData.push("open work orders")
  }
  if (workflowsRes.error) {
    console.error("[ask_ulo/ranking] workflows", workflowsRes.error.message)
    missingData.push("workflows")
  }
  if (unitsRes.error) {
    console.error("[ask_ulo/ranking] units", unitsRes.error.message)
    missingData.push("units")
  }

  const openTickets = ticketsRes.data ?? []
  const recentTickets = recentTicketsRes.data ?? []
  const workflows = workflowsRes.data ?? []
  const units = (unitsRes.data ?? []).filter(
    (u) => String(u.status ?? "").toLowerCase() !== "inactive",
  )
  const residents = residentsRes.data ?? []

  const byBuilding = new Map<string, Agg>()
  const ensure = (name: string) => {
    const key = name.trim()
    let agg = byBuilding.get(key)
    if (!agg) {
      agg = emptyAgg(key)
      byBuilding.set(key, agg)
    }
    return agg
  }

  for (const u of units) {
    const b = normalizeBuilding(typeof u.building === "string" ? u.building : null)
    if (!b) continue
    ensure(b).units.push(u as Record<string, unknown>)
  }

  let ticketsWithBuilding = 0
  for (const t of openTickets) {
    const b = normalizeBuilding(typeof t.building === "string" ? t.building : null)
    if (!b) continue
    ticketsWithBuilding += 1
    ensure(b).open.push(t as Record<string, unknown>)
  }
  for (const t of recentTickets) {
    const b = normalizeBuilding(typeof t.building === "string" ? t.building : null)
    if (!b) continue
    ensure(b).recent.push(t as Record<string, unknown>)
  }

  let workflowsWithBuilding = 0
  for (const w of workflows) {
    const meta = asRecord(w.metadata)
    const b = buildingFromWorkflowMeta(meta)
    if (!b) continue
    workflowsWithBuilding += 1
    const agg = ensure(b)
    if (String(w.status) === "escalated") agg.escalated += 1
    if (isAwaitingDecision(String(w.status), meta)) agg.awaiting += 1
  }

  const nonOccupying = new Set(["past_resident", "inactive", "vacant"])
  for (const agg of byBuilding.values()) {
    let occupied = 0
    for (const u of agg.units) {
      const label = String(u.unit_label ?? "").toLowerCase().replace(/^unit\s+/, "").trim()
      const building = String(u.building ?? "").trim().toLowerCase()
      const hit = residents.find((r) => {
        const rUnit = String(r.unit ?? "").toLowerCase().replace(/^unit\s+/, "").trim()
        const rBuilding = String(r.building ?? "").trim().toLowerCase()
        if (building && rBuilding && building !== rBuilding) return false
        return Boolean(label) && rUnit === label
      })
      if (hit && !nonOccupying.has(String(hit.status ?? "").toLowerCase())) occupied += 1
    }
    agg.occupied = occupied
  }

  // Incomplete retrieval: portfolio totals without property assignment
  if (openTickets.length > 0 && ticketsWithBuilding === 0) {
    missingData.push("property assignments on open work orders")
  }
  if (workflows.length > 0 && workflowsWithBuilding === 0) {
    missingData.push("property assignments on active workflows")
  }
  if (byBuilding.size === 0) {
    missingData.push("named properties / buildings in portfolio")
  }

  const canRank =
    byBuilding.size >= 1 &&
    !(openTickets.length > 0 && ticketsWithBuilding === 0 && byBuilding.size === 0)

  const ranked = [...byBuilding.values()]
    .map((agg) => scoreProperty(agg, now))
    .sort((a, b) => b.rankScore - a.rankScore || a.building.localeCompare(b.building))

  // If we only have buildings from units with zero risk signals and open tickets
  // lack building — treat as incomplete when user asked for ranking.
  const hasEntitySignals = ranked.some(
    (r) =>
      r.criticalWorkOrders > 0 ||
      r.escalatedWorkflows > 0 ||
      r.agingWorkOrders > 0 ||
      r.repeatHotspots.length > 0 ||
      r.openWorkOrders > 0,
  )
  const rankingComplete =
    canRank &&
    (hasEntitySignals || openTickets.length === 0) &&
    !(openTickets.length > 0 && ticketsWithBuilding === 0)

  const top = rankingComplete && ranked.length ? ranked[0]! : null
  const watch =
    rankingComplete && ranked.length > 1
      ? ranked.slice(1, 3).filter((r) => r.rankScore > 0 || r.openWorkOrders > 0)
      : []

  const bullets: string[] = []
  if (!rankingComplete) {
    bullets.push(
      `Ranking incomplete. Portfolio open work orders: ${openTickets.length}.`,
    )
    for (const m of missingData) bullets.push(`Missing: ${m}.`)
  } else if (top) {
    bullets.push(`Top priority property: ${top.building} (rank score ${top.rankScore}).`)
    for (const line of top.whyLines) bullets.push(`Why: ${line}.`)
    for (const a of top.recommendedActions) bullets.push(`Action: ${a}`)
    for (const w of watch) {
      bullets.push(
        `Also watch: ${w.building}` +
          (w.whyLines[0] ? ` — ${w.whyLines[0]}` : ` — ${w.openWorkOrders} open WOs`) +
          ".",
      )
    }
    for (const r of ranked.slice(0, 8)) {
      bullets.push(
        `Property ${r.building}: open ${r.openWorkOrders}, critical ${r.criticalWorkOrders}, aging ${r.agingWorkOrders}, escalated ${r.escalatedWorkflows}, health ${
          r.healthScore ?? "n/a"
        }${r.healthDelta4w != null ? ` (Δ4w ${r.healthDelta4w >= 0 ? "+" : ""}${r.healthDelta4w})` : ""}.`,
      )
    }
  } else {
    bullets.push("No properties available to rank.")
  }

  const citations: AskUloCitation[] = [
    {
      tool: "ops_graph",
      title: "Property priority ranking",
      citation: "maintenance_request_enriched + workflow_runs + units (per building)",
      excerpt: top
        ? `Top: ${top.building}; ${ranked.length} properties ranked`
        : `Incomplete ranking; ${openTickets.length} open WOs portfolio-wide`,
    },
  ]

  const mdParts: string[] = ["## Property ranking packet"]
  if (!rankingComplete) {
    const incomplete = buildPropertyRankingIncompleteSignal({
      available: true,
      canRank: false,
      missingData,
      portfolioOpenWorkOrders: openTickets.length,
    })
    mdParts.length = 0
    mdParts.push(incomplete?.markdown ?? "")
  } else if (top) {
    mdParts.push(`**Top priority: ${top.building}**`)
    mdParts.push("")
    mdParts.push("### Why it ranks first")
    for (const line of top.whyLines) mdParts.push(`- ${line}`)
    mdParts.push("")
    mdParts.push("### Recommended actions")
    top.recommendedActions.forEach((a, i) => mdParts.push(`${i + 1}. ${a}`))
    if (watch.length) {
      mdParts.push("")
      mdParts.push("### Also watch")
      for (const w of watch) {
        mdParts.push(
          `- **${w.building}**: ${w.whyLines[0] ?? `${w.openWorkOrders} open work orders`}`,
        )
      }
    }
    mdParts.push("")
    mdParts.push("### All ranked properties (internal)")
    for (const r of ranked) {
      mdParts.push(
        `- ${r.building}: score=${r.rankScore}, open=${r.openWorkOrders}, critical=${r.criticalWorkOrders}, aging=${r.agingWorkOrders}, escalated=${r.escalatedWorkflows}`,
      )
    }
  }

  return {
    available: true,
    canRank: rankingComplete,
    missingData,
    bullets,
    citations,
    markdown: mdParts.join("\n"),
    ranked,
    top,
    watch,
    portfolioOpenWorkOrders: openTickets.length,
  }
}
