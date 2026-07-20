/**
 * Oldest unresolved work order for Ask Ulo.
 * Answers “Which work order has been waiting the longest?” with a single ranked ticket.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { incompleteOldestWaitingAnswer } from "./missingInfoCommunication.ts"

export type OldestWaitingWorkOrder = {
  id: string
  displayId: string
  building: string
  unit: string | null
  issueCategory: string
  description: string | null
  status: string
  priority: string | null
  daysWaiting: number
  vendorName: string | null
  vendorId: string | null
  createdAt: string
  reasonWaiting: string
  recommendedAction: string
}

export type OldestWaitingWorkOrderResult = {
  available: boolean
  found: boolean
  missingData: string[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  openCount: number
  oldest: OldestWaitingWorkOrder | null
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

function humanStatus(status: string): string {
  switch (status) {
    case "unassigned":
      return "Unassigned"
    case "pending_accept":
      return "Assigned — waiting for vendor to accept"
    case "accepted":
      return "Accepted — awaiting scheduling or on-site work"
    case "in_progress":
      return "In progress"
    default:
      return status.replace(/_/g, " ")
  }
}

function reasonFor(status: string, days: number, vendorName: string | null): string {
  if (status === "unassigned") {
    return days >= 3
      ? "no vendor has been assigned yet, so it's been sitting in the backlog"
      : "it's still waiting for a vendor assignment"
  }
  if (status === "pending_accept") {
    return vendorName
      ? `${vendorName} still hasn't accepted the assignment`
      : "the assigned vendor still hasn't accepted the job"
  }
  if (status === "accepted") {
    return vendorName
      ? `${vendorName} accepted it, but nothing has actually moved forward on scheduling`
      : "a vendor accepted it, but scheduling hasn't moved forward"
  }
  if (status === "in_progress" && days >= 7) {
    return "it's marked in progress, but it's been open longer than you'd want"
  }
  return "it's still open in the maintenance pipeline"
}

function actionFor(status: string, vendorName: string | null): string {
  if (status === "unassigned") {
    return "I'd assign a vendor today — and escalate if this is urgent."
  }
  if (status === "pending_accept") {
    return vendorName
      ? `I'd reach out to ${vendorName} today. If they can't commit, I'd reassign the job so it doesn't keep aging.`
      : "I'd follow up with the vendor today. If they can't commit, I'd reassign the job so it doesn't keep aging."
  }
  if (status === "accepted") {
    return vendorName
      ? `I'd confirm a schedule with ${vendorName}. If they can't lock in a visit, it's worth reassigning.`
      : "I'd confirm a schedule with the vendor. If they can't lock in a visit, it's worth reassigning."
  }
  return "I'd check in on progress and set a clear completion target."
}

function shortDisplayId(id: string): string {
  const clean = id.replace(/-/g, "")
  return `WO-${clean.slice(0, 4).toUpperCase()}`
}

function waitingPhrase(days: number): string {
  if (days >= 55) return `nearly ${Math.round(days / 30)} months`
  if (days >= 28) return `about ${Math.round(days / 7)} weeks`
  if (days === 1) return "a day"
  return `${days} days`
}

function whyItMatters(days: number, issue: string): string {
  const lower = issue.toLowerCase()
  if (days >= 30 && /plumb|leak|water|flood/i.test(lower)) {
    return "At this age, the repair is becoming a risk for resident satisfaction — and a lingering leak can turn into a larger plumbing issue if it keeps sitting."
  }
  if (days >= 30 && /hvac|heat|ac|air\s*cond/i.test(lower)) {
    return "Leaving this open that long is hard on residents and can push the issue into an emergency if conditions get worse."
  }
  if (days >= 21) {
    return "Residents notice when something sits this long — and the longer it ages, the more likely it becomes a complaint or a bigger repair."
  }
  if (days >= 7) {
    return "It's already past where you'd want an open repair to sit."
  }
  return "Worth clearing soon so it doesn't become the oldest item in the backlog."
}

function buildStory(oldest: OldestWaitingWorkOrder): string {
  const days = oldest.daysWaiting
  const vendor = oldest.vendorName?.trim() || null
  const dayBit = `**${days} day${days === 1 ? "" : "s"}**`

  if (oldest.status === "unassigned") {
    return `This repair has been sitting for ${dayBit} with **no vendor assigned** yet.`
  }
  if (oldest.status === "pending_accept") {
    return vendor
      ? `This repair has been sitting for ${dayBit} because **${vendor}** still hasn't accepted the assignment. It's assigned on paper, but nothing has actually moved forward.`
      : `This repair has been sitting for ${dayBit} because the assigned vendor still hasn't accepted. It's assigned on paper, but nothing has actually moved forward.`
  }
  if (oldest.status === "accepted") {
    return vendor
      ? `This repair has been sitting for ${dayBit}. **${vendor}** accepted it, but the visit still isn't locked in.`
      : `This repair has been sitting for ${dayBit}. A vendor accepted it, but the visit still isn't locked in.`
  }
  if (oldest.status === "in_progress") {
    return vendor
      ? `This repair has been open for ${dayBit}. **${vendor}** has it in progress, but it's aging longer than you'd want.`
      : `This repair has been open for ${dayBit} and is marked in progress, but it's aging longer than you'd want.`
  }
  return `This repair has been sitting for ${dayBit} because ${oldest.reasonWaiting}.`
}

function humanStatusLine(status: string): string {
  switch (status) {
    case "unassigned":
      return "Unassigned"
    case "pending_accept":
      return "Assigned but awaiting vendor acceptance"
    case "accepted":
      return "Accepted — scheduling not locked in"
    case "in_progress":
      return "In progress"
    default:
      return status.replace(/_/g, " ")
  }
}

function buildMarkdown(oldest: OldestWaitingWorkOrder, _openCount: number): string {
  const unitRaw = oldest.unit?.trim() || null
  const unitBit = unitRaw
    ? /unit\b/i.test(unitRaw)
      ? unitRaw
      : `Unit ${unitRaw}`
    : null
  const issue =
    oldest.description?.trim() ||
    oldest.issueCategory.replace(/_/g, " ") ||
    "maintenance issue"
  const vendor = oldest.vendorName?.trim() || null
  const days = oldest.daysWaiting
  const wait = waitingPhrase(days)

  const whereCore = unitBit
    ? `in **${unitBit}** at **${oldest.building}**`
    : `at **${oldest.building}**`

  const leadOptions = [
    `The one that's been sitting the longest is a ${issue} ${whereCore}.`,
    `I'd be watching the ${issue} ${whereCore} most closely — it's been waiting **${wait}**.`,
    `There's a ${issue} ${whereCore} that's been waiting **${wait}**.`,
  ]
  const lead =
    leadOptions[Math.abs(oldest.id.charCodeAt(0) + days) % leadOptions.length]!

  const detailLines = [
    `- **Property:** ${oldest.building}`,
    unitBit ? `- **Unit:** ${unitBit}` : null,
    `- **Issue:** ${issue}`,
    `- **Vendor:** ${vendor ?? "Unassigned"}`,
    `- **Waiting:** ${days} day${days === 1 ? "" : "s"}`,
    `- **Status:** ${humanStatusLine(oldest.status)}`,
  ].filter(Boolean) as string[]

  const parts = [
    lead,
    "",
    buildStory(oldest),
    "",
    "## Why it matters",
    whyItMatters(days, issue),
    "",
    "## Details",
    ...detailLines,
    "",
    "## What I'd do",
    oldest.recommendedAction,
  ]

  if (oldest.displayId) {
    parts.push("", `_Reference: ${oldest.displayId}_`)
  }

  return parts.join("\n")
}

function missingMarkdown(missing: string[], openCount: number): string {
  if (openCount === 0) {
    return "Good news — there aren't any open work orders right now, so nothing is waiting."
  }
  // Prefer landlord 3-part voice; fold technical gaps into What's missing.
  const base = incompleteOldestWaitingAnswer()
  if (missing.length === 0) return base
  return base.replace(
    /\*\*What's missing\*\*\n[^\n]+/,
    `**What's missing**\nI don't have ${missing.join(", ")} tied clearly to each open ticket — so I can't pick the single oldest one with confidence.`,
  )
}

/** Find the single oldest unresolved work order for the landlord. */
export async function oldestWaitingWorkOrderLookup(
  supabase: SupabaseClient,
  input: { landlordId: string; buildingFilter?: string | null },
): Promise<OldestWaitingWorkOrderResult> {
  const landlordId = input.landlordId.trim()
  const buildingFilter = input.buildingFilter?.trim() || null
  const missingData: string[] = []
  const now = Date.now()

  const { data: tickets, error } = await supabase
    .from("maintenance_request_enriched")
    .select(
      "id, building, unit, issue_category, description, vendor_work_status, assigned_vendor_id, priority, urgency, created_at, assigned_at",
    )
    .eq("landlord_id", landlordId)
    .in("vendor_work_status", OPEN_VENDOR_STATUSES)
    .order("created_at", { ascending: true })
    .limit(100)

  if (error) {
    console.error("[ask_ulo/oldestWaitingWO] tickets", error.message)
    return {
      available: false,
      found: false,
      missingData: ["open work orders (query failed)"],
      bullets: [],
      citations: [],
      markdown: missingMarkdown(["open work orders (query failed)"], 0),
      openCount: 0,
      oldest: null,
    }
  }

  let open = tickets ?? []
  if (buildingFilter) {
    open = open.filter((t) => {
      const b = typeof t.building === "string" ? t.building : ""
      return b.toLowerCase().includes(buildingFilter.toLowerCase())
    })
  }

  if (open.length === 0) {
    return {
      available: true,
      found: false,
      missingData: [],
      bullets: ["No open work orders — nothing is waiting."],
      citations: [],
      markdown: missingMarkdown([], 0),
      openCount: 0,
      oldest: null,
    }
  }

  // Prefer created_at; fall back to assigned_at if created missing
  const scored = open
    .map((t) => {
      const created =
        typeof t.created_at === "string"
          ? t.created_at
          : typeof t.assigned_at === "string"
            ? t.assigned_at
            : null
      if (!created) return null
      return { t, created, days: daysSince(created, now) }
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.days - a.days || a.created.localeCompare(b.created))

  if (scored.length === 0) {
    missingData.push("created/assigned timestamps on open work orders")
    return {
      available: true,
      found: false,
      missingData,
      bullets: [`${open.length} open work orders found, but ages could not be computed.`],
      citations: [],
      markdown: missingMarkdown(missingData, open.length),
      openCount: open.length,
      oldest: null,
    }
  }

  const top = scored[0]!
  const row = top.t
  const vendorId =
    typeof row.assigned_vendor_id === "string" ? row.assigned_vendor_id : null
  let vendorName: string | null = null
  if (vendorId) {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("id, name")
      .eq("landlord_id", landlordId)
      .eq("id", vendorId)
      .maybeSingle()
    if (vendor && typeof vendor.name === "string") vendorName = vendor.name
  }

  const status = typeof row.vendor_work_status === "string" ? row.vendor_work_status : "open"
  const building =
    typeof row.building === "string" && row.building.trim()
      ? row.building.trim()
      : "Unknown property"
  if (building === "Unknown property") missingData.push("property name on oldest ticket")

  const oldest: OldestWaitingWorkOrder = {
    id: String(row.id),
    displayId: shortDisplayId(String(row.id)),
    building,
    unit: typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : null,
    issueCategory:
      typeof row.issue_category === "string" && row.issue_category.trim()
        ? row.issue_category.trim()
        : "maintenance",
    description:
      typeof row.description === "string" && row.description.trim()
        ? row.description.trim().slice(0, 240)
        : null,
    status,
    priority:
      typeof row.priority === "string"
        ? row.priority
        : typeof row.urgency === "string"
          ? row.urgency
          : null,
    daysWaiting: top.days,
    vendorName,
    vendorId,
    createdAt: top.created,
    reasonWaiting: reasonFor(status, top.days, vendorName),
    recommendedAction: actionFor(status, vendorName),
  }

  const markdown = buildMarkdown(oldest, open.length)
  const citations: AskUloCitation[] = [
    {
      tool: "ops_graph",
      title: "Oldest open work order",
      citation: "maintenance_request_enriched + vendors",
      excerpt: `${oldest.displayId} waiting ${oldest.daysWaiting}d @ ${oldest.building}`,
    },
  ]

  return {
    available: true,
    found: true,
    missingData,
    bullets: [
      `Oldest waiting: ${oldest.displayId} — ${oldest.daysWaiting} days @ ${oldest.building}` +
        (oldest.unit ? ` / ${oldest.unit}` : ""),
      `Status: ${humanStatus(oldest.status)}; vendor: ${oldest.vendorName ?? "unassigned"}`,
      oldest.reasonWaiting,
    ],
    citations,
    markdown,
    openCount: open.length,
    oldest,
  }
}
