/**
 * Recurring repair investigation — repair-level evidence from open + completed work.
 * Do NOT answer from Property Insights "Needs Attention / Prevent / Vendor Response" cards alone.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import type { PropertyInsightsResult } from "./propertyInsightsLookup.ts"

const WINDOW_DAYS = 60
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000
const MIN_PATTERN_COUNT = 2

/** Specific repair type (preferred over broad plumbing/HVAC only). */
export type RepairTypeId =
  | "faucet_sink_leaks"
  | "drain_problems"
  | "toilet_issues"
  | "pipe_leaks"
  | "water_heater"
  | "low_water_pressure"
  | "flooding"
  | "plumbing_general"
  | "ac_not_cooling"
  | "no_heat"
  | "thermostat"
  | "compressor"
  | "hvac_general"
  | "outlet_issues"
  | "breaker_tripping"
  | "power_loss"
  | "sparking"
  | "electrical_general"
  | "appliance"
  | "pest"
  | "general"

export type RecurringRepairPattern = {
  kind: "repair_type" | "property_repair" | "unit_repair"
  /** Display label for the repeated repair type. */
  repairTypeLabel: string
  repairTypeId: RepairTypeId
  label: string
  count: number
  building: string | null
  unitLabel: string | null
  categoryFamily: string
  completedCount: number
  openCount: number
  reopenedAfterCompletion: boolean
}

export type RecurringRepairsResult = {
  available: boolean
  found: boolean
  patterns: RecurringRepairPattern[]
  /** Kept for Tier-1 QC wire-up; answer markdown must not dump RISK/PREVENT/VENDOR cards. */
  propertyInsights: PropertyInsightsResult | null
  ticketCount: number
  completedTicketCount: number
  completedWorkflowCount: number
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  windowDays: number
}

type RepairTypeDef = {
  id: RepairTypeId
  label: string
  family: string
  terms: string[]
}

/** More specific first — first match wins. */
const REPAIR_TYPES: RepairTypeDef[] = [
  {
    id: "faucet_sink_leaks",
    label: "Faucet and sink leaks",
    family: "plumbing",
    terms: [
      "faucet",
      "sink leak",
      "leaking faucet",
      "faucet drip",
      "dripping faucet",
      "kitchen sink",
      "bathroom sink",
      "sink drip",
      "sink leak",
      "under sink",
      "under cabinet",
      "tap leak",
      "spigot",
    ],
  },
  {
    id: "drain_problems",
    label: "Drain problems",
    family: "plumbing",
    terms: [
      "drain",
      "clogged",
      "clog",
      "slow drain",
      "slow draining",
      "stopped up",
      "backup",
      "sewer",
      "sewage",
    ],
  },
  {
    id: "toilet_issues",
    label: "Toilet issues",
    family: "plumbing",
    terms: ["toilet", "commode", "running toilet", "toilet backup"],
  },
  {
    id: "pipe_leaks",
    label: "Pipe leaks",
    family: "plumbing",
    terms: ["pipe leak", "pipe", "burst pipe", "water line", "supply line"],
  },
  {
    id: "water_heater",
    label: "Water heater",
    family: "plumbing",
    terms: ["water heater", "hot water heater", "no hot water", "boiler"],
  },
  {
    id: "low_water_pressure",
    label: "Low water pressure",
    family: "plumbing",
    terms: ["low pressure", "low water pressure", "weak pressure"],
  },
  {
    id: "flooding",
    label: "Flooding / water damage",
    family: "plumbing",
    terms: ["flood", "flooding", "standing water", "water damage"],
  },
  {
    id: "plumbing_general",
    label: "Plumbing repairs",
    family: "plumbing",
    terms: ["plumbing", "leak", "leaking", "water"],
  },
  {
    id: "ac_not_cooling",
    label: "AC not cooling",
    family: "hvac",
    terms: [
      "ac not cooling",
      "not cooling",
      "no cooling",
      "warm air",
      "air conditioning",
      "a/c",
      "ac down",
      "ac is down",
      "the ac",
      "no ac",
    ],
  },
  {
    id: "no_heat",
    label: "No heat / furnace",
    family: "hvac",
    terms: ["no heat", "furnace", "not heating", "heater", "heating"],
  },
  {
    id: "thermostat",
    label: "Thermostat issues",
    family: "hvac",
    terms: ["thermostat"],
  },
  {
    id: "compressor",
    label: "Compressor / condenser",
    family: "hvac",
    terms: ["compressor", "condenser", "refrigerant"],
  },
  {
    id: "hvac_general",
    label: "HVAC repairs",
    family: "hvac",
    terms: ["hvac", "heat pump", "air handler", "ventilation"],
  },
  {
    id: "outlet_issues",
    label: "Outlet not working",
    family: "electrical",
    terms: ["outlet", "receptacle", "socket"],
  },
  {
    id: "breaker_tripping",
    label: "Breaker tripping",
    family: "electrical",
    terms: [
      "breaker tripping",
      "breaker keeps",
      "keeps tripping",
      "tripping breaker",
      "circuit breaker",
      "breaker trip",
    ],
  },
  {
    id: "power_loss",
    label: "Power loss",
    family: "electrical",
    terms: ["power loss", "no power", "outage", "electrical outage"],
  },
  {
    id: "sparking",
    label: "Sparking / wiring",
    family: "electrical",
    terms: ["sparking", "spark", "burning plastic", "wiring", "wire"],
  },
  {
    id: "electrical_general",
    label: "Electrical repairs",
    family: "electrical",
    terms: ["electrical", "electric"],
  },
  {
    id: "appliance",
    label: "Appliance repairs",
    family: "appliance",
    terms: ["appliance", "fridge", "refrigerator", "dishwasher", "washer", "dryer", "oven", "stove"],
  },
  {
    id: "pest",
    label: "Pest control",
    family: "pest",
    terms: ["pest", "roach", "rodent", "mice", "mouse", "bed bug", "termite"],
  },
]

const FAMILY_FROM_CATEGORY: Record<string, string> = {
  plumbing: "plumbing",
  plumb: "plumbing",
  hvac: "hvac",
  heating: "hvac",
  cooling: "hvac",
  electrical: "electrical",
  electric: "electrical",
  appliance: "appliance",
  pest: "pest",
}

function buildingFromUnitField(raw: unknown): string | null {
  const s = String(raw ?? "").trim()
  if (!s.includes("·")) return null
  const left = s.split("·")[0]?.trim() ?? ""
  return left || null
}

function normalizeUnitLabel(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^unit\s+/, "")
  if (s.includes("·")) {
    const right = s.split("·").pop()?.trim() ?? ""
    return right.replace(/^unit\s+/, "")
  }
  return s
}

function displayUnit(unitKey: string): string {
  return `Unit ${unitKey.toUpperCase()}`
}

/** Map category + description into a specific repair type (not only broad family). */
export function normalizeRepairType(
  issueCategory: string | null | undefined,
  description: string | null | undefined = null,
): { id: RepairTypeId; label: string; family: string } {
  const desc = (description ?? "").toLowerCase()
  const cat = (issueCategory ?? "").toLowerCase().replace(/_/g, " ")
  const hay = ` ${cat} ${desc} `.replace(/\s+/g, " ")
  const catKey = cat.trim().replace(/\s+/g, "_")
  const familyHint =
    FAMILY_FROM_CATEGORY[catKey] ?? FAMILY_FROM_CATEGORY[cat.split(" ")[0] ?? ""] ?? null

  const matchIn = (defs: typeof REPAIR_TYPES) => {
    for (const def of defs) {
      if (
        def.terms.some((t) => {
          const term = t.toLowerCase()
          if (term.startsWith(" ") || term.endsWith(" ")) return hay.includes(term)
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          return new RegExp(`\\b${escaped}\\b`, "i").test(hay)
        })
      ) {
        return { id: def.id, label: def.label, family: def.family }
      }
    }
    return null
  }

  // Prefer repair types in the ticket's category family so HVAC terms don't
  // steal electrical tickets that mention "AC compressor", etc.
  if (familyHint) {
    const familyHit = matchIn(REPAIR_TYPES.filter((d) => d.family === familyHint))
    if (familyHit) return familyHit
  }

  const anyHit = matchIn(REPAIR_TYPES)
  if (anyHit) return anyHit

  if (familyHint === "plumbing") {
    return { id: "plumbing_general", label: "Plumbing repairs", family: "plumbing" }
  }
  if (familyHint === "hvac") {
    return { id: "hvac_general", label: "HVAC repairs", family: "hvac" }
  }
  if (familyHint === "electrical") {
    return { id: "electrical_general", label: "Electrical repairs", family: "electrical" }
  }
  return {
    id: "general",
    label: cat ? cat.replace(/\b\w/g, (c) => c.toUpperCase()) : "General repair",
    family: "general",
  }
}

/** @deprecated Prefer normalizeRepairType — kept for existing tests. */
export function normalizeRepairFamily(
  issueCategory: string | null | undefined,
  description: string | null | undefined = null,
): string {
  return normalizeRepairType(issueCategory, description).family
}

function isCompletedVendorStatus(vendorStatus: unknown): boolean {
  const v = String(vendorStatus ?? "").toLowerCase()
  return v === "completed" || v === "closed"
}

function isOpenVendorStatus(vendorStatus: unknown): boolean {
  if (isCompletedVendorStatus(vendorStatus)) return false
  const v = String(vendorStatus ?? "").toLowerCase()
  // Match other Ask Ulo ops lookups: cancelled/declined are not "open repairs".
  return !["cancelled", "canceled", "declined"].includes(v)
}

type TicketRow = {
  id: string
  building: string | null
  unitKey: string
  repairTypeId: RepairTypeId
  repairTypeLabel: string
  family: string
  createdAt: number
  completed: boolean
  open: boolean
  description: string
}

type Agg = {
  count: number
  completedCount: number
  openCount: number
  building: string | null
  unitKey: string | null
  repairTypeId: RepairTypeId
  repairTypeLabel: string
  family: string
  timestamps: number[]
  completedAts: number[]
}

function reopened(agg: Agg): boolean {
  if (agg.completedAts.length === 0 || agg.timestamps.length < 2) return false
  const firstCompleted = Math.min(...agg.completedAts)
  return agg.timestamps.some((ts) => ts > firstCompleted)
}

function bump(
  map: Map<string, Agg>,
  key: string,
  meta: Omit<Agg, "count" | "completedCount" | "openCount" | "timestamps" | "completedAts">,
  ticket: TicketRow,
) {
  const cur = map.get(key) ?? {
    count: 0,
    completedCount: 0,
    openCount: 0,
    timestamps: [] as number[],
    completedAts: [] as number[],
    ...meta,
  }
  cur.count += 1
  if (ticket.completed) {
    cur.completedCount += 1
    cur.completedAts.push(ticket.createdAt)
  }
  if (ticket.open) cur.openCount += 1
  cur.timestamps.push(ticket.createdAt)
  map.set(key, cur)
}

function specificityRank(id: RepairTypeId): number {
  // Higher = more decision-useful. Never lead with catch-all "general".
  if (id === "general") return 0
  if (id.endsWith("_general")) return 1
  return 2
}

function buildMarkdown(input: {
  patterns: RecurringRepairPattern[]
  ticketCount: number
  completedTicketCount: number
}): string {
  const { patterns, ticketCount, completedTicketCount } = input
  const repairTypePatterns = patterns
    .filter((p) => p.kind === "repair_type" && p.repairTypeId !== "general")
    .sort((a, b) => {
      const s = specificityRank(b.repairTypeId) - specificityRank(a.repairTypeId)
      if (s !== 0) return s
      return b.count - a.count
    })
  const unitPatterns = patterns.filter(
    (p) =>
      p.kind === "unit_repair" &&
      p.reopenedAfterCompletion &&
      p.repairTypeId !== "general",
  )
  const top =
    repairTypePatterns.find((p) => specificityRank(p.repairTypeId) >= 2) ??
    repairTypePatterns[0] ??
    patterns.find((p) => p.kind === "property_repair" && p.repairTypeId !== "general") ??
    null

  if (!top) {
    return [
      "I checked open maintenance requests, completed work orders, and completed maintenance workflow runs from the last 60 days.",
      "",
      "### What I know",
      ticketCount > 0
        ? `There were **${ticketCount}** maintenance records in that window (**${completedTicketCount}** completed), but no shared repair type repeated enough times (2+) to call a confirmed recurrence yet.`
        : "There weren't enough recent open or completed repair records in the last 60 days to spot a repeating repair type.",
      "",
      "### What happens next",
      "As the same faucet leak, drain issue, or HVAC failure closes and comes back, those repair-level patterns will show up here.",
    ].join("\n")
  }

  const place = top.building ? ` at ${top.building}` : ""
  const parts: string[] = [
    `The repair that keeps recurring most often is **${top.repairTypeLabel.toLowerCase()}**${place}.`,
    "",
    "### Repeated repairs",
  ]

  const listedTypes = repairTypePatterns
    .filter((p) => specificityRank(p.repairTypeId) >= 2)
    .slice(0, 5)
  const listedFamilies = repairTypePatterns
    .filter((p) => specificityRank(p.repairTypeId) === 1)
    .slice(0, 2)
  for (const p of [...listedTypes, ...listedFamilies]) {
    const placeBit = p.building ? ` at ${p.building}` : ""
    parts.push(
      `- **${p.repairTypeLabel}:** ${p.count} request${p.count === 1 ? "" : "s"} in the last ${WINDOW_DAYS} days${placeBit}` +
        (p.completedCount > 0 ? ` (${p.completedCount} completed)` : ""),
    )
  }

  for (const p of unitPatterns.slice(0, 3)) {
    parts.push(
      `- **${p.unitLabel}:** ${p.count} ${p.repairTypeLabel.toLowerCase()} request${p.count === 1 ? "" : "s"}, including an issue that returned after completion`,
    )
  }

  const reopenAny = patterns.some(
    (p) => p.reopenedAfterCompletion && p.repairTypeId !== "general",
  )
  parts.push("")
  if (reopenAny) {
    parts.push(
      `This suggests ${place ? "the property" : "these buildings"} may have an underlying ${top.categoryFamily} problem rather than several isolated repairs — at least one completed repair was reported again.`,
    )
  } else {
    parts.push(
      `This suggests ${place ? "the property" : "these buildings"} may have an underlying ${top.categoryFamily} problem rather than several isolated repairs.`,
    )
  }

  parts.push("")
  parts.push(
    `I'd review the completed ${top.repairTypeLabel.toLowerCase()} work orders and vendor notes before approving another temporary repair.`,
  )

  return parts.join("\n")
}

/**
 * Recurring repair analysis from open + completed tickets/workflows (60d).
 * Repair-type evidence only — no Needs Attention / Prevent / Vendor Response cards.
 */
export async function recurringRepairsLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<RecurringRepairsResult> {
  const landlordId = input.landlordId.trim()
  const empty: RecurringRepairsResult = {
    available: false,
    found: false,
    patterns: [],
    propertyInsights: null,
    ticketCount: 0,
    completedTicketCount: 0,
    completedWorkflowCount: 0,
    bullets: [],
    citations: [],
    markdown: "",
    windowDays: WINDOW_DAYS,
  }
  if (!landlordId) return empty

  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString()

  const [ticketsEnrichedRes, unitsRes, workflowsRes, graphRes] = await Promise.all([
    supabase
      .from("maintenance_request_enriched")
      .select(
        "id, building, unit, issue_category, description, vendor_work_status, created_at, assigned_vendor_id",
      )
      .eq("landlord_id", landlordId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(400),
    supabase
      .from("units")
      .select("unit_label, building")
      .eq("landlord_id", landlordId)
      .limit(500),
    supabase
      .from("workflow_runs")
      .select("id, template_id, status, current_step, entity_id, started_at, completed_at, metadata")
      .eq("landlord_id", landlordId)
      .in("template_id", ["maintenance_request", "maintenance_intake"])
      .or(
        `status.eq.completed,current_step.eq.completed,current_step.eq.closed,current_step.eq.done`,
      )
      .gte("started_at", sinceIso)
      .limit(250),
    supabase
      .from("operations_graph_events")
      .select("id, event_type, source, metadata, created_at")
      .eq("landlord_id", landlordId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(80),
  ])

  type TicketSource = {
    id: unknown
    building?: unknown
    unit: unknown
    issue_category: unknown
    description: unknown
    vendor_work_status: unknown
    created_at: unknown
    assigned_vendor_id?: unknown
  }

  let ticketsRaw: TicketSource[] = (ticketsEnrichedRes.data ?? []) as TicketSource[]
  if (ticketsEnrichedRes.error) {
    console.error(
      "[ask_ulo/recurringRepairsLookup] enriched",
      ticketsEnrichedRes.error.message,
    )
    // Fallback: base table (same columns Overview uses when the view shape drifts).
    const fallback = await supabase
      .from("maintenance_requests")
      .select(
        "id, unit, issue_category, description, vendor_work_status, created_at, assigned_vendor_id",
      )
      .eq("landlord_id", landlordId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(400)
    if (fallback.error) {
      console.error("[ask_ulo/recurringRepairsLookup]", fallback.error.message)
      return {
        ...empty,
        available: false,
        markdown: "Recurring-repair history could not be loaded from live ops data.",
      }
    }
    ticketsRaw = (fallback.data ?? []) as TicketSource[]
  }

  if (graphRes.error) {
    console.error("[ask_ulo/recurringRepairsLookup] graph", graphRes.error.message)
  }

  const buildingByUnitLabel = new Map<string, string>()
  for (const u of unitsRes.data ?? []) {
    const label = normalizeUnitLabel(u.unit_label)
    const building = typeof u.building === "string" ? u.building.trim() : ""
    if (label && building) buildingByUnitLabel.set(label, building)
  }

  const tickets: TicketRow[] = ticketsRaw.map((t) => {
    const unitKey = normalizeUnitLabel(t.unit)
    const building =
      (typeof (t as { building?: unknown }).building === "string" &&
        String((t as { building?: unknown }).building).trim()) ||
      buildingFromUnitField(t.unit) ||
      buildingByUnitLabel.get(unitKey) ||
      null
    const typed = normalizeRepairType(
      typeof t.issue_category === "string" ? t.issue_category : null,
      typeof t.description === "string" ? t.description : null,
    )
    const createdAt = new Date(String(t.created_at ?? "")).getTime()
    const vendorStatus = t.vendor_work_status
    return {
      id: String(t.id),
      building,
      unitKey,
      repairTypeId: typed.id,
      repairTypeLabel: typed.label,
      family: typed.family,
      createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      completed: isCompletedVendorStatus(vendorStatus),
      open: isOpenVendorStatus(vendorStatus),
      description: typeof t.description === "string" ? t.description : "",
    }
  })

  const completedWorkflowCount = (workflowsRes.data ?? []).length
  const completedEntityIds = new Set(
    (workflowsRes.data ?? [])
      .map((w) => (typeof w.entity_id === "string" ? w.entity_id : null))
      .filter((id): id is string => Boolean(id)),
  )
  for (const t of tickets) {
    if (completedEntityIds.has(t.id) && !t.completed) {
      t.completed = true
      t.open = false
    }
  }

  // Vendor completion notes from workflow metadata (when present) can refine repair type.
  for (const w of workflowsRes.data ?? []) {
    const entityId = typeof w.entity_id === "string" ? w.entity_id : null
    if (!entityId) continue
    const meta = (w.metadata ?? {}) as Record<string, unknown>
    const note = [
      meta.vendor_notes,
      meta.completion_notes,
      meta.notes,
      meta.resolution,
      meta.work_performed,
    ]
      .filter((x) => typeof x === "string" && x.trim())
      .join(" ")
    if (!note) continue
    const ticket = tickets.find((t) => t.id === entityId)
    if (!ticket) continue
    const refined = normalizeRepairType(ticket.family, `${ticket.description} ${note}`)
    // Prefer more specific than *_general / general.
    if (
      refined.id !== "general" &&
      !refined.id.endsWith("_general") &&
      (ticket.repairTypeId === "general" || ticket.repairTypeId.endsWith("_general"))
    ) {
      ticket.repairTypeId = refined.id
      ticket.repairTypeLabel = refined.label
      ticket.family = refined.family
    }
  }

  const completedTicketCount = tickets.filter((t) => t.completed).length
  const graphEventCount = (graphRes.data ?? []).length

  const byRepairType = new Map<string, Agg>()
  const byPropertyRepair = new Map<string, Agg>()
  const byUnitRepair = new Map<string, Agg>()

  for (const t of tickets) {
    bump(
      byRepairType,
      t.repairTypeId,
      {
        building: t.building,
        unitKey: null,
        repairTypeId: t.repairTypeId,
        repairTypeLabel: t.repairTypeLabel,
        family: t.family,
      },
      t,
    )
    if (t.building) {
      bump(
        byPropertyRepair,
        `${t.building}|${t.repairTypeId}`,
        {
          building: t.building,
          unitKey: null,
          repairTypeId: t.repairTypeId,
          repairTypeLabel: t.repairTypeLabel,
          family: t.family,
        },
        t,
      )
    }
    if (t.unitKey) {
      bump(
        byUnitRepair,
        `${t.unitKey}|${t.repairTypeId}`,
        {
          building: t.building,
          unitKey: t.unitKey,
          repairTypeId: t.repairTypeId,
          repairTypeLabel: t.repairTypeLabel,
          family: t.family,
        },
        t,
      )
    }
  }

  const patterns: RecurringRepairPattern[] = []

  for (const [, agg] of byRepairType) {
    if (agg.count < MIN_PATTERN_COUNT) continue
    if (agg.repairTypeId === "general") continue
    const dominantBuilding =
      [...byPropertyRepair.values()]
        .filter((p) => p.repairTypeId === agg.repairTypeId && p.count >= 1)
        .sort((a, b) => b.count - a.count)[0]?.building ?? agg.building
    patterns.push({
      kind: "repair_type",
      repairTypeId: agg.repairTypeId,
      repairTypeLabel: agg.repairTypeLabel,
      label: agg.repairTypeLabel,
      count: agg.count,
      building: dominantBuilding,
      unitLabel: null,
      categoryFamily: agg.family,
      completedCount: agg.completedCount,
      openCount: agg.openCount,
      reopenedAfterCompletion: reopened(agg),
    })
  }

  for (const [, agg] of byPropertyRepair) {
    if (agg.count < MIN_PATTERN_COUNT || !agg.building) continue
    if (agg.repairTypeId === "general") continue
    patterns.push({
      kind: "property_repair",
      repairTypeId: agg.repairTypeId,
      repairTypeLabel: agg.repairTypeLabel,
      label: `${agg.repairTypeLabel} — ${agg.building}`,
      count: agg.count,
      building: agg.building,
      unitLabel: null,
      categoryFamily: agg.family,
      completedCount: agg.completedCount,
      openCount: agg.openCount,
      reopenedAfterCompletion: reopened(agg),
    })
  }

  for (const [, agg] of byUnitRepair) {
    // Same unit + same repair type ≥2, or reopen after completion.
    if (!agg.unitKey || agg.repairTypeId === "general") continue
    const didReopen = reopened(agg)
    if (agg.count < MIN_PATTERN_COUNT) continue
    patterns.push({
      kind: "unit_repair",
      repairTypeId: agg.repairTypeId,
      repairTypeLabel: agg.repairTypeLabel,
      label: `${displayUnit(agg.unitKey)}: ${agg.repairTypeLabel}`,
      count: agg.count,
      building: agg.building,
      unitLabel: displayUnit(agg.unitKey),
      categoryFamily: agg.family,
      completedCount: agg.completedCount,
      openCount: agg.openCount,
      reopenedAfterCompletion: didReopen,
    })
  }

  patterns.sort((a, b) => {
    const s = specificityRank(b.repairTypeId) - specificityRank(a.repairTypeId)
    if (s !== 0) return s
    if (b.count !== a.count) return b.count - a.count
    const rank = (k: RecurringRepairPattern["kind"]) =>
      k === "repair_type" ? 0 : k === "property_repair" ? 1 : 2
    return rank(a.kind) - rank(b.kind)
  })

  const found = patterns.some(
    (p) =>
      p.repairTypeId !== "general" &&
      (p.kind === "repair_type" || p.kind === "property_repair" || p.kind === "unit_repair"),
  )
  const markdown = buildMarkdown({
    patterns,
    ticketCount: tickets.length,
    completedTicketCount,
  })

  console.log(
    "ASK_ULO_RECURRING_REPAIRS",
    JSON.stringify({
      landlordId,
      found,
      ticketCount: tickets.length,
      completedTicketCount,
      completedWorkflowCount,
      graphEventCount,
      patternCount: patterns.length,
      top: patterns[0]
        ? {
            label: patterns[0].label,
            repairType: patterns[0].repairTypeId,
            count: patterns[0].count,
          }
        : null,
    }),
  )

  return {
    available: true,
    found,
    patterns,
    propertyInsights: null,
    ticketCount: tickets.length,
    completedTicketCount,
    completedWorkflowCount,
    bullets: patterns
      .filter((p) => p.kind === "repair_type")
      .slice(0, 6)
      .map((p) => `${p.repairTypeLabel}: ${p.count}`),
    citations: [
      {
        tool: "ops_graph",
        title: "Recurring repairs (repair-level, 60d open + completed)",
        citation:
          "maintenance_request_enriched (all statuses) + workflow_runs completed + operations_graph_events",
        excerpt: found
          ? patterns
            .filter((p) => p.kind === "repair_type")
            .slice(0, 3)
            .map((p) => `${p.repairTypeLabel} (${p.count})`)
            .join(" · ")
          : "No repeating repair types ≥2 in the last 60 days",
      },
    ],
    markdown,
    windowDays: WINDOW_DAYS,
  }
}

export const RECURRING_REPAIRS_GUIDE = `
## Recurring repair investigation (critical)

For “What repairs keep happening over and over?”:
1. Search open maintenance requests AND completed work orders / workflow runs (60d).
2. Normalize descriptions into specific repair types (faucet leaks, drain problems, AC not cooling) —
   not only broad Plumbing / HVAC cards.
3. A pattern is recurring when property+repair type, unit+repair type ≥2, or a completed repair returns.
4. Lead with the repair type, count, period, and whether work was completed / came back.
5. Do NOT answer with Property Insights “Needs Attention”, “Prevent Future Repairs”, or “Vendor Response”
   headlines. Those are unrelated unless they share the same repair type evidence.
6. Do NOT list the busiest unit by total requests unless those requests share the same repair type.
`.trim()

export function isRecurringRepairsQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  return (
    /\b(keep\s+(?:happening|coming(?:\s+back)?|recurring)|over\s+and\s+over|again\s+and\s+again|recurring\s+(?:issues?|repairs?|problems?)|repeat(?:ed|ing)?\s+repairs?|repairs?\s+that\s+keep|same\s+(?:issue|problem|repair)\s+(?:keeps?|again)|keeps?\s+(?:breaking|failing)|come\s+back\s+over|fixing\s+the\s+same|same\s+problems?\s+repeatedly)\b/i
      .test(q) ||
    /\bwhat\s+(?:repairs?|issues?|problems?|maintenance\s+issues?)\s+keep\b/i.test(q) ||
    /\bwhich\s+repairs?\s+are\s+recurring\b/i.test(q) ||
    /\bare\s+we\s+fixing\s+the\s+same\b/i.test(q)
  )
}

/** Answers that look like Property Insights card dumps instead of repair-level evidence. */
export function looksLikePropertyInsightsHeadlineDump(answer: string): boolean {
  const text = answer.trim()
  if (!text) return true
  const hasInsightsCard =
    /\b(needs\s+attention|prevent\s+future\s+repairs|vendor\s+response)\b/i.test(text)
  const hasRepairEvidence =
    /\b(faucet|drain|toilet|pipe|leak|ac\s+not|cooling|furnace|thermostat|outlet|breaker|plumbing|hvac|electrical|completed|returned|reopened|\d+\s+request)/i
      .test(text)
  if (hasInsightsCard && !hasRepairEvidence) return true
  // Headline-only style with Property Insights section and no repair-type bullets
  if (
    /\bproperty\s+insights\b/i.test(text) &&
    !/\brepeated\s+repairs\b|\brepair\s+that\s+keeps\s+recurring\b/i.test(text)
  ) {
    return true
  }
  return false
}
