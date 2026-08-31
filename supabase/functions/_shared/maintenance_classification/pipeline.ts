/**
 * Unified maintenance classification pipeline:
 * raw → sanitize → entities → deterministic → semantic → LLM → confidence → other postcheck → result
 */
import { matchDeterministicRules } from "./deterministicRules.ts"
import { extractEntities } from "./entities.ts"
import { llmClassifyMaintenance } from "./llmClassify.ts"
import { sanitizeMaintenanceDescription } from "./sanitizer.ts"
import { semanticMatchDescription } from "./semanticMap.ts"
import {
  resolveAmbiguousMaintenance,
} from "../../../../shared/maintenance/ambiguityResolution.ts"
import { primaryCategoryFromTrade } from "../../../../shared/maintenance/primaryCategories.ts"
import { resolveUrgencyPolicy } from "../../../../shared/maintenance/urgencyPolicy.ts"
import { resolvePhotoRequest } from "../../../../shared/maintenance/photoRequestPolicy.ts"
import {
  LOW_CONFIDENCE_CLARIFICATION,
  resolveConfidenceBand,
} from "../../../../shared/maintenance/confidencePolicy.ts"
import { toLandlordTriage } from "../../../../shared/maintenance/landlordTriage.ts"
import type { LandlordTriage } from "../../../../shared/maintenance/landlordTriage.ts"
import {
  PIPELINE_VERSION,
  type ClassificationResult,
  type ClassifyMaintenanceInput,
  type IssueType,
  type SeverityLevel,
  type VendorTrade,
} from "./types.ts"

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function severityFromPriority(raw: string | null | undefined): SeverityLevel {
  const x = (raw ?? "").toLowerCase()
  if (x.includes("emergency") || x.includes("critical")) return "critical"
  if (x.includes("urgent") || x.includes("high")) return "urgent"
  if (x.includes("low")) return "low"
  return "normal"
}

function maxSeverity(a: SeverityLevel, b: SeverityLevel): SeverityLevel {
  const rank: Record<SeverityLevel, number> = {
    low: 1,
    normal: 2,
    urgent: 3,
    critical: 4,
  }
  return rank[a] >= rank[b] ? a : b
}

function tradeLabel(trade: VendorTrade): string {
  const labels: Record<VendorTrade, string> = {
    appliance_repair: "appliance repair",
    carpentry: "carpentry",
    cleaning: "cleaning",
    concrete: "concrete",
    deck_builder: "deck builder",
    electrical: "electrical",
    flooring: "flooring",
    general: "general maintenance",
    hvac: "HVAC",
    landscaping: "landscaping",
    locksmith: "locksmith",
    masonry: "masonry",
    painting: "painting",
    pest_control: "pest control",
    plumbing: "plumbing",
    roofing: "roofing",
    windows: "windows",
    other: "general",
  }
  return labels[trade]
}

function runOtherPostcheck(params: {
  sanitized: string
  candidate: VendorTrade
  ruleTrade: VendorTrade | null
  semanticTrade: VendorTrade | null
  semanticScore?: number
  llmTrade: VendorTrade | null
}): { trade: VendorTrade; passed: boolean; signals: string[] } {
  const signals: string[] = []
  if (params.candidate !== "other") {
    return { trade: params.candidate, passed: true, signals }
  }

  signals.push("other_candidate")
  if (params.ruleTrade && params.ruleTrade !== "other") {
    signals.push(`other_postcheck_rule:${params.ruleTrade}`)
    return { trade: params.ruleTrade, passed: false, signals }
  }
  // Require a real semantic match — weak Jaccard (e.g. 0.03) must not invent a trade.
  if (
    params.semanticTrade &&
    params.semanticTrade !== "other" &&
    (params.semanticScore ?? 0) >= 0.45
  ) {
    signals.push(`other_postcheck_semantic:${params.semanticTrade}`)
    return { trade: params.semanticTrade, passed: false, signals }
  }
  if (params.llmTrade && params.llmTrade !== "other") {
    signals.push(`other_postcheck_llm:${params.llmTrade}`)
    return { trade: params.llmTrade, passed: false, signals }
  }

  // Final deterministic rescan of sanitized text
  const rescans = matchDeterministicRules(params.sanitized)
  const top = rescans[0]
  if (top && top.trade !== "other" && top.weight >= 0.7) {
    signals.push(`other_postcheck_rescan:${top.trade}`)
    return { trade: top.trade, passed: false, signals }
  }

  signals.push("other_confirmed")
  return { trade: "other", passed: true, signals }
}

/** Main entry — used by SMS, web, SLA, and trade assignment. */
export async function classifyMaintenanceRequest(
  input: ClassifyMaintenanceInput,
): Promise<ClassificationResult & { landlordTriage: LandlordTriage }> {
  const rawDescription = String(input.rawDescription ?? "").trim()
  const clarifiedExtra = (input.clarificationAnswers ?? [])
    .map((a) => a.trim())
    .filter(Boolean)
    .join(" ")
  const rawForPipeline = [rawDescription, clarifiedExtra].filter(Boolean).join(" ")

  const { sanitized, method: sanitizeMethod } = await sanitizeMaintenanceDescription(
    rawForPipeline,
    { skipLlm: input.skipLlm },
  )

  const entities = extractEntities(sanitized || rawForPipeline)
  const ruleHits = matchDeterministicRules(sanitized || rawForPipeline)
  const topRule = ruleHits[0] ?? null

  const semanticMatches = await semanticMatchDescription(sanitized || rawForPipeline, {
    skipEmbeddings: input.skipEmbeddings ?? input.skipLlm,
  })
  const topSemantic = semanticMatches[0] ?? null

  const llm = input.skipLlm
    ? null
    : await llmClassifyMaintenance(
      sanitized || rawForPipeline,
      JSON.stringify({
        location: entities.location,
        object: entities.affectedObject,
        safety: entities.safetyRisks,
        emergency: entities.emergencyType,
      }),
      input.smsContext ?? null,
    )

  const resolved = resolveAmbiguousMaintenance(sanitized || rawForPipeline)

  // Fuse signals
  let trade: VendorTrade =
    topRule && topRule.weight >= 0.85
      ? topRule.trade
      : llm?.vendorTrade && llm.confidence >= 0.7
      ? llm.vendorTrade
      : topSemantic && topSemantic.score >= 0.45
      ? topSemantic.trade
      : topRule?.trade ??
        entities.vendorTrade ??
        llm?.vendorTrade ??
        "other"

  let issueType: IssueType =
    topRule?.issueType ??
    entities.issueType ??
    llm?.issueType ??
    topSemantic?.issueType ??
    "other"

  if (resolved.handled && resolved.needsClarification) {
    trade = resolved.primaryTrade ?? "other"
    if (resolved.issueType) issueType = resolved.issueType
  } else if (resolved.handled && resolved.primaryTrade) {
    trade = resolved.primaryTrade
    if (resolved.issueType) issueType = resolved.issueType
  }

  // Safety overrides
  if (entities.emergencyType === "gas") {
    trade = "other"
    issueType = "other"
  } else if (entities.emergencyType === "fire" || entities.emergencyType === "electrical") {
    trade = "electrical"
    issueType = "electrical"
  } else if (entities.emergencyType === "lockout") {
    trade = "locksmith"
    issueType = "lock"
  } else if (entities.emergencyType === "flood" && !(resolved.handled && resolved.needsClarification)) {
    trade = trade === "roofing" ? "roofing" : resolved.primaryTrade ?? "plumbing"
    issueType = "leak"
  }

  let emergencyType = entities.emergencyType
  if (resolved.handled && resolved.emergency !== "none") {
    emergencyType = resolved.emergency
  }

  const urgency = resolveUrgencyPolicy({
    text: sanitized || rawForPipeline,
    outdoorTempF: input.outdoorTempF,
    durationHours: input.durationHours,
    emergencyType,
  })

  let severity: SeverityLevel = urgency.severity
  const fromResident = severityFromPriority(input.residentPriority)
  if (urgency.band === "emergency") {
    severity = maxSeverity(severity, fromResident === "low" || fromResident === "normal" ? severity : fromResident)
  } else {
    severity = maxSeverity(severity, fromResident)
  }
  if (emergencyType === "gas" || emergencyType === "fire") {
    severity = maxSeverity(severity, "critical")
  }
  if (topRule?.severityBoost) {
    severity = maxSeverity(severity, topRule.severityBoost)
  }

  // Confidence
  const ruleScore = topRule?.weight ?? 0
  const semScore = topSemantic?.score ?? 0
  const llmScore = llm?.confidence ?? 0
  const agreementBonus =
    (topRule && llm?.vendorTrade && topRule.trade === llm.vendorTrade ? 0.08 : 0) +
    (topRule && topSemantic && topRule.trade === topSemantic.trade ? 0.06 : 0) +
    (llm?.vendorTrade && topSemantic && llm.vendorTrade === topSemantic.trade
      ? 0.05
      : 0)

  let tradeConfidence = clamp01(
    Math.max(ruleScore, semScore * 0.95, llmScore * 0.9) + agreementBonus,
  )
  let categoryConfidence = tradeConfidence
  let severityConfidence = topRule?.severityBoost || emergencyType !== "none" || urgency.band === "emergency"
    ? 0.9
    : llm?.severity
    ? clamp01(llm.confidence)
    : 0.55

  // Other postcheck — do not "rescue" ambiguous cases into a guessed trade
  const otherCheck =
    resolved.handled && resolved.needsClarification
      ? { trade, passed: true, signals: ["ambiguity_skip_other_postcheck"] }
      : runOtherPostcheck({
          sanitized: sanitized || rawForPipeline,
          candidate: trade,
          ruleTrade: topRule?.trade ?? null,
          semanticTrade: topSemantic?.trade ?? null,
          semanticScore: topSemantic?.score ?? 0,
          llmTrade: llm?.vendorTrade ?? null,
        })
  if (!(resolved.handled && resolved.needsClarification)) {
    trade = otherCheck.trade
  }
  if (!otherCheck.passed && trade !== "other") {
    tradeConfidence = Math.max(tradeConfidence, 0.8)
    categoryConfidence = tradeConfidence
    if (issueType === "other") {
      issueType = topRule?.issueType ?? topSemantic?.issueType ?? "plumbing"
    }
  }

  let classificationConfidence = clamp01(
    (tradeConfidence + categoryConfidence + severityConfidence) / 3,
  )

  if (resolved.handled && resolved.primaryTrade) {
    tradeConfidence = Math.max(tradeConfidence, resolved.confidence)
    categoryConfidence = tradeConfidence
    classificationConfidence = clamp01(
      (tradeConfidence + categoryConfidence + severityConfidence) / 3,
    )
  }

  const confidence = resolveConfidenceBand({
    text: sanitized || rawForPipeline,
    vendorTrade: trade,
    urgencyBand: urgency.band,
    urgencyReason: urgency.reason,
    emergencyType,
    ruleWeight: topRule?.weight ?? 0,
    ambiguityConfidence: resolved.handled ? resolved.confidence : 0,
  })

  if (confidence.band === "low") {
    trade = "other"
    issueType = "other"
  }

  classificationConfidence = confidence.classificationConfidence
  const clarificationRequired = confidence.clarificationNeeded
  const clarification = clarificationRequired
    ? LOW_CONFIDENCE_CLARIFICATION
    : null

  const matchedKeywords = [
    ...new Set(ruleHits.flatMap((h) => h.keywords)),
  ].slice(0, 20)

  const matchedEntities = [
    entities.location,
    entities.affectedObject,
    entities.damageType,
    ...entities.safetyRisks,
  ].filter((x): x is string => Boolean(x))

  const signals = [
    `sanitize:${sanitizeMethod}`,
    topRule ? `rule:${topRule.trade}:${topRule.weight.toFixed(2)}` : "rule:none",
    topSemantic
      ? `semantic:${topSemantic.trade}:${topSemantic.score.toFixed(2)}`
      : "semantic:none",
    llm ? `llm:${llm.vendorTrade}:${llm.confidence.toFixed(2)}` : "llm:none",
    llm?.provider ? `llm_provider:${llm.provider}` : "llm_provider:none",
    resolved.handled
      ? `ambiguity:${resolved.reason || "handled"}:${resolved.needsClarification ? "clarify" : resolved.primaryTrade}`
      : "ambiguity:none",
    `urgency:${urgency.band}:${urgency.slaMinutes}`,
    `confidence:${confidence.band}`,
    ...otherCheck.signals,
  ]

  const modelReasoningSummary =
    resolved.handled && resolved.reason
      ? resolved.reason
      : llm?.reasoning ||
        (topRule
          ? `Matched deterministic ${topRule.trade} signals (${matchedKeywords.slice(0, 4).join(", ")})`
          : topSemantic
          ? `Closest phrase match: ${topSemantic.label}`
          : "Insufficient signals")

  const primaryCategory = confidence.band === "low"
    ? "general"
    : resolved.handled
    ? resolved.primaryCategory
    : primaryCategoryFromTrade(trade)
  const secondaryTrade = confidence.band === "low"
    ? null
    : resolved.handled
    ? resolved.secondaryTrade
    : null
  const photo = resolvePhotoRequest({
    text: sanitized || rawForPipeline,
    primaryCategory,
    vendorTrade: trade,
    emergencyType,
    issueType,
  })

  const classificationReason = resolved.handled && resolved.reason
    ? resolved.reason
    : modelReasoningSummary

  const result: ClassificationResult = {
    pipelineVersion: PIPELINE_VERSION,
    rawDescription,
    sanitizedDescription: sanitized || rawDescription,
    entities: {
      ...entities,
      emergencyType,
    },
    ticketCategory: trade,
    issueType,
    vendorTrade: trade,
    primaryCategory,
    secondaryTrade,
    classificationReason,
    severity,
    urgencyBand: urgency.band,
    urgencyReason: urgency.reason,
    slaMinutes: urgency.slaMinutes,
    photoRequested: photo.requested,
    photoRequestReason: photo.reason,
    confidenceBand: confidence.band,
    emergencyType,
    classificationConfidence,
    categoryConfidence,
    tradeConfidence,
    severityConfidence,
    matchedKeywords,
    matchedEntities,
    semanticMatches: semanticMatches.slice(0, 5),
    modelReasoningSummary,
    clarificationRequired: Boolean(clarification),
    clarification,
    otherPostcheckRan: otherCheck.signals.some((s) => s.startsWith("other")),
    otherPostcheckPassed: otherCheck.passed && trade === "other",
    signals,
    audit: {
      trade_label: tradeLabel(trade),
      rule_hits: ruleHits.slice(0, 3),
      llm,
      llm_provider: llm?.provider ?? null,
      sanitize_method: sanitizeMethod,
      primary_category: primaryCategory,
      secondary_trade: secondaryTrade,
      urgency_band: urgency.band,
      sla_minutes: urgency.slaMinutes,
      outdoor_temp_f: input.outdoorTempF ?? null,
      photo_requested: photo.requested,
      confidence_band: confidence.band,
    },
  }
  return { ...result, landlordTriage: toLandlordTriage(result) }
}

/** Sync helper for SLA / ticket create — maps to legacy IssueSlaClassification shape. */
export async function classifyIssueForSlaUnified(
  description: string,
  residentPriority: string,
  opts?: { skipLlm?: boolean; outdoorTempF?: number | null; durationHours?: number | null },
): Promise<{
  issue_category: string
  severity: "low" | "normal" | "urgent"
  classification: ClassificationResult
}> {
  const result = await classifyMaintenanceRequest({
    rawDescription: description,
    residentPriority,
    skipLlm: opts?.skipLlm,
    outdoorTempF: opts?.outdoorTempF,
    durationHours: opts?.durationHours,
  })

  let severity: "low" | "normal" | "urgent" = "normal"
  if (result.urgencyBand === "emergency" || result.severity === "critical" || result.severity === "urgent") {
    severity = "urgent"
  } else if (result.urgencyBand === "low" || result.severity === "low") {
    severity = "low"
  }

  // If clarification required and trade is other, still prefer best trade signal for routing
  // but keep other only when postcheck confirmed.
  return {
    issue_category: result.vendorTrade,
    severity,
    classification: result,
  }
}
