/**
 * Deep operational investigation lookup — category synonym match + repair-cost framing.
 * Uses searchOperationalRecords (same SoT as the workflow detail drawer).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import {
  TYPICAL_REPAIR_COST_BANDS,
  classifyDeepOperationalInvestigation,
  type DeepOpsPlan,
  type OpsCategoryId,
} from "./deepOperationalInvestigation.ts"
import {
  type OperationalWorkOrder,
  type OperationalRetrievalLog,
} from "./searchOperationalRecords.ts"
import { searchWorkOrders } from "./domainTools/searchWorkOrders.ts"
import { sanitizeBuildingFilter } from "./buildingFilter.ts"

export type DeepOpsTicket = {
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
  createdAt: string
  estimatedCost: number | null
  estimatedCostSource: string | null
  repairScope: string
  laborEstimate: string
  workflowStage: string | null
  slaExpired: boolean
  approvalStatus: string
}

export type DeepOpsLookupResult = {
  available: boolean
  found: boolean
  plan: DeepOpsPlan
  tickets: DeepOpsTicket[]
  workOrders: OperationalWorkOrder[]
  operationalEvidence: { workOrders: OperationalWorkOrder[] }
  missingFields: string[]
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  retrievalLog: OperationalRetrievalLog | null
}

function primaryCategory(plan: DeepOpsPlan): OpsCategoryId | null {
  return plan.categories[0] ?? null
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount)
}

function ticketFromWorkOrder(wo: OperationalWorkOrder): DeepOpsTicket {
  return {
    id: wo.maintenanceRequestId,
    displayId: wo.workOrderId,
    building: wo.propertyName,
    unit: wo.unitLabel,
    issueCategory: wo.category,
    description: wo.description,
    status: wo.vendorWorkStatus || wo.workflowStatus || "open",
    priority: wo.priority,
    daysOpen: wo.daysOpen,
    vendorName: wo.vendorName,
    createdAt: wo.createdAt,
    estimatedCost: wo.estimatedCost,
    estimatedCostSource: wo.estimatedCostSource,
    repairScope: wo.repairScope,
    laborEstimate: wo.laborEstimate,
    workflowStage: wo.workflowStage,
    slaExpired: wo.slaExpired,
    approvalStatus: wo.approvalStatus,
  }
}

/**
 * Deterministic repair-cost / ops answer from structured work orders.
 */
export function buildOperationalFindingMarkdown(
  workOrders: OperationalWorkOrder[],
  plan: DeepOpsPlan,
): string {
  if (workOrders.length === 0) {
    return buildNoMatchMarkdown(plan, "your portfolio")
  }

  const primary = workOrders[0]!
  const cat = primaryCategory(plan) ?? (primary.category.toLowerCase() as OpsCategoryId)
  const bands = TYPICAL_REPAIR_COST_BANDS[cat] ?? TYPICAL_REPAIR_COST_BANDS.hvac
  const unitBit = primary.unitLabel ? `Unit ${primary.unitLabel}` : "the property"
  const relatedNote =
    workOrders.length > 1
      ? ` Related ${primary.category.toLowerCase()} work nearby may share the same cause.`
      : ""

  const hasActualQuote =
    primary.estimatedCost != null &&
    (primary.estimatedCostSource === "invoice" ||
      primary.estimatedCostSource === "recognized_spend" ||
      primary.estimatedCostSource === "workflow_metadata")

  const hasProxyEstimate =
    primary.estimatedCost != null && primary.estimatedCostSource === "minutes_proxy"

  let lead: string
  if (plan.isRepairCostQuestion && primary.estimatedCost != null) {
    if (hasActualQuote) {
      lead =
        `The ${primary.category} request at **${primary.propertyName}, ${unitBit}** (${primary.workOrderId}) ` +
        `currently shows an estimate of **${formatMoney(primary.estimatedCost)}** for ${
          primary.repairScope.toLowerCase()
        }, with **${primary.laborEstimate}** of labor expected.${relatedNote}`
    } else {
      lead =
        `The ${primary.category} request at **${primary.propertyName}, ${unitBit}** (${primary.workOrderId}) ` +
        `currently shows an estimate of **${formatMoney(primary.estimatedCost)}** for a ${
          primary.repairScope.toLowerCase()
        }, with **${primary.laborEstimate}** of labor expected.${relatedNote}`
    }
  } else if (plan.isRepairCostQuestion) {
    lead =
      `The ${primary.category} request for **${unitBit}** at **${primary.propertyName}** (${primary.workOrderId}) ` +
      `still needs a vendor estimate before you can approve spend.${relatedNote}`
  } else {
    lead =
      `The ${primary.category} request at **${primary.propertyName}, ${unitBit}** (${primary.workOrderId}) ` +
      `is the one I'd focus on first.${relatedNote}`
  }

  const parts = [
    lead,
    "",
    "### What's going on",
    `- **Work order:** ${primary.workOrderId}`,
    `- **Property:** ${primary.propertyName}`,
    `- **Unit:** ${primary.unitLabel?.trim() || "—"}`,
    `- **Issue:** ${primary.description.slice(0, 180)}`,
    `- **Priority:** ${primary.priority?.replace(/_/g, " ") || "—"}`,
    `- **Status:** ${(primary.workflowStage || primary.vendorWorkStatus || "open").replace(/_/g, " ")}`,
    `- **Open for:** ${primary.daysOpen} day${primary.daysOpen === 1 ? "" : "s"}`,
    `- **Vendor:** ${primary.vendorName?.trim() || "None assigned"}`,
    `- **Existing estimate:** ${
      primary.estimatedCost != null ? formatMoney(primary.estimatedCost) : "None on file"
    }`,
    `- **Repair scope:** ${primary.repairScope}`,
    `- **Labor estimate:** ${primary.laborEstimate}`,
    `- **Vendor response deadline:** ${
      primary.slaExpired ? "Has already passed" : "Still on track"
    }`,
    `- **Approval:** ${
      primary.approvalStatus === "review_required" ? "Review Required" : "Not Required"
    }`,
  ]

  if (plan.isRepairCostQuestion) {
    if (primary.estimatedCost != null) {
      parts.push(
        "",
        "### Estimated cost",
        `- **Current estimate on the work order:** ${formatMoney(primary.estimatedCost)}` +
          (hasProxyEstimate
            ? " (preliminary diagnostic / repair estimate from the ticket)"
            : ""),
        "",
        "### What may affect the final cost",
      )
      if (/compressor/i.test(primary.description)) {
        parts.push(
          "- The compressor failure may require a larger repair than the preliminary estimate covers.",
        )
      }
      if (!primary.vendorName) {
        parts.push("- No HVAC vendor is currently assigned.")
      }
      if (primary.slaExpired) {
        parts.push("- The vendor response deadline has already passed.")
      }
      if (primary.approvalStatus === "review_required") {
        parts.push("- Approval is still required.")
      }
      parts.push(
        "",
        `I'd treat the **${formatMoney(primary.estimatedCost)} as the current preliminary estimate**, not the final price.`,
      )
      if (/compressor/i.test(primary.description)) {
        parts.push(
          "Because the ticket says the compressor failed, the cost could increase once a technician confirms whether the compressor must be repaired or replaced.",
        )
      }
    } else {
      parts.push("", "### Estimated cost")
      for (const b of bands) {
        parts.push(`- ${b.scenario}: **${b.rangeLabel}**`)
      }
      parts.push(
        "",
        "### What would narrow the estimate",
        "- technician diagnosis",
        "- equipment model / age",
        "- photos",
        "- vendor quote",
      )
    }

    parts.push(
      "",
      "### What I'd do next",
      primary.vendorName
        ? `Ask **${primary.vendorName}** for a diagnostic estimate before approving major work.`
        : "Assign an HVAC vendor for a diagnostic visit before approving major work — especially once the vendor response deadline has passed.",
    )
  } else {
    parts.push(
      "",
      "### What I'd do next",
      primary.vendorName
        ? `Follow up with **${primary.vendorName}** on status and next appointment.`
        : "Assign a vendor and set a clear next step so this doesn't sit unresolved.",
    )
  }

  if (workOrders.length > 1) {
    parts.push("", "### Related work to watch")
    for (const t of workOrders.slice(1, 6)) {
      const costBit =
        t.estimatedCost != null ? `, est. ${formatMoney(t.estimatedCost)}` : ""
      parts.push(
        `- ${t.workOrderId}: ${t.unitLabel ? `Unit ${t.unitLabel}` : t.propertyName} — ${t.title.slice(0, 80)} (${t.daysOpen}d${costBit})`,
      )
    }
  }

  return parts.join("\n")
}

function buildNoMatchMarkdown(plan: DeepOpsPlan, scopeLabel: string): string {
  const cat = plan.categories[0] ?? "maintenance"
  return [
    `I don't yet see an open ${cat} request${scopeLabel ? ` for ${scopeLabel}` : ""} with enough detail to estimate or diagnose from.`,
    "",
    "### What I know",
    "Nothing actionable matched those symptoms in the open / recent maintenance picture.",
    "",
    "### What's missing",
    "A work order with unit, symptoms, vendor notes, and any existing quote.",
    "",
    "### What happens next",
    plan.isRepairCostQuestion
      ? "Once a request is logged (or linked to this property), I can use the work-order estimate and typical repair ranges."
      : "Once the related request is in the system, I can reconstruct status, vendor progress, and next actions.",
  ].join("\n")
}

function buildRetrievalFailureMarkdown(plan: DeepOpsPlan, error: string): string {
  const cat = plan.categories[0] ?? "maintenance"
  return [
    `I couldn't finish checking ${cat}-related work orders because the operational query failed.`,
    "",
    "### What I know",
    "Your question needs request-level work-order data (not portfolio totals).",
    "",
    "### What's missing",
    `The operational lookup did not complete (${error.slice(0, 120)}).`,
    "",
    "### What happens next",
    "Retry in a moment. If it keeps failing, refresh Active Tasks and confirm the ticket is still in the pipeline.",
  ].join("\n")
}

/**
 * Locate ops tickets by category synonyms / repair-cost scope.
 */
export async function deepOperationalInvestigationLookup(
  supabase: SupabaseClient,
  input: {
    landlordId: string
    question: string
    buildingFilter?: string | null
    unitLabel?: string | null
  },
): Promise<DeepOpsLookupResult> {
  const plan = classifyDeepOperationalInvestigation(input.question)
  const landlordId = input.landlordId.trim()
  const buildingFilter = sanitizeBuildingFilter(input.buildingFilter)
  const unitLabel = input.unitLabel?.trim() || null

  console.log(
    "ASK_ULO_INTENT",
    plan.isRepairCostQuestion ? "repair_cost_estimate" : "deep_operational_investigation",
  )
  console.log(
    "ASK_ULO_SCOPE",
    JSON.stringify({
      landlordId,
      buildingFilter,
      buildingFilterRaw: input.buildingFilter ?? null,
      unitLabel,
      categories: plan.categories,
      scope: plan.scope,
    }),
  )

  const empty: DeepOpsLookupResult = {
    available: false,
    found: false,
    plan,
    tickets: [],
    workOrders: [],
    operationalEvidence: { workOrders: [] },
    missingFields: [],
    bullets: [],
    citations: [],
    markdown: "",
    retrievalLog: null,
  }

  if (!plan.requiresDeepOps || !landlordId) return empty

  const category = plan.categories[0] ?? null
  const search = await searchWorkOrders(supabase, {
    organizationId: landlordId,
    buildingFilter,
    unitLabel,
    category,
    searchTerms: plan.searchTerms,
    status: "open",
    dateRangeDays: 120,
    limit: 20,
  })

  const log: OperationalRetrievalLog = {
    ...search.log,
    intentHint: plan.isRepairCostQuestion ? "repair_cost_estimate" : "deep_operational_investigation",
    category: category,
  }

  console.log(
    "ASK_ULO_MODEL_CONTEXT",
    JSON.stringify({
      workOrderIds: log.matchingWorkOrderIds,
      estimatedCosts: log.estimatedCosts,
      evidencePayloadBytes: log.evidencePayloadBytes,
      found: search.workOrders.length > 0,
      error: search.error,
      toolId: search.toolId,
    }),
  )

  console.log(
    "[ask_ulo/deepOpsLookup]",
    JSON.stringify({
      intent: log.intentHint,
      category: log.category,
      toolId: search.toolId,
      searchFilters: log.searchFilters,
      tablesOrRpcs: log.tablesOrRpcs,
      recordCount: log.recordCount,
      matchingWorkOrderIds: log.matchingWorkOrderIds,
      estimatedCostFound: log.estimatedCostFound,
      estimatedCosts: log.estimatedCosts,
      evidencePayloadBytes: log.evidencePayloadBytes,
      fallbackReason: log.fallbackReason ?? (search.error ? `error:${search.error}` : null),
    }),
  )

  if (!search.available) {
    console.error(
      "ASK_ULO_RETRIEVAL_FAILURE",
      JSON.stringify({
        method: "searchWorkOrders",
        filters: log.searchFilters,
        organizationId: landlordId,
        propertyId: null,
        recordsReturned: 0,
        failure: search.error,
      }),
    )
    return {
      ...empty,
      available: false,
      plan,
      retrievalLog: log,
      markdown: buildRetrievalFailureMarkdown(plan, search.error || "unknown_error"),
      missingFields: ["operational_retrieval"],
      citations: [
        {
          tool: "ops_graph",
          title: "Deep operational investigation",
          citation: "workflow_runs + maintenance_requests (retrieval failed)",
          excerpt: search.error || "unavailable",
        },
      ],
    }
  }

  const workOrders = search.workOrders
  const tickets = workOrders.map(ticketFromWorkOrder)
  const found = workOrders.length > 0
  const scopeLabel = buildingFilter || "your portfolio"

  const missingFields: string[] = []
  if (found) {
    const p = workOrders[0]!
    if (!p.description) missingFields.push("detailed issue description")
    if (!p.vendorName) missingFields.push("vendor assignment")
    if (p.estimatedCostSource === "minutes_proxy") {
      missingFields.push("vendor quote (preliminary estimate only)")
    }
    if (p.estimatedCost == null) missingFields.push("vendor estimate")
  }

  const bullets = found
    ? workOrders.slice(0, 5).map((t) => {
        const cost =
          t.estimatedCost != null
            ? ` · est. ${formatMoney(t.estimatedCost)}`
            : ""
        return `${t.workOrderId}: ${t.category}${t.unitLabel ? ` Unit ${t.unitLabel}` : ""} @ ${t.propertyName} — ${t.workflowStage || t.vendorWorkStatus}${cost}`
      })
    : [`No matching ops tickets for terms: ${plan.searchTerms.slice(0, 8).join(", ") || "general"}`]

  const citations: AskUloCitation[] = [
    {
      tool: "ops_graph",
      title: "Deep operational investigation",
      citation:
        "workflow_runs + maintenance_requests + maintenance_invoices + vendors (same SoT as workflow detail)",
      excerpt: found
        ? `Matched ${workOrders.length} work order(s): ${workOrders
            .slice(0, 3)
            .map((w) => w.workOrderId)
            .join(", ")}`
        : "No synonym-matched tickets in scope",
    },
  ]

  return {
    available: true,
    found,
    plan,
    tickets,
    workOrders,
    operationalEvidence: { workOrders },
    missingFields,
    bullets,
    citations,
    markdown: found
      ? buildOperationalFindingMarkdown(workOrders, plan)
      : buildNoMatchMarkdown(plan, scopeLabel),
    retrievalLog: log,
  }
}
