/**
 * Ask Ulo job classification: product_support vs portfolio_analyst vs legal.
 * Runs before tool planning so product-support never hits portfolio tools.
 */

export type AskUloJob =
  | "product_support"
  | "portfolio_analyst"
  | "legal"

export type AskUloJobClassification = {
  job: AskUloJob
  /** Explicit "I need help from support" (or similar). */
  explicitSupportAsk: boolean
  confidence: "high" | "medium" | "low"
  reason: string
}

const EXPLICIT_SUPPORT_RE =
  /\b((?:i\s+)?need\s+(?:help\s+from\s+)?support|talk\s+to\s+(?:a\s+)?(?:human|person|someone)|contact\s+support|escalate\s+(?:this|to\s+support)|open\s+a\s+(?:support\s+)?ticket|get\s+(?:me\s+)?(?:a\s+)?human|flag\s+(?:this\s+)?for\s+support|support\s+please)\b/i

const PRODUCT_SUPPORT_RE =
  /\b(how\s+do\s+i|where\s+(?:do\s+i|is|can\s+i)|how\s+to\s+(?:use|find|turn|enable|disable|invite|add|set)|ui\s+(?:broken|bug|issue)|button\s+(?:missing|broken|doesn'?t|won'?t)|(?:doesn'?t|won'?t|isn'?t)\s+work(?:ing)?|roadblock|stuck\s+on|can'?t\s+(?:find|open|see|access|click)|where\s+is\s+the\s+(?:settings?|button|menu|page|screen)|onboarding\s+(?:how|help|stuck)|help\s+(?:me\s+)?(?:with\s+)?(?:the\s+)?(?:app|dashboard|portal|ulo)|product\s+support)\b/i

const PORTFOLIO_RE =
  /\b(work\s*orders?|tickets?|maintenance\s+requests?|late\s+on\s+rent|balance\s+due|which\s+tenants?|which\s+residents?|vendors?|plumbers?|properties?|units?|occupanc|lease\s+end|open\s+repairs?|awaiting\s+(?:approval|decision)|portfolio|vacant|delinquent|invoice|estimate\s+pending|who\s+is\s+assigned)\b/i

const LEGAL_RE =
  /\b(fair\s+housing|eviction|habitability|security\s+deposit|landlord[\s-]tenant|unlawful\s+detainer|notice\s+to\s+(?:quit|vacate)|lead\s+paint|mold\s+disclosure|retaliation|reasonable\s+accommodation)\b/i

/**
 * Classify the landlord question into Ask Ulo jobs.
 * Explicit support phrases force product_support.
 * Clear portfolio/legal signals win over vague "help".
 */
export function classifyAskUloJob(
  question: string,
  priorUserTurns: string[] = [],
): AskUloJobClassification {
  const q = question.trim()
  const prior = priorUserTurns.slice(-2).join("\n")
  const hay = `${q}\n${prior}`

  const explicitSupportAsk = EXPLICIT_SUPPORT_RE.test(q)
  if (explicitSupportAsk) {
    return {
      job: "product_support",
      explicitSupportAsk: true,
      confidence: "high",
      reason: "explicit_support_ask",
    }
  }

  if (LEGAL_RE.test(q)) {
    return {
      job: "legal",
      explicitSupportAsk: false,
      confidence: "high",
      reason: "legal_signals",
    }
  }

  const portfolio = PORTFOLIO_RE.test(q) || PORTFOLIO_RE.test(hay)
  const product = PRODUCT_SUPPORT_RE.test(q)

  if (portfolio && !product) {
    return {
      job: "portfolio_analyst",
      explicitSupportAsk: false,
      confidence: "high",
      reason: "portfolio_signals",
    }
  }

  if (product && !portfolio) {
    return {
      job: "product_support",
      explicitSupportAsk: false,
      confidence: "high",
      reason: "product_support_signals",
    }
  }

  if (portfolio && product) {
    // Portfolio data questions take the analyst path; product how-to takes support.
    // Prefer portfolio when the ask names ops entities.
    return {
      job: "portfolio_analyst",
      explicitSupportAsk: false,
      confidence: "medium",
      reason: "portfolio_over_product_when_both",
    }
  }

  // Default: portfolio analyst (existing Ask Ulo behavior) unless clearly product.
  return {
    job: "portfolio_analyst",
    explicitSupportAsk: false,
    confidence: "low",
    reason: "default_portfolio",
  }
}
