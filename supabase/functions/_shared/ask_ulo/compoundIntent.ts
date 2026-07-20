/**
 * Compound external intents — single-intent router may drop a half.
 * Make the dropped half explicit instead of silently answering only one part.
 */

import { isMarketIntelligenceQuestion } from "./questionSubjectMatch.ts"
import {
  isVendorBestQuestion,
  isVendorExternalDiscoveryQuestion,
  isVendorRecommendQuestion,
} from "./questionMetricContext.ts"

export type CompoundExternalHalves = {
  vendor: boolean
  market: boolean
  isCompound: boolean
}

export function detectCompoundVendorMarketIntent(question: string): CompoundExternalHalves {
  const vendor =
    isVendorExternalDiscoveryQuestion(question) ||
    isVendorRecommendQuestion(question) ||
    (isVendorBestQuestion(question) &&
      /\b(quote|cost|rate|price|fair|reasonable|charge)\b/i.test(question))
  const market =
    isMarketIntelligenceQuestion(question) ||
    (/\b(plumber|electrician|hvac|vendor|contractor)\b/i.test(question) &&
      /\b(fair\s+rate|going\s+rate|what\s+should\s+(?:this|it)\s+cost|reasonable\s+(?:quote|price|rate)|quote\s+reasonable)\b/i
        .test(question))
  return { vendor, market, isCompound: vendor && market }
}

/**
 * Landlord-facing note when we answered one half of a compound ask.
 */
export function formatDroppedHalfNote(input: {
  handled: "vendor" | "market"
  dropped: "vendor" | "market"
}): string {
  if (input.handled === "vendor" && input.dropped === "market") {
    return [
      "",
      "---",
      "",
      "**One thing at a time**",
      "I focused on finding / ranking vendors here. For whether a quote or rate is fair in your market, ask me separately (e.g. “What’s a fair rate for a plumber near my properties?”).",
    ].join("\n")
  }
  return [
    "",
    "---",
    "",
    "**One thing at a time**",
    "I focused on market / rate context here. To shortlist local vendors outside your roster, ask me separately (e.g. “Find a local plumber outside my network”).",
  ].join("\n")
}

/** Append dropped-half note when compound and we only shipped one side. */
export function appendDroppedHalfIfNeeded(
  markdown: string,
  input: {
    compound: CompoundExternalHalves
    shippedVendor: boolean
    shippedMarket: boolean
  },
): string {
  if (!input.compound.isCompound) return markdown
  if (input.shippedVendor && input.shippedMarket) return markdown
  if (input.shippedVendor && !input.shippedMarket) {
    return markdown + formatDroppedHalfNote({ handled: "vendor", dropped: "market" })
  }
  if (input.shippedMarket && !input.shippedVendor) {
    return markdown + formatDroppedHalfNote({ handled: "market", dropped: "vendor" })
  }
  return markdown
}
