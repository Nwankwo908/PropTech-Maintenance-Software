/**
 * Portfolio executive briefing packet for Ask Ulo.
 * Synthesizes live ops signals — never invents scores or causes.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"

export type PortfolioBriefingAssessment =
  | "Healthy"
  | "Stable"
  | "Needs Attention"
  | "At Risk"
  | "Unknown"

export type PortfolioBriefingResult = {
  available: boolean
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  assessment: PortfolioBriefingAssessment
  healthScore: number | null
  healthDelta4w: number | null
  facts: {
    openWorkOrders: number
    criticalWorkOrders: number
    agingWorkOrders: number
    escalatedWorkflows: number
    awaitingDecision: number
    occupancyPct: number | null
    trackedUnits: number
    occupiedUnits: number
    activeWorkflowsByDomain: Record<string, number>
    recurringHotspots: string[]
    recentUloActions: string[]
  }
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

const ULO_ACTION_RE =
  /\b(reassign|reassigned|vendor\..*sla|sla_expired|late[-_ ]?rent|reminder_sent|inspection\.scheduled|workflow\.(?:escalat|act)|maintenance\.(?:reassign|escalat)|rent\.reminder)\b/i

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

function assessmentFromScore(score: number | null): PortfolioBriefingAssessment {
  if (score == null) return "Unknown"
  if (score >= 85) return "Healthy"
  if (score >= 70) return "Stable"
  if (score >= 55) return "Needs Attention"
  return "At Risk"
}

function workflowDomain(templateId: string | null): string {
  const t = (templateId ?? "").toLowerCase()
  if (t.includes("maintenance") || t.includes("vendor_response")) return "maintenance"
  if (t.includes("rent")) return "rent"
  if (t.includes("inspection")) return "inspection"
  if (t.includes("move_in") || t.includes("move-in")) return "move_in"
  if (t.includes("move_out") || t.includes("move-out")) return "move_out"
  if (t.includes("lease_renewal") || t.includes("lease")) return "lease_renewal"
  return "other"
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

function humanizeEvent(eventType: string, meta: Record<string, unknown> | null): string | null {
  const et = eventType.toLowerCase()
  const building =
    (typeof meta?.building === "string" && meta.building) ||
    (typeof meta?.property_name === "string" && meta.property_name) ||
    null

  if (/vendor.*reassign|reassign.*vendor|sla_expired|sla\.expired/.test(et)) {
    return `Ulo reassigned a work order after a vendor missed the response deadline${
      building ? ` at ${building}` : ""
    }.`
  }
  if (/rent\.reminder|late_rent|late-rent/.test(et)) {
    return "Ulo sent late-rent reminders to residents."
  }
  if (/inspection\.scheduled|inspection_scheduled/.test(et)) {
    return `Ulo scheduled an inspection${building ? ` at ${building}` : ""}.`
  }
  if (/lease_renewal|lease\.renewal/.test(et) && /escalat|remind|sent/.test(et)) {
    return "Ulo advanced a lease-renewal workflow."
  }
  if (/maintenance\.|workflow\.act|workflow\.escalat/.test(et)) {
    return `Ulo took an automated ops action (${eventType})${
      building ? ` @ ${building}` : ""
    }.`
  }
  return null
}

export async function portfolioBriefingLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<PortfolioBriefingResult> {
  const landlordId = input.landlordId.trim()
  const now = Date.now()
  const bullets: string[] = []
  const citations: AskUloCitation[] = []

  const emptyFacts = {
    openWorkOrders: 0,
    criticalWorkOrders: 0,
    agingWorkOrders: 0,
    escalatedWorkflows: 0,
    awaitingDecision: 0,
    occupancyPct: null as number | null,
    trackedUnits: 0,
    occupiedUnits: 0,
    activeWorkflowsByDomain: {} as Record<string, number>,
    recurringHotspots: [] as string[],
    recentUloActions: [] as string[],
  }

  if (!landlordId) {
    return {
      available: false,
      bullets: ["Portfolio briefing unavailable: missing landlord id."],
      citations: [],
      markdown: "Portfolio data is unavailable for this session.",
      assessment: "Unknown",
      healthScore: null,
      healthDelta4w: null,
      facts: emptyFacts,
    }
  }

  const [ticketsRes, recentTicketsRes, workflowsRes, unitsRes, residentsRes, eventsRes, feedbackRes] =
    await Promise.all([
      supabase
        .from("maintenance_request_enriched")
        .select(
          "id, building, unit, issue_category, priority, urgency, vendor_work_status, created_at, due_at, description",
        )
        .eq("landlord_id", landlordId)
        .in("vendor_work_status", OPEN_VENDOR_STATUSES)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("maintenance_request_enriched")
        .select("id, building, unit, issue_category, vendor_work_status, created_at")
        .eq("landlord_id", landlordId)
        .gte("created_at", new Date(now - REPEAT_WINDOW_MS).toISOString())
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("workflow_runs")
        .select("id, status, template_id, updated_at, metadata, created_at")
        .eq("landlord_id", landlordId)
        .in("status", ["active", "escalated"])
        .order("updated_at", { ascending: false })
        .limit(60),
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
      supabase
        .from("operations_graph_events")
        .select("id, event_type, metadata, created_at, source")
        .eq("landlord_id", landlordId)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("vendor_feedback")
        .select("id, rating, submitted_at")
        .eq("landlord_id", landlordId)
        .gte("submitted_at", new Date(now - FOUR_WEEKS_MS).toISOString())
        .limit(100),
    ])

  if (ticketsRes.error) console.error("[ask_ulo/briefing] tickets", ticketsRes.error.message)
  if (workflowsRes.error) console.error("[ask_ulo/briefing] workflows", workflowsRes.error.message)
  if (unitsRes.error) console.error("[ask_ulo/briefing] units", unitsRes.error.message)
  if (eventsRes.error) console.error("[ask_ulo/briefing] events", eventsRes.error.message)

  const openTickets = ticketsRes.data ?? []
  const recentTickets = recentTicketsRes.data ?? []
  const workflows = workflowsRes.data ?? []
  const units = (unitsRes.data ?? []).filter(
    (u) => String(u.status ?? "").toLowerCase() !== "inactive",
  )
  const residents = residentsRes.data ?? []
  const events = eventsRes.data ?? []
  const feedback = feedbackRes.error ? [] : feedbackRes.data ?? []

  const critical = openTickets.filter((t) => {
    const pri = `${t.priority ?? ""} ${t.urgency ?? ""}`
    return CRITICAL_RE.test(pri)
  })
  const aging = openTickets.filter((t) => {
    const created = new Date(String(t.created_at)).getTime()
    if (Number.isNaN(created)) return false
    if (now - created >= AGING_MS) return true
    if (t.due_at) {
      const due = new Date(String(t.due_at)).getTime()
      return !Number.isNaN(due) && due < now
    }
    return false
  })

  // Recurring hotspots: building + category with ≥3 in 45 days
  const hotspotCounts = new Map<string, number>()
  for (const t of recentTickets) {
    const building = typeof t.building === "string" && t.building.trim() ? t.building.trim() : null
    const cat =
      typeof t.issue_category === "string" && t.issue_category.trim()
        ? t.issue_category.trim()
        : "maintenance"
    if (!building) continue
    const key = `${building}|${cat}`
    hotspotCounts.set(key, (hotspotCounts.get(key) ?? 0) + 1)
  }
  const recurringHotspots = [...hotspotCounts.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, n]) => {
      const [building, cat] = key.split("|")
      return `${building}: ${n} ${cat} requests in the last 45 days`
    })

  const escalated = workflows.filter((w) => String(w.status) === "escalated")
  const awaiting = workflows.filter((w) =>
    isAwaitingDecision(String(w.status), asRecord(w.metadata)),
  )
  const byDomain: Record<string, number> = {}
  for (const w of workflows) {
    const d = workflowDomain(typeof w.template_id === "string" ? w.template_id : null)
    byDomain[d] = (byDomain[d] ?? 0) + 1
  }

  // Occupancy: units with an occupying resident
  const nonOccupying = new Set(["past_resident", "inactive", "vacant"])
  let occupied = 0
  for (const u of units) {
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
  const occupancyPct = units.length > 0 ? Math.round((occupied / units.length) * 100) : null

  // Recent Ulo actions
  const recentUloActions: string[] = []
  for (const e of events) {
    const et = String(e.event_type ?? "")
    if (!ULO_ACTION_RE.test(et) && String(e.source ?? "") !== "edge_function") continue
    const line = humanizeEvent(et, asRecord(e.metadata))
    if (line && !recentUloActions.includes(line)) recentUloActions.push(line)
    if (recentUloActions.length >= 3) break
  }

  // Simplified property health (same weights as product; missing signals = neutral 50)
  const openRate =
    units.length > 0
      ? new Set(
          openTickets
            .map((t) => String(t.unit ?? "").toLowerCase().replace(/^unit\s+/, "").trim())
            .filter(Boolean),
        ).size / units.length
      : 0
  const openMaintScore = units.length > 0 ? clampScore(100 * (1 - openRate)) : NEUTRAL
  const vacancyScore = occupancyPct != null ? clampScore(occupancyPct) : NEUTRAL
  const unitsWithRepeat = new Set<string>()
  const unitCatCounts = new Map<string, number>()
  for (const t of recentTickets) {
    const unitKey = String(t.unit ?? "").toLowerCase().replace(/^unit\s+/, "").trim()
    if (!unitKey) continue
    const cat = String(t.issue_category ?? "general").toLowerCase()
    const key = `${unitKey}|${cat}`
    unitCatCounts.set(key, (unitCatCounts.get(key) ?? 0) + 1)
  }
  for (const [key, count] of unitCatCounts) {
    if (count >= 2) unitsWithRepeat.add(key.split("|")[0]!)
  }
  const repeatScore =
    units.length > 0
      ? clampScore(100 * (1 - unitsWithRepeat.size / units.length))
      : NEUTRAL
  const ratings = feedback
    .map((f) => Number(f.rating))
    .filter((r) => Number.isFinite(r) && r >= 1 && r <= 5)
  const satisfactionScore =
    ratings.length > 0
      ? clampScore((ratings.reduce((a, b) => a + b, 0) / ratings.length / 5) * 100)
      : NEUTRAL

  const healthScore =
    units.length > 0
      ? clampScore(
          openMaintScore * 0.4 +
            NEUTRAL * 0.2 + // PM unknown
            vacancyScore * 0.15 +
            satisfactionScore * 0.1 +
            repeatScore * 0.1 +
            NEUTRAL * 0.05, // vendor unknown → neutral
        )
      : null

  // 4-week delta approximation: recompute open-maint as if only tickets older than 4w counted as "then open"
  let healthDelta4w: number | null = null
  if (healthScore != null && units.length > 0) {
    const thenOpen = openTickets.filter((t) => {
      const created = new Date(String(t.created_at)).getTime()
      return !Number.isNaN(created) && created < now - FOUR_WEEKS_MS
    })
    const thenRate =
      new Set(
        thenOpen
          .map((t) => String(t.unit ?? "").toLowerCase().replace(/^unit\s+/, "").trim())
          .filter(Boolean),
      ).size / units.length
    const thenOpenScore = clampScore(100 * (1 - thenRate))
    const thenHealth = clampScore(
      thenOpenScore * 0.4 +
        NEUTRAL * 0.2 +
        vacancyScore * 0.15 +
        satisfactionScore * 0.1 +
        repeatScore * 0.1 +
        NEUTRAL * 0.05,
    )
    healthDelta4w = healthScore - thenHealth
  }

  const assessment = assessmentFromScore(healthScore)

  // Build bullets (grounded facts only)
  bullets.push(`Assessment label: ${assessment}.`)
  if (healthScore != null) {
    bullets.push(
      `Property Health score (computed from live portfolio signals): ${healthScore}/100` +
        (healthDelta4w != null
          ? ` (approx. ${healthDelta4w >= 0 ? "+" : ""}${healthDelta4w} vs ~4 weeks ago on open-maintenance pressure).`
          : "."),
    )
    bullets.push(
      `Health components used: open maintenance ${openMaintScore}, occupancy ${vacancyScore}, repeat-issue risk ${repeatScore}, resident satisfaction ${
        ratings.length ? satisfactionScore : "neutral (no recent ratings)"
      }; PM compliance and vendor performance defaulted to neutral (no signal).`,
    )
  } else {
    bullets.push("Property Health score: unavailable (no tracked units).")
  }

  if (occupancyPct != null) {
    bullets.push(`Occupancy: ${occupancyPct}% (${occupied} of ${units.length} tracked units).`)
  } else {
    bullets.push("Occupancy: unavailable.")
  }

  bullets.push(
    `Open work orders: ${openTickets.length} (critical/urgent: ${critical.length}; aging/overdue >72h or past due: ${aging.length}).`,
  )
  for (const t of critical.slice(0, 5)) {
    const where = [t.building, t.unit].filter((x) => typeof x === "string" && x.trim()).join(" · ")
    bullets.push(
      `Critical: ${t.issue_category ?? "maintenance"} — ${t.vendor_work_status}${
        where ? ` @ ${where}` : ""
      }.`,
    )
  }
  for (const t of aging.slice(0, 4)) {
    if (critical.some((c) => c.id === t.id)) continue
    const where = [t.building, t.unit].filter((x) => typeof x === "string" && x.trim()).join(" · ")
    bullets.push(
      `Aging request: ${t.issue_category ?? "maintenance"} — ${t.vendor_work_status}${
        where ? ` @ ${where}` : ""
      }.`,
    )
  }

  if (recurringHotspots.length) {
    bullets.push("Recurring issue hotspots (45-day window):")
    for (const h of recurringHotspots) bullets.push(`  • ${h}`)
  } else {
    bullets.push("Recurring issue hotspots: none detected (≥3 same building+category in 45 days).")
  }

  bullets.push(
    `Active workflows: ${workflows.length}; escalated: ${escalated.length}; awaiting landlord decision signals: ${awaiting.length}.`,
  )
  for (const [domain, n] of Object.entries(byDomain)) {
    bullets.push(`  Workflow domain ${domain}: ${n}`)
  }
  for (const w of escalated.slice(0, 5)) {
    const meta = asRecord(w.metadata)
    const building =
      (typeof meta?.building === "string" && meta.building) ||
      (typeof meta?.property_name === "string" && meta.property_name) ||
      null
    bullets.push(
      `Escalated workflow: ${w.template_id ?? "workflow"}${building ? ` @ ${building}` : ""}.`,
    )
  }
  for (const w of awaiting.slice(0, 5)) {
    if (String(w.status) === "escalated") continue
    const meta = asRecord(w.metadata)
    const step = String(meta?.current_step ?? meta?.step ?? "awaiting decision")
    bullets.push(`Awaiting decision: ${w.template_id ?? "workflow"} (${step}).`)
  }

  if (ratings.length) {
    const avg = Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
    bullets.push(`Resident/vendor feedback (last 4 weeks): avg rating ${avg}/5 from ${ratings.length} responses.`)
  } else {
    bullets.push("Resident satisfaction ratings: no recent feedback rows.")
  }

  if (recentUloActions.length) {
    bullets.push("Recent automatic Ulo actions (from operations graph):")
    for (const a of recentUloActions) bullets.push(`  • ${a}`)
  } else {
    bullets.push("Recent automatic Ulo actions: none clearly identified in the latest graph window.")
  }

  citations.push({
    tool: "ops_graph",
    title: "Portfolio executive briefing",
    citation: "maintenance_request_enriched + workflow_runs + units + operations_graph_events",
    excerpt: `${openTickets.length} open WOs; ${workflows.length} active workflows; health ${
      healthScore ?? "n/a"
    }`,
  })

  const facts = {
    openWorkOrders: openTickets.length,
    criticalWorkOrders: critical.length,
    agingWorkOrders: aging.length,
    escalatedWorkflows: escalated.length,
    awaitingDecision: awaiting.length,
    occupancyPct,
    trackedUnits: units.length,
    occupiedUnits: occupied,
    activeWorkflowsByDomain: byDomain,
    recurringHotspots,
    recentUloActions,
  }

  const mdParts = [
    `## Portfolio briefing packet`,
    `Assessment: **${assessment}**` +
      (healthScore != null ? ` · Health **${healthScore}/100**` : " · Health score unavailable"),
    "",
    ...bullets.map((b) => `- ${b}`),
  ]

  return {
    available: true,
    bullets,
    citations,
    markdown: mdParts.join("\n"),
    assessment,
    healthScore,
    healthDelta4w,
    facts,
  }
}
