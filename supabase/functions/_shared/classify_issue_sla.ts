/**
 * AI returns issue_category + severity only; SLA minutes come from sla_rules.ts.
 * Classification is delegated to the unified maintenance_classification pipeline.
 */
import {
  classifyIssueForSlaUnified,
  type ClassificationResult,
} from "./maintenance_classification/mod.ts"
import { issueCategoryToVendorTrade } from "./vendor_trades.ts"

export type IssueSlaClassification = {
  issue_category: string
  severity: "low" | "normal" | "urgent"
  /** Full pipeline result when available (for logging / SMS). */
  classification?: ClassificationResult
}

/** Same rules as embedded SLA classification; used when `issueCategory` overrides AI classification. */
export function severityFromResidentPriority(
  priority: string,
): IssueSlaClassification["severity"] {
  const x = priority.trim().toLowerCase()
  if (
    x.includes("urgent") ||
    x.includes("emergency") ||
    x === "high" ||
    x.includes("critical")
  ) {
    return "urgent"
  }
  if (x.includes("low")) return "low"
  return "normal"
}

/**
 * Classify issue for SLA using the unified sanitizer → entities → rules →
 * semantic → LLM → Other postcheck pipeline.
 */
export async function classifyIssueForSla(
  description: string,
  residentPriority: string,
): Promise<IssueSlaClassification> {
  const unified = await classifyIssueForSlaUnified(description, residentPriority)
  return {
    issue_category: issueCategoryToVendorTrade(unified.issue_category),
    severity: unified.severity,
    classification: unified.classification,
  }
}
