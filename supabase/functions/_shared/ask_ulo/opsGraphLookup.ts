/**
 * Live portfolio / ops facts for Ask Ulo (not embeddings).
 * Mirrors propertyOperationsGraph-style reads: recent graph events + open tickets/workflows.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

export type AskUloCitation = {
  tool: "legal_rag" | "ops_graph" | "structured" | "market_data" | "external_vendor"
  title: string
  citation?: string
  url?: string
  excerpt?: string
  /** Legal source trust (set for legal_rag / structured citations). */
  sourceTier?: "primary_official" | "agency_guidance" | "discovery_mirror" | "untrusted"
  /** ISO date from document passport / structured fact when known. */
  effectiveOn?: string
  lastUpdatedOn?: string
}

export type OpsGraphLookupResult = {
  bullets: string[]
  citations: AskUloCitation[]
  openTicketCount: number
  openWorkflowCount: number
  recentEventCount: number
}

const OPEN_VENDOR_STATUSES = [
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
]

const OPEN_WORKFLOW_STATUSES = ["active", "escalated"]

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function buildingMatch(building: string | null | undefined, filter: string | null): boolean {
  if (!filter?.trim()) return true
  if (!building?.trim()) return false
  return building.toLowerCase().includes(filter.trim().toLowerCase())
}

/** Query recent ops attention for a landlord (optional building substring filter). */
export async function opsGraphLookup(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    buildingFilter?: string | null
    eventLimit?: number
  },
): Promise<OpsGraphLookupResult> {
  const landlordId = input.landlordId.trim()
  const buildingFilter = input.buildingFilter?.trim() || null
  const eventLimit = input.eventLimit ?? 25
  const bullets: string[] = []
  const citations: AskUloCitation[] = []

  // Open maintenance tickets
  let ticketQuery = supabase
    .from("maintenance_request_enriched")
    .select(
      "id, building, unit, issue_category, priority, vendor_work_status, description, created_at, urgency",
    )
    .eq("landlord_id", landlordId)
    .in("vendor_work_status", OPEN_VENDOR_STATUSES)
    .order("created_at", { ascending: false })
    .limit(40)

  const { data: tickets, error: ticketErr } = await ticketQuery
  if (ticketErr) {
    console.error("[ask_ulo/opsGraphLookup] tickets", ticketErr.message)
  }

  const filteredTickets = (tickets ?? []).filter((t) =>
    buildingMatch(typeof t.building === "string" ? t.building : null, buildingFilter),
  )

  bullets.push(
    `Open maintenance tickets: ${filteredTickets.length}${
      buildingFilter ? ` (filter: ${buildingFilter})` : ""
    }.`,
  )

  for (const t of filteredTickets.slice(0, 8)) {
    const where = [t.building, t.unit].filter((x) => typeof x === "string" && x.trim()).join(" · ")
    const cat = typeof t.issue_category === "string" ? t.issue_category : "maintenance"
    const status = typeof t.vendor_work_status === "string" ? t.vendor_work_status : "open"
    const pri = typeof t.priority === "string" ? t.priority : typeof t.urgency === "string" ? t.urgency : null
    bullets.push(
      `Ticket ${String(t.id).slice(0, 8)}: ${cat}${pri ? ` (${pri})` : ""} — ${status}${
        where ? ` @ ${where}` : ""
      }.`,
    )
  }

  if (filteredTickets.length > 0) {
    citations.push({
      tool: "ops_graph",
      title: "Open maintenance tickets",
      citation: "maintenance_request_enriched",
      excerpt: `${filteredTickets.length} open ticket(s) in portfolio scope`,
    })
  }

  // Open workflow runs
  const { data: workflows, error: wfErr } = await supabase
    .from("workflow_runs")
    .select("id, status, template_id, property_id, unit_id, updated_at, metadata")
    .eq("landlord_id", landlordId)
    .in("status", OPEN_WORKFLOW_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(30)

  if (wfErr) {
    console.error("[ask_ulo/opsGraphLookup] workflows", wfErr.message)
  }

  const openWorkflows = workflows ?? []
  bullets.push(`Open workflow runs: ${openWorkflows.length}.`)
  for (const w of openWorkflows.slice(0, 8)) {
    const meta = asRecord(w.metadata)
    const building =
      (typeof meta?.building === "string" ? meta.building : null) ||
      (typeof meta?.property_name === "string" ? meta.property_name : null)
    if (!buildingMatch(building, buildingFilter)) continue
    bullets.push(
      `Workflow ${String(w.id).slice(0, 8)}: ${String(w.template_id ?? "workflow")} — ${String(
        w.status,
      )}${building ? ` @ ${building}` : ""}.`,
    )
  }

  if (openWorkflows.length > 0) {
    citations.push({
      tool: "ops_graph",
      title: "Open workflow runs",
      citation: "workflow_runs",
      excerpt: `${openWorkflows.length} active/escalated run(s)`,
    })
  }

  // Recent graph events
  const { data: events, error: evErr } = await supabase
    .from("operations_graph_events")
    .select("id, event_type, source, metadata, created_at, unit_id, property_id")
    .eq("landlord_id", landlordId)
    .order("created_at", { ascending: false })
    .limit(eventLimit)

  if (evErr) {
    console.error("[ask_ulo/opsGraphLookup] events", evErr.message)
  }

  const recent = events ?? []
  bullets.push(`Recent operations graph events (last ${recent.length}):`)
  const typeCounts = new Map<string, number>()
  for (const e of recent) {
    const et = typeof e.event_type === "string" ? e.event_type : "unknown"
    typeCounts.set(et, (typeCounts.get(et) ?? 0) + 1)
  }
  const topTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  for (const [et, n] of topTypes) {
    bullets.push(`  ${et}: ${n}`)
  }
  for (const e of recent.slice(0, 5)) {
    const when = typeof e.created_at === "string" ? e.created_at.slice(0, 16).replace("T", " ") : ""
    bullets.push(`  • ${String(e.event_type)} (${when})`)
  }

  if (recent.length > 0) {
    citations.push({
      tool: "ops_graph",
      title: "Operations graph (recent)",
      citation: "operations_graph_events",
      excerpt: topTypes.map(([t, n]) => `${t}×${n}`).join(", ") || `${recent.length} events`,
    })
  }

  if (bullets.length === 1) {
    bullets.push("No open tickets, workflows, or recent graph events found for this landlord.")
  }

  return {
    bullets,
    citations,
    openTicketCount: filteredTickets.length,
    openWorkflowCount: openWorkflows.length,
    recentEventCount: recent.length,
  }
}
