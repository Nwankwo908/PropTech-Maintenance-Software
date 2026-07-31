// @ts-nocheck
/**
 * Apply answer-quality-gate rewrites (prefer-packet / incomplete fallbacks).
 * Called by validateFinalAnswerStage after runAnswerQualityGate.
 */

import type { AnswerQualityGateReport } from "./validateFinalAnswer.ts"
import {
  preferPacketBagFromEvidence,
  resolvePreferPacket,
} from "../retrieval/resolvePreferPacket.ts"
import {
  incompleteEntityRootCauseAnswer,
  incompleteInvestigationAnswer,
  incompleteMaintenanceRiskAnswer,
  incompleteOldestWaitingAnswer,
  incompleteSubjectGapAnswer,
  incompleteTaskAnswer,
} from "../guards/refusalBuilder.ts"
import { formatLegalRefuseMarkdown } from "./checkJurisdiction.ts"

export type QualityGateRewriteInput = {
  question: string
  answer: string
  toolsUsed: string[]
  qualityReport: AnswerQualityGateReport
  intent: string
  stateCode: string | null
  propertyDashboardLock: boolean
  evidencePlan: { subject?: string }
  capabilityResult: {
    capability?: string
    hints?: { residentFilter?: string | null }
  }
  reasoningEarly: { mode?: string } | null
  playbook: { id?: string; preferTier1Answer?: boolean } | null
  intentResult: { intent: string }
  openTicketHint: number | null
  entityInvestigation: Record<string, any> | null
  recurringRepairs: { markdown?: string | null } | null
  deepOpsInvestigation: { markdown?: string | null; found?: boolean } | null
  preferEvidence: Record<string, any>
}

export type QualityGateRewriteResult = {
  answer: string
  toolsUsed: string[]
  safetyFail: boolean
  entityFail: boolean
}

export function applyQualityGateRewrites(
  input: QualityGateRewriteInput,
): QualityGateRewriteResult {
  let answerWithSources = input.answer
  const toolsUsed = [...input.toolsUsed]
  const qualityReport = input.qualityReport
  const question = input.question
  const intentResult = input.intentResult
  const jurisdictionState = input.stateCode
  const propertyDashboardLock = input.propertyDashboardLock
  const evidencePlan = input.evidencePlan
  const capabilityResult = input.capabilityResult
  const openTicketHint = input.openTicketHint
  const entityInvestigation = input.entityInvestigation
  const recurringRepairs = input.recurringRepairs
  const deepOpsInvestigation = input.deepOpsInvestigation

  // Post-synthesis safety QC: never show hard legal claims without citations.
  const safetyFail = qualityReport.checks.find(
    (c) => c.id === "safety_qc" && c.status === "fail",
  )
  if (safetyFail && intentResult.intent === "legal") {
    answerWithSources = formatLegalRefuseMarkdown(
      "I drafted an answer with hard legal claims that weren’t clearly backed by the official sources I retrieved. " +
        "I won’t present those as fact. Please rephrase the question, confirm the property location, " +
        "or have a human / attorney review this.",
      jurisdictionState,
    )
    toolsUsed.push("quality_gate:safety_qc_block")
  }

  // Entity investigation: never show portfolio KPIs for a named unit / WO / resident / etc.
  const entityFail = qualityReport.checks.find(
    (c) => c.id === "entity_investigation" && c.status === "fail",
  )
  if (entityFail) {
    if (entityInvestigation?.markdown) {
      answerWithSources = entityInvestigation.markdown
      toolsUsed.push("quality_gate:entity_investigation_rewrite")
    } else {
      const entityLabel =
        entityInvestigation?.plan?.entities?.map((e) => e.label).filter(Boolean).join(", ") ||
        (entityInvestigation?.primary?.unit
          ? `Unit ${entityInvestigation.primary.unit}`
          : entityInvestigation?.primary?.displayId) ||
        null
      answerWithSources = incompleteEntityRootCauseAnswer({ label: entityLabel })
      toolsUsed.push("quality_gate:entity_investigation_block")
    }
  }

  const preferBag = preferPacketBagFromEvidence({
    question,
    route: {
      intentResult,
      capability: capabilityResult,
      evidencePlan,
      reasoningMode: input.reasoningEarly,
      playbook: input.playbook,
    },
    evidence: input.preferEvidence,
  })

  const applyPreferRewrite = (tagPrefix: string): boolean => {
    const preferred = resolvePreferPacket(preferBag)
    if (!preferred.prefer) return false
    answerWithSources = preferred.markdown
    toolsUsed.push(`${tagPrefix}:${preferred.kind}`)
    return true
  }

  // Definition of investigation: never show a single dashboard metric for Why/Which/What should/…
  const investigationFail = qualityReport.checks.find(
    (c) => c.id === "investigation_definition" && c.status === "fail",
  )
  if (investigationFail && !entityFail) {
    if (applyPreferRewrite("quality_gate:investigation_rewrite")) {
      // prefer packet applied
    } else if (
      /\bbecoming\s+(?:an?\s+)?emergenc|emergenc(?:y|ies)\b/i.test(question)
    ) {
      answerWithSources = incompleteMaintenanceRiskAnswer({
        openCount: openTicketHint,
      })
      toolsUsed.push("quality_gate:investigation_block")
    } else if (propertyDashboardLock) {
      answerWithSources = incompleteSubjectGapAnswer({
        subject: evidencePlan.subject,
        openCount: openTicketHint,
        residentFilter: capabilityResult.hints.residentFilter ?? null,
        capability: capabilityResult.capability,
        question,
      })
      toolsUsed.push("quality_gate:investigation_block:subject_gate")
    } else {
      answerWithSources = incompleteInvestigationAnswer({
        openCount: openTicketHint,
      })
      toolsUsed.push("quality_gate:investigation_block")
    }
  }

  // Subject match: never ship vendor→property (or similar) substitutions.
  const subjectFail = qualityReport.checks.find(
    (c) => c.id === "subject_match" && c.status === "fail",
  )
  if (subjectFail && !entityFail) {
    if (!applyPreferRewrite("quality_gate:subject_match_rewrite")) {
      answerWithSources = incompleteSubjectGapAnswer({
        subject: evidencePlan.subject,
        openCount: openTicketHint,
        residentFilter: capabilityResult.hints.residentFilter ?? null,
        capability: capabilityResult.capability,
        question,
      })
      toolsUsed.push("quality_gate:subject_match_block")
    }
  }

  // Metric match: never answer "best" with response-speed-only framing.
  const metricFail = qualityReport.checks.find(
    (c) => c.id === "metric_match" && c.status === "fail",
  )
  if (metricFail && !entityFail) {
    applyPreferRewrite("quality_gate:metric_match_rewrite")
  }

  // Response Sufficiency / Evidence Threshold: earn the right to answer (internal).
  // User-facing copy must stay in landlord language.
  const sufficiencyFail = qualityReport.checks.find(
    (c) => c.id === "response_sufficiency" && c.status === "fail",
  )
  if (sufficiencyFail && !entityFail && !investigationFail) {
    if (applyPreferRewrite("quality_gate:sufficiency_rewrite")) {
      // prefer packet applied
    } else if (
      /\bbecoming\s+(?:an?\s+)?emergenc|emergenc(?:y|ies)\b/i.test(question)
    ) {
      answerWithSources = incompleteMaintenanceRiskAnswer({
        openCount: openTicketHint,
      })
      toolsUsed.push("quality_gate:sufficiency_block")
    } else if (propertyDashboardLock) {
      answerWithSources = incompleteSubjectGapAnswer({
        subject: evidencePlan.subject,
        openCount: openTicketHint,
        residentFilter: capabilityResult.hints.residentFilter ?? null,
        capability: capabilityResult.capability,
        question,
      })
      toolsUsed.push("quality_gate:sufficiency_block:subject_gate")
    } else {
      answerWithSources = incompleteInvestigationAnswer({
        openCount: openTicketHint,
      })
      toolsUsed.push("quality_gate:sufficiency_block")
    }
  }

  // Task completion: never show a generic KPI substitute for a specific investigation.
  const taskFail = qualityReport.checks.find(
    (c) => c.id === "task_completion" && c.status === "fail",
  )
  if (taskFail && !entityFail && !investigationFail && !sufficiencyFail) {
    if (applyPreferRewrite("quality_gate:task_completion_rewrite")) {
      // prefer packet applied
    } else if (propertyDashboardLock) {
      answerWithSources = incompleteSubjectGapAnswer({
        subject: evidencePlan.subject,
        openCount: openTicketHint,
        residentFilter: capabilityResult.hints.residentFilter ?? null,
        capability: capabilityResult.capability,
        question,
      })
      toolsUsed.push("quality_gate:task_completion_block:subject_gate")
    } else {
      answerWithSources = incompleteTaskAnswer()
      toolsUsed.push("quality_gate:task_completion_block")
    }
  }

  // Missing-info voice: rewrite AI-process language into landlord language.
  const missingInfoFail = qualityReport.checks.find(
    (c) => c.id === "missing_info_communication" && c.status === "fail",
  )
  if (
    missingInfoFail &&
    !entityFail &&
    !investigationFail &&
    !sufficiencyFail &&
    !taskFail
  ) {
    if (applyPreferRewrite("quality_gate:missing_info_rewrite")) {
      // prefer packet applied
    } else if (
      /\bbecoming\s+(?:an?\s+)?emergenc|emergenc(?:y|ies)\b/i.test(question)
    ) {
      answerWithSources = incompleteMaintenanceRiskAnswer({
        openCount: openTicketHint,
      })
    } else if (intentResult.intent === "entity_investigation") {
      answerWithSources = incompleteEntityRootCauseAnswer()
    } else if (intentResult.intent === "oldest_waiting_work_order") {
      answerWithSources = incompleteOldestWaitingAnswer()
    } else {
      answerWithSources = incompleteInvestigationAnswer({
        openCount: openTicketHint,
      })
    }
    toolsUsed.push("quality_gate:missing_info_rewrite")
  }

  // Never Ignore Existing Ulo Intelligence: rewrite soft-"can't answer" when Tier 1 exists.
  const tier1Fail = qualityReport.checks.find(
    (c) => c.id === "never_ignore_ulo_intelligence" && c.status === "fail",
  )
  if (tier1Fail) {
    applyPreferRewrite("quality_gate:tier1_intelligence_rewrite")
  }

  // Recurring repairs: invalidate soft unavailable when patterns were found.
  const recurringFail = qualityReport.checks.find(
    (c) => c.id === "recurring_repairs_investigation" && c.status === "fail",
  )
  if (recurringFail && recurringRepairs?.markdown) {
    answerWithSources = recurringRepairs.markdown
    toolsUsed.push("quality_gate:recurring_repairs_rewrite")
  }

  // Deep ops: never claim "unavailable" when matching tickets were found.
  const deepOpsFail = qualityReport.checks.find(
    (c) => c.id === "deep_operational_investigation" && c.status === "fail",
  )
  if (deepOpsFail && deepOpsInvestigation?.markdown && deepOpsInvestigation.found) {
    answerWithSources = deepOpsInvestigation.markdown
    toolsUsed.push("quality_gate:deep_ops_rewrite")
  }


  return {
    answer: answerWithSources,
    toolsUsed,
    safetyFail: Boolean(safetyFail),
    entityFail: Boolean(entityFail),
  }
}
