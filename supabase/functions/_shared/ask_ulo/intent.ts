/**
 * Classify Ask Ulo user intent before retrieval so tools match the goal,
 * not whatever data happens to be available.
 *
 * Critical: score the LATEST user message for intent. Prior turns preserve
 * entity context elsewhere — they must NOT lock the user into the previous
 * response template (e.g. market analysis → price history).
 */

import { isUnitMaintenanceVolumeQuestion } from "./analyticalQuery.ts"
import { isPeriodSummaryQuestion } from "./dynamicResponse.ts"
import {
  classifyAskUloReasoningMode,
  isExecutiveBriefingQuestion,
  isNarrowFactualOpsQuestion,
} from "./briefingIntent.ts"
import { isEntityInvestigationQuestion } from "./entityInvestigation.ts"
import { isOldestWaitingWorkOrderQuestion } from "./taskCompletion.ts"
import { isAnyVendorMetricQuestion } from "./questionMetricContext.ts"
import {
  isMarketRentEstimateQuestion,
  isVendorFocusedQuestion,
  detectQuestionSubject,
} from "./questionSubjectMatch.ts"

export type AskUloIntent =
  | "property_price_history"
  | "rent_history"
  | "market_rent_estimate"
  | "comparable_rentals"
  | "market_analysis"
  | "price_history_ambiguous"
  | "executive_briefing"
  | "period_summary"
  | "property_priority"
  | "unit_maintenance_ranking"
  | "oldest_waiting_work_order"
  | "entity_investigation"
  | "maintenance"
  | "legal"
  | "finance"
  | "property_health"
  | "vendor"
  | "ops"
  | "general"

export type AskUloIntentResult = {
  intent: AskUloIntent
  confidence: "high" | "medium" | "low"
  /** Short label for prompts / logging */
  label: string
}

const PATTERNS: Array<{
  intent: AskUloIntent
  label: string
  re: RegExp
  weight: number
}> = [
  // Most specific first — high weights so they beat broad market_analysis.
  {
    intent: "property_price_history",
    label: "Property Price History",
    weight: 10,
    // Bare "price history" is NOT here — that routes via price_history_ambiguous.
    re: /\b((?:property|building|asset|sale|purchase|resale|valuation|apprais(?:al|ed)?|assess(?:ed|ment)?)\s+(?:price|value)\s*history|(?:price|value)\s*history\s+(?:of|for)|(?:sale|purchase|resale)\s*history|historical\s+(?:sale|purchase|valuation|apprais|assess|propert(?:y|ies)\s+value)|what\s+did\s+.+\s+sell\s+for|last\s+(?:sale|sold)|purchase\s+price|how\s+much\s+is\s+.+\s+worth|estimated\s+value\s+history|appreciation\s+(?:since|history)|value\s+over\s+time)\b/i,
  },
  {
    intent: "rent_history",
    label: "Rent History",
    weight: 10,
    re: /\b(rent\s*history|historical\s+rent|how\s+has\s+rent\s+changed|rent\s+(?:over\s+time|trend|changes?|growth)|past\s+rents?|previous\s+rents?|rent\s+timeline)\b/i,
  },
  {
    intent: "price_history_ambiguous",
    label: "Price History (clarify)",
    weight: 8,
    re: /\b(price\s*history|pricing\s*history|history\s+of\s+(?:the\s+)?price)\b/i,
  },
  {
    intent: "market_rent_estimate",
    label: "Market Rent Estimate",
    weight: 9,
    // Includes "average rent for a two-bedroom nearby" — not portfolio briefing.
    re: /\b(what\s+could\s+i\s+charge|how\s+much\s+should\s+i\s+charge|market\s+rent\s+for|going\s+rate\s+for|rent\s+estimate|(?:average|avg\.?|typical|fair\s+market)\s+rent|what(?:'s|\s+is)\s+(?:the\s+)?(?:average\s+|avg\.?\s+|typical\s+)?(?:market\s+)?rent|what\s+can\s+i\s+(?:get|ask)\s+for|rent\s+for\s+(?:a\s+)?(?:\d+|two|three|one|studio)|(?:\d+|two|three|one)[-\s]?bed(?:room)?s?\s+(?:at|rent|market|nearby|around|in\s+the\s+(?:area|neighborhood))|(?:studio|1br|2br|3br)\s+(?:rent|nearby|market))\b/i,
  },
  {
    intent: "comparable_rentals",
    label: "Comparable Rentals",
    weight: 9,
    re: /\b(comparable\s*rentals?|comparables?\b|comps?\b|compare\s+.+\s+to\s+nearby|nearby\s+rentals?|rental\s+comps?|comp\s+set)\b/i,
  },
  {
    intent: "market_analysis",
    label: "Market Analysis",
    weight: 7,
    re: /\b(market\s*analysis|rental\s*(?:market|analysis)|neighborhood(?:\s*analysis)?|investment\s*(outlook|analysis)|full\s+market\s+(?:report|read)|local\s*demand|vacancy\s*trends?|walkability|school\s*ratings?|crime\s*trends?|demographic)\b/i,
  },
  {
    intent: "period_summary",
    label: "Period Summary",
    weight: 11,
    re: /\b((?:give\s+me\s+(?:a\s+)?|provide\s+(?:a\s+)?)?summar(?:y|ize)\s+of\s+everything|what\s+happened\s+(?:this|last|the)\s+week|weekly\s+summary|week\s+in\s+review|everything\s+that\s+happened|recap\s+(?:of\s+)?(?:this|last)\s+week)\b/i,
  },
  {
    intent: "unit_maintenance_ranking",
    label: "Unit Maintenance Ranking",
    weight: 11,
    re: /\b(which\s+units?\s+(?:generate|have|create|produce|get|need)|units?\s+(?:with\s+the\s+)?(?:most|highest|least|fewest)\s+(?:maintenance|work\s*orders?|repairs?)|most\s+maintenance\s+(?:requests?|tickets?|issues?)|maintenance\s+(?:requests?|tickets?)\s+by\s+unit)\b/i,
  },
  {
    intent: "property_priority",
    label: "Property Priority",
    weight: 10,
    re: /\b(which\s+(?:property|building)|needs?\s+(?:my\s+)?attention\s+first|attention\s+first|perform(?:ing|s)?\s+the\s+worst|worst\s+(?:propert|building)|biggest\s+risk|losing\s+money|what\s+should\s+i\s+focus\s+on|what\s+needs\s+(?:my\s+)?attention|is\s+anything\s+becoming\s+a\s+problem)\b/i,
  },
  {
    intent: "executive_briefing",
    label: "Executive Briefing",
    weight: 9,
    re: /\b((?:how\s+)?healthy\s+is\s+(?:my\s+)?portfolio|portfolio\s+(?:health|status|overview|checkup|check[- ]?in)|catch\s+me\s+up|what\s+did\s+i\s+miss|how\s+are\s+things(?:\s+going)?|anything\s+i\s+should\s+(?:be\s+)?worried\s+about|what(?:'s|\s+is)\s+going\s+on|give\s+me\s+(?:a\s+)?(?:briefing|rundown|status\s+update|ops\s+update)|executive\s+brief(?:ing)?|ops\s+(?:briefing|summary)|morning\s+(?:brief|briefing|update)|where\s+do\s+(?:things|i)\s+stand)\b/i,
  },
  {
    intent: "legal",
    label: "Legal",
    weight: 5,
    re: /\b(evict(?:ion|ing|ed)?|notice\s*period|security\s*deposit|lease\s*law|landlord[- ]tenant|fair\s*housing|statute|ors\b|habitab|legal\s*(requirement|advice|obligation|rule)|late\s*fee\s*cap|rent\s*control|rent\s*increase|(?:raise|hike|increase)\s+(?:the\s+)?rent|(?:can|may|should)\s+i\s+(?:raise|increase|change|evict|deny|enter)|month[- ]to[- ]month|\bmtm\b|fixed[- ]term\s+lease|section\s*8|housing\s+choice\s+voucher|\bhcv\b|landlord\s*entr|reasonable\s*accommodat|disability|service\s*animal|esa\b|tenant\s*screen|background\s*check|adverse\s*action|deny(?:ing|ied)?\s*(?:the\s+)?(?:rental\s+)?application|lead\s*paint|lead\s*disclosure|discriminat|protected\s*class|what\s*(?:does\s+)?(?:the\s+)?law\s*(?:require|say)|am\s*i\s*(?:required|allowed)|municipal\s*code|city\s*ordinance)\b/i,
  },
  {
    intent: "maintenance",
    label: "Maintenance",
    weight: 4,
    re: /\b(leak(?:ing)?|hvac|plumb(?:ing)?|electric(?:al)?|work\s*order|repair|broken|clogged|furnace|water\s*heater|maintenance\s*(ticket|request|issue|history|issues?)|vendor\s*delayed)\b/i,
  },
  {
    intent: "finance",
    label: "Finance",
    weight: 4,
    re: /\b(cash\s*flow|noi\b|cap\s*rate|roi\b|expenses?|budget|capex|spend(?:ing)?|past[- ]due|balances?|collections?|revenue|profit)\b/i,
  },
  {
    intent: "property_health",
    label: "Property Health",
    weight: 3,
    re: /\b(property\s*(health|performance)|health\s*score|recurring\s*issues?|portfolio\s*health|building\s*performance)\b/i,
  },
  {
    intent: "vendor",
    label: "Vendor",
    weight: 3,
    re: /\b(vendor|contractor|bid|quote|license|coi\b|insurance\s*cert|find\s*(a\s+)?(?:plumber|electrician|hvac))\b/i,
  },
  {
    intent: "ops",
    label: "Operations",
    weight: 3,
    re: /\b(what needs (my )?attention|open\s*(tickets?|workflows?|maintenance)|escalat|summarize\s*open|lease[- ]renewal\s*message|draft\s+a\s+)\b/i,
  },
]

function scoreCorpus(corpus: string): {
  intent: AskUloIntent
  label: string
  score: number
} | null {
  let best: { intent: AskUloIntent; label: string; score: number } | null = null
  for (const p of PATTERNS) {
    const matches = corpus.match(new RegExp(p.re.source, "gi"))
    if (!matches?.length) continue
    const score = matches.length * p.weight
    if (!best || score > best.score) {
      best = { intent: p.intent, label: p.label, score }
    }
  }
  return best
}

/**
 * Resolve ambiguous "price history" using cues in the latest question
 * (and lightly from prior turns only for sale vs rent wording).
 */
function resolvePriceAmbiguity(
  question: string,
  priorUserTurns: string[],
): AskUloIntentResult {
  const q = question.toLowerCase()
  const prior = priorUserTurns.slice(-2).join("\n").toLowerCase()

  if (/\b(rent|lease|unit)\b/.test(q)) {
    return { intent: "rent_history", confidence: "high", label: "Rent History" }
  }
  if (/\b(sale|sold|purchase|valuation|apprais|assess|worth|property\s+value)\b/.test(q)) {
    return {
      intent: "property_price_history",
      confidence: "high",
      label: "Property Price History",
    }
  }
  // "price history of the Maple Heights property" → valuation/sale (property noun).
  if (/\bpropert(?:y|ies)\b/.test(q)) {
    return {
      intent: "property_price_history",
      confidence: "high",
      label: "Property Price History",
    }
  }
  // Prior turn was explicitly about rent → prefer rent history.
  if (/\brent\b/.test(prior) && !/\b(sale|valuation|purchase|market\s*analysis)\b/.test(prior)) {
    return { intent: "rent_history", confidence: "medium", label: "Rent History" }
  }
  // Follow-up after market / property talk ("its price history") → sale/valuation.
  if (
    /\b(market\s*analysis|propert(?:y|ies)|building|maple|oakwood|valuation|comps?|neighborhood)\b/.test(
      prior,
    )
  ) {
    return {
      intent: "property_price_history",
      confidence: "medium",
      label: "Property Price History",
    }
  }

  return {
    intent: "price_history_ambiguous",
    confidence: "medium",
    label: "Price History (clarify)",
  }
}

/** Classify from the latest question (prior turns do not override intent). */
export function classifyAskUloIntent(
  question: string,
  priorUserTurns: string[] = [],
): AskUloIntentResult {
  const latest = question.trim()
  if (!latest) {
    return { intent: "general", confidence: "low", label: "General" }
  }

  // Explicit market-rent phrasing before ops / briefing fallbacks.
  if (isMarketRentEstimateQuestion(latest)) {
    return {
      intent: "market_rent_estimate",
      confidence: "high",
      label: "Market Rent Estimate",
    }
  }

  // Market / legal / price intents win over ops ranking when clearly present.
  const bestEarly = scoreCorpus(latest)
  if (
    bestEarly &&
    (bestEarly.intent === "comparable_rentals" ||
      bestEarly.intent === "market_analysis" ||
      bestEarly.intent === "market_rent_estimate" ||
      bestEarly.intent === "property_price_history" ||
      bestEarly.intent === "rent_history" ||
      bestEarly.intent === "price_history_ambiguous" ||
      bestEarly.intent === "legal") &&
    bestEarly.score >= 6
  ) {
    if (bestEarly.intent === "price_history_ambiguous") {
      return resolvePriceAmbiguity(latest, priorUserTurns)
    }
    return {
      intent: bestEarly.intent,
      confidence: bestEarly.score >= 10 ? "high" : bestEarly.score >= 6 ? "medium" : "low",
      label: bestEarly.label,
    }
  }

  // Period activity summary — never collapse to open-ticket totals.
  if (isPeriodSummaryQuestion(latest)) {
    return {
      intent: "period_summary",
      confidence: "high",
      label: "Period Summary",
    }
  }

  // Oldest waiting work order — never collapse to portfolio ticket totals.
  if (isOldestWaitingWorkOrderQuestion(latest)) {
    return {
      intent: "oldest_waiting_work_order",
      confidence: "high",
      label: "Oldest Waiting Work Order",
    }
  }

  // Named entity (Unit 304, WO-1234, …) — investigate that entity, not portfolio KPIs.
  // Must beat diagnosis → property_priority so "why hasn't Unit 304…" stays entity-scoped.
  if (isEntityInvestigationQuestion(latest)) {
    return {
      intent: "entity_investigation",
      confidence: "high",
      label: "Entity Investigation",
    }
  }

  // Unit × maintenance-request volume ranking — never collapse to portfolio totals.
  if (isUnitMaintenanceVolumeQuestion(latest)) {
    return {
      intent: "unit_maintenance_ranking",
      confidence: "high",
      label: "Unit Maintenance Ranking",
    }
  }

  // Vendor questions — never collapse to property_priority / ops briefing.
  if (isAnyVendorMetricQuestion(latest) || isVendorFocusedQuestion(latest)) {
    return {
      intent: "vendor",
      confidence: "high",
      label: "Vendor",
    }
  }

  // Resident / late-rent / move-in — never property_priority.
  if (
    detectQuestionSubject(latest) === "resident" ||
    detectQuestionSubject(latest) === "lease"
  ) {
    return {
      intent: "ops",
      confidence: "high",
      label: "Resident / Lease Ops",
    }
  }

  // Workflow questions — awaiting decisions, not property ranking.
  if (detectQuestionSubject(latest) === "workflow") {
    return {
      intent: "ops",
      confidence: "high",
      label: "Workflow Ops",
    }
  }

  // Finance spend / NOI — not property priority.
  if (detectQuestionSubject(latest) === "finance") {
    return {
      intent: "finance",
      confidence: "high",
      label: "Finance",
    }
  }

  // Market already handled early; document / legal subjects.
  if (detectQuestionSubject(latest) === "legal") {
    return {
      intent: "legal",
      confidence: "high",
      label: "Legal",
    }
  }

  // Reasoning mode: ranking / diagnosis / recommendation never fall to General.
  const reasoning = classifyAskUloReasoningMode(latest)
  if (reasoning.mode === "comparison_ranking") {
    return {
      intent: "property_priority",
      confidence: reasoning.confidence,
      label: "Property Priority",
    }
  }
  if (reasoning.mode === "diagnosis" || reasoning.mode === "recommendation") {
    return {
      intent: "property_priority",
      confidence: reasoning.confidence,
      label: "Property Priority",
    }
  }
  if (reasoning.mode === "executive_briefing" || isExecutiveBriefingQuestion(latest)) {
    return {
      intent: "executive_briefing",
      confidence: "high",
      label: "Executive Briefing",
    }
  }

  const best = bestEarly
  if (!best) {
    if (isNarrowFactualOpsQuestion(latest)) {
      return {
        intent: "maintenance",
        confidence: "high",
        label: "Maintenance (factual)",
      }
    }
    return { intent: "ops", confidence: "low", label: "Operations" }
  }

  if (best.intent === "price_history_ambiguous") {
    return resolvePriceAmbiguity(latest, priorUserTurns)
  }

  // Narrow ticket/count questions stay factual even if ops/health patterns hit.
  if (
    isNarrowFactualOpsQuestion(latest) &&
    (best.intent === "ops" ||
      best.intent === "property_health" ||
      best.intent === "executive_briefing" ||
      best.intent === "general")
  ) {
    return {
      intent: "maintenance",
      confidence: "high",
      label: "Maintenance (factual)",
    }
  }

  // Portfolio health language without the executive phrases → still briefing.
  if (best.intent === "property_health") {
    return {
      intent: "executive_briefing",
      confidence: best.score >= 6 ? "high" : "medium",
      label: "Executive Briefing",
    }
  }

  return {
    intent: best.intent,
    confidence: best.score >= 10 ? "high" : best.score >= 6 ? "medium" : "low",
    label: best.label,
  }
}

export type AskUloToolPlan = {
  runOpsGraph: boolean
  runLegalRag: boolean
  runStructured: boolean
  runPropertySnapshot: boolean
  runMarketData: boolean
  runPriceHistory: boolean
  runRentHistory: boolean
  /** Ops may only contribute a light “leasing impact” note, not ticket dumps. */
  opsMode: "full" | "leasing_impact" | "legal_context" | "none"
  /** Rich UI: full market report vs comps-only vs none. */
  visualMode: "market_analysis" | "comparable_rentals" | "none"
}

/** Decide which retrieval tools to run for an intent. */
export function planToolsForIntent(intent: AskUloIntent): AskUloToolPlan {
  const noneExtras = {
    runPriceHistory: false,
    runRentHistory: false,
    visualMode: "none" as const,
  }

  switch (intent) {
    case "property_price_history":
      return {
        runOpsGraph: false,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: true,
        runMarketData: false,
        runPriceHistory: true,
        runRentHistory: false,
        opsMode: "none",
        visualMode: "none",
      }
    case "rent_history":
      return {
        runOpsGraph: false,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: true,
        runMarketData: false,
        runPriceHistory: false,
        runRentHistory: true,
        opsMode: "none",
        visualMode: "none",
      }
    case "price_history_ambiguous":
      return {
        runOpsGraph: false,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: true,
        runMarketData: false,
        runPriceHistory: false,
        runRentHistory: false,
        opsMode: "none",
        visualMode: "none",
      }
    case "market_rent_estimate":
      return {
        runOpsGraph: false,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: true,
        runMarketData: true,
        runPriceHistory: false,
        runRentHistory: false,
        opsMode: "none",
        visualMode: "none",
      }
    case "comparable_rentals":
      return {
        runOpsGraph: false,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: true,
        runMarketData: true,
        runPriceHistory: false,
        runRentHistory: false,
        opsMode: "none",
        visualMode: "comparable_rentals",
      }
    case "market_analysis":
      return {
        runOpsGraph: true,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: true,
        runMarketData: true,
        runPriceHistory: false,
        runRentHistory: false,
        opsMode: "leasing_impact",
        visualMode: "market_analysis",
      }
    case "legal":
      return {
        // Portfolio dossier (leases, programs, policies) + light ops — answers
        // must combine local law with this landlord's property context.
        runOpsGraph: true,
        runLegalRag: true,
        runStructured: true,
        runPropertySnapshot: true,
        runMarketData: false,
        ...noneExtras,
        opsMode: "legal_context",
      }
    case "maintenance":
      return {
        runOpsGraph: true,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: false,
        runMarketData: false,
        ...noneExtras,
        opsMode: "full",
      }
    case "finance":
      return {
        runOpsGraph: false,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: true,
        runMarketData: false,
        ...noneExtras,
        opsMode: "none",
      }
    case "property_health":
    case "executive_briefing":
    case "period_summary":
    case "property_priority":
    case "unit_maintenance_ranking":
    case "oldest_waiting_work_order":
    case "entity_investigation":
      return {
        runOpsGraph: true,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: true,
        runMarketData: false,
        ...noneExtras,
        opsMode: "full",
      }
    case "vendor":
      return {
        runOpsGraph: true,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: false,
        runMarketData: false,
        ...noneExtras,
        opsMode: "full",
      }
    case "ops":
      return {
        runOpsGraph: true,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: true,
        runMarketData: false,
        ...noneExtras,
        opsMode: "full",
      }
    case "general":
    default:
      // Prefer ops tools over an empty "General" dump — still retrieve entity signals.
      return {
        runOpsGraph: true,
        runLegalRag: false,
        runStructured: false,
        runPropertySnapshot: true,
        runMarketData: false,
        ...noneExtras,
        opsMode: "full",
      }
  }
}
