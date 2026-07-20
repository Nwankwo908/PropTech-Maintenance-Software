/**
 * Focused “what is Ulo handling right now?” packet from workflow_runs + graph.
 * Never a portfolio health / occupancy briefing.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"

export type ActiveWorkflowsResult = {
  available: boolean
  found: boolean
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  facts: {
    activeCount: number
    escalatedCount: number
    awaitingDecisionCount: number
    byDomain: Record<string, number>
    recentUloActions: string[]
  }
}

const OPEN_WORKFLOW_STATUSES = ["active", "escalated"]

const ULO_ACTION_RE =
  /\b(reassign|reassigned|vendor\..*sla|sla_expired|late[-_ ]?rent|reminder_sent|inspection\.scheduled|workflow\.(?:escalat|act)|maintenance\.(?:reassign|escalat)|rent\.reminder)\b/i

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
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

function humanTemplate(templateId: string | null): string {
  const t = (templateId ?? "workflow").replace(/_/g, " ")
  return t
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

function buildingFromMeta(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null
  if (typeof meta.building === "string" && meta.building.trim()) return meta.building.trim()
  if (typeof meta.property_name === "string" && meta.property_name.trim()) {
    return meta.property_name.trim()
  }
  return null
}

function humanizeEvent(eventType: string, meta: Record<string, unknown> | null): string | null {
  const et = eventType.toLowerCase()
  const building = buildingFromMeta(meta)
  const where = building ? ` @ ${building}` : ""
  if (/workflow\.escalat|escalat/.test(et)) return `Escalated a workflow${where}`
  if (/reassign/.test(et)) return `Reassigned a vendor / work order${where}`
  if (/rent\.reminder|late[-_ ]?rent|reminder_sent/.test(et)) {
    return `Sent a rent reminder${where}`
  }
  if (/inspection\.scheduled/.test(et)) return `Scheduled an inspection${where}`
  if (/sla/.test(et)) return `Handled an SLA signal${where}`
  if (/workflow\.act|maintenance\./.test(et)) return `Advanced a maintenance workflow${where}`
  return null
}

/** Questions about what Ulo / the engine is actively running — not portfolio health. */
export function isUloActiveTasksQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (
    /\bwhat\s+tasks?\s+(?:is|are)\s+ulo\b/i.test(q) ||
    /\btasks?\s+(?:is|are)\s+ulo\s+(?:handling|running|working\s+on|doing)\b/i.test(q) ||
    /\bulo\s+(?:is\s+)?(?:handling|running|working\s+on|doing)\b/i.test(q) ||
    /\bwhat(?:'s|\s+is)\s+ulo\s+(?:handling|doing|working\s+on|running)\b/i.test(q) ||
    /\b(?:show|list)\s+(?:me\s+)?(?:active\s+)?(?:ulo\s+)?(?:tasks|workflows)\b/i.test(q) ||
    /\bactive\s+(?:ulo\s+)?(?:tasks|workflows)\b/i.test(q) ||
    /\bwhat\s+(?:is|are)\s+(?:ulo|the\s+(?:system|platform|engine))\s+(?:handling|running|working\s+on)\b/i
      .test(q)
  ) {
    return true
  }
  return false
}

export async function activeWorkflowsLookup(
  supabase: SupabaseClient,
  input: { landlordId: string; limit?: number },
): Promise<ActiveWorkflowsResult> {
  const landlordId = input.landlordId.trim()
  const limit = input.limit ?? 40
  const empty = (): ActiveWorkflowsResult => ({
    available: false,
    found: false,
    bullets: [],
    citations: [],
    markdown: "",
    facts: {
      activeCount: 0,
      escalatedCount: 0,
      awaitingDecisionCount: 0,
      byDomain: {},
      recentUloActions: [],
    },
  })

  if (!landlordId) return empty()

  const [workflowsRes, eventsRes] = await Promise.all([
    supabase
      .from("workflow_runs")
      .select("id, status, template_id, property_id, unit_id, updated_at, metadata")
      .eq("landlord_id", landlordId)
      .in("status", OPEN_WORKFLOW_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(limit),
    supabase
      .from("operations_graph_events")
      .select("id, event_type, source, metadata, created_at")
      .eq("landlord_id", landlordId)
      .order("created_at", { ascending: false })
      .limit(40),
  ])

  if (workflowsRes.error) {
    console.error("[ask_ulo/activeWorkflows] workflows", workflowsRes.error.message)
    return empty()
  }

  const workflows = workflowsRes.data ?? []
  const events = eventsRes.error ? [] : eventsRes.data ?? []

  const escalated = workflows.filter((w) => String(w.status) === "escalated")
  const awaiting = workflows.filter((w) =>
    isAwaitingDecision(String(w.status), asRecord(w.metadata)),
  )
  const byDomain: Record<string, number> = {}
  for (const w of workflows) {
    const d = workflowDomain(typeof w.template_id === "string" ? w.template_id : null)
    byDomain[d] = (byDomain[d] ?? 0) + 1
  }

  const recentUloActions: string[] = []
  for (const e of events) {
    const et = String(e.event_type ?? "")
    if (!ULO_ACTION_RE.test(et) && String(e.source ?? "") !== "edge_function") continue
    const line = humanizeEvent(et, asRecord(e.metadata))
    if (line && !recentUloActions.includes(line)) recentUloActions.push(line)
    if (recentUloActions.length >= 5) break
  }

  const bullets: string[] = []
  bullets.push(
    `Active workflows Ulo is running: ${workflows.length} (escalated: ${escalated.length}; awaiting your decision: ${awaiting.length}).`,
  )
  const domainLines = Object.entries(byDomain).sort((a, b) => b[1] - a[1])
  if (domainLines.length) {
    bullets.push("By domain:")
    for (const [domain, n] of domainLines) {
      bullets.push(`  • ${domain}: ${n}`)
    }
  }

  if (escalated.length) {
    bullets.push("Escalated / needs unblock:")
    for (const w of escalated.slice(0, 8)) {
      const meta = asRecord(w.metadata)
      const building = buildingFromMeta(meta)
      const step = String(meta?.current_step ?? meta?.step ?? w.status ?? "escalated")
      bullets.push(
        `  • ${humanTemplate(typeof w.template_id === "string" ? w.template_id : null)} — ${step}${
          building ? ` @ ${building}` : ""
        }.`,
      )
    }
  }

  const awaitingOnly = awaiting.filter((w) => String(w.status) !== "escalated")
  if (awaitingOnly.length) {
    bullets.push("Awaiting your decision:")
    for (const w of awaitingOnly.slice(0, 8)) {
      const meta = asRecord(w.metadata)
      const building = buildingFromMeta(meta)
      const step = String(meta?.current_step ?? meta?.step ?? "awaiting decision")
      bullets.push(
        `  • ${humanTemplate(typeof w.template_id === "string" ? w.template_id : null)} — ${step}${
          building ? ` @ ${building}` : ""
        }.`,
      )
    }
  }

  if (recentUloActions.length) {
    bullets.push("Recent automatic Ulo actions:")
    for (const a of recentUloActions) bullets.push(`  • ${a}`)
  } else {
    bullets.push("Recent automatic Ulo actions: none clearly identified in the latest graph window.")
  }

  if (workflows.length === 0) {
    bullets.push("No active or escalated workflow runs right now.")
  }

  const citations: AskUloCitation[] = [
    {
      tool: "ops_graph",
      title: "Active Ulo workflows",
      citation: "workflow_runs + operations_graph_events",
      excerpt: `${workflows.length} active/escalated; ${escalated.length} escalated; ${awaiting.length} awaiting decision`,
    },
  ]

  const mdParts = [
    `## What Ulo is handling right now`,
    "",
    `**${workflows.length} active workflows**` +
      (escalated.length || awaiting.length
        ? ` · ${escalated.length} escalated · ${awaiting.length} awaiting your decision`
        : ""),
    "",
  ]
  if (domainLines.length) {
    mdParts.push("**By domain**")
    for (const [domain, n] of domainLines) {
      mdParts.push(`- ${domain}: ${n}`)
    }
    mdParts.push("")
  }
  if (escalated.length) {
    mdParts.push("**Escalated / needs unblock**")
    for (const w of escalated.slice(0, 8)) {
      const meta = asRecord(w.metadata)
      const building = buildingFromMeta(meta)
      const step = String(meta?.current_step ?? meta?.step ?? w.status ?? "escalated")
      mdParts.push(
        `- ${humanTemplate(typeof w.template_id === "string" ? w.template_id : null)} — ${step}${
          building ? ` @ ${building}` : ""
        }`,
      )
    }
    mdParts.push("")
  }
  if (awaitingOnly.length) {
    mdParts.push("**Awaiting your decision**")
    for (const w of awaitingOnly.slice(0, 8)) {
      const meta = asRecord(w.metadata)
      const building = buildingFromMeta(meta)
      const step = String(meta?.current_step ?? meta?.step ?? "awaiting decision")
      mdParts.push(
        `- ${humanTemplate(typeof w.template_id === "string" ? w.template_id : null)} — ${step}${
          building ? ` @ ${building}` : ""
        }`,
      )
    }
    mdParts.push("")
  }
  mdParts.push("**Recent automatic Ulo actions**")
  if (recentUloActions.length) {
    for (const a of recentUloActions) mdParts.push(`- ${a}`)
  } else {
    mdParts.push("- None clearly identified in the latest graph window.")
  }

  return {
    available: true,
    found: workflows.length > 0 || recentUloActions.length > 0,
    bullets,
    citations,
    markdown: mdParts.join("\n"),
    facts: {
      activeCount: workflows.length,
      escalatedCount: escalated.length,
      awaitingDecisionCount: awaiting.length,
      byDomain,
      recentUloActions,
    },
  }
}
