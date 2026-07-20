/**
 * Contextualize the landlord's metric before answering.
 * Prevents Ask Ulo from answering a nearby metric (e.g. fastest when they asked best).
 */

import {
  VENDOR_TRADE_DEFINITIONS,
  issueCategoryToVendorTrade,
  type VendorTradeSlug,
} from "../vendor_trades.ts"
import {
  isVendorResponseSpeedQuestion,
  isVendorRankingQuestion,
  isVendorInactivityQuestion,
  isVendorOverloadQuestion,
  looksLikePortfolioBriefingAnswer,
} from "./questionSubjectMatch.ts"
import { isVendorVerificationStatusQuestion } from "./vendorVerificationStatusLookup.ts"

export type AskUloVendorMetric =
  | "response_speed"
  | "overall_quality"
  | "completion"
  | "satisfaction"
  | "inactivity"
  | "workload"
  | "verification"
  | "unspecified"

export const QUESTION_CONTEXTUALIZATION_GUIDE = `
## Question contextualization (never skip)

Before retrieving or answering, name:
1. **Subject** — vendor / property / unit / work order / …
2. **Metric** — what “best / fastest / most / worst” means here
3. **Scope** — trade, building, period (if stated)

Rules:
- Do **not** invent a metric. If they said “best electrician,” that is overall quality for the electrical trade — **not** “who responds fastest.”
- Only use the response-speed packet when they asked about respond / response time / fastest / slowest.
- When the metric is ambiguous but a trade is clear (“best plumber”), use the **overall vendor score** for that trade and say what it includes (satisfaction, completion, response speed, rework).
- Never ship an answer for a different metric than the one the question implies.
`.trim()

const TRADE_HINTS: Array<{ slug: VendorTradeSlug; re: RegExp; label: string }> = [
  { slug: "electrical", re: /\belectricians?\b|\belectrical\b/i, label: "electrician" },
  { slug: "plumbing", re: /\bplumbers?\b|\bplumbing\b/i, label: "plumber" },
  { slug: "hvac", re: /\bhvac\b|\bheat(?:ing)?\b|\bcool(?:ing)?\b|\bair\s*condition/i, label: "HVAC tech" },
  { slug: "appliance_repair", re: /\bappliance\b/i, label: "appliance tech" },
  { slug: "pest_control", re: /\bpest\b/i, label: "pest control vendor" },
  { slug: "landscaping", re: /\blandscap|\blawn\b/i, label: "landscaper" },
  { slug: "roofing", re: /\broof(?:er|ing)?\b/i, label: "roofer" },
  { slug: "painting", re: /\bpaint(?:er|ing)?\b/i, label: "painter" },
  { slug: "carpentry", re: /\bcarpent(?:er|ry)\b/i, label: "carpenter" },
  { slug: "cleaning", re: /\bclean(?:er|ing)?\b/i, label: "cleaner" },
  { slug: "locksmith", re: /\blocksmiths?\b/i, label: "locksmith" },
  { slug: "flooring", re: /\bfloor(?:ing)?\b/i, label: "flooring contractor" },
  { slug: "windows", re: /\bwindows?\b/i, label: "window tech" },
  { slug: "general", re: /\bhandym[ae]n\b|\bgeneral\s+(?:vendor|contractor)\b/i, label: "handyman" },
]

export function detectVendorTradeFromQuestion(question: string): {
  slug: VendorTradeSlug | null
  label: string | null
} {
  const q = question.trim()
  if (!q) return { slug: null, label: null }
  for (const hint of TRADE_HINTS) {
    if (hint.re.test(q)) return { slug: hint.slug, label: hint.label }
  }
  const fromIssue = issueCategoryToVendorTrade(q)
  if (fromIssue && fromIssue !== "other") {
    const def = VENDOR_TRADE_DEFINITIONS.find((t) => t.slug === fromIssue)
    return {
      slug: fromIssue,
      label: def?.rosterPlural?.replace(/s$/, "") ?? def?.label ?? fromIssue,
    }
  }
  return { slug: null, label: null }
}

/** “Find a local plumber outside my network” / “external vendor near Oakwood”. */
export function isVendorExternalDiscoveryQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  const trade = detectVendorTradeFromQuestion(q)
  const hasVendorSubject =
    /\bvendors?\b|\bcontractors?\b|\btrades?\b/i.test(q) || trade.slug != null
  if (!hasVendorSubject && !/\bnetwork\b|\broster\b|\blocal\b|\bexternal\b/i.test(q)) {
    return false
  }
  return (
    /\b(?:outside|external|off[- ]?roster)\b.{0,24}\b(?:network|roster|vendors?|contractors?)\b/i
      .test(q) ||
    /\b(?:outside|external)\b.{0,20}\b(?:vendor|contractor|plumber|electrician|hvac)\b/i.test(
      q,
    ) ||
    /\b(?:not on|not in)\b.{0,16}\b(?:my )?(?:roster|network)\b/i.test(q) ||
    (/\blocal(?:ly)?\b/i.test(q) &&
      (hasVendorSubject ||
        /\b(?:near|around|area|portfolio|propert(?:y|ies))\b/i.test(q))) ||
    (/\b(?:find|search|discover|look\s+for)\b/i.test(q) &&
      /\b(?:near|around|local|area|portfolio)\b/i.test(q) &&
      hasVendorSubject)
  )
}

/** “Recommend another plumber” / “suggest a different electrician”. */
export function isVendorRecommendQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  const trade = detectVendorTradeFromQuestion(q)
  const hasVendorSubject =
    /\bvendors?\b|\bcontractors?\b|\btrades?\b/i.test(q) || trade.slug != null
  if (!hasVendorSubject) return false
  return (
    /\b(?:recommend|suggest|find|show|give\s+me)\b.{0,24}\b(?:another|a\s+different|different|alternative|alternate|other)\b/i
      .test(q) ||
    /\b(?:another|a\s+different|different|alternative|alternate|other)\b.{0,24}\b(?:vendor|contractor|plumber|electrician|hvac)\b/i
      .test(q) ||
    /\brecommend\s+another\b/i.test(q)
  )
}

/** “Who is my best electrician?” / “best plumber” / “strongest HVAC vendor” / “Compare my HVAC vendors”. */
export function isVendorBestQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (isVendorResponseSpeedQuestion(q)) return false
  if (isVendorOverloadQuestion(q)) return false
  if (isVendorRecommendQuestion(q)) return true
  if (isVendorExternalDiscoveryQuestion(q)) return true

  const bestish =
    /\b(best|top|favorite|favourite|strongest|highest[- ]?rated|go[- ]to)\b/i.test(q) ||
    /\bwho\s+(?:is|are)\s+my\s+best\b/i.test(q) ||
    /\bcompar(?:e|ing|ison)\b/i.test(q)
  if (!bestish) return false

  const trade = detectVendorTradeFromQuestion(q)
  if (trade.slug) return true
  return /\bvendors?\b|\bcontractors?\b|\btrades?\b/i.test(q)
}

/** “Which vendor has the highest completion rate?” */
export function isVendorCompletionQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (!/\bvendors?\b|\bcontractors?\b|\btrades?\b/i.test(q) && !detectVendorTradeFromQuestion(q).slug) {
    return false
  }
  return (
    /\bcompletion\s+rate\b/i.test(q) ||
    /\bhighest\s+completion\b/i.test(q) ||
    /\bcompletes?\s+(?:the\s+)?most\b/i.test(q) ||
    /\bfinish(?:es|ing)?\s+(?:the\s+)?most\s+(?:jobs?|work)\b/i.test(q) ||
    (/\bcompletion\b/i.test(q) && /\b(highest|best|top|rank)\b/i.test(q))
  )
}

/** “Highest rated vendor” / resident satisfaction rankings. */
export function isVendorSatisfactionQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (!/\bvendors?\b|\bcontractors?\b/i.test(q) && !detectVendorTradeFromQuestion(q).slug) {
    return false
  }
  return (
    /\b(resident\s+)?(?:satisfaction|rating|reviews?)\b/i.test(q) ||
    /\bhighest[- ]?rated\b/i.test(q)
  ) && !isVendorResponseSpeedQuestion(q)
}

/**
 * Any vendor ranking / metric question — never route these to property priority.
 */
export function isAnyVendorMetricQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  return (
    isVendorResponseSpeedQuestion(q) ||
    isVendorCompletionQuestion(q) ||
    isVendorSatisfactionQuestion(q) ||
    isVendorBestQuestion(q) ||
    isVendorRecommendQuestion(q) ||
    isVendorExternalDiscoveryQuestion(q) ||
    isVendorInactivityQuestion(q) ||
    isVendorOverloadQuestion(q) ||
    isVendorVerificationStatusQuestion(q) ||
    isVendorRankingQuestion(q)
  )
}

export function detectVendorMetric(question: string): AskUloVendorMetric {
  const q = question.trim()
  if (!q) return "unspecified"
  if (isVendorVerificationStatusQuestion(q)) return "verification"
  if (isVendorOverloadQuestion(q)) return "workload"
  if (isVendorInactivityQuestion(q)) return "inactivity"
  if (isVendorResponseSpeedQuestion(q)) return "response_speed"
  if (isVendorCompletionQuestion(q)) return "completion"
  if (isVendorSatisfactionQuestion(q)) return "satisfaction"
  if (isVendorBestQuestion(q)) return "overall_quality"
  if (isVendorRankingQuestion(q) && !isVendorResponseSpeedQuestion(q) && !isVendorOverloadQuestion(q)) {
    return "overall_quality"
  }
  return "unspecified"
}

/** True when the answer used response-speed framing for a non-speed question. */
export function looksLikeResponseSpeedForBestAnswer(question: string, answer: string): boolean {
  if (detectVendorMetric(question) === "response_speed") return false
  const metric = detectVendorMetric(question)
  if (
    !isVendorBestQuestion(question) &&
    metric !== "overall_quality" &&
    metric !== "completion" &&
    metric !== "satisfaction"
  ) {
    return false
  }
  const a = answer.trim()
  return (
    /\brespond(?:s|ing)?\s+the\s+fastest\b/i.test(a) ||
    /\btimed\s+vendor\s+responses?\b/i.test(a) ||
    /\baccept\s*\/\s*decline\s+timings?\b/i.test(a) ||
    /\bfastest\s+responders?\b/i.test(a) ||
    (/\bresponse\s+speed\b/i.test(a) && !/\bvendor\s+score\b|\boverall\b|\bsatisfaction\b|\bcompletion\b/i.test(a))
  )
}

/** True when the answer used best/score framing for a response-speed question. */
export function looksLikeBestForResponseSpeedAnswer(question: string, answer: string): boolean {
  if (detectVendorMetric(question) !== "response_speed") return false
  const a = answer.trim()
  return (
    /\bbest\s+vendor\b/i.test(a) ||
    /\boverall\s+vendor\s+score\b/i.test(a) ||
    /\bscore\s+\*\*\d/i.test(a) ||
    /\bTop\s+vendors\b/i.test(a) ||
    (/\bcompletion\b/i.test(a) && /\bresident\s+rating\b/i.test(a) &&
      !/\bresponse\s+time\b|\baverage\s+response\b|\bfastest\b|\bslowest\b|\bpoor\b/i.test(a))
  )
}

/** True when the answer used best/score framing for a workload question. */
export function looksLikeBestForOverloadAnswer(question: string, answer: string): boolean {
  if (!isVendorOverloadQuestion(question)) return false
  const a = answer.trim()
  return (
    /\bbest\s+vendor\b/i.test(a) ||
    /\boverall\s+vendor\s+score\b/i.test(a) ||
    /\bscore\s+\*\*\d/i.test(a) ||
    /\bTop\s+vendors\b/i.test(a) ||
    /\brainked?\s+by\s+overall\b/i.test(a) ||
    (/\bcompletion\b/i.test(a) && /\bresident\s+rating\b/i.test(a) && !/\bopen\b|\bworkload\b|\boverload/i.test(a))
  )
}

export function evaluateMetricMatchQc(input: {
  question: string
  answer: string
  packetSatisfied?: boolean
}): {
  status: "pass" | "fail" | "warn" | "skip"
  summary: string
  metric: AskUloVendorMetric
} {
  const metric = detectVendorMetric(input.question)
  if (metric === "unspecified" && !isAnyVendorMetricQuestion(input.question)) {
    return {
      status: "skip",
      summary: "No strong vendor-metric constraint.",
      metric,
    }
  }

  // Property priority answers are never valid for vendor metrics.
  if (
    isAnyVendorMetricQuestion(input.question) &&
    /\b(needs?\s+your\s+attention\s+first|why\s+it\s+ranks\s+first|top\s+priority)\b/i.test(
      input.answer,
    )
  ) {
    return {
      status: "fail",
      summary: "Vendor metric question answered with property priority.",
      metric,
    }
  }

  // Portfolio briefing is never valid for vendor inactivity (or any vendor metric).
  if (
    isAnyVendorMetricQuestion(input.question) &&
    looksLikePortfolioBriefingAnswer(input.answer)
  ) {
    return {
      status: "fail",
      summary: "Vendor metric question answered with portfolio briefing.",
      metric,
    }
  }

  if (looksLikeBestForOverloadAnswer(input.question, input.answer)) {
    return {
      status: "fail",
      summary:
        "Question asked which vendors are overloaded/busy but answer used best/score ranking.",
      metric,
    }
  }

  if (looksLikeBestForResponseSpeedAnswer(input.question, input.answer)) {
    return {
      status: "fail",
      summary:
        "Question asked about response time but answer used overall best/score ranking.",
      metric,
    }
  }

  if (input.packetSatisfied) {
    return {
      status: "pass",
      summary: `Vendor metric packet available (${metric}).`,
      metric,
    }
  }

  if (looksLikeResponseSpeedForBestAnswer(input.question, input.answer)) {
    return {
      status: "fail",
      summary:
        "Question asked for best/overall quality but answer used response-speed framing.",
      metric,
    }
  }

  return {
    status: "pass",
    summary: `Answer metric aligns with ${metric}.`,
    metric,
  }
}
