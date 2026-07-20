/**
 * Entity-scoped maintenance investigation for Ask Ulo.
 * Locates tickets for a named unit / work order and explains the root cause.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type {
  EntityInvestigationPlan,
  ResolvedEntity,
} from "./entityInvestigation.ts"
import { classifyEntityInvestigation } from "./entityInvestigation.ts"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { formatIncompleteAnswer } from "./missingInfoCommunication.ts"
import { loadVendorNameById } from "./vendorNames.ts"

export type EntityInvestigationTicket = {
  id: string
  displayId: string
  building: string
  unit: string | null
  issueCategory: string
  description: string | null
  status: string
  priority: string | null
  daysOpen: number
  vendorName: string | null
  vendorId: string | null
  createdAt: string
  rootCause: string
  recommendedAction: string
  relatedOpenCount: number
}

export type EntityInvestigationLookupResult = {
  available: boolean
  found: boolean
  missingData: string[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  plan: EntityInvestigationPlan
  primary: EntityInvestigationTicket | null
  related: EntityInvestigationTicket[]
}

const OPEN_VENDOR_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
]

function daysSince(iso: string, nowMs: number): number {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000))
}

function shortDisplayId(id: string): string {
  const clean = id.replace(/-/g, "")
  return `WO-${clean.slice(0, 4).toUpperCase()}`
}

function normalizeUnit(raw: string | null | undefined): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/^unit\s+/i, "")
    .replace(/^#/, "")
    .trim()
}

function unitMatches(ticketUnit: unknown, target: string): boolean {
  const a = normalizeUnit(typeof ticketUnit === "string" ? ticketUnit : null)
  const b = normalizeUnit(target)
  if (!a || !b) return false
  return a === b || a.endsWith(b) || b.endsWith(a)
}

function categoryMatches(
  ticketCategory: unknown,
  description: unknown,
  hint: string | null,
): boolean {
  if (!hint) return true
  const blob = `${ticketCategory ?? ""} ${description ?? ""}`.toLowerCase()
  if (hint === "plumbing") return /plumb|leak|water|drain|pipe|toilet|sink/.test(blob)
  if (hint === "hvac") return /hvac|heat|air|furnace|ac\b|cool/.test(blob)
  if (hint === "electrical") return /electric|outlet|breaker|wiring|light/.test(blob)
  return blob.includes(hint.replace(/_/g, " ")) || blob.includes(hint)
}

function rootCauseFor(status: string, days: number, vendorName: string | null): string {
  if (status === "unassigned") {
    return days >= 3
      ? "no vendor has been assigned yet, so the repair has been sitting in the backlog"
      : "it's still waiting for a vendor assignment"
  }
  if (status === "pending_accept") {
    return vendorName
      ? `${vendorName} hasn't accepted the job yet, so nothing has been scheduled`
      : "the assigned vendor hasn't accepted the job yet, so nothing has been scheduled"
  }
  if (status === "accepted") {
    return vendorName
      ? `${vendorName} accepted it, but a visit still isn't locked in`
      : "a vendor accepted it, but scheduling hasn't moved forward"
  }
  if (status === "in_progress" && days >= 7) {
    return "it's marked in progress, but it's been open longer than you'd want without a clear completion"
  }
  if (status === "in_progress") {
    return "work is marked in progress — progress may still be underway"
  }
  return "it's still open in the maintenance pipeline and the exact blocker isn't fully recorded"
}

function actionFor(status: string, vendorName: string | null): string {
  if (status === "unassigned") {
    return "I'd assign a vendor today — and escalate if this is urgent or involves water."
  }
  if (status === "pending_accept") {
    return vendorName
      ? `I'd follow up with ${vendorName} today. If they can't commit, I'd reassign so the repair doesn't keep aging.`
      : "I'd follow up with the vendor today. If they can't commit, I'd reassign so the repair doesn't keep aging."
  }
  if (status === "accepted") {
    return vendorName
      ? `I'd confirm a schedule with ${vendorName}. If they can't lock in a visit, it's worth reassigning.`
      : "I'd confirm a schedule with the vendor. If they can't lock in a visit, it's worth reassigning."
  }
  return "I'd check progress, confirm the completion target, and escalate if it's still drifting."
}

function whyItMatters(days: number, issue: string, category: string): string {
  const lower = `${issue} ${category}`.toLowerCase()
  if (/plumb|leak|water|flood|drain/.test(lower)) {
    return days >= 7
      ? "Since this is a plumbing issue, delaying repairs increases the risk of water damage and resident dissatisfaction."
      : "Plumbing issues can escalate quickly — worth clearing before water damage or resident frustration grows."
  }
  if (/hvac|heat|ac|air|furnace/.test(lower)) {
    return "HVAC delays hit resident comfort hard and often turn into emergency calls if conditions worsen."
  }
  if (days >= 21) {
    return "Residents notice when something sits this long — and the longer it ages, the more likely it becomes a complaint or a bigger repair."
  }
  return "Leaving this open longer than needed creates avoidable resident friction and backlog risk."
}

function humanStatusLine(status: string): string {
  switch (status) {
    case "unassigned":
      return "Unassigned"
    case "pending_accept":
      return "Assigned — waiting for vendor to accept"
    case "accepted":
      return "Accepted — scheduling not locked in"
    case "in_progress":
      return "In progress"
    default:
      return status.replace(/_/g, " ")
  }
}

function buildMarkdown(
  primary: EntityInvestigationTicket,
  plan: EntityInvestigationPlan,
  related: EntityInvestigationTicket[],
): string {
  const unitRaw = primary.unit?.trim() || null
  const unitBit = unitRaw
    ? /unit\b/i.test(unitRaw)
      ? unitRaw
      : `Unit ${unitRaw}`
    : plan.entities.find((e) => e.kind === "unit")?.label ?? null
  const issue =
    primary.description?.trim() ||
    primary.issueCategory.replace(/_/g, " ") ||
    plan.categoryHint ||
    "maintenance issue"
  const vendor = primary.vendorName?.trim() || null
  const whereCore = unitBit
    ? `in **${unitBit}** at **${primary.building}**`
    : `at **${primary.building}**`

  const lead =
    primary.status === "pending_accept" && vendor
      ? `It looks like the ${issue} ${whereCore} stalled after it was assigned to **${vendor}**.`
      : primary.status === "unassigned"
        ? `The ${issue} ${whereCore} hasn't moved because **no vendor is assigned** yet.`
        : `Here's what's going on with the ${issue} ${whereCore}.`

  const story =
    primary.status === "pending_accept" && vendor
      ? `The vendor hasn't accepted the job yet, so no work has been scheduled. It's been open **${primary.daysOpen} day${primary.daysOpen === 1 ? "" : "s"}**.`
      : `Progress stopped because ${primary.rootCause}. It's been open **${primary.daysOpen} day${primary.daysOpen === 1 ? "" : "s"}**.`

  const detailLines = [
    `- **Property:** ${primary.building}`,
    unitBit ? `- **Unit:** ${unitBit}` : null,
    `- **Issue:** ${issue}`,
    `- **Vendor:** ${vendor ?? "Unassigned"}`,
    `- **Open:** ${primary.daysOpen} day${primary.daysOpen === 1 ? "" : "s"}`,
    `- **Status:** ${humanStatusLine(primary.status)}`,
    primary.relatedOpenCount > 1
      ? `- **Related open tickets on this entity:** ${primary.relatedOpenCount}`
      : null,
  ].filter(Boolean) as string[]

  const parts = [
    lead,
    "",
    story,
    "",
    "## Why it matters",
    whyItMatters(primary.daysOpen, issue, primary.issueCategory),
    "",
    "## Details",
    ...detailLines,
    "",
    "## What I'd do",
    primary.recommendedAction,
  ]

  if (related.length > 0) {
    parts.push(
      "",
      "There are related open tickets on the same entity — worth checking they aren't duplicates before reassigning.",
    )
  }

  if (primary.displayId) {
    parts.push("", `_Reference: ${primary.displayId}_`)
  }

  return parts.join("\n")
}

function missingMarkdown(plan: EntityInvestigationPlan, missing: string[]): string {
  const labels = plan.entities.map((e) => e.label).join(", ") || "that specific issue"
  return formatIncompleteAnswer({
    lead: `I can't explain why ${labels} hasn't been resolved yet.`,
    whatIKnow: `I know you're asking about ${labels}, not a portfolio-wide total.`,
    whatsMissing:
      missing.length > 0
        ? `I still need ${missing.join(", ")} before I can say what's blocking it.`
        : "I need the matching work order's status history, vendor assignment, and how long each step has been waiting.",
    whatHappensNext:
      "Once those details are available, I'll walk through what stalled, why it matters, and what I'd do next for that issue specifically.",
  })
}

type TicketRow = {
  id: string
  building: unknown
  unit: unknown
  issue_category: unknown
  description: unknown
  vendor_work_status: unknown
  assigned_vendor_id: unknown
  priority: unknown
  urgency: unknown
  created_at: unknown
  assigned_at: unknown
}

function toTicket(
  t: TicketRow,
  vendorName: string | null,
  relatedOpenCount: number,
  now: number,
): EntityInvestigationTicket | null {
  const created =
    typeof t.created_at === "string"
      ? t.created_at
      : typeof t.assigned_at === "string"
        ? t.assigned_at
        : null
  if (!created) return null
  const status = typeof t.vendor_work_status === "string" ? t.vendor_work_status : "open"
  const days = daysSince(created, now)
  const building =
    typeof t.building === "string" && t.building.trim() ? t.building.trim() : "Unknown property"
  return {
    id: String(t.id),
    displayId: shortDisplayId(String(t.id)),
    building,
    unit: typeof t.unit === "string" ? t.unit : null,
    issueCategory: typeof t.issue_category === "string" ? t.issue_category : "maintenance",
    description: typeof t.description === "string" ? t.description : null,
    status,
    priority:
      typeof t.priority === "string"
        ? t.priority
        : typeof t.urgency === "string"
          ? t.urgency
          : null,
    daysOpen: days,
    vendorName,
    vendorId: typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null,
    createdAt: created,
    rootCause: rootCauseFor(status, days, vendorName),
    recommendedAction: actionFor(status, vendorName),
    relatedOpenCount,
  }
}

function preferCategory(
  tickets: EntityInvestigationTicket[],
  hint: string | null,
): EntityInvestigationTicket[] {
  if (!hint) return tickets
  const matched = tickets.filter((t) =>
    categoryMatches(t.issueCategory, t.description, hint),
  )
  return matched.length > 0 ? matched : tickets
}

function matchWorkOrder(entities: ResolvedEntity[], id: string, displayId: string): boolean {
  const wo = entities.filter((e) => e.kind === "work_order")
  if (wo.length === 0) return false
  const idNorm = id.toLowerCase().replace(/-/g, "")
  const displayNorm = displayId.toLowerCase().replace(/-/g, "")
  return wo.some((e) => {
    const raw = e.raw.toLowerCase().replace(/-/g, "").replace(/^wo/, "")
    return (
      idNorm === raw ||
      idNorm.startsWith(raw) ||
      displayNorm.includes(raw) ||
      idNorm.includes(raw)
    )
  })
}

function matchProperty(entities: ResolvedEntity[], building: string): boolean {
  const props = entities.filter((e) => e.kind === "property")
  if (props.length === 0) return true
  const b = building.toLowerCase()
  return props.some((e) => b.includes(e.raw.toLowerCase()) || e.raw.toLowerCase().includes(b))
}

/** Investigate a named entity's open maintenance / root-cause blocker. */
export async function entityInvestigationLookup(
  supabase: SupabaseClient,
  input: { landlordId: string; question: string; buildingFilter?: string | null },
): Promise<EntityInvestigationLookupResult> {
  const plan = classifyEntityInvestigation(input.question)
  const landlordId = input.landlordId.trim()
  const buildingFilter = input.buildingFilter?.trim() || null
  const now = Date.now()

  if (!plan.isEntityInvestigation) {
    return {
      available: false,
      found: false,
      missingData: [],
      bullets: [],
      citations: [],
      markdown: "",
      plan,
      primary: null,
      related: [],
    }
  }

  const { data: tickets, error } = await supabase
    .from("maintenance_request_enriched")
    .select(
      "id, building, unit, issue_category, description, vendor_work_status, assigned_vendor_id, priority, urgency, created_at, assigned_at",
    )
    .eq("landlord_id", landlordId)
    .in("vendor_work_status", OPEN_VENDOR_STATUSES)
    .order("created_at", { ascending: true })
    .limit(120)

  if (error) {
    console.error("[ask_ulo/entityInvestigation] tickets", error.message)
    return {
      available: false,
      found: false,
      missingData: ["open work orders (query failed)"],
      bullets: [],
      citations: [],
      markdown: missingMarkdown(plan, ["open work orders (query failed)"]),
      plan,
      primary: null,
      related: [],
    }
  }

  let open = (tickets ?? []) as TicketRow[]
  if (buildingFilter) {
    open = open.filter((t) => {
      const b = typeof t.building === "string" ? t.building : ""
      return b.toLowerCase().includes(buildingFilter.toLowerCase())
    })
  }

  const unitEntities = plan.entities.filter((e) => e.kind === "unit")
  const woEntities = plan.entities.filter((e) => e.kind === "work_order")

  let matched = open.filter((t) => {
    const id = String(t.id)
    const display = shortDisplayId(id)
    if (woEntities.length > 0 && matchWorkOrder(plan.entities, id, display)) return true
    if (unitEntities.length > 0) {
      const unitOk = unitEntities.some((e) => unitMatches(t.unit, e.raw))
      const propOk = matchProperty(plan.entities, typeof t.building === "string" ? t.building : "")
      return unitOk && propOk
    }
    if (plan.entities.some((e) => e.kind === "property")) {
      return matchProperty(plan.entities, typeof t.building === "string" ? t.building : "")
    }
    return false
  })

  if (matched.length === 0 && unitEntities.length > 0) {
    // Soft fallback: unit match without property constraint
    matched = open.filter((t) => unitEntities.some((e) => unitMatches(t.unit, e.raw)))
  }

  if (matched.length === 0) {
    const missing = [
      woEntities.length > 0
        ? `open work order matching ${woEntities.map((e) => e.label).join(", ")}`
        : null,
      unitEntities.length > 0
        ? `open maintenance request for ${unitEntities.map((e) => e.label).join(", ")}`
        : null,
      plan.categoryHint ? `${plan.categoryHint} category linkage` : null,
      "vendor assignment / acceptance history",
    ].filter(Boolean) as string[]

    return {
      available: true,
      found: false,
      missingData: missing,
      bullets: [`No open ticket found for ${plan.entities.map((e) => e.label).join(", ")}.`],
      citations: [],
      markdown: missingMarkdown(plan, missing),
      plan,
      primary: null,
      related: [],
    }
  }

  const vendorIds = [
    ...new Set(
      matched
        .map((t) => (typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null))
        .filter((x): x is string => Boolean(x)),
    ),
  ]
  const vendorNameById = await loadVendorNameById(supabase, { vendorIds })

  const relatedCount = matched.length
  const mapped = matched
    .map((t) => {
      const vid = typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null
      return toTicket(t, vid ? vendorNameById.get(vid) ?? null : null, relatedCount, now)
    })
    .filter((x): x is EntityInvestigationTicket => x != null)

  const preferred = preferCategory(mapped, plan.categoryHint)
  // Prefer oldest / most stalled as primary
  preferred.sort((a, b) => b.daysOpen - a.daysOpen)
  const primary = preferred[0]!
  const related = preferred.slice(1, 4)

  // Optional: recent ops graph events for this unit/ticket (best-effort)
  const bullets = [
    `Investigating ${plan.entities.map((e) => e.label).join(", ")}${
      plan.categoryHint ? ` (${plan.categoryHint})` : ""
    }.`,
    `Primary ticket ${primary.displayId}: ${primary.issueCategory} — ${primary.status} @ ${primary.building}${
      primary.unit ? ` · ${primary.unit}` : ""
    } (${primary.daysOpen}d). Root cause: ${primary.rootCause}.`,
  ]
  for (const r of related) {
    bullets.push(
      `Related ${r.displayId}: ${r.issueCategory} — ${r.status} (${r.daysOpen}d).`,
    )
  }

  const citations: AskUloCitation[] = [
    {
      tool: "ops_graph",
      title: `Entity investigation: ${plan.entities.map((e) => e.label).join(", ")}`,
      citation: "maintenance_request_enriched",
      excerpt: `${primary.displayId} — ${primary.rootCause}`,
    },
  ]

  return {
    available: true,
    found: true,
    missingData: [],
    bullets,
    citations,
    markdown: buildMarkdown(primary, plan, related),
    plan,
    primary,
    related,
  }
}
