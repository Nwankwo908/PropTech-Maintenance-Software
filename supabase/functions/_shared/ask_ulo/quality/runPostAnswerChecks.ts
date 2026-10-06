/**
 * Independent post-answer quality checks (fail-closed).
 * Runs after synthesis — never before tools.
 *
 *   faithfulness → completeness → privacy → confidence → jurisdiction
 */

import {
  checkAnswerFaithfulness,
  type AnswerFaithfulnessCheck,
} from "./checkFaithfulness.ts"
import {
  checkAnswerCompleteness,
  type AnswerCompletenessCheck,
} from "./checkCompleteness.ts"
import {
  checkAnswerJurisdiction,
  type AnswerJurisdictionCheck,
} from "./checkJurisdiction.ts"
import {
  checkAnswerPrivacy,
  type AnswerPrivacyCheck,
} from "./checkPrivacy.ts"
import {
  checkAnswerConfidence,
  type AnswerConfidenceCheck,
} from "./checkConfidence.ts"
import type { AskUloCitation } from "../retrieval/searchInternalData.ts"
import type { AskUloEvidencePacket } from "../retrieval/buildEvidencePacket.ts"
import { formatOrganizedEvidenceBlock } from "../retrieval/buildEvidencePacket.ts"
import {
  formatUnsupportedFiguresClarifyMarkdown,
  isUnsupportedFiguresRejection,
} from "./groundedRetryAfterFiguresRejection.ts"

export type PostAnswerCheckId =
  | "faithfulness"
  | "completeness"
  | "privacy"
  | "confidence"
  | "jurisdiction"

export type PostAnswerQualityReport = {
  pass: boolean
  /** Replace the drafted answer — do not show unsupported / wrong-scope text. */
  failClosed: boolean
  block: "clarify" | "refuse" | null
  summaryLine: string
  reasons: string[]
  faithfulness: AnswerFaithfulnessCheck
  completeness: AnswerCompletenessCheck
  privacy: AnswerPrivacyCheck
  confidence: AnswerConfidenceCheck
  jurisdiction: AnswerJurisdictionCheck
  /** When privacy soft-redacted contact PII without fail-closed. */
  redactedAnswer?: string
}

function evidenceCorpus(packet: AskUloEvidencePacket | null | undefined): string {
  if (!packet) return ""
  return formatOrganizedEvidenceBlock(packet)
}

/**
 * Run the independent post-answer checks.
 * Fail-closed when any check sets failClosed.
 */
export function runPostAnswerQualityChecks(input: {
  question: string
  answer: string
  intent: string
  citations: AskUloCitation[]
  evidencePacket?: AskUloEvidencePacket | null
  gateStatus?: "ok" | "clarify" | "refuse" | null
  buildingFilter?: string | null
  portfolioBuildings?: string[]
  landlordId?: string | null
  packetSatisfied?: boolean
  stateCode?: string | null
  cityLabel?: string | null
  screeningIsolation?: boolean
  sensitiveTopicIds?: string[]
  requireCounsel?: boolean
}): PostAnswerQualityReport {
  const hasEvidence = Boolean(
    input.evidencePacket?.meta.hasEvidence ||
      (input.evidencePacket?.internal.length ?? 0) > 0 ||
      (input.evidencePacket?.legal.length ?? 0) > 0 ||
      (input.evidencePacket?.market.length ?? 0) > 0 ||
      input.citations.length > 0,
  )
  const corpus = evidenceCorpus(input.evidencePacket)

  const faithfulness = checkAnswerFaithfulness({
    intent: input.intent,
    answer: input.answer,
    citations: input.citations,
    evidenceText: corpus,
    hasEvidence,
    gateStatus: input.gateStatus,
  })

  const completeness = checkAnswerCompleteness({
    question: input.question,
    answer: input.answer,
    hasEvidence,
    packetSatisfied: input.packetSatisfied,
  })

  const privacy = checkAnswerPrivacy({
    answer: input.answer,
    screeningIsolation: input.screeningIsolation,
    sensitiveTopicIds: input.sensitiveTopicIds,
  })

  const confidence = checkAnswerConfidence({
    intent: input.intent,
    answer: input.answer,
    hasEvidence,
    citationCount: input.citations.length,
    requireCounsel: input.requireCounsel,
  })

  const jurisdiction = checkAnswerJurisdiction({
    intent: input.intent,
    answer: input.answer,
    stateCode:
      input.stateCode ?? input.evidencePacket?.meta.jurisdiction.stateCode ?? null,
    cityLabel:
      input.cityLabel ?? input.evidencePacket?.meta.jurisdiction.cityLabel ?? null,
    buildingFilter: input.buildingFilter,
    portfolioBuildings: input.portfolioBuildings,
    landlordId: input.landlordId,
  })

  const checks = [faithfulness, completeness, privacy, confidence, jurisdiction]
  const failClosed = checks.some((c) => c.failClosed)
  const reasons = checks.flatMap((c) => c.reasons)
  const pass = checks.every((c) => c.pass)

  let block: PostAnswerQualityReport["block"] = null
  if (failClosed) {
    if (jurisdiction.block === "clarify" || completeness.block === "clarify") {
      block = "clarify"
    } else {
      block = "refuse"
    }
  }

  const summaryLine = [
    `faithfulness:${faithfulness.pass ? "pass" : "fail"}`,
    `completeness:${completeness.pass ? "pass" : "fail"}`,
    `privacy:${privacy.pass ? "pass" : "fail"}`,
    `confidence:${confidence.pass ? "pass" : "fail"}`,
    `jurisdiction:${jurisdiction.pass ? "pass" : "fail"}`,
  ].join("|")

  return {
    pass,
    failClosed,
    block,
    summaryLine,
    reasons,
    faithfulness,
    completeness,
    privacy,
    confidence,
    jurisdiction,
    redactedAnswer: privacy.redactedAnswer,
  }
}

/** Map internal check ids → landlord-facing bullets. Never echo raw labels. */
function landlordFacingFailClosedBullets(reasons: string[], question?: string): string[] {
  const bullets: string[] = []
  const q = question ?? ""

  if (isUnsupportedFiguresRejection(reasons)) {
    if (/\b(cost|costs|estimate|\$|spend|budget|how much)\b/i.test(q)) {
      bullets.push("I don't have cost data recorded for these tickets yet.")
    } else if (/\b(timeline|how long|when will|deadline|eta)\b/i.test(q)) {
      bullets.push("I don't have reliable timeline figures on file for this yet.")
    } else {
      bullets.push(
        "Some numbers in the draft weren’t backed by your live records, so I won’t show that version.",
      )
    }
  }
  if (reasons.some((r) => r.startsWith("wrong_property:"))) {
    bullets.push("The draft mentioned a different property than the one this question is about.")
  }
  if (reasons.some((r) => r.startsWith("pii_leak:") || r === "screening_detail_in_answer")) {
    bullets.push("The draft included private details that shouldn’t appear in this chat.")
  }
  if (reasons.includes("foreign_uuid_in_answer")) {
    bullets.push("The draft included an internal id that doesn’t belong in a landlord answer.")
  }
  if (reasons.includes("overstated_uncertainty_with_evidence")) {
    bullets.push("I actually have matching records — I shouldn’t have said I couldn’t answer.")
  }
  if (reasons.includes("absolute_legal_claim_without_citation")) {
    bullets.push("A hard legal claim needed an official source citation.")
  }

  // Drop every internal label (non_legal_intent, unsupported_figures:…, etc.).
  if (bullets.length === 0) {
    bullets.push("The draft didn’t stay within the evidence or the correct property scope.")
  }
  return bullets
}

/** Landlord-facing fail-closed replacement when post-answer checks refuse. */
export function formatPostAnswerFailClosedMarkdown(input: {
  block: "clarify" | "refuse"
  reasons: string[]
  question?: string
}): string {
  // Unsupported / invented figures — dedicated plain-language path (no diagnostics).
  if (isUnsupportedFiguresRejection(input.reasons)) {
    return formatUnsupportedFiguresClarifyMarkdown(input.question)
  }

  const bullets = landlordFacingFailClosedBullets(input.reasons, input.question)
  const why = bullets.map((b) => `- ${b}`).join("\n")

  if (input.block === "clarify") {
    return [
      "I need a clearer property or location before I can answer this safely.",
      "",
      "### What's missing",
      why,
      "",
      "### What happens next",
      "Name the building (or city/state for a legal question) and ask again — I’ll stay within that scope.",
    ].join("\n")
  }

  if (input.reasons.some((r) => r.startsWith("pii_leak:") || r === "screening_detail_in_answer")) {
    return [
      "I won’t show that draft answer — it included private information that shouldn’t appear in this chat.",
      "",
      "### What's missing",
      why,
      "",
      "### What happens next",
      "Ask again without requesting personal identifiers, credit scores, or screening details.",
    ].join("\n")
  }

  return [
    "I won’t show that draft answer — it didn’t stay within the evidence or the correct property scope.",
    "",
    "### What's missing",
    why,
    "",
    "### What happens next",
    "Rephrase the question, confirm the property, or ask me to pull a specific work order / resident / vendor by name.",
  ].join("\n")
}
