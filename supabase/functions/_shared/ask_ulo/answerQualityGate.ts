/**
 * Ask Ulo answer quality gate — five checks before any answer is shown.
 *
 * 1. Location — which city/county/state laws apply
 * 2. Topic — what the user is asking (legal, maintenance, finance, market, …)
 * 3. Scope — search only sources that apply to that place/topic
 * 4. Sources — prefer official, recent, on-point over third-party/stale/loose
 * 5. Grounding — important claims must be backed; never guess as fact
 *
 * Extra: lightweight safety QC (not a substitute for official sources).
 */

import type { AskUloIntent } from "./intent.ts"
import type { LegalJurisdictionResolution } from "./legalJurisdiction.ts"
import type { LegalSourceTier } from "./legalSourceTrust.ts"
import { evaluateTaskCompletionQc } from "./taskCompletion.ts"
import { evaluateEntityInvestigationQc } from "./entityInvestigation.ts"
import { evaluateInvestigationDefinitionQc } from "./investigationDefinition.ts"
import { evaluateResponseSufficiencyQc } from "./responseSufficiency.ts"
import { evaluateMissingInfoCommunicationQc } from "./missingInfoCommunication.ts"
import {
  evaluateDeepOperationalInvestigationQc,
  looksLikeInvalidOpsFallback,
} from "./deepOperationalInvestigation.ts"
import { looksLikeIgnoringTier1Intelligence } from "./knowledgeHierarchy.ts"
import { isRecurringRepairsQuestion, looksLikePropertyInsightsHeadlineDump } from "./recurringRepairsLookup.ts"
import { evaluateSubjectMatchQc } from "./questionSubjectMatch.ts"
import { evaluateMetricMatchQc } from "./questionMetricContext.ts"

export type QualityCheckId =
  | "location"
  | "topic"
  | "scope"
  | "sources"
  | "grounding"
  | "safety_qc"
  | "task_completion"
  | "entity_investigation"
  | "investigation_definition"
  | "response_sufficiency"
  | "missing_info_communication"
  | "deep_operational_investigation"
  | "never_ignore_ulo_intelligence"
  | "recurring_repairs_investigation"
  | "subject_match"
  | "metric_match"

export type QualityCheckStatus = "pass" | "fail" | "warn" | "skip"

export type QualityCheckResult = {
  id: QualityCheckId
  /** Short layperson label (1–5 numbering for the product checks). */
  step: number | null
  label: string
  status: QualityCheckStatus
  summary: string
}

export type AnswerQualityGateReport = {
  /** True when the answer may be shown (passes or warns only). */
  mayAnswer: boolean
  /** Block showing a synthesized legal answer. */
  block: "clarify" | "refuse" | null
  checks: QualityCheckResult[]
  /** One-line audit for tools_used / logs. */
  summaryLine: string
}

const TOPIC_LABELS: Partial<Record<AskUloIntent, string>> = {
  legal: "Legal / compliance",
  maintenance: "Maintenance",
  finance: "Finance",
  market_analysis: "Market & neighborhood",
  market_rent_estimate: "Market & neighborhood",
  comparable_rentals: "Market & neighborhood",
  property_price_history: "Market & neighborhood",
  rent_history: "Market & neighborhood",
  price_history_ambiguous: "Market & neighborhood",
  ops: "Operations",
  property_health: "Operations",
  executive_briefing: "Executive portfolio briefing",
  period_summary: "Period activity summary",
  property_priority: "Property priority",
  unit_maintenance_ranking: "Unit maintenance ranking",
  oldest_waiting_work_order: "Oldest waiting work order",
  vendor: "Operations",
  general: "Operations",
}

function checkLocation(input: {
  intent: AskUloIntent
  jurisdiction: Pick<
    LegalJurisdictionResolution,
    "stateCode" | "cityLabel" | "countyLabel" | "needsClarification" | "source" | "confidence"
  > | null
  needsPropertyScope: boolean
}): QualityCheckResult {
  const step = 1
  const label = "Figure out where the property is"
  if (input.intent !== "legal") {
    const place = input.jurisdiction?.stateCode
      ? [input.jurisdiction.cityLabel, input.jurisdiction.stateCode].filter(Boolean).join(", ")
      : null
    return {
      id: "location",
      step,
      label,
      status: place ? "pass" : "skip",
      summary: place
        ? `Using portfolio/question location: ${place}.`
        : "Location less critical for this topic; portfolio context used when available.",
    }
  }
  if (!input.jurisdiction || input.jurisdiction.needsClarification) {
    return {
      id: "location",
      step,
      label,
      status: "fail",
      summary:
        "Need a confirmed city/state (from the address, portfolio, or question) before legal guidance.",
    }
  }
  if (input.needsPropertyScope) {
    return {
      id: "location",
      step,
      label,
      status: "fail",
      summary: "Multiple properties in the portfolio — need which building this question is about.",
    }
  }
  const bits = [
    input.jurisdiction.cityLabel,
    input.jurisdiction.countyLabel ? `${input.jurisdiction.countyLabel} County` : null,
    input.jurisdiction.stateCode,
  ].filter(Boolean)
  return {
    id: "location",
    step,
    label,
    status: input.jurisdiction.confidence === "low" ? "warn" : "pass",
    summary: `Laws scoped to ${bits.join(", ")} (from ${input.jurisdiction.source}).`,
  }
}

function checkTopic(input: {
  intent: AskUloIntent
  intentLabel: string
  toolsPlanned: string[]
}): QualityCheckResult {
  const topic = TOPIC_LABELS[input.intent] ?? input.intentLabel
  return {
    id: "topic",
    step: 2,
    label: "Identify what the user is asking about",
    status: "pass",
    summary: `Topic: ${topic}. Tools: ${input.toolsPlanned.join(", ") || "none"}.`,
  }
}

function checkScope(input: {
  intent: AskUloIntent
  stateCode: string | null
  citySlug: string | null
  housingProgram: string | null
  ranLegalSearch: boolean
  ranTopicTools: boolean
}): QualityCheckResult {
  const step = 3
  const label = "Search only the information that applies"
  if (input.intent === "legal") {
    if (!input.stateCode) {
      return {
        id: "scope",
        step,
        label,
        status: "fail",
        summary: "Cannot narrow legal search without a state.",
      }
    }
    if (!input.ranLegalSearch) {
      return {
        id: "scope",
        step,
        label,
        status: "warn",
        summary: "Legal search did not run (clarification or empty plan).",
      }
    }
    const scopeBits = [
      `state ${input.stateCode}`,
      input.citySlug ? `city ${input.citySlug}` : null,
      input.housingProgram ? `program ${input.housingProgram}` : "general (non–program-only docs)",
    ].filter(Boolean)
    return {
      id: "scope",
      step,
      label,
      status: "pass",
      summary: `Pre-filtered corpus to ${scopeBits.join("; ")} before hybrid search.`,
    }
  }
  return {
    id: "scope",
    step,
    label,
    status: input.ranTopicTools ? "pass" : "warn",
    summary: input.ranTopicTools
      ? "Retrieved only tools matched to this topic."
      : "Limited retrieval for this topic.",
  }
}

function checkSources(input: {
  intent: AskUloIntent
  primaryOfficial: number
  agencyGuidance: number
  discoveryMirror: number
  untrusted: number
  citationCount: number
  pendingOrdinanceCount: number
}): QualityCheckResult {
  const step = 4
  const label = "Choose the best sources"
  if (input.intent !== "legal") {
    return {
      id: "sources",
      step,
      label,
      status: input.citationCount > 0 ? "pass" : "warn",
      summary:
        input.citationCount > 0
          ? `Using ${input.citationCount} topic-relevant source(s); prefer live portfolio/market data over guesswork.`
          : "Few or no citations — answer should stay cautious.",
    }
  }
  if (input.untrusted > 0 && input.primaryOfficial === 0 && input.agencyGuidance === 0) {
    return {
      id: "sources",
      step,
      label,
      status: "fail",
      summary: "Only untrusted or unofficial material found — will not treat as legal fact.",
    }
  }
  if (input.discoveryMirror > 0 && input.primaryOfficial === 0 && input.agencyGuidance === 0) {
    return {
      id: "sources",
      step,
      label,
      status: "fail",
      summary:
        "Only aggregator/mirror hits — must confirm on official government/court sources before answering.",
    }
  }
  if (input.primaryOfficial === 0 && input.agencyGuidance > 0) {
    return {
      id: "sources",
      step,
      label,
      status: "warn",
      summary: `Preferring agency guidance (${input.agencyGuidance}); no primary statute/code hit yet.${
        input.pendingOrdinanceCount > 0
          ? ` Also ${input.pendingOrdinanceCount} pending ordinance note(s).`
          : ""
      }`,
    }
  }
  return {
    id: "sources",
    step,
    label,
    status: "pass",
    summary: `Prioritized official sources (primary ${input.primaryOfficial}, guidance ${input.agencyGuidance})${
      input.discoveryMirror > 0 ? `; ${input.discoveryMirror} mirror(s) discovery-only` : ""
    }.`,
  }
}

function checkGrounding(input: {
  intent: AskUloIntent
  gateStatus: "ok" | "clarify" | "refuse" | null
  grounded: boolean
  groundingReason: string | null
  officialSourceCount: number
}): QualityCheckResult {
  const step = 5
  const label = "Double-check before showing the answer"
  if (input.intent !== "legal") {
    return {
      id: "grounding",
      step,
      label,
      status: "pass",
      summary: "Non-legal answer: avoid inventing facts; stick to retrieved portfolio/market data.",
    }
  }
  if (input.gateStatus === "clarify") {
    return {
      id: "grounding",
      step,
      label,
      status: "fail",
      summary: "Holding answer until location/property is confirmed — will not guess.",
    }
  }
  if (input.gateStatus === "refuse" || !input.grounded) {
    return {
      id: "grounding",
      step,
      label,
      status: "fail",
      summary:
        input.groundingReason === "mirror_only"
          ? "Cannot verify on official sources — tell the user what’s missing and suggest a human/attorney."
          : "Important claims are not backed by official sources — refuse to invent rules.",
    }
  }
  return {
    id: "grounding",
    step,
    label,
    status: input.officialSourceCount > 0 ? "pass" : "warn",
    summary:
      input.officialSourceCount > 0
        ? `Grounded on ${input.officialSourceCount} official/agency source(s); uncertain parts should be labeled and may need a human expert.`
        : "Thin grounding — keep claims soft and recommend verification.",
  }
}

/**
 * Extra QC layer: catch unsupported hard legal claims in draft text.
 * Does not replace official sources.
 */
export function evaluateAnswerSafetyQc(input: {
  intent: AskUloIntent
  answer: string
  citationCount: number
  gateStatus: "ok" | "clarify" | "refuse" | null
}): QualityCheckResult {
  const label = "Extra safety / quality control"
  if (input.intent !== "legal" || input.gateStatus !== "ok") {
    return {
      id: "safety_qc",
      step: null,
      label,
      status: "skip",
      summary: "Safety QC skipped (not a final legal answer draft).",
    }
  }
  const text = input.answer.trim()
  if (!text) {
    return {
      id: "safety_qc",
      step: null,
      label,
      status: "warn",
      summary: "Empty draft — nothing to QC.",
    }
  }
  const hardClaim =
    /\b(you\s+must|required\s+by\s+law|it\s+is\s+illegal|always\s+illegal|never\s+allowed|definitely\s+legal)\b/i.test(
      text,
    )
  if (hardClaim && input.citationCount === 0) {
    return {
      id: "safety_qc",
      step: null,
      label,
      status: "fail",
      summary:
        "Draft makes hard legal claims without citations — block or soften before showing.",
    }
  }
  if (hardClaim && input.citationCount < 1) {
    return {
      id: "safety_qc",
      step: null,
      label,
      status: "warn",
      summary: "Hard legal phrasing detected — ensure every must/illegal claim cites an official source.",
    }
  }
  return {
    id: "safety_qc",
    step: null,
    label,
    status: "pass",
    summary: "No unsupported hard-claim pattern detected in draft QC.",
  }
}

export function runAnswerQualityGate(input: {
  intent: AskUloIntent
  intentLabel: string
  toolsPlanned: string[]
  jurisdiction: LegalJurisdictionResolution | null
  needsPropertyScope: boolean
  stateCode: string | null
  citySlug: string | null
  housingProgram: string | null
  ranLegalSearch: boolean
  ranTopicTools: boolean
  primaryOfficial: number
  agencyGuidance: number
  discoveryMirror: number
  untrusted: number
  citationCount: number
  pendingOrdinanceCount: number
  gateStatus: "ok" | "clarify" | "refuse" | null
  grounded: boolean
  groundingReason: string | null
  officialSourceCount: number
  /** Optional draft for post-synthesis safety QC. */
  draftAnswer?: string | null
  /** Latest user question — used for task-completion QC. */
  question?: string | null
  /** True when a dedicated investigation packet already answers the task. */
  taskPacketSatisfied?: boolean
  /** True when subject-specific packet (vendor speed, etc.) already answers. */
  subjectPacketSatisfied?: boolean
  /** True when metric-specific packet (best vendor vs speed) already answers. */
  metricPacketSatisfied?: boolean
  /** True when entity investigation packet already answers the named-entity question. */
  entityPacketSatisfied?: boolean
  /** True when deep ops lookup found matching maintenance/work-order records. */
  deepOpsRecordsFound?: boolean
  /** True when Property Insights / Tier 1 already has findings. */
  tier1FindingsExist?: boolean
  /** True when recurring-repairs lookup found patterns. */
  recurringRepairsFound?: boolean
  /** Structured work orders from operational retrieval (for estimated-cost QC). */
  deepOpsWorkOrders?: Array<{
    workOrderId: string
    propertyName?: string
    unitLabel?: string | null
    estimatedCost?: number | null
  }>
}): AnswerQualityGateReport {
  const checks: QualityCheckResult[] = [
    checkLocation({
      intent: input.intent,
      jurisdiction: input.jurisdiction,
      needsPropertyScope: input.needsPropertyScope,
    }),
    checkTopic({
      intent: input.intent,
      intentLabel: input.intentLabel,
      toolsPlanned: input.toolsPlanned,
    }),
    checkScope({
      intent: input.intent,
      stateCode: input.stateCode,
      citySlug: input.citySlug,
      housingProgram: input.housingProgram,
      ranLegalSearch: input.ranLegalSearch,
      ranTopicTools: input.ranTopicTools,
    }),
    checkSources({
      intent: input.intent,
      primaryOfficial: input.primaryOfficial,
      agencyGuidance: input.agencyGuidance,
      discoveryMirror: input.discoveryMirror,
      untrusted: input.untrusted,
      citationCount: input.citationCount,
      pendingOrdinanceCount: input.pendingOrdinanceCount,
    }),
    checkGrounding({
      intent: input.intent,
      gateStatus: input.gateStatus,
      grounded: input.grounded,
      groundingReason: input.groundingReason,
      officialSourceCount: input.officialSourceCount,
    }),
  ]

  if (input.draftAnswer != null) {
    checks.push(
      evaluateAnswerSafetyQc({
        intent: input.intent,
        answer: input.draftAnswer,
        citationCount: input.citationCount,
        gateStatus: input.gateStatus,
      }),
    )
  }

  if (input.draftAnswer != null && input.question) {
    const taskQc = evaluateTaskCompletionQc({
      question: input.question,
      answer: input.draftAnswer,
      packetSatisfied: input.taskPacketSatisfied,
    })
    checks.push({
      id: "task_completion",
      step: null,
      label: "Confirm the user's task was completed",
      status: taskQc.status,
      summary: taskQc.summary,
    })

    const entityQc = evaluateEntityInvestigationQc({
      question: input.question,
      answer: input.draftAnswer,
      packetSatisfied: input.entityPacketSatisfied,
    })
    checks.push({
      id: "entity_investigation",
      step: null,
      label: "Confirm named-entity investigation (not portfolio KPIs)",
      status: entityQc.status,
      summary: entityQc.summary,
    })

    const investigationQc = evaluateInvestigationDefinitionQc({
      question: input.question,
      answer: input.draftAnswer,
      packetSatisfied: input.taskPacketSatisfied || input.entityPacketSatisfied,
    })
    checks.push({
      id: "investigation_definition",
      step: null,
      label: "Confirm investigation (not a single dashboard metric)",
      status: investigationQc.status,
      summary: investigationQc.summary,
    })

    const sufficiencyQc = evaluateResponseSufficiencyQc({
      question: input.question,
      answer: input.draftAnswer,
      packetSatisfied: input.taskPacketSatisfied || input.entityPacketSatisfied,
    })
    checks.push({
      id: "response_sufficiency",
      step: null,
      label: "Response Sufficiency Score / Evidence Threshold",
      status: sufficiencyQc.status,
      summary: sufficiencyQc.summary,
    })

    const missingInfoQc = evaluateMissingInfoCommunicationQc({
      question: input.question,
      answer: input.draftAnswer,
    })
    checks.push({
      id: "missing_info_communication",
      step: null,
      label: "Explain gaps in landlord language (not AI process)",
      status: missingInfoQc.status,
      summary: missingInfoQc.summary,
    })

    const subjectQc = evaluateSubjectMatchQc({
      question: input.question,
      answer: input.draftAnswer,
      packetSatisfied: input.subjectPacketSatisfied || input.taskPacketSatisfied,
    })
    checks.push({
      id: "subject_match",
      step: null,
      label: "Match answer subject to the question (no entity substitution)",
      status: subjectQc.status,
      summary: subjectQc.summary,
    })

    const metricQc = evaluateMetricMatchQc({
      question: input.question,
      answer: input.draftAnswer,
      packetSatisfied: input.metricPacketSatisfied || input.taskPacketSatisfied,
    })
    checks.push({
      id: "metric_match",
      step: null,
      label: "Match answer metric to the question (best ≠ fastest)",
      status: metricQc.status,
      summary: metricQc.summary,
    })

    const deepOpsQc = evaluateDeepOperationalInvestigationQc({
      question: input.question,
      answer: input.draftAnswer,
      foundMatchingRecords: input.deepOpsRecordsFound,
      workOrders: input.deepOpsWorkOrders,
    })
    checks.push({
      id: "deep_operational_investigation",
      step: null,
      label: "Deep operational investigation (records before unavailable)",
      status: deepOpsQc.status,
      summary: deepOpsQc.summary,
    })

    const ignoredTier1 =
      Boolean(input.tier1FindingsExist) &&
      looksLikeIgnoringTier1Intelligence(input.draftAnswer)
    checks.push({
      id: "never_ignore_ulo_intelligence",
      step: null,
      label: "Never ignore existing Ulo intelligence (Tier 1)",
      status: ignoredTier1 ? "fail" : input.tier1FindingsExist ? "pass" : "skip",
      summary: ignoredTier1
        ? "Answer claims insufficient information while Property Insights / Tier 1 findings exist."
        : input.tier1FindingsExist
          ? "Tier 1 findings present; answer does not soft-unavailable over them."
          : "No Tier 1 findings for this turn.",
    })

    if (isRecurringRepairsQuestion(input.question)) {
      const answer = input.draftAnswer.trim()
      const namesRepairType =
        /\b(faucet|sink|drain|toilet|pipe|water\s+heater|leak|ac\s+not|cooling|furnace|thermostat|compressor|outlet|breaker|power\s+loss|spark|plumbing|hvac|electrical|appliance|pest)\b/i
          .test(answer)
      const hasCount = /\b\d+\b/.test(answer) && /\b(60\s*days?|last\s+60)\b/i.test(answer)
      const softUnavailable =
        looksLikeIgnoringTier1Intelligence(answer) || looksLikeInvalidOpsFallback(answer)
      const insightsDump = looksLikePropertyInsightsHeadlineDump(answer)
      const fail =
        softUnavailable ||
        insightsDump ||
        (Boolean(input.recurringRepairsFound) && (!namesRepairType || !hasCount))
      checks.push({
        id: "recurring_repairs_investigation",
        step: null,
        label: "Recurring repairs (repair-level + completed work)",
        status: fail ? "fail" : input.recurringRepairsFound ? "pass" : "warn",
        summary: softUnavailable
          ? "Recurring-repair question answered with soft unavailable language."
          : insightsDump
            ? "Answer repeats Property Insights headlines instead of repair-level evidence."
            : fail
              ? "Recurring patterns were found but the answer omits a repair type, count, or 60-day window."
              : input.recurringRepairsFound
                ? "Recurring repair answer names a repair type with count and period."
                : "Recurring-repair question — no ≥2 repair-type pattern after open+completed search.",
      })
    }
  }

  const failed = checks.filter((c) => c.status === "fail")
  let block: AnswerQualityGateReport["block"] = null
  if (input.gateStatus === "clarify" || failed.some((c) => c.id === "location")) {
    block = "clarify"
  } else if (
    input.gateStatus === "refuse" ||
    failed.some((c) => c.id === "sources" || c.id === "grounding" || c.id === "safety_qc")
  ) {
    block = "refuse"
  }

  const mayAnswer = block == null

  const summaryLine = checks
    .filter((c) => c.step != null)
    .map((c) => `${c.step}:${c.status}`)
    .join("|")

  return { mayAnswer, block, checks, summaryLine }
}

/** Map trust tier counts into gate source inputs. */
export function tierCountsForGate(counts: {
  primaryOfficial: number
  agencyGuidance: number
  discoveryMirror: number
  untrusted: number
}): Pick<
  Parameters<typeof runAnswerQualityGate>[0],
  "primaryOfficial" | "agencyGuidance" | "discoveryMirror" | "untrusted"
> {
  return {
    primaryOfficial: counts.primaryOfficial,
    agencyGuidance: counts.agencyGuidance,
    discoveryMirror: counts.discoveryMirror,
    untrusted: counts.untrusted,
  }
}

export function formatQualityChecksForAudit(
  checks: QualityCheckResult[],
): Array<{ id: QualityCheckId; step: number | null; label: string; status: QualityCheckStatus; summary: string }> {
  return checks.map((c) => ({
    id: c.id,
    step: c.step,
    label: c.label,
    status: c.status,
    summary: c.summary,
  }))
}

/** Intent → planned tool names for the topic check. */
export function plannedToolNames(plan: {
  runLegalRag: boolean
  runStructured: boolean
  runOpsGraph: boolean
  runPropertySnapshot: boolean
  runMarketData: boolean
  runPriceHistory: boolean
  runRentHistory: boolean
}): string[] {
  const names: string[] = []
  if (plan.runLegalRag) names.push("legal_rag")
  if (plan.runStructured) names.push("structured")
  if (plan.runOpsGraph) names.push("ops_graph")
  if (plan.runPropertySnapshot) names.push("property_snapshot")
  if (plan.runMarketData) names.push("market_data")
  if (plan.runPriceHistory) names.push("price_history")
  if (plan.runRentHistory) names.push("rent_history")
  return names
}

export type { LegalSourceTier }
