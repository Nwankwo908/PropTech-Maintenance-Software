/**
 * Trusted source hierarchy for Ask Ulo.
 *
 * Answers must prefer higher priorities. Portfolio context never overrides law.
 *
 * Legal place order within primary law: local → state → federal.
 */

import type { AskUloIntent } from "./intent.ts"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import {
  classifyLegalSourceTrust,
  type LegalSourceTier,
} from "./legalSourceTrust.ts"

/** Prompt Priority 1–9. */
export type SourceHierarchyPriority =
  | 1 // Laws & regulations
  | 2 // Court decisions
  | 3 // Municipal codes
  | 4 // Housing authority guidance
  | 5 // Building codes & safety
  | 6 // Maintenance documentation
  | 7 // Financial data
  | 8 // Market & socioeconomic
  | 9 // Government FAQs & guides (plain-language)

export type SourceHierarchyFamily =
  | "laws_regulations"
  | "court_decisions"
  | "municipal_codes"
  | "housing_authority"
  | "building_codes"
  | "maintenance_docs"
  | "financial_data"
  | "market_socioeconomic"
  | "gov_faqs_guides"
  | "portfolio_context"

export type AnswerConfidence = "high" | "medium" | "low" | "escalate"

export type SourceUsedItem = {
  label: string
  priority: SourceHierarchyPriority | null
  family: SourceHierarchyFamily
  /** Binding law vs guidance vs portfolio vs market context. */
  kind: "requirement" | "guidance" | "portfolio" | "market" | "reference"
  checked: true
}

export const SOURCE_HIERARCHY: Array<{
  priority: SourceHierarchyPriority
  family: SourceHierarchyFamily
  label: string
  description: string
}> = [
  {
    priority: 1,
    family: "laws_regulations",
    label: "Laws & regulations",
    description: "Federal/state statutes & administrative regs on official portals",
  },
  {
    priority: 2,
    family: "court_decisions",
    label: "Court decisions",
    description: "State/federal court opinions; aggregators are discovery only",
  },
  {
    priority: 3,
    family: "municipal_codes",
    label: "Municipal codes",
    description: "City/county codes; track pending ordinances vs published code",
  },
  {
    priority: 4,
    family: "housing_authority",
    label: "Housing authority guidance",
    description: "HUD / PHA program rules — guidance, not statutes",
  },
  {
    priority: 5,
    family: "building_codes",
    label: "Building codes & safety",
    description: "Locally adopted codes, ICC/NFPA/ASHRAE/EPA when adopted",
  },
  {
    priority: 6,
    family: "maintenance_docs",
    label: "Maintenance documentation",
    description: "Manufacturer manuals, warranties, service bulletins",
  },
  {
    priority: 7,
    family: "financial_data",
    label: "Financial data",
    description: "HUD FMR, FHFA, BLS, FRED — economics only",
  },
  {
    priority: 8,
    family: "market_socioeconomic",
    label: "Market & socioeconomic data",
    description: "ACS, AHS, CHAS — market context; never for tenant steering",
  },
  {
    priority: 9,
    family: "gov_faqs_guides",
    label: "Government FAQs & guides",
    description: "Plain-language explainers after authoritative law",
  },
]

/** Which hierarchy families apply for each Ask Ulo intent. */
export function hierarchyPrioritiesForIntent(
  intent: AskUloIntent,
): SourceHierarchyPriority[] {
  switch (intent) {
    case "legal":
      return [1, 2, 3, 4, 5, 9]
    case "maintenance":
    case "unit_maintenance_ranking":
    case "oldest_waiting_work_order":
    case "entity_investigation":
    case "period_summary":
    case "property_health":
    case "executive_briefing":
    case "property_priority":
    case "vendor":
      return [5, 6, 3, 1, 9]
    case "finance":
    case "rent_history":
    case "market_rent_estimate":
      return [7, 8, 1, 9]
    case "market_analysis":
    case "comparable_rentals":
      return [8, 7]
    case "property_price_history":
    case "price_history_ambiguous":
      return [7, 8]
    case "ops":
    case "general":
    default:
      return [1, 3, 4, 5, 7, 8, 9]
  }
}

/**
 * Place specificity for legal chunks: city (local) > county > state > federal.
 * Lower score = higher priority (sort ascending).
 */
export function legalPlaceRank(hit: {
  jurisdictionLevel?: string | null
  citySlug?: string | null
  countySlug?: string | null
  stateCode?: string | null
}): number {
  const level = (hit.jurisdictionLevel ?? "").toLowerCase()
  if (level === "city" || hit.citySlug) return 0
  if (hit.countySlug) return 1
  if (level === "state" || hit.stateCode) return 2
  if (level === "federal") return 3
  return 4
}

/** Map a citation / domain blob into hierarchy family + kind. */
export function classifyCitationHierarchy(input: {
  title?: string | null
  citation?: string | null
  url?: string | null
  domain?: string | null
  tool?: string | null
}): { family: SourceHierarchyFamily; priority: SourceHierarchyPriority | null; kind: SourceUsedItem["kind"] } {
  const blob = `${input.title ?? ""} ${input.citation ?? ""} ${input.domain ?? ""} ${input.url ?? ""}`
    .toLowerCase()
  const trust = classifyLegalSourceTrust({
    url: input.url,
    title: input.title,
    citation: input.citation,
    domain: input.domain,
  })

  if (input.tool === "ops_graph") {
    return { family: "portfolio_context", priority: null, kind: "portfolio" }
  }
  if (input.tool === "market_data") {
    return { family: "market_socioeconomic", priority: 8, kind: "market" }
  }

  if (/\b(court|opinion|holding|appellate|supreme\s+court|docket)\b/.test(blob)) {
    return {
      family: "court_decisions",
      priority: 2,
      kind: trust.tier === "primary_official" ? "requirement" : "reference",
    }
  }
  if (
    /\b(municipal|city\s+code|ordinance|county\s+code|title\s+\d+)\b/.test(blob) ||
    (input.domain === "building_code" && /city|municipal|portland|hillsboro/i.test(blob))
  ) {
    return {
      family: "municipal_codes",
      priority: 3,
      kind: "requirement",
    }
  }
  if (/\b(section\s*8|hcv|housing\s+choice|pha|hud\s+exchange)\b/.test(blob) ||
    /hud\.gov/.test(blob)) {
    const isFhaPrimary = /\bfair\s+housing\s+act\b|42\s+u\.?s\.?c/.test(blob)
    if (isFhaPrimary && trust.tier === "primary_official") {
      return { family: "laws_regulations", priority: 1, kind: "requirement" }
    }
    return {
      family: "housing_authority",
      priority: 4,
      kind: "guidance",
    }
  }
  if (/\b(ipmc|building\s+code|nfpa|ashrae|property\s+maintenance)\b/.test(blob) ||
    input.domain === "building_code") {
    return { family: "building_codes", priority: 5, kind: "requirement" }
  }
  if (/\b(faq|handbook|guide|self[- ]help|brochure)\b/.test(blob) ||
    trust.tier === "agency_guidance") {
    return { family: "gov_faqs_guides", priority: 9, kind: "guidance" }
  }
  if (trust.tier === "primary_official") {
    return { family: "laws_regulations", priority: 1, kind: "requirement" }
  }
  if (trust.tier === "discovery_mirror") {
    return { family: "court_decisions", priority: 2, kind: "reference" }
  }
  return { family: "gov_faqs_guides", priority: 9, kind: "guidance" }
}

export function assessAnswerConfidence(input: {
  intent: AskUloIntent
  gateStatus?: "ok" | "clarify" | "refuse" | null
  requireCounsel?: boolean
  primaryOfficialCount: number
  agencyGuidanceCount: number
  discoveryMirrorCount?: number
  pendingOrdinanceCount?: number
  hasPortfolioContext?: boolean
}): AnswerConfidence {
  if (input.requireCounsel) return "escalate"
  if (input.gateStatus === "clarify" || input.gateStatus === "refuse") {
    return input.gateStatus === "refuse" ? "low" : "low"
  }

  if (input.intent === "legal") {
    if (input.primaryOfficialCount > 0) return "high"
    if (input.agencyGuidanceCount > 0) return "medium"
    return "low"
  }

  // Non-legal: market/finance/ops — portfolio + live tools count as medium/high loosely
  if (input.hasPortfolioContext || input.primaryOfficialCount + input.agencyGuidanceCount > 0) {
    return "medium"
  }
  return "low"
}

export function confidenceLabel(c: AnswerConfidence): string {
  switch (c) {
    case "high":
      return "High — official laws and regulations found"
    case "medium":
      return "Medium — official guidance available"
    case "low":
      return "Low — limited authoritative information"
    case "escalate":
      return "Escalate — human legal or compliance review recommended"
  }
}

/**
 * Build sources used for legal audit / graph logging (UI shows citations under Compliance & References).
 * Dedupes by label; portfolio items appended after external authority.
 */
export function buildSourcesUsed(input: {
  citations: AskUloCitation[]
  propertyBuildingName?: string | null
  propertyBullets?: string[]
  hasOpsContext?: boolean
  housingProgram?: string | null
  jurisdictionLabel?: string | null
}): SourceUsedItem[] {
  const out: SourceUsedItem[] = []
  const seen = new Set<string>()

  const push = (item: SourceUsedItem) => {
    const key = item.label.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  }

  for (const c of input.citations) {
    if (c.tool === "ops_graph") continue
    const h = classifyCitationHierarchy({
      title: c.title,
      citation: c.citation,
      url: c.url,
      tool: c.tool,
    })
    const label =
      (c.citation && c.citation.trim()) ||
      (c.title && c.title.trim()) ||
      "Cited source"
    push({
      label: label.slice(0, 120),
      priority: h.priority,
      family: h.family,
      kind: h.kind,
      checked: true,
    })
  }

  // Sort external by priority (nulls last), then append portfolio.
  out.sort((a, b) => {
    const pa = a.priority ?? 99
    const pb = b.priority ?? 99
    return pa - pb
  })

  if (input.jurisdictionLabel) {
    push({
      label: `Jurisdiction: ${input.jurisdictionLabel}`,
      priority: null,
      family: "portfolio_context",
      kind: "portfolio",
      checked: true,
    })
  }
  if (input.propertyBuildingName) {
    push({
      label: `${input.propertyBuildingName} portfolio context`,
      priority: null,
      family: "portfolio_context",
      kind: "portfolio",
      checked: true,
    })
  }
  if (input.housingProgram === "section_8_hcv") {
    push({
      label: "Section 8 / HCV program context",
      priority: 4,
      family: "housing_authority",
      kind: "guidance",
      checked: true,
    })
  }
  if (input.hasOpsContext) {
    push({
      label: "Property maintenance / ops history",
      priority: null,
      family: "portfolio_context",
      kind: "portfolio",
      checked: true,
    })
  }

  return out.slice(0, 12)
}

/** Trust tier → rough hierarchy priority for logging. */
export function hierarchyPriorityFromTrustTier(
  tier: LegalSourceTier,
): SourceHierarchyPriority {
  if (tier === "primary_official") return 1
  if (tier === "agency_guidance") return 4
  if (tier === "discovery_mirror") return 2
  return 9
}
