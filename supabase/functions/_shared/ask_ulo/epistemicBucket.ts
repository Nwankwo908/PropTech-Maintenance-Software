/**
 * Epistemic bucket for Ask Ulo "external" asks — auditable classification.
 *
 * 1 external_vendor — open-web-adjacent vendor discovery (Google/Yelp/…)
 * 2 allowlisted_facts — market / legal / weather / incentives APIs & RAG
 * 3 internal_unmatched — portfolio ask that missed specialty tools
 * 4 policy_boundary — refuse / constrain (action, fair housing, etc.)
 * 5 internal_specialty — normal in-portfolio specialty packet hit
 */

import type { AskUloCapability } from "./capability.ts"
import type { AskUloQuestionSubject } from "./questionSubjectMatch.ts"
import {
  isLandlordIncentivesQuestion,
  isMarketIntelligenceQuestion,
  isWeatherAlertsQuestion,
} from "./questionSubjectMatch.ts"
import {
  isVendorExternalDiscoveryQuestion,
  isVendorRecommendQuestion,
  isVendorBestQuestion,
} from "./questionMetricContext.ts"
import { detectCompoundVendorMarketIntent } from "./compoundIntent.ts"

export type EpistemicBucket =
  | "external_vendor"
  | "allowlisted_facts"
  | "internal_unmatched"
  | "policy_boundary"
  | "internal_specialty"

export type EpistemicClassification = {
  classified_bucket: EpistemicBucket
  matched_rule: string
  confidence: "high" | "medium" | "low"
  /** Why we fell back / what was missing — null when primary path succeeded. */
  fallback_reason: string | null
  /** Other detectors that also fired (compound-intent diagnostics). */
  secondary_signals: string[]
}

export type EpistemicSignalId =
  | "vendor_external"
  | "vendor_recommend"
  | "vendor_best"
  | "market_intelligence"
  | "legal"
  | "weather"
  | "incentives"
  | "draft"
  | "policy_boundary"

/** Collect all detectors that match — used for compound-intent + audit. */
export function collectEpistemicSignals(input: {
  question: string
  subject: AskUloQuestionSubject
  capability: AskUloCapability
  policyBlocked?: boolean
}): EpistemicSignalId[] {
  const q = input.question
  const out: EpistemicSignalId[] = []
  if (input.policyBlocked) out.push("policy_boundary")
  if (isVendorExternalDiscoveryQuestion(q)) out.push("vendor_external")
  if (isVendorRecommendQuestion(q)) out.push("vendor_recommend")
  if (isVendorBestQuestion(q)) out.push("vendor_best")
  if (
    input.subject === "market_intelligence" ||
    isMarketIntelligenceQuestion(q) ||
    detectCompoundVendorMarketIntent(q).market
  ) {
    out.push("market_intelligence")
  }
  if (input.subject === "legal" || input.capability === "legal_lookup") {
    out.push("legal")
  }
  if (input.subject === "weather" || isWeatherAlertsQuestion(q)) {
    out.push("weather")
  }
  if (input.subject === "incentives" || isLandlordIncentivesQuestion(q)) {
    out.push("incentives")
  }
  if (input.capability === "draft") out.push("draft")
  return out
}

/**
 * Classify the *ask* (before retrieval outcomes).
 * Prefer the most specific external / allowlisted bucket when signals fire.
 */
export function classifyEpistemicAsk(input: {
  question: string
  subject: AskUloQuestionSubject
  capability: AskUloCapability
  policyBlocked?: boolean
}): EpistemicClassification {
  const signals = collectEpistemicSignals(input)

  if (signals.includes("policy_boundary")) {
    return {
      classified_bucket: "policy_boundary",
      matched_rule: "policy_boundary",
      confidence: "high",
      fallback_reason: null,
      secondary_signals: signals.filter((s) => s !== "policy_boundary"),
    }
  }

  if (signals.includes("vendor_external") || signals.includes("vendor_recommend")) {
    const rule = signals.includes("vendor_external")
      ? "vendor_external_discovery"
      : "vendor_recommend"
    return {
      classified_bucket: "external_vendor",
      matched_rule: rule,
      confidence: "high",
      fallback_reason: null,
      secondary_signals: signals.filter(
        (s) => s !== "vendor_external" && s !== "vendor_recommend",
      ),
    }
  }

  const factRule =
    signals.includes("market_intelligence")
      ? "market_intelligence"
      : signals.includes("legal")
        ? "legal"
        : signals.includes("weather")
          ? "weather"
          : signals.includes("incentives")
            ? "incentives"
            : null

  if (factRule) {
    return {
      classified_bucket: "allowlisted_facts",
      matched_rule: factRule,
      confidence: "high",
      fallback_reason: null,
      secondary_signals: signals.filter((s) => s !== factRule),
    }
  }

  if (signals.includes("vendor_best")) {
    return {
      classified_bucket: "external_vendor",
      matched_rule: "vendor_best_roster",
      confidence: "medium",
      fallback_reason: null,
      secondary_signals: signals.filter((s) => s !== "vendor_best"),
    }
  }

  return {
    classified_bucket: "internal_specialty",
    matched_rule: `subject:${input.subject}+capability:${input.capability}`,
    confidence: "medium",
    fallback_reason: null,
    secondary_signals: signals,
  }
}

/**
 * Reconcile ask classification with retrieval outcomes (miss / catchall / specialty).
 */
export function resolveEpistemicOutcome(input: {
  ask: EpistemicClassification
  specialtyPacket: boolean
  noToolMatched: boolean
  catchallAttempted: boolean
  catchallFound: boolean
}): EpistemicClassification {
  const { ask } = input

  if (ask.classified_bucket === "policy_boundary") return ask

  if (
    ask.classified_bucket === "external_vendor" ||
    ask.classified_bucket === "allowlisted_facts"
  ) {
    if (input.specialtyPacket) {
      return { ...ask, fallback_reason: null }
    }
    return {
      ...ask,
      fallback_reason: input.noToolMatched
        ? "no_tool_matched_after_external_classify"
        : input.catchallAttempted && !input.catchallFound
          ? "catchall_none_after_external_classify"
          : "specialty_packet_miss",
      confidence: "medium",
    }
  }

  if (input.specialtyPacket) {
    return {
      ...ask,
      classified_bucket: "internal_specialty",
      fallback_reason: null,
    }
  }

  if (input.noToolMatched || (input.catchallAttempted && !input.catchallFound)) {
    return {
      classified_bucket: "internal_unmatched",
      matched_rule: ask.matched_rule,
      confidence: "high",
      fallback_reason: input.noToolMatched
        ? "no_tool_matched"
        : "catchall_none",
      secondary_signals: ask.secondary_signals,
    }
  }

  return ask
}
