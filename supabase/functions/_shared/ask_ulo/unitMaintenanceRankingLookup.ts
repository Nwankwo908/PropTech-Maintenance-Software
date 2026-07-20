/**
 * Unit-level maintenance request volume ranking for Ask Ulo.
 * Groups requests with a valid unit_id, counts by unit, returns top 3–5.
 * Never fabricates a ranking when unit linkage is missing.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import {
  effectiveAnalyticalTimeframeDays,
  type AnalyticalQuery,
} from "./analyticalQuery.ts"
import { buildUnitRankingIncompleteSignal } from "./incompleteEvidence.ts"

export type RankedUnitMaintenance = {
  unitId: string
  unitLabel: string
  building: string
  /** Requests in the analysis window (historical for that window). */
  totalRequests: number
  /** Subset of totalRequests created in the most recent 14 days. */
  recentRequests: number
  openRequests: number
  mostCommonCategory: string | null
}

export type UnitMaintenanceRankingResult = {
  available: boolean
  canRank: boolean
  missingData: string[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  /** User-facing window label, e.g. "last 60 days". */
  timeframeLabel: string
  timeframeDays: number
  timeframeIsDefault: boolean
  scopeLabel: string
  ranked: RankedUnitMaintenance[]
  top: RankedUnitMaintenance | null
  /** Requests in scope that could not be linked to a unit. */
  unlinkedRequestCount: number
  /** All requests considered in the window (linked + unlinked). */
  scopedRequestCount: number
  openInScope: number
}

const OPEN_VENDOR_STATUSES = new Set([
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
])

const RECENT_DAYS = 14
const TOP_N = 5

function normalizeBuilding(raw: string | null | undefined): string {
  const t = typeof raw === "string" ? raw.trim() : ""
  return t || "Unknown property"
}

function formatUnitLabel(raw: string | null | undefined): string {
  const t = typeof raw === "string" ? raw.trim() : ""
  if (!t) return "Unit"
  if (/^unit\b/i.test(t)) return t
  return `Unit ${t}`
}

function buildingMatch(building: string | null | undefined, filter: string | null): boolean {
  if (!filter?.trim()) return true
  if (!building?.trim()) return false
  return building.toLowerCase().includes(filter.trim().toLowerCase())
}

function mostCommon(values: string[]): string | null {
  if (!values.length) return null
  const counts = new Map<string, number>()
  for (const v of values) {
    const key = v.trim() || "General"
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [k, n] of counts) {
    if (n > bestN || (n === bestN && best != null && k.localeCompare(best) < 0)) {
      best = k
      bestN = n
    }
  }
  return best
}

function interpretationFor(top: RankedUnitMaintenance): string {
  if (top.openRequests >= 2 && top.totalRequests >= 4) {
    return "This pattern often points to recurring repairs in the same unit — worth reviewing the request history and checking whether an aging system or fixture needs a deeper fix."
  }
  if (top.mostCommonCategory && /plumb|hvac|electr|water|heat/i.test(top.mostCommonCategory)) {
    return `The concentration of ${top.mostCommonCategory.toLowerCase()} requests may mean a system or fixture issue rather than one-off resident reports.`
  }
  if (top.recentRequests >= Math.ceil(top.totalRequests / 2)) {
    return "Many of these requests are recent, which can mean rising reporting frequency or a new problem that started recently."
  }
  return "A higher request volume can reflect recurring repairs, an aging system, or simply a resident who reports issues promptly — review the history before assuming the cause."
}

function nextStepFor(top: RankedUnitMaintenance): string {
  return `Review the maintenance history for ${top.unitLabel} at ${top.building} and schedule a preventive inspection if the same issue category keeps repeating.`
}

export async function unitMaintenanceRankingLookup(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    buildingFilter?: string | null
    analytical?: AnalyticalQuery | null
  },
): Promise<UnitMaintenanceRankingResult> {
  const landlordId = input.landlordId.trim()
  const buildingFilter = input.buildingFilter?.trim() || null
  const analytical = input.analytical ?? null
  const timeframeDays = analytical
    ? effectiveAnalyticalTimeframeDays(analytical)
    : 60
  const timeframeIsDefault = !(analytical?.timeframeDays != null)
  const timeframeLabel = `last ${timeframeDays} days`
  const scopeLabel = buildingFilter
    ? `property scope: ${buildingFilter}`
    : "full portfolio"
  const missingData: string[] = []

  if (!landlordId) {
    return {
      available: false,
      canRank: false,
      missingData: ["landlord id"],
      bullets: ["Unit ranking unavailable: missing landlord id."],
      citations: [],
      markdown:
        "I found maintenance activity for the portfolio, but I could not reliably connect the requests to individual units.",
      timeframeLabel,
      timeframeDays,
      timeframeIsDefault,
      scopeLabel,
      ranked: [],
      top: null,
      unlinkedRequestCount: 0,
      scopedRequestCount: 0,
      openInScope: 0,
    }
  }

  const sinceIso = new Date(Date.now() - timeframeDays * 24 * 60 * 60 * 1000).toISOString()
  const recentIso = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: rows, error } = await supabase
    .from("maintenance_request_enriched")
    .select(
      "id, unit_id, unit, building, issue_category, vendor_work_status, created_at",
    )
    .eq("landlord_id", landlordId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(800)

  if (error) {
    console.error("[ask_ulo/unitRanking] tickets", error.message)
    missingData.push("maintenance requests")
  }

  const scoped = (rows ?? []).filter((t) =>
    buildingMatch(typeof t.building === "string" ? t.building : null, buildingFilter),
  )

  const linked = scoped.filter(
    (t) => typeof t.unit_id === "string" && t.unit_id.trim().length > 0,
  )
  const unlinkedRequestCount = scoped.length - linked.length
  const openInScope = scoped.filter((t) =>
    OPEN_VENDOR_STATUSES.has(String(t.vendor_work_status ?? "")),
  ).length

  // Resolve labels from units table when enriched unit string is thin
  const unitIds = [...new Set(linked.map((t) => String(t.unit_id)))]
  const unitMeta = new Map<string, { unitLabel: string; building: string }>()
  if (unitIds.length) {
    const { data: units, error: unitsErr } = await supabase
      .from("units")
      .select("id, unit_label, building")
      .eq("landlord_id", landlordId)
      .in("id", unitIds.slice(0, 200))
    if (unitsErr) {
      console.error("[ask_ulo/unitRanking] units", unitsErr.message)
      missingData.push("unit labels")
    }
    for (const u of units ?? []) {
      unitMeta.set(String(u.id), {
        unitLabel: formatUnitLabel(typeof u.unit_label === "string" ? u.unit_label : null),
        building: normalizeBuilding(typeof u.building === "string" ? u.building : null),
      })
    }
  }

  type Acc = {
    unitId: string
    unitLabel: string
    building: string
    categories: string[]
    total: number
    recent: number
    open: number
  }
  const byUnit = new Map<string, Acc>()

  for (const t of linked) {
    const unitId = String(t.unit_id)
    const meta = unitMeta.get(unitId)
    const building = meta?.building ??
      normalizeBuilding(typeof t.building === "string" ? t.building : null)
    const unitLabel = meta?.unitLabel ??
      formatUnitLabel(typeof t.unit === "string" ? t.unit : null)
    let acc = byUnit.get(unitId)
    if (!acc) {
      acc = {
        unitId,
        unitLabel,
        building,
        categories: [],
        total: 0,
        recent: 0,
        open: 0,
      }
      byUnit.set(unitId, acc)
    }
    acc.total += 1
    const created = typeof t.created_at === "string" ? t.created_at : ""
    if (created && created >= recentIso) acc.recent += 1
    if (OPEN_VENDOR_STATUSES.has(String(t.vendor_work_status ?? ""))) acc.open += 1
    if (typeof t.issue_category === "string" && t.issue_category.trim()) {
      acc.categories.push(t.issue_category.trim())
    }
  }

  const descending = analytical?.ranking !== "lowest"
  const ranked: RankedUnitMaintenance[] = [...byUnit.values()]
    .map((acc) => ({
      unitId: acc.unitId,
      unitLabel: acc.unitLabel,
      building: acc.building,
      totalRequests: acc.total,
      recentRequests: acc.recent,
      openRequests: acc.open,
      mostCommonCategory: mostCommon(acc.categories),
    }))
    .sort((a, b) =>
      descending
        ? b.totalRequests - a.totalRequests || a.unitLabel.localeCompare(b.unitLabel)
        : a.totalRequests - b.totalRequests || a.unitLabel.localeCompare(b.unitLabel),
    )
    .slice(0, TOP_N)

  const canRank = ranked.length > 0 && linked.length > 0
  const top = canRank ? ranked[0]! : null

  if (scoped.length > 0 && linked.length === 0) {
    missingData.push("unit assignments on maintenance requests")
  }

  const bullets: string[] = []
  bullets.push(`Analysis window: ${timeframeLabel}${timeframeIsDefault ? " (default)" : ""}.`)
  bullets.push(`Scope: ${scopeLabel}.`)
  bullets.push(
    `Requests in window: ${scoped.length} total; ${linked.length} linked to units; ${unlinkedRequestCount} unlinked.`,
  )
  bullets.push(`Currently open across these units: ${openInScope}.`)

  if (!canRank) {
    bullets.push(
      "I found maintenance activity for the portfolio, but I could not reliably connect the requests to individual units.",
    )
  } else if (top) {
    bullets.push(
      `Top unit: ${top.unitLabel} at ${top.building} — ${top.totalRequests} requests (${timeframeLabel}); ${top.openRequests} currently open; most common: ${top.mostCommonCategory ?? "n/a"}.`,
    )
    for (const r of ranked) {
      bullets.push(
        `${r.unitLabel} — ${r.building}: ${r.totalRequests} total / ${r.recentRequests} recent (≤${RECENT_DAYS}d) / ${r.openRequests} open; top category ${r.mostCommonCategory ?? "n/a"}.`,
      )
    }
  }

  const citations: AskUloCitation[] = [
    {
      tool: "ops_graph",
      title: "Unit maintenance volume ranking",
      citation: "maintenance_request_enriched (unit_id) + units",
      excerpt: canRank && top
        ? `Top: ${top.unitLabel} @ ${top.building}; ${ranked.length} units ranked over ${timeframeLabel}`
        : `Could not rank units; ${scoped.length} requests in window, ${linked.length} with unit_id`,
    },
  ]

  const md: string[] = []
  if (!canRank) {
    const incomplete = buildUnitRankingIncompleteSignal({
      available: true,
      canRank: false,
      missingData,
      requestCount: scoped.length,
      unlinkedRequestCount,
      timeframeLabel,
      scopeLabel,
    })
    md.push(incomplete?.markdown ?? "")
  } else if (top) {
    md.push("## Quick Answer")
    md.push(
      `**${top.unitLabel}** at **${top.building}** generated the most maintenance requests, with **${top.totalRequests}** requests during the ${timeframeLabel}.`,
    )
    md.push("")
    md.push("## Top Units")
    ranked.forEach((r, i) => {
      md.push(`${i + 1}. **${r.unitLabel}** — ${r.building}`)
      md.push(`   ${r.totalRequests} requests`)
      md.push(
        `   Most common issue: ${r.mostCommonCategory ?? "Not specified"}`,
      )
      md.push(`   ${r.openRequests} currently open`)
      md.push(`   Recent (last ${RECENT_DAYS} days): ${r.recentRequests}`)
      md.push("")
    })
    md.push("## What This May Mean")
    md.push(interpretationFor(top))
    md.push("")
    md.push("## Recommended Next Step")
    md.push(nextStepFor(top))
    md.push("")
    md.push("### Metric distinctions (internal)")
    md.push(
      `- Total in window (${timeframeLabel}): historical count used for ranking.`,
    )
    md.push(
      `- Recent: requests created in the last ${RECENT_DAYS} days (subset of the window).`,
    )
    md.push(`- Currently open: still in an open vendor work status.`)
  }

  return {
    available: true,
    canRank,
    missingData,
    bullets,
    citations,
    markdown: md.join("\n").trim(),
    timeframeLabel,
    timeframeDays,
    timeframeIsDefault,
    scopeLabel,
    ranked,
    top,
    unlinkedRequestCount,
    scopedRequestCount: scoped.length,
    openInScope,
  }
}
