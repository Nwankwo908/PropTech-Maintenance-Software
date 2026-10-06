/**
 * Catch-all fallback retriever — subject-scoped work-order answer when specialty
 * packets miss. Never portfolio briefing / property ranking.
 */
/// <reference lib="deno.ns" />

import type { AskUloQuestionSubject } from "../routing/detectSubject.ts"
import type { OperationalWorkOrder } from "../tools/maintenance/searchOperationalRecords.ts"
import { polishAskUloProse } from "../synthesis/formatAnswer.ts"
import type { SearchWorkOrdersResult } from "../tools/maintenance/searchWorkOrders.ts"
import { formatUnitReference } from "../../properties/unitLabelDisplay.ts"

/** Subjects where a work-order list is a valid answer (not a metric substitution). */
const CATCHALL_WO_SUBJECTS = new Set<AskUloQuestionSubject>([
  "work_order",
  "maintenance",
  "unit",
  "finance",
  "other",
])

export type CatchAllWorkOrderPacket = {
  available: boolean
  found: boolean
  markdown: string
  bullets: string[]
  workOrderCount: number
  source: "search_work_orders"
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount)
}

function statusLabel(wo: OperationalWorkOrder): string {
  const raw = (wo.workflowStage || wo.vendorWorkStatus || wo.workflowStatus || "open")
    .replace(/_/g, " ")
    .trim()
  return raw || "open"
}

function urgencyLabel(wo: OperationalWorkOrder): string {
  const raw = (wo.urgency || wo.priority || "").replace(/_/g, " ").trim()
  if (!raw) return "Routine"
  if (/\b(fire|gas|smoke|electrical|habitability|emergency|critical)\b/i.test(raw)) {
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  }
  if (/urgent|high/i.test(raw)) return "Urgent"
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function unitBit(wo: OperationalWorkOrder): string {
  return formatUnitReference(wo.unitLabel) || "common area / property"
}

/**
 * Landlord-facing markdown from search_work_orders hits.
 * Insights only — no "I found N records" retrieval language.
 */
export function formatCatchAllWorkOrdersMarkdown(
  workOrders: OperationalWorkOrder[],
  opts?: { prioritization?: boolean },
): string {
  if (workOrders.length === 0) return ""

  const top = workOrders.slice(0, 8)
  const lead = opts?.prioritization
    ? top.length === 1
      ? `Here's the open work I'd focus on first — ranked by urgency, then how long it's been waiting.`
      : `Here's what I'd focus on first across your **${workOrders.length}** open requests — urgency first, then wait time, then anything waiting on your decision.`
    : top.length === 1
      ? `Here's the work order that best matches what you asked.`
      : `Here are the open work orders that best match what you asked, starting with the one I'd look at first.`

  const lines: string[] = [lead, ""]

  for (const wo of top) {
    // title/description already summarized via generateIssueSummary upstream.
    const issue = (wo.title || wo.description || wo.category || "Maintenance request")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160)
    const urgency = urgencyLabel(wo)
    const est =
      wo.estimatedCost != null ? formatMoney(wo.estimatedCost) : "No estimate on file"
    const ageBit =
      wo.slaExpired
        ? `${wo.daysOpen} day${wo.daysOpen === 1 ? "" : "s"} open — past the response time`
        : `${wo.daysOpen} day${wo.daysOpen === 1 ? "" : "s"}`
    lines.push(
      `### ${wo.workOrderId} — ${wo.propertyName}, ${unitBit(wo)}`,
      `- **Issue:** ${issue}`,
      `- **Urgency:** ${urgency}`,
      `- **Category:** ${wo.category || "—"}`,
      `- **Status:** ${statusLabel(wo)}`,
      `- **Open for:** ${ageBit}`,
      `- **Vendor:** ${wo.vendorName?.trim() || "None assigned"}`,
      `- **Estimate:** ${est}`,
      "",
    )
  }

  if (workOrders.length > top.length) {
    lines.push(
      `There ${workOrders.length - top.length === 1 ? "is" : "are"} **${
        workOrders.length - top.length
      }** more related work order${
        workOrders.length - top.length === 1 ? "" : "s"
      } in the portfolio beyond this list.`,
      "",
    )
  }

  lines.push(
    "### What I'd do next",
    "- Start with emergency / habitability items — same wait time is not the same risk.",
    "- Confirm vendor assignment and the latest update on the top work order.",
    "- If the response time has passed on a routine ticket, follow up before it becomes urgent.",
  )

  return polishAskUloProse(lines.join("\n").trim())
}

export function buildCatchAllWorkOrderPacket(
  result: SearchWorkOrdersResult | null | undefined,
  opts?: { prioritization?: boolean },
): CatchAllWorkOrderPacket | null {
  if (!result?.available || !result.workOrders.length) return null
  const markdown = formatCatchAllWorkOrdersMarkdown(result.workOrders, opts)
  if (!markdown.trim()) return null
  const top = result.workOrders[0]!
  return {
    available: true,
    found: true,
    markdown,
    bullets: [
      `${top.workOrderId} at ${top.propertyName}: ${statusLabel(top)}, open ${top.daysOpen}d`,
    ],
    workOrderCount: result.workOrders.length,
    source: "search_work_orders",
  }
}

export function shouldAttemptCatchAllWorkOrderFallback(input: {
  subject: AskUloQuestionSubject
  /** True when a specialty domain packet already answers the question. */
  hasSpecialtyPacket: boolean
}): boolean {
  if (input.hasSpecialtyPacket) return false
  return CATCHALL_WO_SUBJECTS.has(input.subject)
}
