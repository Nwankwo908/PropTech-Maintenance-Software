/**
 * Investigation playbooks — question-type specific search order.
 * Decision-support routing: consult Ulo intelligence before raw SQL.
 */

import {
  type KnowledgeSourceId,
  NEVER_IGNORE_ULO_INTELLIGENCE_GUIDE,
} from "./knowledgeHierarchy.ts"
import { isRepairCostQuestion } from "./deepOperationalInvestigation.ts"
import { isEntityInvestigationQuestion } from "./entityInvestigation.ts"
import { requiresInvestigation } from "./investigationDefinition.ts"
import { isRecurringRepairsQuestion } from "./recurringRepairsLookup.ts"
import { isRepairsToApproveQuestion } from "./repairsToApproveLookup.ts"
import { isMissingUpdatesQuestion } from "./missingUpdatesLookup.ts"
import { isVendorResponseSpeedQuestion, isVendorRankingQuestion, isVendorInactivityQuestion, isVendorOverloadQuestion, isVendorFocusedQuestion, isMarketIntelligenceQuestion, isUloActiveTasksQuestion, isWeatherAlertsQuestion, isLandlordIncentivesQuestion, detectQuestionSubject } from "./questionSubjectMatch.ts"
import { isVendorVerificationStatusQuestion } from "./vendorVerificationStatusLookup.ts"
import { isFirstActionPriorityQuestion } from "./reasoningFirst.ts"
import {
  isVendorBestQuestion,
  isVendorRecommendQuestion,
  isVendorCompletionQuestion,
  isAnyVendorMetricQuestion,
} from "./questionMetricContext.ts"

export type InvestigationPlaybookId =
  | "maintenance_risk"
  | "recurring_repairs"
  | "approve_repairs"
  | "missing_updates"
  | "vendor_speed"
  | "vendor_best"
  | "vendor_completion"
  | "vendor_inactive"
  | "vendor_overload"
  | "vendor_verification"
  | "emergency_escalation"
  | "repair_estimate"
  | "why_not_resolved"
  | "executive_briefing"
  | "generic_ops"

export type InvestigationPlaybook = {
  id: InvestigationPlaybookId
  label: string
  /** Human-readable objective for logs / prompts. */
  objective: string
  searchOrder: KnowledgeSourceId[]
  /** Always run Tier 1 lookups before declaring unavailable. */
  consultTier1First: boolean
  /** Prefer Property Insights / briefing packet as the answer when findings exist. */
  preferTier1Answer: boolean
  /** Allow deep ops / WO category search as primary path. */
  deepOpsPrimary: boolean
}

const PLAYBOOKS: Record<InvestigationPlaybookId, Omit<InvestigationPlaybook, "objective">> = {
  maintenance_risk: {
    id: "maintenance_risk",
    label: "Maintenance risk / expensive if ignored",
    searchOrder: [
      "property_insights",
      "property_health",
      "risk_scores",
      "awaiting_decision",
      "work_orders",
      "workflow_pipeline",
      "operations_graph",
      "vendor_activity",
    ],
    consultTier1First: true,
    preferTier1Answer: true,
    deepOpsPrimary: false,
  },
  recurring_repairs: {
    id: "recurring_repairs",
    label: "Recurring repairs / keeps happening",
    searchOrder: [
      "work_orders",
      "workflow_runs",
      "workflow_pipeline",
      "operations_graph",
      "property_insights",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
  approve_repairs: {
    id: "approve_repairs",
    label: "Repairs to approve / act on now",
    searchOrder: [
      "awaiting_decision",
      "work_orders",
      "workflow_pipeline",
      "workflow_priorities",
      "operations_graph",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
  missing_updates: {
    id: "missing_updates",
    label: "Work orders missing updates",
    searchOrder: [
      "work_orders",
      "vendor_activity",
      "workflow_pipeline",
      "operations_graph",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
  vendor_speed: {
    id: "vendor_speed",
    label: "Vendor response speed ranking",
    searchOrder: [
      "vendor_activity",
      "work_orders",
      "operations_graph",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
  vendor_best: {
    id: "vendor_best",
    label: "Best vendor by overall score / trade",
    searchOrder: [
      "vendor_activity",
      "work_orders",
      "operations_graph",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
  vendor_completion: {
    id: "vendor_completion",
    label: "Vendor completion-rate ranking",
    searchOrder: [
      "vendor_activity",
      "work_orders",
      "operations_graph",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
  vendor_inactive: {
    id: "vendor_inactive",
    label: "Vendors without recent accepts",
    searchOrder: [
      "vendor_activity",
      "work_orders",
      "operations_graph",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
  vendor_overload: {
    id: "vendor_overload",
    label: "Vendors overloaded by open workload",
    searchOrder: [
      "vendor_activity",
      "work_orders",
      "operations_graph",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
  vendor_verification: {
    id: "vendor_verification",
    label: "Vendor verification / compliance status",
    searchOrder: [
      "vendor_activity",
      "operations_graph",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
  emergency_escalation: {
    id: "emergency_escalation",
    label: "Requests becoming emergencies",
    searchOrder: [
      "awaiting_decision",
      "workflow_priorities",
      "work_orders",
      "workflow_pipeline",
      "operations_graph",
      "property_insights",
      "vendor_activity",
    ],
    consultTier1First: true,
    preferTier1Answer: true,
    deepOpsPrimary: false,
  },
  repair_estimate: {
    id: "repair_estimate",
    label: "Repair cost estimate",
    searchOrder: [
      "work_orders",
      "invoices",
      "workflow_pipeline",
      "vendor_activity",
      "repair_pricing",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: true,
  },
  why_not_resolved: {
    id: "why_not_resolved",
    label: "Why isn't this resolved?",
    searchOrder: [
      "work_orders",
      "workflow_runs",
      "vendor_activity",
      "operations_graph",
      "messages",
      "awaiting_decision",
    ],
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
  executive_briefing: {
    id: "executive_briefing",
    label: "Portfolio / property health briefing",
    searchOrder: [
      "property_health",
      "property_insights",
      "active_tasks",
      "awaiting_decision",
      "operations_graph",
    ],
    consultTier1First: true,
    preferTier1Answer: true,
    deepOpsPrimary: false,
  },
  generic_ops: {
    id: "generic_ops",
    label: "General operational question",
    searchOrder: [
      "property_insights",
      "awaiting_decision",
      "work_orders",
      "workflow_pipeline",
      "operations_graph",
    ],
    // Fail closed: unmatched questions must NOT auto-fetch portfolio briefing.
    // Briefing is only fetched when intent/mode/playbook is explicitly executive_briefing.
    consultTier1First: false,
    preferTier1Answer: false,
    deepOpsPrimary: false,
  },
}

const EXPENSIVE_IF_IGNORED_RE =
  /\b(expensive\s+if\s+ignored|become\s+expensive|costly\s+if|ignored|defer(?:red)?\s+repair|prevent(?:ive)?\s+repair|could\s+become\s+(?:an?\s+)?(?:expensive|costly|serious)|risk\s+of\s+(?:bigger|larger|major)\s+(?:repair|cost))\b/i

const EMERGENCY_ESCALATION_RE =
  /\b(becoming\s+(?:an?\s+)?emergenc|emergenc(?:y|ies)\b|sla\s+expir|no\s+vendor|vendor\s+declined|overdue|critical\s+(?:work\s*orders?|tickets?|requests?))\b/i

const WHY_NOT_RESOLVED_RE =
  /\b(why\s+(?:isn'?t|is\s+not|hasn'?t|haven'?t)|what(?:'s|\s+is)\s+(?:blocking|stalling|holding)|still\s+open|not\s+(?:been\s+)?(?:resolved|fixed|completed))\b/i

export function classifyInvestigationPlaybook(question: string): InvestigationPlaybook {
  const q = question.trim()
  if (!q) {
    return {
      ...PLAYBOOKS.generic_ops,
      objective: "Empty question",
    }
  }

  // Market rent / comps — never portfolio briefing or Tier-1 ops packet.
  if (isMarketIntelligenceQuestion(q)) {
    return {
      ...PLAYBOOKS.generic_ops,
      consultTier1First: false,
      preferTier1Answer: false,
      objective:
        "Answer with market rent / comps data — never portfolio health briefing",
    }
  }

  if (isWeatherAlertsQuestion(q)) {
    return {
      ...PLAYBOOKS.generic_ops,
      consultTier1First: false,
      preferTier1Answer: false,
      objective: "Answer with NWS weather alerts for portfolio locations — never portfolio briefing",
    }
  }

  if (isLandlordIncentivesQuestion(q)) {
    return {
      ...PLAYBOOKS.generic_ops,
      consultTier1First: false,
      preferTier1Answer: false,
      objective:
        "Answer with jurisdiction-scoped landlord grants / tax incentive catalog — never portfolio briefing",
    }
  }

  // First-action / smartest-decision — ranked priority, never raw briefing dump.
  if (isFirstActionPriorityQuestion(q)) {
    return {
      ...PLAYBOOKS.generic_ops,
      consultTier1First: false,
      preferTier1Answer: false,
      objective:
        "Recommend the single highest-leverage action / property to start with — never dump the full portfolio briefing packet",
    }
  }

  // Active Ulo / workflow tasks — never portfolio health briefing.
  if (isUloActiveTasksQuestion(q) || detectQuestionSubject(q) === "workflow") {
    return {
      ...PLAYBOOKS.generic_ops,
      consultTier1First: false,
      preferTier1Answer: false,
      objective:
        "List active/escalated workflows Ulo is running — never portfolio health briefing",
    }
  }

  if (isRepairCostQuestion(q)) {
    return {
      ...PLAYBOOKS.repair_estimate,
      objective: "Estimate repair cost from matching work orders and quotes",
    }
  }

  if (isRecurringRepairsQuestion(q)) {
    return {
      ...PLAYBOOKS.recurring_repairs,
      objective:
        "Identify repeating repair types from open + completed work orders / workflows (60d)",
    }
  }

  if (isRepairsToApproveQuestion(q)) {
    return {
      ...PLAYBOOKS.approve_repairs,
      objective:
        "List urgent open repairs and landlord-awaiting workflows to approve or unblock first",
    }
  }

  if (isMissingUpdatesQuestion(q)) {
    return {
      ...PLAYBOOKS.missing_updates,
      objective:
        "List open work orders stuck without progress (missing status / vendor updates)",
    }
  }

  if (isVendorResponseSpeedQuestion(q)) {
    return {
      ...PLAYBOOKS.vendor_speed,
      objective:
        "Rank vendors by response speed (notify → accept/decline) — never property priority",
    }
  }

  // Before inactivity: “pending vendors” means verification, not job accepts.
  if (isVendorVerificationStatusQuestion(q)) {
    return {
      ...PLAYBOOKS.vendor_verification,
      objective:
        "Report vendor verification + capacity chips from vendor_verifications — never portfolio briefing",
    }
  }

  if (isVendorInactivityQuestion(q)) {
    return {
      ...PLAYBOOKS.vendor_inactive,
      objective:
        "List vendors sitting on pending accepts or with no accept history — never portfolio briefing",
    }
  }

  if (isVendorOverloadQuestion(q)) {
    return {
      ...PLAYBOOKS.vendor_overload,
      objective:
        "Rank vendors by open assigned workload — never overall ‘best’ score or portfolio briefing",
    }
  }

  if (isVendorCompletionQuestion(q)) {
    return {
      ...PLAYBOOKS.vendor_completion,
      objective:
        "Rank vendors by completion rate — never property priority or response-speed-only",
    }
  }

  if (isVendorBestQuestion(q) || isVendorRecommendQuestion(q)) {
    return {
      ...PLAYBOOKS.vendor_best,
      objective:
        "Recommend a strong vendor for the asked trade — never collapse to response speed alone or a portfolio gap answer",
    }
  }

  // Any remaining vendor-focused question stays on a vendor playbook —
  // never fall through to generic_ops / portfolio briefing.
  if (isAnyVendorMetricQuestion(q) || isVendorRankingQuestion(q) || isVendorFocusedQuestion(q)) {
    return {
      ...PLAYBOOKS.vendor_best,
      objective:
        "Answer the vendor question with vendor data — never property priority or portfolio briefing",
    }
  }

  if (isEntityInvestigationQuestion(q) || WHY_NOT_RESOLVED_RE.test(q)) {
    return {
      ...PLAYBOOKS.why_not_resolved,
      objective: "Explain what stalled a specific work order or entity",
    }
  }

  if (EMERGENCY_ESCALATION_RE.test(q)) {
    return {
      ...PLAYBOOKS.emergency_escalation,
      objective: "Identify requests escalating into emergencies from pipeline + awaiting decision",
    }
  }

  if (
    EXPENSIVE_IF_IGNORED_RE.test(q) ||
    /\b(what\s+(?:maintenance\s+)?(?:issues?|problems?|repairs?)\s+could|predictive|prevent\s+future|recurring\s+issues?)\b/i
      .test(q)
  ) {
    // Prefer dedicated recurring playbook when phrasing is clearly "keeps happening".
    if (isRecurringRepairsQuestion(q)) {
      return {
        ...PLAYBOOKS.recurring_repairs,
        objective:
          "Identify repairs that keep repeating using Property Insights + open/completed work (60d)",
      }
    }
    return {
      ...PLAYBOOKS.maintenance_risk,
      objective:
        "Surface expensive-if-ignored risk from Property Insights before raw ticket scraping",
    }
  }

  if (
    /\b(portfolio\s+health|property\s+health|executive\s+brief|how\s+(?:is|are)\s+(?:my\s+)?(?:portfolio|properties)\b)/i
      .test(q)
  ) {
    return {
      ...PLAYBOOKS.executive_briefing,
      objective: "Portfolio health and derived intelligence briefing",
    }
  }

  if (requiresInvestigation(q)) {
    return {
      ...PLAYBOOKS.generic_ops,
      objective: "Investigative question — consult Tier 1 then operational records",
    }
  }

  return {
    ...PLAYBOOKS.generic_ops,
    objective: "General ops question — consult Tier 1 then operational records",
  }
}

export function investigationPlaybookPromptBlock(question: string): string {
  const playbook = classifyInvestigationPlaybook(question)
  return (
    `INVESTIGATION_PLAYBOOK: ${playbook.id} (${playbook.label})\n` +
    `objective: ${playbook.objective}\n` +
    `consult_tier1_first: ${playbook.consultTier1First}\n` +
    `prefer_tier1_answer: ${playbook.preferTier1Answer}\n` +
    `search_order:\n${playbook.searchOrder.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n` +
    `${NEVER_IGNORE_ULO_INTELLIGENCE_GUIDE}\n`
  )
}

export function getPlaybook(id: InvestigationPlaybookId): InvestigationPlaybook {
  return {
    ...PLAYBOOKS[id],
    objective: PLAYBOOKS[id].label,
  }
}
