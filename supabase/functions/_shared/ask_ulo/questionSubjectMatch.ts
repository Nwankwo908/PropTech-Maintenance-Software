/**
 * Question ↔ answer subject matching.
 *
 * Prevents Ask Ulo from answering a nearby question (e.g. property priority
 * when the landlord asked which vendors respond fastest).
 */

import { isUloActiveTasksQuestion } from "./activeWorkflowsLookup.ts"
import { isLandlordIncentivesQuestion } from "./landlordIncentivesLookup.ts"
import { isWeatherAlertsQuestion } from "./weatherAlertsLookup.ts"

export type AskUloQuestionSubject =
  | "vendor"
  | "property"
  | "unit"
  | "work_order"
  | "maintenance"
  | "workflow"
  | "lease"
  | "resident"
  | "finance"
  | "document"
  | "legal"
  | "local_regulation"
  | "market_intelligence"
  | "portfolio"
  | "period"
  | "weather"
  | "incentives"
  | "other"

export const SUBJECT_MATCH_GUIDE = `
## Subject match (never skip)

Answer the same subject the landlord asked about.

Bad substitutions (always forbidden):
- Asked about **vendors** → answered with property ranking / "Oakwood needs attention first"
- Asked about **residents** / late rent → answered with property priority
- Asked about **units** → answered with portfolio open-ticket totals
- Asked about **work orders** / repairs to approve → answered with a property health briefing
- Asked about **leases / renewals** → answered with maintenance KPIs

Before sending:
1. What subject did they ask about? (vendor / property / unit / work order / resident / …)
2. Does my answer's lead entity match that subject?
3. Did I answer their **metric** (fastest ≠ best; oldest ≠ most)?

Bad metric substitutions (always forbidden):
- Asked **best electrician** → answered with response-speed / “timed vendor responses”
- Asked **respond fastest** → answered with overall “best” without saying speed
- Asked about **vendors** (any vendor list/activity) → answered with portfolio briefing / health score

**Hard rule:** if the question subject is vendors, residents, work orders, or finance,
never ship a property-priority or portfolio-briefing packet as the answer.
`.trim()

const VENDOR_SUBJECT_RE =
  /\b(vendors?|trades?people|contractors?|plumbers?|electricians?|hvac\s+tech)\b/i
const PROPERTY_SUBJECT_RE =
  /\b(propert(?:y|ies)|buildings?|communities|complexes|apartments?\s+buildings?)\b/i
const UNIT_SUBJECT_RE = /\b(units?|apartments?|suites?)\b/i
const WORK_ORDER_SUBJECT_RE =
  /\b(work\s*orders?|tickets?|repairs?|maintenance\s+requests?)\b/i
const MAINTENANCE_SUBJECT_RE =
  /\b(maintenance|emergenc(?:y|ies)|hvac|plumb(?:ing|er)|electrical|appliance)\b/i
const WORKFLOW_SUBJECT_RE =
  /\b(workflows?|pipeline|awaiting\s+decision|sla|escalat|decisions?\s+waiting|waiting\s+on\s+me|active\s+tasks?|ulo\s+(?:is\s+)?(?:handling|running|working\s+on|doing)|what\s+tasks?\s+(?:is|are)\s+ulo)\b/i
const LEASE_SUBJECT_RE =
  /\b(leases?|renewals?|lease\s+terms?|rent\s+(?:roll|increase)|moved?\s+in|move[\s-]?ins?|moving\s+in)\b/i
const RESIDENT_SUBJECT_RE = /\b(residents?|tenants?|occupants?)\b/i
const LATE_RENT_RE =
  /\b(late\s+(?:paying|on\s+rent|with\s+rent)|past[\s-]?due|arrears|delinquen|balance\s+due|owes?\s+rent|rent\s+(?:late|owed|outstanding))\b/i
/** Move-in / occupancy questions — never portfolio briefing. */
const MOVE_IN_QUESTION_RE =
  /\b(who\s+moved\s+in|moved\s+in\s+this\s+(?:month|week)|move[\s-]?ins?\s+(?:this|last)|new\s+(?:residents?|tenants?|occupants?)|recent\s+move[\s-]?ins?)\b/i
/** Tenants who haven't replied to SMS / outreach — not late rent. */
const MESSAGE_NONRESPONSE_RE =
  /\b((?:haven'?t|have\s+not|didn'?t|not)\s+respond(?:ed|ing)?\s+to\s+(?:(?:my|our|the)\s+)?(?:messages?|texts?|sms|outreach)|(?:no|without)\s+(?:reply|response)\s+to\s+(?:(?:my|our|the)\s+)?(?:messages?|texts?|sms)|(?:unanswered|unreplied)\s+(?:messages?|texts?|sms))\b/i
const FINANCE_SUBJECT_RE =
  /\b(invoices?|estimates?|quotes?|repair\s+cost|spent|spend(?:ing)?|costs?|costing|expenses?|budget|revenue|noi\b|cap\s*rate|maintenance\s+(?:spend|cost|expense)|losing\s+money|costing\s+(?:me\s+)?money)\b/i
const DOCUMENT_SUBJECT_RE =
  /\b(documents?|attachments?|cois?|certificates?\s+of\s+insurance|w-?9|passport|inspection\s+report|insurance(?:\s+polic(?:y|ies))?|polic(?:y|ies)\s+expir|this\s+(?:insurance\s+)?(?:lease|invoice|contract|policy))\b/i
const LEGAL_SUBJECT_RE =
  /\b(fair\s+housing|eviction|habitability|security\s+deposit|landlord[\s-]tenant|legal|attorney|counsel|enter(?:ing)?\s+(?:this\s+)?(?:rental\s+)?(?:unit|property)|without\s+notice|mold|smoke\s+detectors?|compl(?:y|iance)\s+with|(?:georgia|state)\s+law)\b/i
const VACANT_UNIT_RE =
  /\b(which\s+units?\s+are\s+vacant|vacant\s+units?|vacancies|which\s+units?\s+(?:are\s+)?empty)\b/i
const LEASE_ENDING_RE =
  /\b(leases?\s+ending|lease\s+(?:renewals?|expir)|ending\s+in\s+the\s+next|need(?:s|ing)?\s+renewal)\b/i
const LOCAL_REG_SUBJECT_RE =
  /\b(ordinance|local\s+(?:code|law|regulation)|municode|building\s+code|rent[\s-]?control)\b/i
/** Market rent / comps / neighborhood — never portfolio briefing. */
const MARKET_SUBJECT_RE =
  /\b(market\s+(?:rent|analysis|comps?)|comparable\s+rentals?|neighborhood|zestimate|avm|fair\s+market\s+rent|\bfmr\b|(?:average|avg\.?|typical)\s+(?:market\s+)?rent|rent\s+(?:nearby|estimate|comps?)|(?:\d+|two|three|one)[-\s]?bed(?:room)?s?\s+(?:nearby|rent|market|around)|what(?:'s|\s+is)\s+(?:the\s+)?(?:average\s+|avg\.?\s+)?(?:market\s+)?rent)\b/i
const PERIOD_SUBJECT_RE =
  /\b(this\s+week|this\s+month|last\s+week|last\s+month|yesterday|today|period)\b/i

/** “What's the average rent for a two-bedroom nearby?” */
export function isMarketRentEstimateQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (LATE_RENT_RE.test(q) && /\b(who|which|consistently|always|repeatedly|list)\b/i.test(q)) {
    return false
  }
  if (/\brent\s+(?:roll|increase|control)\b/i.test(q) && !/\b(average|avg\.?|market|nearby|bedroom|comp)\b/i.test(q)) {
    return false
  }
  return (
    /(?:average|avg\.?|typical|fair\s+market)\s+rent/i.test(q) ||
    /what(?:'s|\s+is)\s+(?:the\s+)?(?:average\s+|avg\.?\s+|typical\s+)?(?:market\s+)?rent\b/i.test(q) ||
    /rent\s+for\s+(?:a\s+)?(?:\d+|two|three|one|studio)/i.test(q) ||
    /(?:\d+|two|three|one)[-\s]?bed(?:room)?s?\s+(?:at|rent|market|nearby|around|in\s+the\s+(?:area|neighborhood))/i.test(
      q,
    ) ||
    /\b(what\s+could\s+i\s+charge|how\s+much\s+should\s+i\s+charge|going\s+rate\s+for|rent\s+estimate|market\s+rent\s+for)\b/i
      .test(q) ||
    (/\brent\b/i.test(q) && /\bnearby\b/i.test(q) && !/\b(late|owes?|arrears|past[\s-]?due)\b/i.test(q))
  )
}

export function isMarketIntelligenceQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (isMarketRentEstimateQuestion(q)) return true
  return MARKET_SUBJECT_RE.test(q)
}

export function isMoveInQuestion(question: string): boolean {
  return MOVE_IN_QUESTION_RE.test(question.trim())
}

export { isUloActiveTasksQuestion } from "./activeWorkflowsLookup.ts"

/** Work orders stuck waiting on vendors — not a vendor ranking question. */
export function isWorkOrderVendorWaitQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  return (
    /\b(?:work\s*orders?|tickets?|repairs?|requests?|jobs?)\b.{0,48}\b(?:stuck\s+)?waiting\s+for\s+vendors?\b/i
      .test(q) ||
    /\bwaiting\s+for\s+vendors?\b.{0,40}\b(?:work\s*orders?|tickets?|repairs?|jobs?|approval)\b/i
      .test(q) ||
    /\b(?:maintenance\s+)?jobs?\s+waiting\s+for\s+vendor\s+approval\b/i.test(q)
  )
}

/** Predictive / external / admin asks that must never fall back to portfolio briefing. */
export function isHonestGapSubjectQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  // Weather / landlord incentives have dedicated tools — not honest gaps.
  if (isWeatherAlertsQuestion(q)) return false
  if (isLandlordIncentivesQuestion(q)) return false
  return (
    /\b(forecast\s+(?:occupancy|maintenance)|predict(?:\s+next)?|might\s+not\s+renew|before\s+winter)\b/i
      .test(q) ||
    /\bmost\s+likely\s+to\s+need\b/i.test(q) ||
    /\b(draft|write|create|send)\b.{0,40}\b(message|email|notice|checklist|reminder)\b/i.test(q) ||
    /\b(what\s+can\s+i\s+automate|occupancy\s+trends?|happiest\s+residents?)\b/i.test(q) ||
    /\b(insurance\s+polic(?:y|ies)|polic(?:y|ies)\s+expir|when\s+does\s+this\s+insurance)\b/i.test(q)
  )
}

export { isWeatherAlertsQuestion } from "./weatherAlertsLookup.ts"
export { isLandlordIncentivesQuestion } from "./landlordIncentivesLookup.ts"

export function isLeaseEndingQuestion(question: string): boolean {
  return LEASE_ENDING_RE.test(question.trim())
}

export function isVacantUnitQuestion(question: string): boolean {
  return VACANT_UNIT_RE.test(question.trim())
}

export function isMessageNonresponseQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (MESSAGE_NONRESPONSE_RE.test(q)) return true
  // "Which tenants haven't responded to messages?"
  return (
    RESIDENT_SUBJECT_RE.test(q) &&
    /\b(haven'?t|have\s+not|didn'?t|not)\s+respond/i.test(q) &&
    /\b(messages?|texts?|sms|outreach)\b/i.test(q)
  )
}

/**
 * Broad vendor ranking language (best / which vendors / performance).
 * Does NOT imply response speed — use isVendorResponseSpeedQuestion for that.
 */
export function isVendorRankingQuestion(question: string): boolean {
  const q = question.trim()
  if (!q || !VENDOR_SUBJECT_RE.test(q)) return false
  if (isVendorResponseSpeedQuestion(q)) return false
  return (
    /\b(performance|score|best|worst|rank|top|favorite|favourite|which\s+vendors?|compar(?:e|ing|ison))\b/i.test(q) ||
    /^\s*which\s+vendors?\b/i.test(q) ||
    /\bwho\s+(?:is|are)\s+my\s+best\b/i.test(q)
  )
}

/** “Which vendors have poor / slow response times?” — slowest framing. */
export function isVendorPoorResponseSpeedQuestion(question: string): boolean {
  const q = question.trim()
  if (!q || !VENDOR_SUBJECT_RE.test(q)) return false
  return (
    /\b(?:poor|bad|weak|worst|lagging|delayed)\b.{0,40}\b(?:response|respond)\b/i.test(q) ||
    /\b(?:response|respond(?:s|ing)?)\b.{0,24}\b(?:poor|bad|weak|worst|slow|slowest|lag)\b/i.test(q) ||
    /\bslowest\b.{0,30}\b(?:vendors?|respond|response)\b/i.test(q) ||
    /\b(?:vendors?|contractors?)\b.{0,40}\b(?:respond|response)\b.{0,20}\b(?:slow|slowest|poorly)\b/i.test(
      q,
    ) ||
    /\bslow(?:est)?\s+(?:to\s+)?respond\b/i.test(q)
  )
}

export function isVendorResponseSpeedQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (isVendorPoorResponseSpeedQuestion(q)) return true
  // Portfolio ops metric without naming vendors still routes vendor.
  if (/\b(?:average|avg\.?|mean)\s+response\s+times?\b/i.test(q)) return true
  return (
    /\bvendors?\b.{0,40}\b(?:respond(?:s|ing)?|response)\b.{0,20}\b(?:fastest|quickest|slowest|time|times)\b/i
      .test(q) ||
    /\b(?:fastest|quickest|slowest)\b.{0,30}\bvendors?\b/i.test(q) ||
    /\bwhich\s+vendors?\s+respond\b/i.test(q) ||
    /\bvendor\s+response\s+(?:time|times|speed|rate)\b/i.test(q) ||
    (/\bresponse\s+times?\b/i.test(q) && VENDOR_SUBJECT_RE.test(q))
  )
}

/** Vendors that haven't accepted / inactive / no recent accepts. */
export function isVendorInactivityQuestion(question: string): boolean {
  const q = question.trim()
  if (!q || !VENDOR_SUBJECT_RE.test(q)) return false
  // Verification/compliance status is a different subject (Pending chip ≠ unaccepted jobs).
  if (
    /\bverif(?:y|ies|ied|ication|ying)\b/i.test(q) ||
    /\bcompliance\b/i.test(q)
  ) {
    return false
  }
  return (
    /\bhaven'?t\s+accepted\b/i.test(q) ||
    /\bhave\s+not\s+accepted\b/i.test(q) ||
    /\bnot\s+accepted?\s+(?:jobs?|work|assignments?)?\b/i.test(q) ||
    /\bno\s+recent\s+(?:accept|acceptance|accepts|jobs?)\b/i.test(q) ||
    /\binactive\s+vendors?\b/i.test(q) ||
    /\bvendors?\s+(?:that|who)\s+(?:haven'?t|have\s+not|never|aren'?t|are\s+not)\b/i.test(q) ||
    /\bvendors?\s+that\s+haven'?t\b/i.test(q) ||
    /\bslow\s+to\s+accept\b/i.test(q) ||
    /\bstale\s+vendors?\b/i.test(q) ||
    /\bshow\s+vendors?\b.*\b(?:accept|recent|inactive)\b/i.test(q)
  )
}

/**
 * Vendors carrying too much open work (“overloaded”, “busiest”, “at capacity”).
 * Not quality/best, not inactive — open-job workload.
 */
export function isVendorOverloadQuestion(question: string): boolean {
  const q = question.trim()
  if (!q || !VENDOR_SUBJECT_RE.test(q)) return false
  if (isVendorInactivityQuestion(q) || isVendorResponseSpeedQuestion(q)) return false
  return (
    /\boverload(?:ed|ing)?\b/i.test(q) ||
    /\bat\s+capacity\b/i.test(q) ||
    /\bovercapacity\b/i.test(q) ||
    /\bbusiest\b/i.test(q) ||
    /\btoo\s+many\s+(?:open\s+)?(?:jobs?|work\s*orders?|tickets?|assignments?)\b/i.test(q) ||
    /\bmost\s+(?:open\s+)?(?:jobs?|work|tickets?|load|workload)\b/i.test(q) ||
    /\b(?:high|heavy|highest)\s+(?:workload|caseload|load)\b/i.test(q) ||
    /\bworkload\b/i.test(q) ||
    /\bbusy\s+vendors?\b/i.test(q) ||
    /\bvendors?\s+(?:that|who)\s+are\s+(?:overloaded|too\s+busy|at\s+capacity)\b/i.test(q) ||
    /\bwhich\s+vendors?\s+are\s+(?:overloaded|too\s+busy|busiest)\b/i.test(q) ||
    /\bbacklog(?:ged)?\b.{0,24}\bvendors?\b/i.test(q) ||
    /\bvendors?\b.{0,24}\bbacklog(?:ged)?\b/i.test(q)
  )
}

/**
 * Broad vendor-focused question — any list / activity / ranking about vendors.
 * Used as a hard lock against portfolio briefing + property priority.
 */
export function isVendorFocusedQuestion(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (detectQuestionSubject(q) !== "vendor") return false
  return (
    isVendorInactivityQuestion(q) ||
    isVendorOverloadQuestion(q) ||
    isVendorResponseSpeedQuestion(q) ||
    isVendorRankingQuestion(q) ||
    /\bverif(?:y|ies|ied|ication|ying)\b/i.test(q) ||
    /\bcompliance\b/i.test(q) ||
    /\b(recommend|suggest|find|show)\b.{0,24}\b(?:another|different|alternative|other)\b/i.test(q) ||
    /\b(show|list|which|who|find|rank|compare)\b.{0,40}\bvendors?\b/i.test(q) ||
    /\bvendors?\b.{0,40}\b(accept|response|completion|score|best|worst|fastest|inactive|recent|overload|workload|busy|verif|compliance|pending)\b/i
      .test(q)
  )
}

/**
 * Primary subject of the question (what entity must appear in the answer).
 */
export function detectQuestionSubject(question: string): AskUloQuestionSubject {
  const q = question.trim()
  if (!q) return "other"

  // What Ulo is handling / active engine tasks — never portfolio briefing.
  if (isUloActiveTasksQuestion(q)) return "workflow"

  // Weather alerts — NWS tool path; never portfolio briefing.
  if (isWeatherAlertsQuestion(q)) return "weather"

  // Landlord grants / tax incentives — curated official catalog; never portfolio briefing.
  if (isLandlordIncentivesQuestion(q)) return "incentives"

  // Work-order vendor waits before bare "vendor" steals the subject.
  if (isWorkOrderVendorWaitQuestion(q) || /\bmissing\s+updates?\b/i.test(q)) {
    return "work_order"
  }

  // Vendor metrics / lists — never confuse with property language.
  if (
    isVendorResponseSpeedQuestion(q) ||
    isVendorOverloadQuestion(q) ||
    isVendorInactivityQuestion(q) ||
    isVendorRankingQuestion(q) ||
    /\bverif(?:y|ies|ied|ication|ying)\b/i.test(q) ||
    /\bvendor\s+compliance\b/i.test(q) ||
    (VENDOR_SUBJECT_RE.test(q) && !isWorkOrderVendorWaitQuestion(q))
  ) {
    return "vendor"
  }

  // Move-in / new occupants — resident subject (never portfolio briefing).
  if (MOVE_IN_QUESTION_RE.test(q)) {
    return "resident"
  }

  // Market rent / comps before lease/finance “rent” language and ops briefing.
  if (isMarketIntelligenceQuestion(q)) {
    return "market_intelligence"
  }

  // Vacancy before generic unit ranking.
  if (VACANT_UNIT_RE.test(q)) {
    return "unit"
  }

  // Lease ending / renewal roll.
  if (LEASE_ENDING_RE.test(q) && !WORK_ORDER_SUBJECT_RE.test(q)) {
    return "lease"
  }

  // Finance spend / NOI / cost — before maintenance/property so cost questions stay finance.
  if (
    FINANCE_SUBJECT_RE.test(q) &&
    (WORK_ORDER_SUBJECT_RE.test(q) ||
      MAINTENANCE_SUBJECT_RE.test(q) ||
      /\b(cost|costs|costing|spend|spent|spending|expense|noi|budget|revenue|losing\s+money|category|this\s+(?:month|year)|estimate|forecast)\b/i
        .test(q) ||
      /\bcosts?\s+the\s+most\b/i.test(q) ||
      /\bcosting\s+(?:me\s+)?money\b/i.test(q) ||
      /\bto\s+maintain\b/i.test(q))
  ) {
    return "finance"
  }

  // Maintenance issue about a tenant's unit ("my tenant has a leak") — not resident list.
  if (
    MAINTENANCE_SUBJECT_RE.test(q) &&
    /\b(leak|broken|clogged|furnace|repair|trends?|emergenc|expensive|ignored)\b/i.test(q) &&
    !/\b(cost|costs|spend|spent|estimate|expense)\b/i.test(q) &&
    !/\bwhich\s+(?:residents?|tenants?)\b/i.test(q) &&
    !UNIT_SUBJECT_RE.test(q)
  ) {
    return "maintenance"
  }

  // Residents + late rent / arrears / message non-response before property patterns.
  // Require resident-as-topic cues so "my tenant has a leak" stays maintenance.
  if (
    MESSAGE_NONRESPONSE_RE.test(q) ||
    (LATE_RENT_RE.test(q) &&
      /\b(who|which|consistently|always|repeatedly|list)\b/i.test(q)) ||
    (RESIDENT_SUBJECT_RE.test(q) &&
      /\b(which|who|show|list|summarize)\b/i.test(q))
  ) {
    return "resident"
  }

  if (LOCAL_REG_SUBJECT_RE.test(q)) return "local_regulation"
  // Lease compliance / law questions before document ("this lease").
  if (
    LEGAL_SUBJECT_RE.test(q) ||
    (/\bcompl(?:y|iance)\b/i.test(q) && /\b(lease|law|legal)\b/i.test(q))
  ) {
    if (!WORK_ORDER_SUBJECT_RE.test(q)) return "legal"
  }
  if (DOCUMENT_SUBJECT_RE.test(q) && !WORK_ORDER_SUBJECT_RE.test(q)) return "document"

  if (
    LEASE_SUBJECT_RE.test(q) &&
    !WORK_ORDER_SUBJECT_RE.test(q) &&
    !MOVE_IN_QUESTION_RE.test(q)
  ) {
    return "lease"
  }
  if (PERIOD_SUBJECT_RE.test(q) && /\b(summar|happen|catch\s+me\s+up|activity)\b/i.test(q)) {
    return "period"
  }

  // Unit before property when both appear ("which units at Oakwood…")
  if (
    UNIT_SUBJECT_RE.test(q) &&
    (/\bwhich\s+units?\b/i.test(q) ||
      /\bunits?\s+with\b/i.test(q) ||
      /\bmost\s+maintenance\b/i.test(q) ||
      VACANT_UNIT_RE.test(q) ||
      /\bunit\s+\d+/i.test(q) ||
      /\bapartment\s+\d+/i.test(q))
  ) {
    return "unit"
  }

  // Approve / act-on repairs stay work_order — never "approve tenant".
  if (
    /\b(?:approve|approval)\b/i.test(q) &&
    WORK_ORDER_SUBJECT_RE.test(q) &&
    !/\b(applicant|application|screening|background\s*check)\b/i.test(q)
  ) {
    return "work_order"
  }

  if (
    WORK_ORDER_SUBJECT_RE.test(q) &&
    (/\bwhich\s+(?:work\s*orders?|tickets?|repairs?|maintenance\s+requests?)\b/i.test(q) ||
      /\b(?:show|list|find)\b.{0,48}\b(?:every|all)\b.{0,40}\brepairs?\b/i.test(q) ||
      /\bevery\b.{0,40}\brepairs?\b/i.test(q) ||
      /\b(?:roof|hvac|plumb(?:ing)?|electrical|water\s+heater)[\w-]*\s+repairs?\b/i.test(q) ||
      /\bunresolved\s+(?:issues?|repairs?|requests?)\b/i.test(q) ||
      /\bmissing\s+updates?\b/i.test(q) ||
      /\bwaiting\s+(?:the\s+)?longest\b/i.test(q) ||
      /\bstale\b/i.test(q) ||
      /\bkeep(?:s|ing)?\s+happening\b/i.test(q) ||
      /\breoccurr|recurring\b/i.test(q) ||
      /\bbecoming\s+(?:an?\s+)?emergenc/i.test(q) ||
      isWorkOrderVendorWaitQuestion(q))
  ) {
    return "work_order"
  }

  if (WORKFLOW_SUBJECT_RE.test(q)) return "workflow"
  if (
    MAINTENANCE_SUBJECT_RE.test(q) &&
    /\b(emergenc|recurring|trend|approve|expensive)\b/i.test(q)
  ) {
    return "maintenance"
  }
  // Repair-vs-replace / asset decisions — never portfolio briefing.
  if (
    /\brepair\s+or\s+replace\b/i.test(q) ||
    (/\bwater\s+heater\b/i.test(q) && /\b(repair|replace|worth)\b/i.test(q)) ||
    (WORK_ORDER_SUBJECT_RE.test(q) && /\b(replace|renovat)\b/i.test(q))
  ) {
    return "maintenance"
  }

  // Portfolio health / briefing / owned-portfolio priority language.
  if (
    /\b(portfolio\s+health|how\s+healthy|catch\s+me\s+up|what\s+did\s+i\s+miss|executive\s+brief|today'?s\s+briefing|summarize\s+(?:my\s+)?(?:entire\s+)?portfolio|regional\s+property\s+manager|owned\s+my\s+portfolio|if\s+you\s+owned|(?:my\s+)?portfolio\b|(?:everything|all)\s+(?:that\s+)?needs?\s+(?:my|your|our)\s+attention)\b/i
      .test(q)
  ) {
    return "portfolio"
  }

  // Honest-gap / external asks before bare "property/properties" keyword steal.
  if (isHonestGapSubjectQuestion(q)) return "other"

  if (PROPERTY_SUBJECT_RE.test(q)) return "property"

  return "other"
}

export function looksLikePropertyPriorityAnswer(answer: string): boolean {
  const a = answer.trim()
  if (!a) return false
  return (
    /\b(top\s+priority|needs?\s+your\s+attention\s+first|ranks?\s+first|why\s+it\s+ranks)\b/i.test(
      a,
    ) ||
    (/\b(critical\/urgent\s+work\s+orders?|oldest\s+open\s+request|waiting\s+on\s+your\s+decision)\b/i
      .test(a) &&
      /\b(apartments?|heights|ridge|manor|plaza|towers?)\b/i.test(a))
  )
}

export function looksLikeVendorSpeedAnswer(answer: string): boolean {
  const a = answer.trim()
  if (!a) return false
  return (
    /\bvendors?\b/i.test(a) &&
    /\b(response|respond|fastest|quickest|minutes?|hours?|acceptance)\b/i.test(a)
  )
}

export function looksLikePortfolioBriefingAnswer(answer: string): boolean {
  const a = answer.trim()
  if (!a) return false
  return (
    /\bportfolio\s+briefing\b/i.test(a) ||
    /\bassessment:\s*(stable|watch|at\s+risk)\b/i.test(a) ||
    /\bhealth\s+score\b/i.test(a) ||
    (/\bhealth\s+components?\b/i.test(a) && /\boccupancy\b/i.test(a)) ||
    (/\b\d+\s*\/\s*100\b/.test(a) && /\b(open\s+work\s+orders?|occupancy|escalated)\b/i.test(a))
  )
}

/**
 * Detect a hard subject mismatch (question about A, answer clearly about B).
 */
export function hasSubjectMismatch(question: string, answer: string): boolean {
  const subject = detectQuestionSubject(question)
  const a = answer.trim()
  if (!a || subject === "other") return false

  if (subject === "vendor") {
    // Portfolio briefing / property priority are never valid vendor answers —
    // even if they casually mention “vendor performance” or claim data is missing.
    if (looksLikePortfolioBriefingAnswer(a)) return true
    if (looksLikePropertyPriorityAnswer(a) && !looksLikeVendorSpeedAnswer(a)) return true
    if (!/\bvendors?\b/i.test(a) && looksLikePropertyPriorityAnswer(a)) return true
    if (
      /\b(apartments?\s+needs?|building\s+needs?|propert(?:y|ies)\s+(?:need|rank))\b/i.test(a) &&
      !/\bvendors?\b/i.test(a)
    ) {
      return true
    }
    // "Best electrician" answered only as missing response-speed timings.
    const wrongMetricGapForBest =
      /\b(best|top|favorite|favourite)\b/i.test(question) &&
      !isVendorResponseSpeedQuestion(question) &&
      /\b(timed\s+vendor\s+responses?|respond(?:s|ing)?\s+the\s+fastest|accept\s*\/\s*decline\s+timings?)\b/i
        .test(a) &&
      !/\b(vendor\s+score|overall|satisfaction|completion|rating)\b/i.test(a)
    if (wrongMetricGapForBest) {
      return true
    }
  }

  // Honest gap answers are OK when they name the same subject (after hard
  // vendor/briefing mismatches above).
  const isHonestGap =
    /\b(do not have|don't have|could not|couldn't|missing|unavailable)\b/i.test(a)
  if (isHonestGap) {
    if (subject !== "vendor" || /\bvendors?\b/i.test(a)) {
      return false
    }
  }

  if (subject === "unit") {
    if (looksLikePropertyPriorityAnswer(a) && !/\bunit\b/i.test(a)) return true
    if (/\bportfolio\b/i.test(a) && /\bopen\s+(?:maintenance|work)\b/i.test(a) && !/\bunit\b/i.test(a)) {
      return true
    }
  }

  if (subject === "workflow") {
    // Active Ulo / workflow questions must never dump portfolio health.
    if (looksLikePortfolioBriefingAnswer(a)) return true
    if (looksLikePropertyPriorityAnswer(a) && !/\b(workflow|escalat|awaiting|decision|ulo)\b/i.test(a)) {
      return true
    }
  }

  if (subject === "work_order" || subject === "maintenance") {
    if (looksLikePropertyPriorityAnswer(a) && !/\b(work\s*order|ticket|WO-|going quiet|waiting|approve|repair)\b/i.test(a)) {
      return true
    }
    if (looksLikePortfolioBriefingAnswer(a) && !/\b(work\s*order|ticket|repair)\b/i.test(a)) {
      return true
    }
  }

  if (subject === "resident" || subject === "finance") {
    if (looksLikePropertyPriorityAnswer(a)) return true
    if (looksLikePortfolioBriefingAnswer(a)) return true
    if (
      /\b(top\s+priority|ranks?\s+first|needs?\s+your\s+attention\s+first)\b/i.test(a) &&
      !/\b(resident|tenant|late|rent|arrears|balance)\b/i.test(a)
    ) {
      return true
    }
  }

  if (subject === "market_intelligence") {
    if (looksLikePortfolioBriefingAnswer(a)) return true
    if (looksLikePropertyPriorityAnswer(a)) return true
    if (
      /\b(health\s*score|open\s+work\s+orders?|occupancy)\b/i.test(a) &&
      !/\b(market|rent\s+estimate|comps?|avm|zestimate|fmr|bedroom)\b/i.test(a)
    ) {
      return true
    }
  }

  if (subject === "weather") {
    if (looksLikePortfolioBriefingAnswer(a)) return true
    if (looksLikePropertyPriorityAnswer(a)) return true
    if (
      /\b(health\s*score|open\s+work\s+orders?|occupancy)\b/i.test(a) &&
      !/\b(weather|alert|nws|storm|freeze|heat)\b/i.test(a)
    ) {
      return true
    }
  }

  if (subject === "incentives") {
    if (looksLikePortfolioBriefingAnswer(a)) return true
    if (looksLikePropertyPriorityAnswer(a)) return true
    if (
      /\b(health\s*score|open\s+work\s+orders?|occupancy)\b/i.test(a) &&
      !/\b(grant|incentive|tax\s+credit|rebate|lihtc|irs|hud)\b/i.test(a)
    ) {
      return true
    }
  }

  if (subject === "property") {
    // Vendor-only answer when they asked which property — mismatch
    if (
      looksLikeVendorSpeedAnswer(a) &&
      !/\b(propert|building|apartments?|attention\s+first)\b/i.test(a)
    ) {
      return true
    }
  }

  return false
}

export function evaluateSubjectMatchQc(input: {
  question: string
  answer: string
  /** Dedicated packet already satisfies the subject. */
  packetSatisfied?: boolean
}): {
  status: "pass" | "fail" | "warn" | "skip"
  summary: string
  subject: AskUloQuestionSubject
} {
  const subject = detectQuestionSubject(input.question)
  if (subject === "other" && !isVendorRankingQuestion(input.question)) {
    return {
      status: "skip",
      summary: "No strong subject constraint for this question.",
      subject,
    }
  }

  if (input.packetSatisfied) {
    return {
      status: "pass",
      summary: `Subject packet available for ${subject}.`,
      subject,
    }
  }

  if (hasSubjectMismatch(input.question, input.answer)) {
    return {
      status: "fail",
      summary: `Answer subject does not match the question (expected ${subject}).`,
      subject,
    }
  }

  if (
    subject === "vendor" &&
    (looksLikePortfolioBriefingAnswer(input.answer) || looksLikePropertyPriorityAnswer(input.answer))
  ) {
    return {
      status: "fail",
      summary: "Vendor question answered with portfolio/property packet.",
      subject,
    }
  }

  if (
    (subject === "resident" || subject === "finance") &&
    (looksLikePortfolioBriefingAnswer(input.answer) || looksLikePropertyPriorityAnswer(input.answer))
  ) {
    return {
      status: "fail",
      summary: `${subject} question answered with portfolio/property packet.`,
      subject,
    }
  }

  if (
    subject === "market_intelligence" &&
    (looksLikePortfolioBriefingAnswer(input.answer) || looksLikePropertyPriorityAnswer(input.answer))
  ) {
    return {
      status: "fail",
      summary: "Market rent question answered with portfolio/property packet.",
      subject,
    }
  }

  if (
    (subject === "work_order" || subject === "maintenance") &&
    looksLikePropertyPriorityAnswer(input.answer) &&
    !/\b(work\s*order|ticket|repair|approve)\b/i.test(input.answer)
  ) {
    return {
      status: "fail",
      summary: "Work-order question answered with property priority packet.",
      subject,
    }
  }

  if (
    subject === "vendor" &&
    !/\bvendors?\b/i.test(input.answer) &&
    !/\b(respond(?:s|ing)?|response|fastest|quickest|minutes?|hours?|accepted|completion)\b/i
      .test(input.answer) &&
    input.answer.trim().length > 40
  ) {
    return {
      status: "fail",
      summary: "Vendor question answered without naming vendors or vendor activity.",
      subject,
    }
  }

  return {
    status: "pass",
    summary: `Answer subject aligns with ${subject}.`,
    subject,
  }
}
