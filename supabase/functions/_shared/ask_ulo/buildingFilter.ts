/**
 * Building / property name extraction for Ask Ulo scope.
 * Must never treat trade categories (HVAC, plumbing, …) as property names.
 */

import { CATEGORY_SYNONYMS } from "./deepOperationalInvestigation.ts"

const BUILDING_SCOPE_STOPWORDS = new Set(
  [
    ...Object.keys(CATEGORY_SYNONYMS),
    ...Object.values(CATEGORY_SYNONYMS).flatMap((terms) => terms),
    "repair",
    "repairs",
    "cost",
    "costs",
    "estimate",
    "estimates",
    "issue",
    "issues",
    "problem",
    "problems",
    "maintenance",
    "request",
    "requests",
    "ticket",
    "tickets",
    "work",
    "order",
    "orders",
    "vendor",
    "vendors",
    "workflow",
    "workflows",
    "portfolio",
    "property",
    "properties",
    "building",
    "buildings",
    "unit",
    "units",
    "resident",
    "residents",
    "emergency",
    "emergencies",
    "delay",
    "delays",
    "risk",
    "risks",
    "quote",
    "quotes",
    "pricing",
    "price",
    "range",
    "labor",
    "scope",
    "sla",
    "approval",
    "priority",
    "status",
    "pipeline",
    "open",
    "active",
    "past",
    "week",
    "month",
    "year",
    "today",
    "tomorrow",
  ].map((s) => s.toLowerCase()),
)

/**
 * True when a candidate building name is really a trade / ops topic word.
 */
export function looksLikeOpsCategoryToken(name: string): boolean {
  const parts = name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return true
  // Single-token "HVAC", "Plumbing", "AC" → never a building
  if (parts.length === 1) return BUILDING_SCOPE_STOPWORDS.has(parts[0]!)
  // Multi-token still rejected if every word is a stopword ("HVAC Issues")
  return parts.every((p) => BUILDING_SCOPE_STOPWORDS.has(p))
}

/**
 * Extract a property/building name from natural language.
 * Returns null when the match is a category (e.g. "for the HVAC issues").
 */
export function extractBuildingFilter(question: string): string | null {
  const m = question.match(
    /\b(?:for|at|about|in|on|of|my)\s+(?:the\s+)?([A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3})\b/,
  )
  if (!m) return null
  const name = m[1].trim()
  if (/^(my|the|a|an|all|open|past)\b/i.test(name)) return null
  if (name.length < 3) return null
  if (looksLikeOpsCategoryToken(name)) return null
  return name
}

/**
 * Drop a building filter that is actually a category/synonym token.
 */
export function sanitizeBuildingFilter(
  buildingFilter: string | null | undefined,
): string | null {
  const raw = buildingFilter?.trim() || null
  if (!raw) return null
  if (looksLikeOpsCategoryToken(raw)) return null
  return raw
}
