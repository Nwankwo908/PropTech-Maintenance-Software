/**
 * Period activity summary for Ask Ulo ("what happened this week").
 * Collects maintenance, vendor, rent/leasing, and attention items in a window.
 * Never fabricates activity; never answers with only current open-ticket count.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { parsePeriodSummaryWindow } from "./dynamicResponse.ts"

export type PeriodSummaryResult = {
  available: boolean
  canSummarize: boolean
  missingData: string[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  periodLabel: string
  periodDays: number
  periodIsDefault: boolean
  scopeLabel: string
  facts: {
    newMaintenance: number
    completedMaintenance: number
    stillOpenCreatedInPeriod: number
    criticalOrUrgent: number
    escalatedWorkflows: number
    vendorAccepted: number
    vendorDeclined: number
    vendorReassigned: number
    rentEvents: number
    leaseEvents: number
    moveEvents: number
    inspectionEvents: number
    residentCommEvents: number
    graphEventCount: number
    attentionItems: string[]
  }
}

const OPEN_VENDOR_STATUSES = new Set([
  "unassigned",
  "pending_accept",
  "accepted",
  "in_progress",
])

const CRITICAL_RE = /\b(critical|emergency|urgent|high)\b/i

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

function buildingMatch(building: string | null | undefined, filter: string | null): boolean {
  if (!filter?.trim()) return true
  if (!building?.trim()) return false
  return building.toLowerCase().includes(filter.trim().toLowerCase())
}

function formatDayRange(days: number): { startIso: string; endIso: string; startLabel: string; endLabel: string } {
  const end = new Date()
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "long", day: "numeric" })
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startLabel: fmt(start),
    endLabel: fmt(end),
  }
}

function classifyEvent(et: string): {
  bucket:
    | "vendor"
    | "rent"
    | "lease"
    | "move"
    | "inspection"
    | "resident"
    | "escalation"
    | "other"
  attention?: string
} {
  const e = et.toLowerCase()
  if (/vendor|reassign|sla|decline|accept/.test(e)) {
    const attention = /reassign|sla_expired|sla\.expired|no[_ ]response/.test(e)
      ? "Review a vendor reassignment or missed response"
      : undefined
    return { bucket: "vendor", attention }
  }
  if (/rent\.|late_rent|payment|collection/.test(e)) return { bucket: "rent" }
  if (/lease|renewal/.test(e)) return { bucket: "lease" }
  if (/move[_ ]?(in|out)/.test(e)) return { bucket: "move" }
  if (/inspection/.test(e)) return { bucket: "inspection" }
  if (/sms|message|conversation|resident\.|tenant\./.test(e)) return { bucket: "resident" }
  if (/escalat|awaiting|landlord_decision/.test(e)) {
    return { bucket: "escalation", attention: "An item requires your attention" }
  }
  return { bucket: "other" }
}

export async function periodSummaryLookup(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    question: string
    buildingFilter?: string | null
  },
): Promise<PeriodSummaryResult> {
  const landlordId = input.landlordId.trim()
  const buildingFilter = input.buildingFilter?.trim() || null
  const window = parsePeriodSummaryWindow(input.question)
  const range = formatDayRange(window.days)
  const scopeLabel = buildingFilter ? `property scope: ${buildingFilter}` : "full portfolio"
  const missingData: string[] = []

  const emptyFacts = {
    newMaintenance: 0,
    completedMaintenance: 0,
    stillOpenCreatedInPeriod: 0,
    criticalOrUrgent: 0,
    escalatedWorkflows: 0,
    vendorAccepted: 0,
    vendorDeclined: 0,
    vendorReassigned: 0,
    rentEvents: 0,
    leaseEvents: 0,
    moveEvents: 0,
    inspectionEvents: 0,
    residentCommEvents: 0,
    graphEventCount: 0,
    attentionItems: [] as string[],
  }

  if (!landlordId) {
    return {
      available: false,
      canSummarize: false,
      missingData: ["landlord id"],
      bullets: ["Period summary unavailable: missing landlord id."],
      citations: [],
      markdown:
        "I can see current maintenance totals, but I do not have the event history needed to create a reliable weekly summary.",
      periodLabel: window.label,
      periodDays: window.days,
      periodIsDefault: window.isDefault,
      scopeLabel,
      facts: emptyFacts,
    }
  }

  const [createdRes, completedRes, openRes, workflowsRes, eventsRes] = await Promise.all([
    supabase
      .from("maintenance_request_enriched")
      .select(
        "id, building, unit, issue_category, priority, urgency, vendor_work_status, created_at, description",
      )
      .eq("landlord_id", landlordId)
      .gte("created_at", range.startIso)
      .order("created_at", { ascending: false })
      .limit(400),
    // completed_at may not be on the enriched view — filter completed status + created/assigned window via status events fallback
    supabase
      .from("maintenance_request_enriched")
      .select(
        "id, building, unit, issue_category, priority, urgency, vendor_work_status, created_at, description",
      )
      .eq("landlord_id", landlordId)
      .eq("vendor_work_status", "completed")
      .gte("created_at", range.startIso)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("maintenance_request_enriched")
      .select(
        "id, building, unit, issue_category, priority, urgency, vendor_work_status, created_at, description",
      )
      .eq("landlord_id", landlordId)
      .in("vendor_work_status", [...OPEN_VENDOR_STATUSES])
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("workflow_runs")
      .select("id, status, template_id, updated_at, metadata, created_at")
      .eq("landlord_id", landlordId)
      .gte("updated_at", range.startIso)
      .order("updated_at", { ascending: false })
      .limit(120),
    supabase
      .from("operations_graph_events")
      .select("id, event_type, source, metadata, created_at, unit_id, property_id")
      .eq("landlord_id", landlordId)
      .gte("created_at", range.startIso)
      .order("created_at", { ascending: false })
      .limit(250),
  ])

  if (createdRes.error) {
    console.error("[ask_ulo/periodSummary] created", createdRes.error.message)
    missingData.push("new maintenance requests")
  }
  if (eventsRes.error) {
    console.error("[ask_ulo/periodSummary] events", eventsRes.error.message)
    missingData.push("operations event history")
  }
  if (workflowsRes.error) {
    console.error("[ask_ulo/periodSummary] workflows", workflowsRes.error.message)
    missingData.push("workflow activity")
  }

  const filterBuilding = <T extends { building?: unknown; metadata?: unknown }>(rows: T[]) =>
    rows.filter((r) => {
      const b =
        typeof r.building === "string"
          ? r.building
          : (() => {
              const meta = asRecord(r.metadata)
              return (
                (typeof meta?.building === "string" && meta.building) ||
                (typeof meta?.property_name === "string" && meta.property_name) ||
                null
              )
            })()
      return buildingMatch(b, buildingFilter)
    })

  const created = filterBuilding(createdRes.data ?? [])
  const completedApprox = filterBuilding(completedRes.data ?? [])
  const openNow = filterBuilding(openRes.data ?? [])
  const workflows = filterBuilding(workflowsRes.data ?? [])
  const events = filterBuilding(eventsRes.data ?? [])

  const stillOpenFromPeriod = created.filter((t) =>
    OPEN_VENDOR_STATUSES.has(String(t.vendor_work_status ?? "")),
  )
  const critical = created.filter(
    (t) =>
      CRITICAL_RE.test(String(t.priority ?? "")) ||
      CRITICAL_RE.test(String(t.urgency ?? "")),
  )

  let vendorAccepted = 0
  let vendorDeclined = 0
  let vendorReassigned = 0
  let rentEvents = 0
  let leaseEvents = 0
  let moveEvents = 0
  let inspectionEvents = 0
  let residentCommEvents = 0
  const attentionItems: string[] = []
  const attentionSeen = new Set<string>()

  const pushAttention = (line: string) => {
    const k = line.toLowerCase()
    if (attentionSeen.has(k)) return
    attentionSeen.add(k)
    attentionItems.push(line)
  }

  for (const e of events) {
    const et = typeof e.event_type === "string" ? e.event_type : "unknown"
    const meta = asRecord(e.metadata)
    const building =
      (typeof meta?.building === "string" && meta.building) ||
      (typeof meta?.property_name === "string" && meta.property_name) ||
      null
    const unit =
      (typeof meta?.unit === "string" && meta.unit) ||
      (typeof meta?.unit_label === "string" && meta.unit_label) ||
      null
    const where = [building, unit].filter(Boolean).join(" · ")
    const { bucket, attention } = classifyEvent(et)
    if (bucket === "vendor") {
      if (/accept/.test(et.toLowerCase())) vendorAccepted += 1
      else if (/declin/.test(et.toLowerCase())) vendorDeclined += 1
      else if (/reassign|sla/.test(et.toLowerCase())) vendorReassigned += 1
    } else if (bucket === "rent") rentEvents += 1
    else if (bucket === "lease") leaseEvents += 1
    else if (bucket === "move") moveEvents += 1
    else if (bucket === "inspection") inspectionEvents += 1
    else if (bucket === "resident") residentCommEvents += 1

    if (attention) {
      pushAttention(where ? `${attention}${where ? ` (${where})` : ""}` : attention)
    }
  }

  const escalated = workflows.filter((w) => String(w.status) === "escalated")
  for (const w of escalated.slice(0, 5)) {
    const meta = asRecord(w.metadata)
    const building =
      (typeof meta?.building === "string" && meta.building) ||
      (typeof meta?.property_name === "string" && meta.property_name) ||
      null
    const unit =
      (typeof meta?.unit === "string" && meta.unit) ||
      (typeof meta?.unit_label === "string" && meta.unit_label) ||
      null
    const tmpl = String(w.template_id ?? "operation")
    pushAttention(
      `Review escalated ${tmpl.replace(/_/g, " ")}${
        building || unit ? ` — ${[building, unit].filter(Boolean).join(" · ")}` : ""
      }`,
    )
  }

  for (const t of critical.slice(0, 3)) {
    const where = [t.building, t.unit].filter((x) => typeof x === "string" && String(x).trim()).join(" · ")
    const cat = typeof t.issue_category === "string" ? t.issue_category : "maintenance"
    pushAttention(
      `Address critical ${cat.toLowerCase()} issue${where ? ` at ${where}` : ""}`,
    )
  }

  // Try vendor_status_events for completed-in-window if table exists
  let completedInWindow = completedApprox.length
  const { data: statusEvents, error: statusErr } = await supabase
    .from("vendor_status_events")
    .select("id, maintenance_request_id, to_status, created_at")
    .eq("to_status", "completed")
    .gte("created_at", range.startIso)
    .limit(300)

  if (!statusErr && statusEvents) {
    // Count unique request ids completed in window (landlord-scoped via join not available — use intersection)
    const createdIds = new Set(created.map((t) => String(t.id)))
    const openIds = new Set(openNow.map((t) => String(t.id)))
    const allKnown = new Set([...createdIds, ...openIds, ...completedApprox.map((t) => String(t.id))])
    const completedIds = new Set(
      statusEvents
        .map((e) => String(e.maintenance_request_id ?? ""))
        .filter((id) => id && (allKnown.size === 0 || allKnown.has(id) || createdIds.has(id))),
    )
    // Prefer status-event count when we got rows; else fall back
    if (statusEvents.length > 0) {
      completedInWindow = completedIds.size || statusEvents.length
    }
  }

  const facts = {
    newMaintenance: created.length,
    completedMaintenance: completedInWindow,
    stillOpenCreatedInPeriod: stillOpenFromPeriod.length,
    criticalOrUrgent: critical.length,
    escalatedWorkflows: escalated.length,
    vendorAccepted,
    vendorDeclined,
    vendorReassigned,
    rentEvents,
    leaseEvents,
    moveEvents,
    inspectionEvents,
    residentCommEvents,
    graphEventCount: events.length,
    attentionItems: attentionItems.slice(0, 6),
  }

  const hasActivity =
    facts.newMaintenance > 0 ||
    facts.completedMaintenance > 0 ||
    facts.graphEventCount > 0 ||
    facts.escalatedWorkflows > 0 ||
    workflows.length > 0

  const canSummarize =
    hasActivity ||
    (missingData.length === 0 && createdRes.data != null && eventsRes.data != null)

  const bullets: string[] = []
  bullets.push(
    `Period: ${window.label} (${range.startLabel} – ${range.endLabel})${
      window.isDefault ? " [default window]" : ""
    }.`,
  )
  bullets.push(`Scope: ${scopeLabel}.`)
  bullets.push(
    `Retrieved: ${facts.newMaintenance} new maintenance requests; ~${facts.completedMaintenance} completed; ${facts.graphEventCount} graph events; ${workflows.length} workflows updated.`,
  )
  bullets.push(
    `Maintenance: ${facts.newMaintenance} new, ${facts.completedMaintenance} completed, ${facts.stillOpenCreatedInPeriod} from this period still open, ${facts.criticalOrUrgent} critical/urgent.`,
  )
  bullets.push(
    `Vendors (from events): ${facts.vendorAccepted} accepted, ${facts.vendorDeclined} declined, ${facts.vendorReassigned} reassigned.`,
  )
  bullets.push(
    `Rent/leasing events: rent ${facts.rentEvents}, lease ${facts.leaseEvents}, move ${facts.moveEvents}, inspection ${facts.inspectionEvents}, resident messages ${facts.residentCommEvents}.`,
  )
  bullets.push(`Escalated workflows updated in period: ${facts.escalatedWorkflows}.`)
  for (const a of facts.attentionItems) bullets.push(`Needs attention: ${a}.`)
  for (const m of missingData) bullets.push(`Missing: ${m}.`)

  if (!hasActivity && canSummarize) {
    bullets.push("No meaningful operational activity recorded in this period.")
  }

  const citations: AskUloCitation[] = [
    {
      tool: "ops_graph",
      title: `Activity summary — ${window.label}`,
      citation: "maintenance_request_enriched + workflow_runs + operations_graph_events",
      excerpt: `${facts.graphEventCount} events, ${facts.newMaintenance} new requests (${range.startLabel}–${range.endLabel})`,
    },
  ]

  const md: string[] = []
  const title =
    window.label === "this week"
      ? "## This Week at a Glance"
      : window.label === "this month"
        ? "## This Month at a Glance"
        : `## ${window.label.charAt(0).toUpperCase()}${window.label.slice(1)} at a Glance`

  if (!canSummarize && missingData.includes("operations event history") && facts.newMaintenance === 0) {
    md.push(
      "I can see current maintenance totals, but I do not have the event history needed to create a reliable weekly summary.",
    )
  } else if (!hasActivity) {
    md.push(title)
    md.push("")
    md.push(
      `No meaningful operational activity was recorded for ${scopeLabel === "full portfolio" ? "your portfolio" : buildingFilter} during ${window.label} (${range.startLabel} – ${range.endLabel}).`,
    )
  } else {
    md.push(title)
    md.push("")
    const openBit =
      facts.stillOpenCreatedInPeriod > 0
        ? ` ${facts.stillOpenCreatedInPeriod} from this period ${facts.stillOpenCreatedInPeriod === 1 ? "is" : "are"} still open` +
          (facts.criticalOrUrgent > 0
            ? `, including ${facts.criticalOrUrgent} critical/urgent.`
            : ".")
        : "."
    md.push(
      `During ${window.label} (${range.startLabel} – ${range.endLabel}), **${facts.newMaintenance}** maintenance requests were created and about **${facts.completedMaintenance}** were completed.${openBit}`,
    )
    md.push("")
    md.push("### Maintenance")
    md.push(`- ${facts.newMaintenance} new requests`)
    md.push(`- ${facts.completedMaintenance} completed`)
    md.push(`- ${facts.stillOpenCreatedInPeriod} from this period still open`)
    if (facts.criticalOrUrgent > 0) {
      md.push(`- ${facts.criticalOrUrgent} critical/urgent`)
    }
    if (facts.escalatedWorkflows > 0) {
      md.push(`- ${facts.escalatedWorkflows} escalated items needing attention`)
    }
    md.push("")
    md.push("### Vendors")
    md.push(`- ${facts.vendorAccepted} jobs accepted (from recorded events)`)
    md.push(`- ${facts.vendorDeclined} vendor declines`)
    md.push(`- ${facts.vendorReassigned} reassignments / missed-response actions`)
    if (
      facts.vendorAccepted === 0 &&
      facts.vendorDeclined === 0 &&
      facts.vendorReassigned === 0
    ) {
      md.push("- No vendor accept/decline/reassign events were recorded in this window.")
    }
    md.push("")
    md.push("### Rent and Leasing")
    md.push(`- ${facts.rentEvents} rent / collection events`)
    md.push(`- ${facts.leaseEvents} lease / renewal events`)
    md.push(`- ${facts.moveEvents} move-in / move-out events`)
    md.push(`- ${facts.inspectionEvents} inspection events`)
    if (facts.residentCommEvents > 0) {
      md.push(`- ${facts.residentCommEvents} resident communication events`)
    }
    if (
      facts.rentEvents + facts.leaseEvents + facts.moveEvents + facts.inspectionEvents === 0
    ) {
      md.push("- No rent, lease, move, or inspection events were recorded in this window.")
    }
    if (facts.attentionItems.length) {
      md.push("")
      md.push("### Needs Your Attention")
      for (const a of facts.attentionItems) md.push(`- ${a}`)
    }
    md.push("")
    md.push(
      `_Based on ${facts.graphEventCount} workflow events and ${facts.newMaintenance} maintenance requests recorded between ${range.startLabel} and ${range.endLabel}._`,
    )
  }

  return {
    available: true,
    canSummarize,
    missingData,
    bullets,
    citations,
    markdown: md.join("\n").trim(),
    periodLabel: window.label,
    periodDays: window.days,
    periodIsDefault: window.isDefault,
    scopeLabel,
    facts,
  }
}
