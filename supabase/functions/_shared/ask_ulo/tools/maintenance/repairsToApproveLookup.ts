/**
 * Repairs to approve / act on now — urgent open work + landlord-awaiting workflows.
 * Used for “Which repairs should I approve immediately?”
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "../../retrieval/searchInternalData.ts"
import { polishAskUloProse } from "../../synthesis/formatAnswer.ts"
import { formatUnitReference } from "../../../properties/unitLabelDisplay.ts"
import {
  formatPendingLandlordDecisionReason,
  rankWorkOrderUrgency,
  summarizeWorkOrderIssue,
} from "./workOrderPresentation.ts"

const OPEN_VENDOR_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
] as const

export type RepairToApproveItem = {
  kind: "urgent_work_order" | "awaiting_decision"
  label: string
  building: string | null
  unitLabel: string | null
  category: string | null
  reason: string
  ageHours: number | null
  priority: string | null
}

export type RepairsToApproveResult = {
  available: boolean
  found: boolean
  items: RepairToApproveItem[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  openUrgentCount: number
  awaitingCount: number
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

function isCritical(priority: unknown, urgency: unknown): boolean {
  const p = String(priority ?? "").toLowerCase()
  const u = String(urgency ?? "").toLowerCase()
  return (
    ["urgent", "critical", "emergency", "high"].includes(p) ||
    ["urgent", "critical", "emergency", "high"].includes(u)
  )
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

function ageHours(iso: unknown): number | null {
  const t = new Date(String(iso ?? "")).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round((Date.now() - t) / (60 * 60 * 1000)))
}

function formatAge(hours: number | null): string {
  if (hours == null) return ""
  if (hours < 24) return `${hours}h waiting`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} waiting`
}

function buildMarkdown(items: RepairToApproveItem[], openUrgentCount: number, awaitingCount: number): string {
  if (items.length === 0) {
    return [
      "I checked open urgent work orders and workflows waiting on your decision.",
      "",
      "### What I know",
      "Nothing is currently queued as an immediate repair approval — no critical open tickets or landlord-decision holds showed up.",
      "",
      "### What happens next",
      "When an emergency ticket opens or a workflow escalates for your OK, I'll list it here first.",
    ].join("\n")
  }

  const parts: string[] = [
    `I'd approve or unblock these first — **${items.length}** item${items.length === 1 ? "" : "s"} need your attention right now` +
      (openUrgentCount > 0 || awaitingCount > 0
        ? ` (${openUrgentCount} urgent open, ${awaitingCount} awaiting decision).`
        : "."),
    "",
    "### Approve or act now",
  ]

  for (const item of items.slice(0, 8)) {
    const place = [item.building, formatUnitReference(item.unitLabel) || null]
      .filter(Boolean)
      .join(" · ")
    parts.push(
      `- **${item.label}**${place ? ` — ${place}` : ""}: ${item.reason}` +
        (item.ageHours != null ? ` (${formatAge(item.ageHours)})` : ""),
    )
  }

  parts.push("")
  parts.push(
    "These are the highest-urgency open repairs and anything already escalated for a landlord decision. I'd clear emergencies and plumbing/HVAC past the response time before routine work.",
  )

  return parts.join("\n")
}

export function isRepairsToApproveQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  return (
    /\bwhich\s+repairs?\s+should\s+i\s+approve\b/i.test(q) ||
    /\bwhat\s+repairs?\s+should\s+i\s+approve\b/i.test(q) ||
    /\brepairs?\s+(?:to\s+)?approve\s+(?:immediately|now|first)\b/i.test(q) ||
    (/\bapprove\s+(?:immediately|now|first)\b/i.test(q) &&
      /\b(repair|maintenance|work\s*order|ticket)\b/i.test(q)) ||
    (/\bneeds?\s+(?:my|your)\s+(?:attention|decision)\b/i.test(q) &&
      /\b(repair|maintenance|work\s*order)\b/i.test(q)) ||
    /\bawaiting\s+(?:my|your|landlord)\s+decision\b/i.test(q)
  )
}

export async function repairsToApproveLookup(
  supabase: SupabaseClient,
  input: { landlordId: string },
): Promise<RepairsToApproveResult> {
  const landlordId = input.landlordId.trim()
  const empty: RepairsToApproveResult = {
    available: false,
    found: false,
    items: [],
    bullets: [],
    citations: [],
    markdown: "",
    openUrgentCount: 0,
    awaitingCount: 0,
  }
  if (!landlordId) return empty

  const [ticketsRes, workflowsRes, estimatesRes, pendingAskTicketsRes] =
    await Promise.all([
      supabase
        .from("maintenance_request_enriched")
        .select(
          "id, building, unit, issue_category, description, vendor_work_status, priority, urgency, created_at, due_at",
        )
        .eq("landlord_id", landlordId)
        .in("vendor_work_status", [...OPEN_VENDOR_STATUSES])
        .order("created_at", { ascending: true })
        .limit(200),
      supabase
        .from("workflow_runs")
        .select("id, template_id, status, current_step, entity_id, started_at, metadata")
        .eq("landlord_id", landlordId)
        .in("status", ["active", "escalated", "running", "waiting"])
        .order("started_at", { ascending: true })
        .limit(150),
      supabase
        .from("maintenance_estimates")
        .select("maintenance_request_id, status, total_cost")
        .eq("landlord_id", landlordId)
        .eq("status", "pending_approval")
        .limit(100),
      // Enriched view omits these columns — pull pending-ask flags from the base table.
      supabase
        .from("maintenance_requests")
        .select(
          "id, unit, issue_category, description, priority, urgency, created_at, awaiting_landlord_choice_at, spend_status",
        )
        .eq("landlord_id", landlordId)
        .or(
          "awaiting_landlord_choice_at.not.is.null,spend_status.eq.pending_approval",
        )
        .limit(100),
    ])

  let tickets: Array<Record<string, unknown>> = (ticketsRes.data ?? []) as Array<
    Record<string, unknown>
  >
  if (ticketsRes.error) {
    console.error("[ask_ulo/repairsToApproveLookup] enriched", ticketsRes.error.message)
    const fallback = await supabase
      .from("maintenance_requests")
      .select(
        "id, unit, issue_category, description, vendor_work_status, priority, urgency, created_at, due_at",
      )
      .eq("landlord_id", landlordId)
      .in("vendor_work_status", [...OPEN_VENDOR_STATUSES])
      .order("created_at", { ascending: true })
      .limit(200)
    if (fallback.error) {
      console.error("[ask_ulo/repairsToApproveLookup]", fallback.error.message)
      return {
        ...empty,
        available: false,
        markdown: "I couldn't load open work orders to recommend what to approve first.",
      }
    }
    tickets = (fallback.data ?? []) as Array<Record<string, unknown>>
  }

  const pendingEstimateTicketIds = new Set<string>()
  if (!estimatesRes.error) {
    for (const row of estimatesRes.data ?? []) {
      const id = typeof row.maintenance_request_id === "string"
        ? row.maintenance_request_id
        : ""
      if (id) pendingEstimateTicketIds.add(id)
    }
  } else {
    console.error("[ask_ulo/repairsToApproveLookup] estimates", estimatesRes.error.message)
  }

  const pendingAskByTicketId = new Map<string, Record<string, unknown>>()
  if (!pendingAskTicketsRes.error) {
    for (const row of pendingAskTicketsRes.data ?? []) {
      const id = String(row.id ?? "")
      if (id) pendingAskByTicketId.set(id, row as Record<string, unknown>)
    }
  } else {
    console.error(
      "[ask_ulo/repairsToApproveLookup] pending asks",
      pendingAskTicketsRes.error.message,
    )
  }

  const items: RepairToApproveItem[] = []
  const ticketById = new Map<string, Record<string, unknown>>()

  for (const t of tickets) {
    const id = String(t.id ?? "")
    if (id) ticketById.set(id, t)
    if (!isCritical(t.priority, t.urgency)) continue
    const unitLabel = normalizeUnit(t.unit) || null
    const building =
      (typeof t.building === "string" && t.building.trim()) ||
      buildingFromUnit(t.unit)
    const cat =
      typeof t.issue_category === "string" && t.issue_category.trim()
        ? t.issue_category.trim()
        : "maintenance"
    const label = summarizeWorkOrderIssue(
      typeof t.description === "string" ? t.description : null,
      cat,
    )
    const pri = String(t.priority ?? t.urgency ?? "urgent").toLowerCase()
    const hours = ageHours(t.created_at)
    const overdue =
      t.due_at && new Date(String(t.due_at)).getTime() < Date.now()
        ? "response time has passed"
        : null
    items.push({
      kind: "urgent_work_order",
      label,
      building: building || null,
      unitLabel,
      category: cat,
      reason: overdue
        ? `${pri} priority — ${overdue}`
        : `${pri} priority open repair`,
      ageHours: hours,
      priority: pri,
    })
  }

  const workflows = workflowsRes.error ? [] : (workflowsRes.data ?? [])
  if (workflowsRes.error) {
    console.error("[ask_ulo/repairsToApproveLookup] workflows", workflowsRes.error.message)
  }

  let awaitingCount = 0
  const seenAwaitingTickets = new Set<string>()

  // Ticket-level pending asks (estimate approval / vendor choice) — same distinction SMS uses.
  for (const [id, t] of pendingAskByTicketId) {
    const awaitingChoice = Boolean(t.awaiting_landlord_choice_at)
    const pendingEstimate =
      pendingEstimateTicketIds.has(id) ||
      String(t.spend_status ?? "").toLowerCase() === "pending_approval"
    if (!awaitingChoice && !pendingEstimate) continue
    awaitingCount += 1
    seenAwaitingTickets.add(id)
    const enriched = ticketById.get(id)
    const cat =
      typeof (enriched?.issue_category ?? t.issue_category) === "string" &&
        String(enriched?.issue_category ?? t.issue_category).trim()
        ? String(enriched?.issue_category ?? t.issue_category).trim()
        : "maintenance"
    const { reason } = formatPendingLandlordDecisionReason({
      awaitingLandlordChoice: awaitingChoice,
      pendingEstimateApproval: pendingEstimate,
      spendStatus: typeof t.spend_status === "string" ? t.spend_status : null,
    })
    items.push({
      kind: "awaiting_decision",
      label: summarizeWorkOrderIssue(
        typeof (enriched?.description ?? t.description) === "string"
          ? String(enriched?.description ?? t.description)
          : null,
        cat,
      ),
      building:
        (typeof enriched?.building === "string" && enriched.building.trim()) ||
        buildingFromUnit(enriched?.unit ?? t.unit),
      unitLabel: normalizeUnit(enriched?.unit ?? t.unit) || null,
      category: cat,
      reason,
      ageHours: ageHours(enriched?.created_at ?? t.created_at),
      priority: "escalated",
    })
  }

  for (const w of workflows) {
    const status = String(w.status ?? "")
    const meta = (w.metadata ?? {}) as Record<string, unknown>
    if (!isAwaitingDecision(status, meta)) continue
    const entityId = typeof w.entity_id === "string" ? w.entity_id : ""
    if (entityId && seenAwaitingTickets.has(entityId)) continue
    awaitingCount += 1
    const ticket = entityId ? ticketById.get(entityId) : null
    const pendingAsk = entityId ? pendingAskByTicketId.get(entityId) : null
    const step = String(w.current_step ?? meta.current_step ?? "awaiting decision")
    const { reason } = formatPendingLandlordDecisionReason({
      workflowStep: step,
      workflowStatus: status,
      awaitingLandlordChoice: Boolean(
        pendingAsk?.awaiting_landlord_choice_at || meta.awaiting_landlord,
      ),
      pendingEstimateApproval: entityId
        ? pendingEstimateTicketIds.has(entityId)
        : false,
      spendStatus:
        typeof pendingAsk?.spend_status === "string" ? pendingAsk.spend_status : null,
    })
    const cat =
      typeof ticket?.issue_category === "string" && ticket.issue_category.trim()
        ? ticket.issue_category.trim()
        : null
    const label = ticket
      ? summarizeWorkOrderIssue(
        typeof ticket.description === "string" ? ticket.description : null,
        cat,
      )
      : String(w.template_id ?? "workflow").replace(/_/g, " ")
    items.push({
      kind: "awaiting_decision",
      label,
      building:
        (typeof ticket?.building === "string" && ticket.building.trim()) ||
        (typeof meta.building === "string" ? meta.building : null) ||
        buildingFromUnit(ticket?.unit ?? meta.unit),
      unitLabel: ticket?.unit
        ? normalizeUnit(ticket.unit)
        : meta.unit
        ? normalizeUnit(meta.unit)
        : null,
      category: cat,
      reason,
      ageHours: ageHours(w.started_at),
      priority: status === "escalated" ? "escalated" : "awaiting",
    })
  }

  // Urgency tier first (fire/habitability before routine), then wait age.
  items.sort((a, b) => {
    const r =
      rankWorkOrderUrgency(a.priority, a.priority, a.label) -
      rankWorkOrderUrgency(b.priority, b.priority, b.label)
    if (r !== 0) return r
    return (b.ageHours ?? 0) - (a.ageHours ?? 0)
  })

  const openUrgentCount = items.filter((i) => i.kind === "urgent_work_order").length
  const markdown = polishAskUloProse(buildMarkdown(items, openUrgentCount, awaitingCount))
  const found = items.length > 0

  console.log(
    "ASK_ULO_REPAIRS_TO_APPROVE",
    JSON.stringify({
      landlordId,
      found,
      openUrgentCount,
      awaitingCount,
      itemCount: items.length,
    }),
  )

  return {
    available: true,
    found,
    items,
    openUrgentCount,
    awaitingCount,
    bullets: items.slice(0, 6).map((i) => `${i.label}: ${i.reason}`),
    citations: [
      {
        tool: "ops_graph",
        title: "Repairs to approve (urgent open + awaiting decision)",
        citation: "maintenance_request_enriched + workflow_runs",
        excerpt: found
          ? `${openUrgentCount} urgent · ${awaitingCount} awaiting decision`
          : "No immediate repairs queued for approval",
      },
    ],
    markdown,
  }
}

export const REPAIRS_TO_APPROVE_GUIDE = `
## Repairs to approve immediately

For “Which repairs should I approve immediately?”:
1. Lead with urgent / emergency / high open work orders and workflows waiting on landlord decision.
2. Name the repair, property/unit, and why it can't wait (emergency, response time passed, escalated).
3. Do NOT confuse this with tenant screening approve/deny.
4. Do NOT answer with soft unavailable language when open urgent tickets exist.
5. Do NOT expose retrieval stats or UI-clipped text — full natural English only.
`.trim()
