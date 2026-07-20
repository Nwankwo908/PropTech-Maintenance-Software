/**
 * Repairs to approve / act on now — urgent open work + landlord-awaiting workflows.
 * Used for “Which repairs should I approve immediately?”
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { polishAskUloProse } from "./responsePolish.ts"

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
    const place = [item.building, item.unitLabel ? `Unit ${item.unitLabel}` : null]
      .filter(Boolean)
      .join(" · ")
    parts.push(
      `- **${item.label}**${place ? ` — ${place}` : ""}: ${item.reason}` +
        (item.ageHours != null ? ` (${formatAge(item.ageHours)})` : ""),
    )
  }

  parts.push("")
  parts.push(
    "These are the highest-urgency open repairs and anything already escalated for a landlord decision. I'd clear emergencies and plumbing/HVAC past the vendor response deadline before routine work.",
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

  const [ticketsRes, workflowsRes] = await Promise.all([
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

  const items: RepairToApproveItem[] = []

  for (const t of tickets) {
    if (!isCritical(t.priority, t.urgency)) continue
    const unitLabel = normalizeUnit(t.unit) || null
    const building =
      (typeof t.building === "string" && t.building.trim()) ||
      buildingFromUnit(t.unit)
    const cat =
      typeof t.issue_category === "string" && t.issue_category.trim()
        ? t.issue_category.trim()
        : "maintenance"
    const desc =
      typeof t.description === "string" && t.description.trim()
        ? t.description.trim().slice(0, 120)
        : null
    const pri = String(t.priority ?? t.urgency ?? "urgent").toLowerCase()
    const hours = ageHours(t.created_at)
    const overdue =
      t.due_at && new Date(String(t.due_at)).getTime() < Date.now()
        ? "vendor response deadline has passed"
        : null
    items.push({
      kind: "urgent_work_order",
      label: desc || `${cat} work order`,
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
  for (const w of workflows) {
    const status = String(w.status ?? "")
    const meta = (w.metadata ?? {}) as Record<string, unknown>
    if (!isAwaitingDecision(status, meta)) continue
    awaitingCount += 1
    const template = String(w.template_id ?? "workflow")
    const step = String(w.current_step ?? meta.current_step ?? "awaiting decision")
    const hours = ageHours(w.started_at)
    items.push({
      kind: "awaiting_decision",
      label: template.replace(/_/g, " "),
      building: typeof meta.building === "string" ? meta.building : null,
      unitLabel: meta.unit ? normalizeUnit(meta.unit) : null,
      category: null,
      reason: `Waiting on your decision (${step})`,
      ageHours: hours,
      priority: status === "escalated" ? "escalated" : "awaiting",
    })
  }

  // Priority: urgent emergency first, then by age.
  const rank = (p: string | null) => {
    const s = (p ?? "").toLowerCase()
    if (s === "urgent" || s === "emergency" || s === "critical") return 0
    if (s === "escalated") return 1
    if (s === "high") return 2
    return 3
  }
  items.sort((a, b) => {
    const r = rank(a.priority) - rank(b.priority)
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
2. Name the repair, property/unit, and why it can't wait (emergency, vendor response deadline passed, escalated).
3. Do NOT confuse this with tenant screening approve/deny.
4. Do NOT answer with soft unavailable language when open urgent tickets exist.
5. Do NOT expose retrieval stats or UI-clipped text — full natural English only.
`.trim()
