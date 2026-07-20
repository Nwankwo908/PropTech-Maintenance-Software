/**
 * Capability detection — small typed set instead of one playbook per phrasing.
 */

import {
  isFirstActionPriorityQuestion,
} from "./reasoningFirst.ts"
import {
  detectQuestionSubject,
  isLeaseEndingQuestion,
  isMarketIntelligenceQuestion,
  isMessageNonresponseQuestion,
  isMoveInQuestion,
  isUloActiveTasksQuestion,
  isVacantUnitQuestion,
  isVendorInactivityQuestion,
  isVendorOverloadQuestion,
  isVendorRankingQuestion,
  isVendorResponseSpeedQuestion,
  isWeatherAlertsQuestion,
  isLandlordIncentivesQuestion,
  isWorkOrderVendorWaitQuestion,
  type AskUloQuestionSubject,
} from "./questionSubjectMatch.ts"
import { isDraftCommunicationQuestion } from "./domainTools/draftCommunication.ts"
import { isRepairsToApproveQuestion } from "./repairsToApproveLookup.ts"
import { isRecurringRepairsQuestion } from "./recurringRepairsLookup.ts"
import { isMissingUpdatesQuestion } from "./missingUpdatesLookup.ts"
import { isOldestWaitingWorkOrderQuestion } from "./taskCompletion.ts"
import { isRepairCostQuestion } from "./deepOperationalInvestigation.ts"
import {
  isVendorBestQuestion,
  isVendorCompletionQuestion,
} from "./questionMetricContext.ts"

export type AskUloCapability =
  | "count"
  | "search"
  | "rank"
  | "compare"
  | "summarize"
  | "investigate_root_cause"
  | "identify_risk"
  | "recommend"
  | "estimate_cost"
  | "identify_recurring_pattern"
  | "identify_pending_decision"
  | "explain_status"
  | "forecast"
  | "legal_lookup"
  | "draft"

export type AskUloCapabilityResult = {
  capability: AskUloCapability
  confidence: "high" | "medium" | "low"
  /** Optional structured hints for tool arguments. */
  hints: {
    metric?: string
    order?: "asc" | "desc"
    groupBy?: string[]
    approvalRequired?: boolean
    includeCompleted?: boolean
    pendingJobsOnly?: boolean
    vendorMetric?:
      | "response_time"
      | "completion_rate"
      | "overall_quality"
      | "inactive"
      | "workload"
    residentFilter?:
      | "late_rent"
      | "outstanding_balance"
      | "lease_ending"
      | "high_maintenance_activity"
      | "move_in"
      | "move_out"
      | "message_nonresponse"
    priorities?: string[]
  }
}

const LATE_RENT_CAPABILITY_RE =
  /\b(late\s+(?:paying|on\s+rent|with\s+rent)|past[\s-]?due|arrears|delinquen|balance\s+due|owes?\s+rent|rent\s+(?:late|owed|outstanding)|consistently\s+late)\b/i

/**
 * Detect the operational capability implied by the question.
 * Prefer high-confidence specialized detectors over generic rank/search.
 */
export function detectAskUloCapability(
  question: string,
  subject?: AskUloQuestionSubject,
): AskUloCapabilityResult {
  const q = question.trim()
  const subj = subject ?? detectQuestionSubject(q)

  if (subj === "legal" || subj === "local_regulation") {
    return { capability: "legal_lookup", confidence: "high", hints: {} }
  }

  if (isDraftCommunicationQuestion(q)) {
    return { capability: "draft", confidence: "high", hints: {} }
  }

  if (isWeatherAlertsQuestion(q) || subj === "weather") {
    return {
      capability: "search",
      confidence: "high",
      hints: { metric: "weather_alerts" },
    }
  }

  if (isLandlordIncentivesQuestion(q) || subj === "incentives") {
    return {
      capability: "search",
      confidence: "high",
      hints: { metric: "landlord_incentives" },
    }
  }

  if (isUloActiveTasksQuestion(q) || subj === "workflow") {
    if (/\bwaiting\s+on\s+me|decisions?\s+waiting|awaiting\s+(?:my\s+)?decision\b/i.test(q)) {
      return {
        capability: "identify_pending_decision",
        confidence: "high",
        hints: { approvalRequired: true },
      }
    }
    if (isUloActiveTasksQuestion(q)) {
      return {
        capability: "explain_status",
        confidence: "high",
        hints: { metric: "ulo_active_tasks" },
      }
    }
    return {
      capability: "search",
      confidence: "high",
      hints: { metric: "workflow_status" },
    }
  }

  if (subj === "market_intelligence" || isMarketIntelligenceQuestion(q)) {
    return { capability: "search", confidence: "high", hints: { metric: "market_rent" } }
  }

  if (isFirstActionPriorityQuestion(q)) {
    return { capability: "recommend", confidence: "high", hints: {} }
  }

  if (isLeaseEndingQuestion(q)) {
    return {
      capability: "search",
      confidence: "high",
      hints: { residentFilter: "lease_ending", metric: "lease_end_date", order: "asc" },
    }
  }

  if (isVacantUnitQuestion(q)) {
    return {
      capability: "search",
      confidence: "high",
      hints: { metric: "vacancy", groupBy: ["unit"] },
    }
  }

  if (isWorkOrderVendorWaitQuestion(q)) {
    return {
      capability: "search",
      confidence: "high",
      hints: { pendingJobsOnly: true, metric: "missing_updates" },
    }
  }

  if (isMessageNonresponseQuestion(q)) {
    return {
      capability: "search",
      confidence: "high",
      hints: { residentFilter: "message_nonresponse", metric: "message_response" },
    }
  }

  if (isMoveInQuestion(q)) {
    return {
      capability: "search",
      confidence: "high",
      hints: { residentFilter: "move_in", metric: "move_in_date", order: "desc" },
    }
  }

  if (isRepairsToApproveQuestion(q) || (/\bapprove\b/i.test(q) && /\brepairs?\b/i.test(q))) {
    return {
      capability: "identify_pending_decision",
      confidence: "high",
      hints: {
        approvalRequired: true,
        priorities: ["critical", "urgent", "high"],
      },
    }
  }

  if (isRecurringRepairsQuestion(q) || /\bkeep(?:s|ing)?\s+happening\b|\breoccurr|\bover\s+and\s+over\b/i.test(q)) {
    return {
      capability: "identify_recurring_pattern",
      confidence: "high",
      hints: {
        includeCompleted: true,
        groupBy: ["property", "unit", "normalized_issue"],
      },
    }
  }

  if (isRepairCostQuestion(q) || /\bestimate\b.{0,40}\bcost\b|\brepair\s+cost\b/i.test(q)) {
    return { capability: "estimate_cost", confidence: "high", hints: {} }
  }

  if (isOldestWaitingWorkOrderQuestion(q) || /\bwaiting\s+(?:the\s+)?longest\b/i.test(q)) {
    return {
      capability: "rank",
      confidence: "high",
      hints: { metric: "wait_age", order: "desc" },
    }
  }

  if (isMissingUpdatesQuestion(q) || /\bwaiting\s+for\s+vendors?\b/i.test(q)) {
    return {
      capability: "search",
      confidence: "high",
      hints: { pendingJobsOnly: true, metric: "missing_updates" },
    }
  }

  if (
    LATE_RENT_CAPABILITY_RE.test(q) &&
    (subj === "resident" || subj === "finance" || /\bresidents?\b|\btenants?\b/i.test(q))
  ) {
    return {
      capability: "search",
      confidence: "high",
      hints: { residentFilter: "late_rent", metric: "balance_due", order: "desc" },
    }
  }

  if (isVendorInactivityQuestion(q)) {
    return {
      capability: "rank",
      confidence: "high",
      hints: { vendorMetric: "inactive", pendingJobsOnly: true },
    }
  }
  if (isVendorOverloadQuestion(q)) {
    return {
      capability: "rank",
      confidence: "high",
      hints: { vendorMetric: "workload", order: "desc" },
    }
  }
  if (isVendorResponseSpeedQuestion(q)) {
    return {
      capability: "rank",
      confidence: "high",
      hints: { vendorMetric: "response_time", order: "asc" },
    }
  }
  if (isVendorCompletionQuestion(q)) {
    return {
      capability: "rank",
      confidence: "high",
      hints: { vendorMetric: "completion_rate", order: "desc" },
    }
  }
  if (isVendorBestQuestion(q) || isVendorRankingQuestion(q)) {
    return {
      capability: "rank",
      confidence: "high",
      hints: { vendorMetric: "overall_quality", order: "desc" },
    }
  }

  if (
    /\bbecoming\s+(?:an?\s+)?emergenc|expensive\s+if\s+ignored|biggest\s+(?:operational\s+)?risk\b|worries?\s+you\s+the\s+most\b/i
      .test(q)
  ) {
    return { capability: "identify_risk", confidence: "high", hints: {} }
  }

  if (/\bwaiting\s+on\s+me|decisions?\s+waiting|awaiting\s+(?:my\s+)?decision\b/i.test(q)) {
    return {
      capability: "identify_pending_decision",
      confidence: "high",
      hints: { approvalRequired: true },
    }
  }

  if (subj === "finance") {
    return {
      capability: /\b(estimate|forecast|cost)\b/i.test(q) ? "estimate_cost" : "search",
      confidence: "medium",
      hints: { metric: "spend" },
    }
  }

  if (/\bwhich\s+units?\b.{0,40}\bmost\b|\bmost\s+maintenance\b/i.test(q)) {
    return {
      capability: "rank",
      confidence: "high",
      hints: { metric: "request_count", groupBy: ["unit"], order: "desc" },
    }
  }

  if (/\bcompar(?:e|ing|ison)\b/i.test(q)) {
    return { capability: "compare", confidence: "medium", hints: {} }
  }
  if (/\brecommend|suggest\b/i.test(q)) {
    return { capability: "recommend", confidence: "medium", hints: {} }
  }
  if (/\bsummar|catch\s+me\s+up|what\s+happened\b/i.test(q)) {
    return { capability: "summarize", confidence: "medium", hints: {} }
  }
  if (/\bwhy\b|\broot\s+cause\b|\bstuck\b/i.test(q)) {
    return { capability: "investigate_root_cause", confidence: "medium", hints: {} }
  }
  if (/\brank|highest|lowest|fastest|oldest|most\b/i.test(q)) {
    return { capability: "rank", confidence: "medium", hints: { order: "desc" } }
  }

  return { capability: "search", confidence: "low", hints: {} }
}
