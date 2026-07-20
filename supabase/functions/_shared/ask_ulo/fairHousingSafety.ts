/**
 * Fair Housing / AI screening safety for Ask Ulo.
 *
 * Ulo never recommends approve/deny based on protected characteristics or proxies.
 * It may explain lawful, documented screening criteria and point landlords to
 * company policy + counsel — it does not make the screening decision.
 */

export type FairHousingFlagId =
  | "protected_characteristic_decision"
  | "proxy_discrimination"
  | "invented_denial_reason"
  | "approve_deny_decision_request"

export type FairHousingFlag = {
  id: FairHousingFlagId
  label: string
}

export type FairHousingSafety = {
  /** Hard stop: discriminatory / proxy / cover-story request. */
  blocked: boolean
  /** Soft: refuse to pick approve/deny; still allow rule explanation via RAG. */
  refuseDecision: boolean
  flags: FairHousingFlag[]
  protectedTraitsMentioned: string[]
  proxiesMentioned: string[]
}

/** Federal FHA protected classes (orientation — state/local may add more). */
const PROTECTED_TRAITS: Array<{ id: string; label: string; re: RegExp }> = [
  { id: "race", label: "race / color", re: /\b(race|racial|racist|black|white|asian|hispanic|latino|latina|latinx|african[\s-]?american|people\s+of\s+color|poc\b|skin\s+color|ethnicity)\b/i },
  { id: "religion", label: "religion", re: /\b(religion|religious|muslim|jewish|christian|hindu|sikh|atheist|church|mosque|synagogue)\b/i },
  { id: "national_origin", label: "national origin", re: /\b(national\s+origin|immigrant|immigration|foreign[\s-]?born|accent|from\s+(?:mexico|china|india|africa|europe)|non[\s-]?citizen|citizenship\s+status)\b/i },
  { id: "sex", label: "sex / gender", re: /\b(sex\s+discriminat|gender|pregnant|pregnancy|lgbtq|transgender|non[\s-]?binary|sexual\s+orientation)\b/i },
  { id: "disability", label: "disability", re: /\b(disabled|disability|disabilities|wheelchair|mental\s+illness|ada\b|service\s+animal|emotional\s+support|esa\b)\b/i },
  { id: "familial_status", label: "familial status", re: /\b(kids|children|child|pregnant|pregnancy|familial\s+status|family[\s-]?friendly|no\s+kids|no\s+children|single\s+parent|families\s+with\s+kids)\b/i },
]

/**
 * Common proxies that can stand in for protected classes — treat like
 * protected-characteristic decisions when used as screening grounds.
 */
const PROXY_PATTERNS: Array<{ id: string; label: string; re: RegExp }> = [
  { id: "zip_code", label: "ZIP / neighborhood as a stand-in for people", re: /\b((?:zip|postal)\s*code|screen\s+(?:by|on)\s+(?:zip|neighborhood|area)|(?:reject|deny|avoid).{0,40}(?:zip|neighborhood|side\s+of\s+town)|(?:only|prefer).{0,30}(?:certain|specific)\s+(?:zip|neighborhood)s?)\b/i },
  { id: "name_accent", label: "name / accent / language as a stand-in", re: /\b((?:reject|deny|screen|avoid).{0,40}(?:name|accent|english)|(?:foreign|ethnic)\s+sounding\s+name|prefer\s+(?:english[\s-]?speaking|native\s+english))\b/i },
  { id: "family_stereotype", label: "family / kids stereotypes as a stand-in", re: /\b((?:too\s+many|lots\s+of)\s+(?:kids|children)|(?:no|avoid)\s+(?:kids|children|families)|family[\s-]?friendly\s+(?:only|building)|single[\s-]?family\s+only\s+tenants)\b/i },
  { id: "source_of_income_proxy", label: "blanket source-of-income exclusion (check local law)", re: /\b((?:no|reject|deny|refuse).{0,40}(?:section\s*8|housing\s+choice|voucher|ssi|disability\s+income)|(?:don'?t|do\s+not)\s+(?:take|accept)\s+(?:section\s*8|vouchers?))\b/i },
]

const DECISION_REQUEST_RE =
  /\b((?:should|shall|can|could|would)\s+i\s+(?:just\s+)?(?:reject|deny|decline|approve|accept)|(?:please\s+)?(?:reject|deny|decline|approve|accept)\s+(?:this|the|that|them|him|her)|(?:go\s+ahead\s+and\s+)?(?:reject|deny|approve)|(?:make|give)\s+(?:me\s+)?(?:a\s+)?(?:decision|recommendation)\s+(?:on|about|for)\s+(?:this\s+)?(?:applicant|application)|(?:is\s+it\s+ok\s+to|okay\s+to)\s+(?:reject|deny|refuse)|(?:turn\s+(?:them|him|her|this)\s+down)|(?:tell\s+me\s+(?:to|whether\s+to)\s+(?:reject|deny|approve))|which\s+(?:\w+\s+){0,3}(?:should|do)\s+i\s+approve)\b/i

/** Real tenant-screening context — not maintenance “approve this repair”. */
const SCREENING_CONTEXT_RE =
  /\b(applicant|application|tenant\s*screen|screening|background\s*check|credit\s*check|lease\s+(?:them|him|her)|rent\s+(?:to|them)|adverse\s*action)\b/i

/** Ops / maintenance cues that mean “approve” is about work, not applicants. */
const MAINTENANCE_OPS_CONTEXT_RE =
  /\b(repair|repairs|maintenance|work\s*orders?|tickets?|vendor|plumbing|hvac|electrical|invoice|estimate|emergenc(?:y|ies)|sla|overdue)\b/i

const INVENTED_REASON_RE =
  /\b((?:invent|make\s+up|fabricate|fake|cover[\s-]?story|pretextual|pretext)\s+(?:a\s+)?(?:reason|excuse|denial)|(?:denial|reject(?:ion)?)\s+reason\s+(?:that\s+)?(?:sounds|looks)\s+(?:legit|lawful|legal)|(?:what\s+(?:excuse|reason)\s+(?:can|should)\s+i\s+(?:use|give))\s+(?:to\s+)?(?:reject|deny)|(?:hide|conceal)\s+(?:the\s+)?(?:real|true)\s+reason)\b/i

const BECAUSE_PROTECTED_RE =
  /\b((?:because|since|due\s+to|on\s+account\s+of|for\s+being|they(?:'re|are)|applicant\s+is).{0,80})\b/i

/** Lawful criteria Ulo may discuss (not an exhaustive legal list). */
export const LAWFUL_SCREENING_CRITERIA_EXAMPLES = [
  "documented income / rent-to-income ratios applied consistently",
  "credit history when used uniformly and disclosed where required",
  "verifiable rental / housing history",
  "criminal-history screens only as allowed by federal, state, and local rules",
  "identity / occupancy verification required of all applicants",
  "written company screening criteria applied the same way to everyone",
] as const

const HUD_FHEO_URL =
  "https://www.hud.gov/program_offices/fair_housing_equal_opp"
const HUD_AI_SCREENING_NOTE =
  "HUD and DOJ have warned that AI or automated screening can still violate the Fair Housing Act when it uses protected traits or proxies, or produces unjustified disparate impact — human judgment and written, lawful criteria remain required."

function findMatches(
  corpus: string,
  items: Array<{ id: string; label: string; re: RegExp }>,
): string[] {
  const out: string[] = []
  for (const item of items) {
    if (item.re.test(corpus)) out.push(item.label)
  }
  return out
}

export function detectFairHousingSafety(text: string): FairHousingSafety {
  const corpus = text.trim()
  if (!corpus) {
    return {
      blocked: false,
      refuseDecision: false,
      flags: [],
      protectedTraitsMentioned: [],
      proxiesMentioned: [],
    }
  }

  const protectedTraitsMentioned = findMatches(corpus, PROTECTED_TRAITS)
  const proxiesMentioned = findMatches(corpus, PROXY_PATTERNS)
  const decisionRequest = DECISION_REQUEST_RE.test(corpus)
  const screeningContext = SCREENING_CONTEXT_RE.test(corpus)
  const maintenanceOpsContext = MAINTENANCE_OPS_CONTEXT_RE.test(corpus)
  const inventedReason = INVENTED_REASON_RE.test(corpus)
  const becauseHook = BECAUSE_PROTECTED_RE.test(corpus)

  const flags: FairHousingFlag[] = []

  const protectedAsGrounds =
    protectedTraitsMentioned.length > 0 &&
    (decisionRequest ||
      inventedReason ||
      (screeningContext && becauseHook) ||
      /\b(reject|deny|refuse|don'?t\s+rent|do\s+not\s+rent|turn\s+down|screen\s+out)\b/i.test(
        corpus,
      ))

  if (protectedAsGrounds) {
    flags.push({
      id: "protected_characteristic_decision",
      label: "Approve/deny tied to a protected characteristic",
    })
  }

  if (proxiesMentioned.length > 0 && (decisionRequest || screeningContext)) {
    flags.push({
      id: "proxy_discrimination",
      label: "Screening via a proxy that can stand in for a protected class",
    })
  }

  if (inventedReason) {
    flags.push({
      id: "invented_denial_reason",
      label: "Request to invent or disguise a denial reason",
    })
  }

  // Soft refuse approve/deny only for real tenant-screening asks — never for
  // maintenance (“which repairs should I approve”).
  if (
    decisionRequest &&
    screeningContext &&
    !maintenanceOpsContext &&
    !protectedAsGrounds &&
    proxiesMentioned.length === 0
  ) {
    flags.push({
      id: "approve_deny_decision_request",
      label: "Request for an approve/deny screening decision",
    })
  }

  const blocked = flags.some(
    (f) =>
      f.id === "protected_characteristic_decision" ||
      f.id === "proxy_discrimination" ||
      f.id === "invented_denial_reason",
  )
  const refuseDecision =
    blocked ||
    flags.some((f) => f.id === "approve_deny_decision_request")

  return {
    blocked,
    refuseDecision,
    flags,
    protectedTraitsMentioned,
    proxiesMentioned,
  }
}

export function formatFairHousingBlockMarkdown(safety: FairHousingSafety): string {
  const traitLine =
    safety.protectedTraitsMentioned.length > 0
      ? `- Traits / topics raised: **${safety.protectedTraitsMentioned.join("; ")}**.`
      : null
  const proxyLine =
    safety.proxiesMentioned.length > 0
      ? `- Proxy signals raised: **${safety.proxiesMentioned.join("; ")}**.`
      : null

  const criteria = LAWFUL_SCREENING_CRITERIA_EXAMPLES.map((c) => `- ${c}`).join("\n")

  return [
    "## I won’t recommend that screening decision",
    "I will **not** recommend approving or denying anyone based on a protected characteristic, a proxy for one, or a made-up denial reason. That can violate the Fair Housing Act and create serious liability.",
    "",
    "## Why this is blocked",
    ...(traitLine ? [traitLine] : []),
    ...(proxyLine ? [proxyLine] : []),
    `- ${HUD_AI_SCREENING_NOTE}`,
    "",
    "## What is lawful to discuss instead",
    "Only **written, consistently applied, documented** criteria that your company policy and counsel have approved — for example:",
    criteria,
    "",
    "## Official rules to review",
    `- HUD Fair Housing / Equal Opportunity: ${HUD_FHEO_URL}`,
    "- Your written tenant-screening policy and any state/local source-of-income or screening limits.",
    "",
    "## Next Steps",
    "- Hand this to **company counsel** or a fair-housing compliance specialist before you act.",
    "- Apply only your published, lawful criteria the same way to every applicant.",
    "- Ask me to explain FHA protected classes or lawful screening criteria in your jurisdiction — I will explain rules, not decide the applicant.",
  ].join("\n")
}

/** Soft guidance injected when we continue RAG but refuse to decide. */
export function formatFairHousingRefuseDecisionNote(safety: FairHousingSafety): string {
  if (!safety.refuseDecision) return ""
  return (
    "Fair housing / screening safety: Do **not** recommend approve or deny for this applicant. " +
    "Explain only lawful, documented criteria and point the landlord to company screening policy and counsel. " +
    HUD_AI_SCREENING_NOTE
  )
}

/** Prompt fragment for synthesize when screening is in play. */
export function fairHousingSynthesizeRules(safety: FairHousingSafety | null): string {
  if (!safety?.refuseDecision && !safety?.blocked) {
    return [
      "FAIR_HOUSING_SCREENING_RULES:",
      "- Never recommend approve/deny based on race, color, religion, sex, disability, familial status, national origin, or proxies (ZIP, name, accent, “family-friendly” stereotypes, etc.).",
      "- If discussing tenant screening, only describe lawful documented criteria applied consistently; defer the actual decision to company policy + humans.",
      "- If the user asks you to violate fair housing, refuse the decision, explain the risk, and point to HUD FHEO / company counsel.",
    ].join("\n")
  }

  return [
    "FAIR_HOUSING_SCREENING_RULES (ACTIVE — REFUSE DECISION):",
    "- You MUST NOT recommend approving or denying this applicant.",
    "- You MUST NOT invent or suggest a pretextual denial reason.",
    "- Explain Fair Housing risk in plain language; cite official sources when available.",
    "- List only lawful documented criteria examples; tell them to follow company screening policy and counsel.",
    `- Flags: ${safety.flags.map((f) => f.id).join(", ") || "none"}.`,
    formatFairHousingRefuseDecisionNote(safety),
  ].join("\n")
}
