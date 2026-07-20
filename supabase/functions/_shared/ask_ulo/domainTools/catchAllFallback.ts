/**
 * Catch-all fallback retriever — subject-scoped work-order answer when specialty
 * packets miss. Never portfolio briefing / property ranking.
 */
/// <reference lib="deno.ns" />

import type { AskUloQuestionSubject } from "../questionSubjectMatch.ts"
import type { OperationalWorkOrder } from "../searchOperationalRecords.ts"
import { polishAskUloProse } from "../responsePolish.ts"
import type { SearchWorkOrdersResult } from "./searchWorkOrders.ts"

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

function unitBit(wo: OperationalWorkOrder): string {
  return wo.unitLabel?.trim() ? `Unit ${wo.unitLabel.trim()}` : "common area / property"
}

/**
 * Landlord-facing markdown from search_work_orders hits.
 * Insights only — no "I found N records" retrieval language.
 */
export function formatCatchAllWorkOrdersMarkdown(
  workOrders: OperationalWorkOrder[],
): string {
  if (workOrders.length === 0) return ""

  const top = workOrders.slice(0, 8)
  const lead =
    top.length === 1
      ? `Here's the work order that best matches what you asked.`
      : `Here are the open work orders that best match what you asked, starting with the one I'd look at first.`

  const lines: string[] = [lead, ""]

  for (const wo of top) {
    const issue = (wo.description || wo.title || wo.category || "Maintenance request")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160)
    const est =
      wo.estimatedCost != null ? formatMoney(wo.estimatedCost) : "No estimate on file"
    lines.push(
      `### ${wo.workOrderId} — ${wo.propertyName}, ${unitBit(wo)}`,
      `- **Issue:** ${issue}`,
      `- **Category:** ${wo.category || "—"}`,
      `- **Priority:** ${(wo.priority ?? "—").replace(/_/g, " ")}`,
      `- **Status:** ${statusLabel(wo)}`,
      `- **Open for:** ${wo.daysOpen} day${wo.daysOpen === 1 ? "" : "s"}`,
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
    "- Open the top work order and confirm vendor assignment and the latest update.",
    "- If the vendor response deadline has passed, reassign or follow up before it becomes an emergency.",
  )

  return polishAskUloProse(lines.join("\n").trim())
}

export function buildCatchAllWorkOrderPacket(
  result: SearchWorkOrdersResult | null | undefined,
): CatchAllWorkOrderPacket | null {
  if (!result?.available || !result.workOrders.length) return null
  const markdown = formatCatchAllWorkOrdersMarkdown(result.workOrders)
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
