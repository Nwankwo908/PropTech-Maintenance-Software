/**
 * Structured compliance lookup — deterministic numbers, never LLM-invented.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"

export type StructuredFactHit = {
  factKey: string
  valueNumeric: number | null
  valueText: string | null
  unit: string | null
  sourceCitation: string | null
  sourceUrl: string | null
  stateCode: string | null
  citySlug: string | null
  countySlug: string | null
  jurisdictionLevel: string
  effectiveOn: string | null
  publicationStatus: string | null
  normativeType: string | null
}

export type StructuredLookupResult = {
  relevant: boolean
  facts: StructuredFactHit[]
  bullets: string[]
  citations: AskUloCitation[]
  matchedKeys: string[]
}

const KEYWORD_TO_FACT_KEYS: Array<{ re: RegExp; keys: string[] }> = [
  {
    re: /\b(security\s*deposit|deposit\s*cap|max(?:imum)?\s*deposit)\b/i,
    keys: ["security_deposit_max_months"],
  },
  {
    re: /\b(month[- ]to[- ]month|notice\s*period|termination\s*notice|evict(?:ion)?\s*notice|days?\s*notice)\b/i,
    keys: ["notice_period_days_month_to_month"],
  },
  {
    re: /\b(late\s*fee|late\s*charge|late\s*rent\s*fee|fee\s*cap)\b/i,
    keys: ["late_fee_cap_pct"],
  },
  {
    re: /\b(rent\s*cap|rent\s*control|rent\s*increase)\b/i,
    keys: ["rent_increase_cap_pct", "late_fee_cap_pct"],
  },
  {
    re: /\b(property\s*tax|assessed\s*value)\b/i,
    keys: ["property_tax_note"],
  },
  {
    re: /\b(relocati(?:on|e)|no[- ]cause)\b/i,
    keys: ["relocation_assistance_note"],
  },
  {
    re: /\b(enter|entry|landlord\s*access|24\s*hour)\b/i,
    keys: ["landlord_entry_notice_hours"],
  },
  {
    re: /\b(fair\s*housing|protected\s*class|discriminat|fha|hud)\b/i,
    keys: ["fha_protected_classes_count"],
  },
  {
    re: /\b(section\s*8|housing\s+choice\s+voucher|\bhcv\b|payment\s*standard|fair\s*market\s*rent|\bfmr\b|voucher\s*(?:rent|payment)?)\b/i,
    keys: [
      "section_8_payment_standard_note",
      "hud_fmr_0br",
      "hud_fmr_1br",
      "hud_fmr_2br",
      "hud_fmr_3br",
    ],
  },
  {
    re: /\b(lead\s*paint|lead[\s-]?based\s*paint|lead\s*disclosure|epa\s*(?:lead|pamphlet)|pre[- ]?1978)\b/i,
    keys: ["lead_paint_pre1978_disclosure"],
  },
  {
    re: /\b(habitab|required\s*repair|legally\s*required\s*to\s*(?:make|repair)|essential\s*service|smoke\s*alarm|carbon\s*monoxide|property\s*maintenance\s*code|safety\s*(?:and\s+)?habitab)\b/i,
    keys: ["habitability_required"],
  },
]

/** True when the question should hit structured_compliance_lookup. */
export function shouldRunStructuredLookup(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  return KEYWORD_TO_FACT_KEYS.some(({ re }) => re.test(q))
}

function keysForQuestion(question: string): string[] {
  const keys = new Set<string>()
  for (const { re, keys: ks } of KEYWORD_TO_FACT_KEYS) {
    if (re.test(question)) {
      for (const k of ks) keys.add(k)
    }
  }
  return [...keys]
}

/** Exported for tests — which structured fact keys a question should hit. */
export function matchedStructuredFactKeys(question: string): string[] {
  return keysForQuestion(question)
}

const FACT_LABELS: Record<string, string> = {
  security_deposit_max_months: "Security deposit limit",
  notice_period_days_month_to_month: "Month-to-month notice period",
  late_fee_cap_pct: "Late fee cap",
  rent_increase_cap_pct: "Rent increase cap",
  property_tax_note: "Property tax note",
  relocation_assistance_note: "Relocation assistance",
  landlord_entry_notice_hours: "Landlord entry notice",
  fha_protected_classes_count: "Fair housing protected classes",
  section_8_payment_standard_note: "Section 8 payment standard",
  hud_fmr_0br: "HUD Fair Market Rent for a studio",
  hud_fmr_1br: "HUD Fair Market Rent for a one-bedroom",
  hud_fmr_2br: "HUD Fair Market Rent for a two-bedroom",
  hud_fmr_3br: "HUD Fair Market Rent for a three-bedroom",
  lead_paint_pre1978_disclosure: "Lead paint disclosure (pre-1978)",
  habitability_required: "Habitability / required repairs",
}

const FMR_KEYS = new Set(["hud_fmr_0br", "hud_fmr_1br", "hud_fmr_2br", "hud_fmr_3br"])

function moneyAmount(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`
}

function formatUnitValue(n: number, unit: string | null): string {
  const u = (unit ?? "").toLowerCase()
  if (u.includes("usd") || u.includes("dollar") || u === "usd_per_month") {
    return `${moneyAmount(n)} per month`
  }
  if (u.includes("month") && !u.includes("usd")) return `${n} months`
  if (u.includes("day")) return `${n} days`
  if (u.includes("hour")) return `${n} hours`
  if (u.includes("percent") || u === "pct" || u === "%") return `${n}%`
  if (u) return `${n} ${unit}`
  return String(n)
}

function placePhrase(f: StructuredFactHit): string {
  if (f.citySlug) {
    return f.citySlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  }
  if (f.countySlug) {
    return `${f.countySlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} County`
  }
  if (f.stateCode === "OR") return "Oregon"
  if (f.stateCode) return f.stateCode
  if (f.jurisdictionLevel === "federal") return "this area"
  return ""
}

/** Plain-English fact line for synthesis (never raw API keys or backend tags). */
export function formatFact(f: StructuredFactHit): string {
  const label = FACT_LABELS[f.factKey] ?? f.factKey.replace(/_/g, " ")
  const place = placePhrase(f)
  const pending =
    f.publicationStatus === "adopted_not_yet_codified"
      ? " A recent update may not appear on every government website yet."
      : ""
  const source = f.sourceCitation ? ` (Source: ${f.sourceCitation})` : ""

  if (f.factKey.startsWith("hud_fmr_") && f.valueNumeric != null) {
    return `${label}${place ? ` in ${place}` : ""} is about **${formatUnitValue(f.valueNumeric, f.unit)}**.${source}${pending}`
  }

  if (f.factKey === "landlord_entry_notice_hours" && f.valueNumeric != null) {
    return `In most cases, landlords must give tenants at least **${formatUnitValue(f.valueNumeric, f.unit)}' notice** before entering a rental unit.${source}${pending}`
  }

  if (f.factKey === "notice_period_days_month_to_month" && f.valueNumeric != null) {
    return `For month-to-month leases, the typical notice period is about **${formatUnitValue(f.valueNumeric, f.unit)}**.${source}${pending}`
  }

  if (f.factKey === "security_deposit_max_months" && f.valueNumeric != null) {
    return `Security deposits are generally capped around **${formatUnitValue(f.valueNumeric, f.unit)} of rent**.${source}${pending}`
  }

  if (f.factKey === "late_fee_cap_pct" && f.valueNumeric != null) {
    return `Late fees are generally capped around **${formatUnitValue(f.valueNumeric, f.unit)} of rent**.${source}${pending}`
  }

  if (f.factKey === "rent_increase_cap_pct" && f.valueNumeric != null) {
    return `Rent increases may be capped around **${formatUnitValue(f.valueNumeric, f.unit)}**.${source}${pending}`
  }

  if (f.valueNumeric != null) {
    return `${label}${place ? ` (${place})` : ""} is about **${formatUnitValue(f.valueNumeric, f.unit)}**.${
      f.valueText ? ` ${f.valueText}` : ""
    }${source}${pending}`
  }

  return `${label}${place ? ` for ${place}` : ""}: ${f.valueText ?? "see official source for details."}${source}${pending}`
}

/** Prefer a single FMR range sentence over listing every bedroom size. */
export function formatStructuredBullets(facts: StructuredFactHit[]): string[] {
  const fmr = facts.filter((f) => FMR_KEYS.has(f.factKey) && f.valueNumeric != null)
  const other = facts.filter((f) => !FMR_KEYS.has(f.factKey))
  const out: string[] = other.map(formatFact)

  if (fmr.length === 1) {
    out.push(formatFact(fmr[0]!))
  } else if (fmr.length > 1) {
    const amounts = fmr.map((f) => f.valueNumeric as number)
    const low = Math.min(...amounts)
    const high = Math.max(...amounts)
    const place = placePhrase(fmr[0]!)
    const cite = fmr.find((f) => f.sourceCitation)?.sourceCitation
    out.push(
      `HUD's Fair Market Rent${place ? ` in ${place}` : " in this area"} ranges from about **${moneyAmount(low)} to ${moneyAmount(high)} per month**, depending on unit size.` +
        (cite ? ` (Source: ${cite})` : "") +
        " Ask if you want the breakdown by bedroom count.",
    )
  }

  return out
}

export async function structuredComplianceLookup(
  supabase: SupabaseClient,
  input: {
    question: string
    stateCode?: string | null
    citySlug?: string | null
    countySlug?: string | null
  },
): Promise<StructuredLookupResult> {
  const matchedKeys = keysForQuestion(input.question)
  if (matchedKeys.length === 0) {
    return { relevant: false, facts: [], bullets: [], citations: [], matchedKeys: [] }
  }

  const stateCode = input.stateCode?.trim().toUpperCase() || null
  const citySlug = input.citySlug?.trim().toLowerCase() || null
  const countySlug = input.countySlug?.trim().toLowerCase() || null

  const { data, error } = await supabase
    .from("compliance_structured_facts")
    .select(
      "fact_key, value_numeric, value_text, unit, source_citation, source_url, state_code, city_slug, county_slug, jurisdiction_level, effective_on, publication_status, normative_type",
    )
    .in("fact_key", matchedKeys)

  if (error) {
    console.error("[ask_ulo/structuredLookup]", error.message)
    return { relevant: true, facts: [], bullets: [], citations: [], matchedKeys }
  }

  const rows = (data ?? []).map((r) => ({
    factKey: String(r.fact_key),
    valueNumeric:
      typeof r.value_numeric === "number"
        ? r.value_numeric
        : r.value_numeric != null
        ? Number(r.value_numeric)
        : null,
    valueText: typeof r.value_text === "string" ? r.value_text : null,
    unit: typeof r.unit === "string" ? r.unit : null,
    sourceCitation: typeof r.source_citation === "string" ? r.source_citation : null,
    sourceUrl: typeof r.source_url === "string" ? r.source_url : null,
    stateCode: typeof r.state_code === "string" ? r.state_code : null,
    citySlug: typeof r.city_slug === "string" ? r.city_slug : null,
    countySlug: typeof r.county_slug === "string" ? r.county_slug : null,
    jurisdictionLevel: String(r.jurisdiction_level ?? ""),
    effectiveOn: typeof r.effective_on === "string" ? r.effective_on : null,
    publicationStatus: typeof r.publication_status === "string" ? r.publication_status : null,
    normativeType: typeof r.normative_type === "string" ? r.normative_type : null,
  })) as StructuredFactHit[]

  // Prefer matching state/county/city, then state-level, then federal
  const scored = rows
    .map((f) => {
      let score = 0
      if (f.jurisdictionLevel === "federal") score += 1
      if (stateCode && f.stateCode?.toUpperCase() === stateCode) score += 10
      if (countySlug && f.countySlug?.toLowerCase() === countySlug) score += 7
      if (citySlug && f.citySlug?.toLowerCase() === citySlug) score += 5
      if (f.publicationStatus === "adopted_not_yet_codified") score += 2
      if (stateCode && f.stateCode && f.stateCode.toUpperCase() !== stateCode && f.jurisdictionLevel !== "federal") {
        score -= 20
      }
      return { f, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.f)

  // Dedupe by fact_key keeping best score
  const byKey = new Map<string, StructuredFactHit>()
  for (const f of scored) {
    if (!byKey.has(f.factKey)) byKey.set(f.factKey, f)
  }
  const facts = [...byKey.values()]

  const bullets = formatStructuredBullets(facts)
  const citations: AskUloCitation[] = facts.map((f) => ({
    tool: "structured" as const,
    title: FACT_LABELS[f.factKey] ?? f.factKey.replace(/_/g, " "),
    citation: f.sourceCitation ?? undefined,
    url: f.sourceUrl ?? undefined,
    excerpt: f.valueText ??
      (f.valueNumeric != null ? formatUnitValue(f.valueNumeric, f.unit) : undefined),
    effectiveOn: f.effectiveOn ?? undefined,
  }))

  return { relevant: true, facts, bullets, citations, matchedKeys }
}
