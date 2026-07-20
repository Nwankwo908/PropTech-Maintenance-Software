import type {
  ClassificationEntities,
  ClarificationPrompt,
  SemanticMatch,
} from "./types.ts"
import type { RuleHit } from "./deterministicRules.ts"

function looksLikeWaterIssue(entities: ClassificationEntities, ruleHits: RuleHit[]): boolean {
  if (entities.damageType === "water") return true
  if (entities.issueType === "leak" || entities.issueType === "plumbing") return true
  if (entities.vendorTrade === "plumbing" || entities.vendorTrade === "roofing") return true
  if (ruleHits.some((h) => h.trade === "plumbing" || h.trade === "roofing")) return true
  return false
}

/** One targeted clarification question — perfect grammar, no mirroring. */
export function buildClarificationPrompt(params: {
  entities: ClassificationEntities
  ruleHits: RuleHit[]
  semanticMatches: SemanticMatch[]
  confidence: number
  /** Original / sanitized text for wording-aware prompts. */
  textHint?: string
}): ClarificationPrompt | null {
  const { entities, confidence, ruleHits } = params
  if (confidence >= 0.65) return null

  const hay = (params.textHint ?? "").toLowerCase()
  const hasCeilingWater =
    /\bceiling\b/.test(hay) ||
    /ceiling/i.test(entities.affectedObject ?? "") ||
    /ceiling/i.test(entities.location ?? "")

  if (
    hasCeilingWater &&
    (looksLikeWaterIssue(entities, ruleHits) || /\bwater|leak|drip|pour/i.test(hay))
  ) {
    return {
      field: "ceiling_source",
      reason: "ceiling_water_source",
      question:
        "I'm sorry you're dealing with this. Is the water coming through the ceiling after rain, or from a fixture in the unit above?",
    }
  }

  if (looksLikeWaterIssue(entities, ruleHits) || /\bwater|leak|drip|wet\b/i.test(hay)) {
    return {
      field: "issue_source",
      reason: "ambiguous_water_source",
      question:
        "Thanks for letting us know. Is the water coming from a sink, toilet, pipe, ceiling, or another source?",
    }
  }

  if (
    entities.vendorTrade === "appliance_repair" ||
    entities.issueType === "appliance" ||
    /\bfridge|washer|dryer|oven|dishwasher|appliance\b/i.test(hay)
  ) {
    return {
      field: "appliance_symptom",
      reason: "appliance_symptom_unclear",
      question:
        "Got it. Is the appliance not turning on, leaking, making noise, or failing to heat or cool?",
    }
  }

  if (
    /\belectric|power|outlet|spark/i.test(entities.affectedObject ?? "") ||
    entities.issueType === "electrical" ||
    /\boutlet|spark|power|electric/i.test(hay)
  ) {
    return {
      field: "electrical_safety",
      reason: "electrical_details",
      question:
        "Understood. Are there sparks, smoke, a burning smell, or a complete loss of power?",
    }
  }

  if (
    entities.issueType === "lock" ||
    entities.vendorTrade === "locksmith" ||
    /\block|key|can't get in|cannot get in/i.test(hay)
  ) {
    return {
      field: "lockout",
      reason: "lock_status",
      question: "Just to confirm — is anyone locked out of the unit right now?",
    }
  }

  return {
    field: "general",
    reason: "low_confidence",
    question:
      "Thanks for the update. Could you tell me which fixture or appliance is having the problem, and which room it's in?",
  }
}

/** Acknowledge + next step after successful classification (resident-facing). */
export function buildClassificationAck(params: {
  tradeLabel: string
  severity: string
  urgentReason?: string | null
}): string {
  const urgent =
    params.severity === "urgent" || params.severity === "critical"
  const reason = params.urgentReason?.trim()
  if (urgent && reason) {
    return (
      `Thanks for the details. I've classified this as a ${params.tradeLabel} issue and marked it urgent because ${reason}. ` +
      `Ulo will now begin the vendor assignment process.`
    )
  }
  return (
    `Thanks for the details. I've classified this as a ${params.tradeLabel} issue. ` +
    `Ulo will now begin the vendor assignment process.`
  )
}
