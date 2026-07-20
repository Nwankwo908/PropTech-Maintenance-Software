/**
 * Resolve jurisdiction for legal Ask Ulo answers.
 *
 * Stack: country → state → county → city → court/venue → housing program → code set.
 * Order: explicit state/city/county in question → named property → prior turns →
 * unambiguous single-state portfolio → ask for clarification.
 *
 * Never invent legal guidance without a confident location.
 */

import type { PortfolioJurisdiction } from "./portfolioContext.ts"
import {
  classifyLegalSourceTrust,
  isOfficialLegalSourceUrl as isOfficialUrlFromTrust,
  summarizeLegalSourceTiers,
} from "./legalSourceTrust.ts"
import {
  collectOfficialVerifyTargets,
  formatOfficialVerifyHint,
  type OfficialVerifyTarget,
} from "./officialSourceVerify.ts"

export type LegalJurisdictionConfidence = "high" | "medium" | "low" | "none"

export type LegalJurisdictionResolution = {
  /** ISO country; Ask Ulo legal corpus is US-only today. */
  countryCode: string
  stateCode: string | null
  countySlug: string | null
  countyLabel: string | null
  citySlug: string | null
  cityLabel: string | null
  buildingName: string | null
  /** Likely court / venue for housing disputes in this place. */
  courtSystem: string | null
  /** e.g. section_8_hcv when the question is about that program. */
  housingProgram: string | null
  /** Which building/housing code set likely applies (IPMC / local title). */
  codeSet: string | null
  confidence: LegalJurisdictionConfidence
  /** True when we must ask before answering legally. */
  needsClarification: boolean
  clarificationPrompt: string | null
  source:
    | "question_explicit"
    | "named_property"
    | "conversation"
    | "portfolio_unambiguous"
    | "unknown"
}

type PlaceMeta = {
  city: string
  state: string
  county: string
}

const DEMO_BUILDING_META: Record<string, PlaceMeta> = {
  "Oakwood Apartments": { city: "Portland", state: "OR", county: "Multnomah" },
  "Pine Ridge": { city: "Portland", state: "OR", county: "Multnomah" },
  "Cedar Court": { city: "Beaverton", state: "OR", county: "Washington" },
  "Maple Heights": { city: "Hillsboro", state: "OR", county: "Washington" },
  "Birch Tower": { city: "Portland", state: "OR", county: "Multnomah" },
  "Willow Park": { city: "Gresham", state: "OR", county: "Multnomah" },
  // Used when a portfolio sample spans states (tests + multi-market landlords).
  "Seattle Tower": { city: "Seattle", state: "WA", county: "King" },
}

const STATE_NAMES: Record<string, string> = {
  oregon: "OR",
  washington: "WA",
  california: "CA",
  texas: "TX",
  arizona: "AZ",
  nevada: "NV",
  idaho: "ID",
  colorado: "CO",
  "new york": "NY",
  florida: "FL",
}

const CITY_HINTS: Record<string, PlaceMeta> = {
  portland: { city: "Portland", state: "OR", county: "Multnomah" },
  hillsboro: { city: "Hillsboro", state: "OR", county: "Washington" },
  beaverton: { city: "Beaverton", state: "OR", county: "Washington" },
  gresham: { city: "Gresham", state: "OR", county: "Multnomah" },
  seattle: { city: "Seattle", state: "WA", county: "King" },
  bellevue: { city: "Bellevue", state: "WA", county: "King" },
}

/** County phrases — prefer "X County" over bare names that collide with states. */
const COUNTY_HINTS: Array<{ re: RegExp; county: string; state: string }> = [
  { re: /\bmultnomah\s+county\b/i, county: "Multnomah", state: "OR" },
  { re: /\bwashington\s+county\b/i, county: "Washington", state: "OR" },
  { re: /\bking\s+county\b/i, county: "King", state: "WA" },
  { re: /\bclackamas\s+county\b/i, county: "Clackamas", state: "OR" },
]

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function slugifyCity(city: string): string {
  return slugify(city)
}

function countyFromCity(
  cityLabel: string | null,
  stateCode: string | null,
): { countyLabel: string; countySlug: string } | null {
  if (!cityLabel) return null
  const hint = CITY_HINTS[slugifyCity(cityLabel)]
  if (!hint) return null
  if (stateCode && hint.state !== stateCode) return null
  return { countyLabel: hint.county, countySlug: slugify(hint.county) }
}

export function courtSystemFor(
  stateCode: string | null,
  countyLabel: string | null,
): string | null {
  if (!stateCode) return null
  if (stateCode === "OR") {
    return countyLabel
      ? `Oregon Circuit Court (${countyLabel} County)`
      : "Oregon Circuit Court"
  }
  if (stateCode === "WA") {
    return countyLabel
      ? `Washington Superior Court (${countyLabel} County)`
      : "Washington Superior Court"
  }
  if (stateCode === "CA") {
    return countyLabel
      ? `California Superior Court (${countyLabel} County)`
      : "California Superior Court"
  }
  return countyLabel
    ? `${stateCode} trial court (${countyLabel} County)`
    : `${stateCode} trial court`
}

export function housingProgramFromQuestion(question: string): string | null {
  const q = question.toLowerCase()
  if (
    /\b(section\s*8|housing\s+choice\s+voucher|\bhcv\b|voucher\s+program|pha\s+voucher)\b/.test(
      q,
    )
  ) {
    return "section_8_hcv"
  }
  return null
}

export function codeSetForQuestion(
  question: string,
  cityLabel: string | null,
): string | null {
  const q = question.toLowerCase()
  if (
    !/\b(habitabilit\w*|building\s+code|property\s+maintenance|housing\s+code|\bipmc\b|code\s+enforcement|unsafe\s+structure)\b/
      .test(q)
  ) {
    return null
  }
  const city = (cityLabel ?? "").toLowerCase()
  if (city === "portland") {
    return "Portland Title 29 / IPMC-aligned housing code"
  }
  if (city === "seattle") {
    return "Seattle Housing & Building Maintenance Code / IPMC-aligned"
  }
  return "Local property maintenance code (IPMC-aligned)"
}

function matchBuildingName(corpus: string): string | null {
  const q = corpus.toLowerCase()
  for (const name of Object.keys(DEMO_BUILDING_META)) {
    if (q.includes(name.toLowerCase())) return name
  }
  return null
}

function extractExplicitJurisdiction(text: string): {
  stateCode: string | null
  countyLabel: string | null
  countySlug: string | null
  cityLabel: string | null
  citySlug: string | null
} | null {
  const t = text.trim()
  if (!t) return null

  let stateCode: string | null = null
  const stateAbbr = t.match(/\b(?:in|for|under|per)\s+([A-Z]{2})\b/)
  if (stateAbbr) stateCode = stateAbbr[1].toUpperCase()
  if (!stateCode) {
    const bareAbbr = t.match(/\b(OR|WA|CA|TX|AZ|NV|ID|CO|NY|FL)\b/)
    if (bareAbbr) stateCode = bareAbbr[1].toUpperCase()
  }
  if (!stateCode) {
    const lower = t.toLowerCase()
    for (const [name, code] of Object.entries(STATE_NAMES)) {
      // "Washington County" (OR) must not resolve as Washington state.
      if (name === "washington" && /\bwashington\s+county\b/i.test(lower)) continue
      if (new RegExp(`\\b${name}\\b`, "i").test(lower)) {
        stateCode = code
        break
      }
    }
  }

  let countyLabel: string | null = null
  for (const hint of COUNTY_HINTS) {
    if (hint.re.test(t)) {
      countyLabel = hint.county
      if (!stateCode) stateCode = hint.state
      break
    }
  }

  let cityLabel: string | null = null
  const lower = t.toLowerCase()
  for (const [slug, meta] of Object.entries(CITY_HINTS)) {
    if (new RegExp(`\\b${slug}\\b`, "i").test(lower)) {
      cityLabel = meta.city
      if (!stateCode) stateCode = meta.state
      if (!countyLabel) countyLabel = meta.county
      break
    }
  }

  if (!countyLabel && cityLabel) {
    const fromCity = countyFromCity(cityLabel, stateCode)
    if (fromCity) countyLabel = fromCity.countyLabel
  }

  if (!stateCode && !cityLabel && !countyLabel) return null
  return {
    stateCode,
    countyLabel,
    countySlug: countyLabel ? slugify(countyLabel) : null,
    cityLabel,
    citySlug: cityLabel ? slugifyCity(cityLabel) : null,
  }
}

function withPlaceExtras(
  base: Omit<
    LegalJurisdictionResolution,
    "countryCode" | "courtSystem" | "housingProgram" | "codeSet" | "countySlug" | "countyLabel"
  > & {
    countySlug?: string | null
    countyLabel?: string | null
  },
  question: string,
): LegalJurisdictionResolution {
  let countyLabel = base.countyLabel ?? null
  let countySlug = base.countySlug ?? null
  if (!countyLabel && base.cityLabel) {
    const fromCity = countyFromCity(base.cityLabel, base.stateCode)
    if (fromCity) {
      countyLabel = fromCity.countyLabel
      countySlug = fromCity.countySlug
    }
  } else if (countyLabel && !countySlug) {
    countySlug = slugify(countyLabel)
  }

  return {
    countryCode: "US",
    stateCode: base.stateCode,
    countySlug,
    countyLabel,
    citySlug: base.citySlug,
    cityLabel: base.cityLabel,
    buildingName: base.buildingName,
    courtSystem: courtSystemFor(base.stateCode, countyLabel),
    housingProgram: housingProgramFromQuestion(question),
    codeSet: codeSetForQuestion(question, base.cityLabel),
    confidence: base.confidence,
    needsClarification: base.needsClarification,
    clarificationPrompt: base.clarificationPrompt,
    source: base.source,
  }
}

function clarificationFor(partial: {
  stateCode: string | null
  cityLabel: string | null
  multiState?: boolean
}): string {
  if (partial.multiState) {
    return (
      "Your portfolio spans more than one state. Which property (or which state/city/county) " +
      "should I use for this legal question? I only give location-specific guidance " +
      "when I can ground it in official sources for that place."
    )
  }
  if (!partial.stateCode) {
    return (
      "Before I answer a legal question, I need to know where the property is located " +
      "(country is assumed US; I need state, and city/county when the rule is local). " +
      "Which property or jurisdiction should I use?"
    )
  }
  return (
    `I have **${partial.stateCode}**` +
    (partial.cityLabel ? ` / **${partial.cityLabel}**` : "") +
    ", but I’m not confident enough to give legal guidance yet. " +
    "Confirm the property city/county/state, or ask me to have a human review this."
  )
}

/**
 * Resolve where a legal question applies.
 * Portfolio defaults (e.g. OR/Portland demo fallback) are NOT used unless the
 * portfolio is a single unambiguous state with a clear primary city.
 */
export function resolveLegalJurisdiction(input: {
  question: string
  priorUserTurns?: string[]
  portfolio: PortfolioJurisdiction
  buildingHint?: string | null
}): LegalJurisdictionResolution {
  const question = input.question.trim()
  const prior = (input.priorUserTurns ?? []).slice(-3)
  const corpusLatest = [question, ...prior].join("\n")

  // 1) Explicit state/city/county in the latest question (strongest).
  const explicitQ = extractExplicitJurisdiction(question)
  if (explicitQ?.stateCode) {
    return withPlaceExtras(
      {
        stateCode: explicitQ.stateCode,
        countySlug: explicitQ.countySlug,
        countyLabel: explicitQ.countyLabel,
        citySlug: explicitQ.citySlug,
        cityLabel: explicitQ.cityLabel,
        buildingName: matchBuildingName(question),
        confidence: explicitQ.cityLabel || explicitQ.countyLabel ? "high" : "medium",
        needsClarification: false,
        clarificationPrompt: null,
        source: "question_explicit",
      },
      question,
    )
  }

  // 2) Named property in question or building hint.
  const building =
    matchBuildingName(question) ||
    (input.buildingHint ? matchBuildingName(input.buildingHint) : null) ||
    matchBuildingName(corpusLatest)
  if (building && DEMO_BUILDING_META[building]) {
    const meta = DEMO_BUILDING_META[building]
    return withPlaceExtras(
      {
        stateCode: meta.state,
        countySlug: slugify(meta.county),
        countyLabel: meta.county,
        citySlug: slugifyCity(meta.city),
        cityLabel: meta.city,
        buildingName: building,
        confidence: "high",
        needsClarification: false,
        clarificationPrompt: null,
        source: "named_property",
      },
      question,
    )
  }

  // 3) Explicit jurisdiction mentioned in recent conversation (follow-ups).
  for (const turn of prior) {
    const ex = extractExplicitJurisdiction(turn)
    if (ex?.stateCode) {
      return withPlaceExtras(
        {
          stateCode: ex.stateCode,
          countySlug: ex.countySlug,
          countyLabel: ex.countyLabel,
          citySlug: ex.citySlug,
          cityLabel: ex.cityLabel,
          buildingName: matchBuildingName(corpusLatest),
          confidence: "medium",
          needsClarification: false,
          clarificationPrompt: null,
          source: "conversation",
        },
        question,
      )
    }
  }

  // 4) Portfolio only when unambiguous single-state footprint.
  const portfolio = input.portfolio
  const sampleStates = new Set<string>()
  for (const b of portfolio.sampleBuildings) {
    const meta = DEMO_BUILDING_META[b]
    if (meta) sampleStates.add(meta.state)
  }
  if (portfolio.stateCode) sampleStates.add(portfolio.stateCode)

  if (sampleStates.size > 1) {
    return withPlaceExtras(
      {
        stateCode: null,
        citySlug: null,
        cityLabel: null,
        buildingName: null,
        confidence: "none",
        needsClarification: true,
        clarificationPrompt: clarificationFor({
          stateCode: null,
          cityLabel: null,
          multiState: true,
        }),
        source: "unknown",
      },
      question,
    )
  }

  if (portfolio.stateCode && sampleStates.size === 1 && portfolio.buildingCount > 0) {
    return withPlaceExtras(
      {
        stateCode: portfolio.stateCode,
        citySlug: portfolio.citySlug,
        cityLabel: portfolio.cityLabel,
        buildingName: null,
        confidence: portfolio.citySlug ? "medium" : "low",
        needsClarification: false,
        clarificationPrompt: null,
        source: "portfolio_unambiguous",
      },
      question,
    )
  }

  // 5) Unknown — ask.
  return withPlaceExtras(
    {
      stateCode: null,
      citySlug: null,
      cityLabel: null,
      buildingName: null,
      confidence: "none",
      needsClarification: true,
      clarificationPrompt: clarificationFor({ stateCode: null, cityLabel: null }),
      source: "unknown",
    },
    question,
  )
}

/** Heuristic: URL is primary official or agency guidance (.gov family). */
export function isOfficialLegalSourceUrl(url: string | null | undefined): boolean {
  return isOfficialUrlFromTrust(url)
}

export type LegalGroundingAssessment = {
  grounded: boolean
  officialSourceCount: number
  /** primary_official count — preferred for citations. */
  primaryOfficialCount: number
  agencyGuidanceCount: number
  reason: string | null
  refusePrompt: string | null
  /** Official pages to confirm against when mirrors were used for discovery. */
  verifyTargets: OfficialVerifyTarget[]
}

/**
 * Decide whether retrieved legal packets are strong enough to answer.
 *
 * Requires at least one primary official or agency-guidance source.
 * Aggregators / mirrors / blogs alone are not enough to answer.
 */
export function assessLegalGrounding(input: {
  stateCode: string | null
  cityLabel: string | null
  legalCitations: Array<{ url?: string; citation?: string; title?: string }>
  structuredCitations: Array<{ url?: string; citation?: string; title?: string }>
  legalHitCount: number
  structuredRelevant: boolean
}): LegalGroundingAssessment {
  const place =
    [input.cityLabel, input.stateCode].filter(Boolean).join(", ") || input.stateCode || "this jurisdiction"

  const all = [...input.legalCitations, ...input.structuredCitations]
  const tiers = summarizeLegalSourceTiers(all)

  if (!input.stateCode) {
    return {
      grounded: false,
      officialSourceCount: 0,
      primaryOfficialCount: 0,
      agencyGuidanceCount: 0,
      reason: "missing_jurisdiction",
      refusePrompt:
        "I can’t give legal guidance without a confirmed property location (state/city).",
      verifyTargets: [],
    }
  }

  if (input.legalHitCount === 0 && !input.structuredRelevant) {
    return {
      grounded: false,
      officialSourceCount: 0,
      primaryOfficialCount: 0,
      agencyGuidanceCount: 0,
      reason: "no_hits",
      refusePrompt:
        `I looked for official sources covering **${place}**, but I don’t have a clear, ` +
        `current statute or municipal rule I can cite for this question. ` +
        `Please add more detail (or confirm the city), or have a human / attorney review this.`,
      verifyTargets: collectOfficialVerifyTargets(all),
    }
  }

  if (tiers.answerableCount === 0) {
    const mirrorOnly = tiers.discoveryMirror > 0 && tiers.untrusted === 0
    const verifyTargets = collectOfficialVerifyTargets(all)
    const verifyHint = formatOfficialVerifyHint(verifyTargets)
    return {
      grounded: false,
      officialSourceCount: 0,
      primaryOfficialCount: 0,
      agencyGuidanceCount: 0,
      reason: mirrorOnly ? "mirror_only" : "no_official_sources",
      refusePrompt: mirrorOnly
        ? `I found related material for **${place}** on aggregator / mirror sites (for example CourtListener or Municode), but not a ` +
          `citable official government source (statute, regulation, court opinion from the issuing court, or city/county clerk code). ` +
          `I won’t treat those mirrors as the final authority — they can be outdated or incomplete.\n\n${verifyHint}`
        : `I found related material for **${place}**, but not a citable official government source. ` +
          `I won’t invent legal rules from blogs or unofficial summaries.\n\n${verifyHint}`,
      verifyTargets,
    }
  }

  // Prefer primary law; agency guidance is allowed to fill gaps.
  const top = all
    .map((c) => classifyLegalSourceTrust(c))
    .filter((t) => t.tier === "primary_official" || t.tier === "agency_guidance")
  const reason =
    tiers.primaryOfficial === 0 && tiers.agencyGuidance > 0
      ? "agency_guidance_only"
      : null

  return {
    grounded: true,
    officialSourceCount: top.length,
    primaryOfficialCount: tiers.primaryOfficial,
    agencyGuidanceCount: tiers.agencyGuidance,
    reason,
    refusePrompt: null,
    verifyTargets: collectOfficialVerifyTargets(all),
  }
}

export function formatJurisdictionPlaceLabel(j: {
  countryCode?: string | null
  stateCode: string | null
  countyLabel?: string | null
  cityLabel: string | null
}): string | null {
  const bits: string[] = []
  if (j.cityLabel) bits.push(j.cityLabel)
  if (j.countyLabel) bits.push(`${j.countyLabel} County`)
  if (j.stateCode) bits.push(j.stateCode)
  if (bits.length === 0) return null
  const place = bits.join(", ")
  const country = (j.countryCode ?? "US").toUpperCase()
  return country === "US" ? place : `${place} (${country})`
}

export function formatLegalClarificationMarkdown(resolution: LegalJurisdictionResolution): string {
  return [
    "## Location needed",
    resolution.clarificationPrompt ??
      "Which property or state/city should I use for this legal question?",
    "",
    "## Why I’m asking",
    "Landlord-tenant rules vary by state, county, and city. I only provide legal guidance when I know the place and can back it up with official government or court sources — not aggregator sites alone. That includes newly adopted ordinances that may not yet appear in every online code mirror.",
    "",
    "## Next Steps",
    "- Name the property (e.g. Maple Heights) or say the state/city/county.",
    "- Or ask me to flag this for human / attorney review.",
  ].join("\n")
}

export function formatLegalRefuseMarkdown(prompt: string, stateCode: string | null): string {
  return [
    "## I can’t give reliable legal guidance yet",
    prompt,
    "",
    "I couldn't verify this using official sources. This may require additional research or professional advice.",
    "",
    "## What would help",
    "- Confirm the property’s city, county, and state" +
      (stateCode ? ` (I currently have **${stateCode}**)` : ""),
    "- Point to the specific issue (deposit, notice, entry, late fee, etc.)",
    "- Or escalate to a human for review",
    "",
    "## Next Steps",
    "- Reply with the property name or jurisdiction.",
    "- If this is time-sensitive, have counsel review before acting.",
  ].join("\n")
}
