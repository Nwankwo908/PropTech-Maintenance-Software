/**
 * Work orders missing updates — open tickets stuck without progress.
 * Answers “Which work orders are missing updates?”
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { polishAskUloProse } from "./responsePolish.ts"
import { loadVendorNameById } from "./vendorNames.ts"

const OPEN_VENDOR_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
] as const

export type MissingUpdateItem = {
  displayId: string
  label: string
  building: string | null
  unitLabel: string | null
  status: string
  daysWaiting: number
  whyMissing: string
  nextStep: string
  priority: string | null
}

export type MissingUpdatesResult = {
  available: boolean
  found: boolean
  items: MissingUpdateItem[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  openCount: number
}

function normalizeUnit(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .replace(/^unit\s+/i, "")
  if (s.includes("·")) return (s.split("·").pop() ?? "").trim()
  return s
}

function buildingFromUnit(raw: unknown): string | null {
  const s = String(raw ?? "").trim()
  if (!s.includes("·")) return null
  return s.split("·")[0]?.trim() || null
}

function shortDisplayId(id: string): string {
  const clean = id.replace(/-/g, "")
  return `WO-${clean.slice(0, 4).toUpperCase()}`
}

function daysSince(iso: unknown, nowMs: number): number {
  const t = new Date(String(iso ?? "")).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000))
}

function statusStuckThreshold(status: string): number {
  switch (status) {
    case "unassigned":
      return 1
    case "pending_accept":
      return 1
    case "accepted":
      return 2
    case "in_progress":
      return 5
    default:
      return 3
  }
}

function whyMissingUpdate(
  status: string,
  days: number,
  vendorHint: string | null,
  overdue: boolean,
): string {
  if (overdue) {
    return "The vendor response deadline has already passed with no clear progress"
  }
  if (status === "unassigned") {
    return days >= 3
      ? "Still unassigned — sitting in the backlog with no vendor progress"
      : "No vendor assigned yet, so nothing has started"
  }
  if (status === "pending_accept") {
    return vendorHint
      ? `${vendorHint} still hasn't accepted, so the job hasn't moved`
      : "Assigned on paper, but the vendor still hasn't accepted"
  }
  if (status === "accepted") {
    return vendorHint
      ? `${vendorHint} accepted it, but scheduling / on-site work hasn't been updated`
      : "Accepted, but no scheduling or visit update has come through"
  }
  if (status === "in_progress") {
    return "Marked in progress, but it's been quiet longer than you'd want"
  }
  return "Open with no recent progress update"
}

function nextStepFor(status: string): string {
  if (status === "unassigned") return "Assign (or reassign) a vendor today"
  if (status === "pending_accept") return "Chase acceptance or reassign"
  if (status === "accepted") return "Confirm a visit date"
  if (status === "in_progress") return "Ask for a status update and completion target"
  return "Check in and set a clear next step"
}

function buildMarkdown(items: MissingUpdateItem[]): string {
  if (items.length === 0) {
    return [
      "I don't see open work orders that are going quiet right now — nothing sits past the usual check-in windows.",
      "",
      "### What I'd do",
      "Keep an eye on anything newly assigned — if acceptance stalls past a day, that's when I'd chase.",
    ].join("\n")
  }

  const lead =
    items.length === 1
      ? `**${items[0]!.label}** at ${
          [items[0]!.building, items[0]!.unitLabel ? `Unit ${items[0]!.unitLabel}` : null]
            .filter(Boolean)
            .join(" · ") || "your portfolio"
        } is the open repair going quiet — ${items[0]!.whyMissing.toLowerCase()}.`
      : `These **${items.length}** open repairs are missing updates — nothing meaningful has moved in a while.`

  const parts: string[] = [lead, "", "### Going quiet"]

  for (const item of items.slice(0, 8)) {
    const place = [item.building, item.unitLabel ? `Unit ${item.unitLabel}` : null]
      .filter(Boolean)
      .join(" · ")
    parts.push(
      `- **${item.label}**${place ? ` — ${place}` : ""} (${item.displayId}): ${item.whyMissing} (${item.daysWaiting} day${item.daysWaiting === 1 ? "" : "s"}). I'd ${item.nextStep.charAt(0).toLowerCase()}${item.nextStep.slice(1)}.`,
    )
  }

  parts.push("")
  parts.push("### What I'd do")
  parts.push(
    "I'd chase vendor acceptance and scheduling first — those are where updates usually stall — then fill any trade gaps (appliance, specialty) so tickets don't sit unassigned.",
  )

  return parts.join("\n")
}

export function isMissingUpdatesQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (
    /\b(?:work\s*orders?|tickets?|repairs?|requests?|jobs?)\b.{0,48}\b(?:stuck\s+)?waiting\s+for\s+vendors?\b/i
      .test(q) ||
    /\bwaiting\s+for\s+vendors?\b/i.test(q)
  ) {
    return true
  }
  return (
    /\b(?:work\s*orders?|tickets?|repairs?|requests?)\b.{0,40}\bmissing\s+updates?\b/i.test(q) ||
    /\bmissing\s+updates?\b.{0,40}\b(?:work\s*orders?|tickets?|repairs?|requests?)\b/i.test(q) ||
    /\bwhich\s+(?:work\s*orders?|tickets?|repairs?)\s+(?:are|have\s+been)\s+(?:missing\s+updates?|stale|stuck|silent|going\s+quiet)\b/i.test(
      q,
    ) ||
    /\b(?:work\s*orders?|tickets?|repairs?|requests?)\b.{0,40}\b(?:are\s+)?stale\b/i.test(q) ||
    /\bstale\b.{0,40}\b(?:work\s*orders?|tickets?|repairs?|requests?)\b/i.test(q) ||
    /\b(?:no\s+(?:status\s+)?updates?|haven'?t\s+(?:been\s+)?updated|without\s+(?:an?\s+)?updates?|stale\s+(?:work\s*orders?|tickets?))\b/i.test(
      q,
    ) ||
    /\b(?:work\s*orders?|tickets?|repairs?)\s+(?:with\s+)?no\s+progress\b/i.test(q) ||
    /\bno\s+progress\b.{0,30}\b(?:work\s*orders?|tickets?|repairs?)\b/i.test(q)
  )
}

export async function missingUpdatesLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<MissingUpdatesResult> {
  const landlordId = input.landlordId.trim()
  const empty: MissingUpdatesResult = {
    available: false,
    found: false,
    items: [],
    bullets: [],
    citations: [],
    markdown: "",
    openCount: 0,
  }
  if (!landlordId) return empty

  const now = Date.now()
  const ticketsRes = await supabase
    .from("maintenance_request_enriched")
    .select(
      "id, building, unit, issue_category, description, vendor_work_status, priority, urgency, created_at, assigned_at, due_at, assigned_vendor_id",
    )
    .eq("landlord_id", landlordId)
    .in("vendor_work_status", [...OPEN_VENDOR_STATUSES])
    .order("created_at", { ascending: true })
    .limit(200)

  let tickets: Array<Record<string, unknown>> = (ticketsRes.data ?? []) as Array<
    Record<string, unknown>
  >
  if (ticketsRes.error) {
    console.error("[ask_ulo/missingUpdatesLookup] enriched", ticketsRes.error.message)
    const fallback = await supabase
      .from("maintenance_requests")
      .select(
        "id, unit, issue_category, description, vendor_work_status, priority, urgency, created_at, assigned_at, due_at, assigned_vendor_id",
      )
      .eq("landlord_id", landlordId)
      .in("vendor_work_status", [...OPEN_VENDOR_STATUSES])
      .order("created_at", { ascending: true })
      .limit(200)
    if (fallback.error) {
      console.error("[ask_ulo/missingUpdatesLookup]", fallback.error.message)
      return {
        ...empty,
        available: false,
        markdown:
          "I couldn't load open work orders to see which ones are missing updates right now.",
      }
    }
    tickets = (fallback.data ?? []) as Array<Record<string, unknown>>
  }

  const vendorIds = [
    ...new Set(
      tickets
        .map((t) => (typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const vendorNames = await loadVendorNameById(supabase, { vendorIds })

  const items: MissingUpdateItem[] = []
  for (const t of tickets) {
    const status = String(t.vendor_work_status ?? "")
    const created = String(t.created_at ?? "")
    const assigned = t.assigned_at ? String(t.assigned_at) : null
    const daysCreated = daysSince(created, now)
    const daysAssigned = assigned ? daysSince(assigned, now) : daysCreated
    // Prefer calendar age of the ticket so overdue / reassigned rows don't show "0 days".
    const days = Math.max(daysCreated, daysAssigned)
    const overdue =
      Boolean(t.due_at) && new Date(String(t.due_at)).getTime() < now
    const stuck =
      daysCreated >= statusStuckThreshold(status) ||
      daysAssigned >= statusStuckThreshold(status) ||
      overdue
    if (!stuck) continue

    const unitLabel = normalizeUnit(t.unit) || null
    const building =
      (typeof t.building === "string" && t.building.trim()) || buildingFromUnit(t.unit)
    const cat =
      typeof t.issue_category === "string" && t.issue_category.trim()
        ? t.issue_category.trim()
        : "maintenance"
    const desc =
      typeof t.description === "string" && t.description.trim()
        ? t.description.trim().slice(0, 100)
        : null
    const vendorId = typeof t.assigned_vendor_id === "string" ? t.assigned_vendor_id : null
    const vendorHint = vendorId ? vendorNames.get(vendorId) ?? null : null
    const id = String(t.id ?? "")

    items.push({
      displayId: shortDisplayId(id),
      label: desc || `${cat} repair`,
      building: building || null,
      unitLabel,
      status,
      daysWaiting: days,
      whyMissing: whyMissingUpdate(status, days, vendorHint, overdue),
      nextStep: nextStepFor(status),
      priority: t.priority ? String(t.priority) : null,
    })
  }

  items.sort((a, b) => {
    const rank = (s: string) => {
      if (s === "pending_accept") return 0
      if (s === "unassigned") return 1
      if (s === "accepted") return 2
      return 3
    }
    const r = rank(a.status) - rank(b.status)
    if (r !== 0) return r
    return b.daysWaiting - a.daysWaiting
  })

  const markdown = polishAskUloProse(buildMarkdown(items))
  const found = items.length > 0

  console.log(
    "ASK_ULO_MISSING_UPDATES",
    JSON.stringify({
      landlordId,
      found,
      openCount: tickets.length,
      itemCount: items.length,
    }),
  )

  return {
    available: true,
    found,
    items,
    openCount: tickets.length,
    bullets: items.slice(0, 6).map((i) => `${i.label}: ${i.whyMissing}`),
    citations: [
      {
        tool: "ops_graph",
        title: "Work orders missing updates",
        citation: "maintenance_request_enriched (open stuck statuses)",
        excerpt: found
          ? `${items.length} open repairs going quiet`
          : "No stuck open repairs past check-in windows",
      },
    ],
    markdown,
  }
}

export const MISSING_UPDATES_GUIDE = `
## Work orders missing updates

For “Which work orders are missing updates?”:
1. List open repairs that stalled (unassigned, waiting on vendor accept, accepted without a visit, in-progress too long).
2. Lead with what matters and why — not a database field dump.
3. Name property/unit, how long it's been quiet, and what you'd do next.
4. Do NOT answer with a single deep-ops ticket card for an unrelated category.
5. Never expose retrieval stats — synthesize the quiet backlog into an operational recommendation.
`.trim()
