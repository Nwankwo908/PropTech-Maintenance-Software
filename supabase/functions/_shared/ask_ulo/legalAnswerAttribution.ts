/**
 * User-visible attribution for legal answers: place, currency, source authority.
 */

import { formatJurisdictionPlaceLabel } from "./legalJurisdiction.ts"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import { formatLegalFreshnessLines } from "./sourceFreshness.ts"

export type LegalAttributionInput = {
  jurisdiction: {
    countryCode?: string | null
    stateCode: string | null
    countyLabel?: string | null
    cityLabel: string | null
  }
  citations: AskUloCitation[]
  primaryOfficialCount?: number
  agencyGuidanceCount?: number
}

function authorityLabel(tier: AskUloCitation["sourceTier"] | undefined): string {
  if (tier === "primary_official") return "law / official court or code source"
  if (tier === "agency_guidance") return "official government guidance"
  if (tier === "discovery_mirror") return "discovery mirror (confirm on official site)"
  if (tier === "untrusted") return "unverified"
  return "reference"
}

function collectCurrencyDates(citations: AskUloCitation[]): string | null {
  const dates: string[] = []
  for (const c of citations) {
    if (c.lastUpdatedOn) dates.push(c.lastUpdatedOn)
    else if (c.effectiveOn) dates.push(c.effectiveOn)
  }
  if (dates.length === 0) return null
  dates.sort()
  return dates[dates.length - 1] ?? null
}

function summarizeAuthorities(citations: AskUloCitation[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of citations) {
    if (c.tool !== "legal_rag" && c.tool !== "structured") continue
    const label = authorityLabel(c.sourceTier)
    if (seen.has(label)) continue
    seen.add(label)
    out.push(label)
  }
  return out
}

/** Compact footer / “Where this applies” block for legal answers. */
export function formatLegalAttributionMarkdown(input: LegalAttributionInput): string {
  const place =
    formatJurisdictionPlaceLabel({
      countryCode: input.jurisdiction.countryCode,
      stateCode: input.jurisdiction.stateCode,
      countyLabel: input.jurisdiction.countyLabel,
      cityLabel: input.jurisdiction.cityLabel,
    }) ?? "jurisdiction not confirmed"

  const currency = collectCurrencyDates(input.citations)
  const authorities = summarizeAuthorities(input.citations)
  const authorityLine =
    authorities.length > 0
      ? authorities.join("; ")
      : input.primaryOfficialCount && input.primaryOfficialCount > 0
        ? "law / official source"
        : input.agencyGuidanceCount && input.agencyGuidanceCount > 0
          ? "official government guidance"
          : "sources shown in details"

  const lines = [
    "## Where this applies",
    `- **Location:** ${place}`,
    `- **Source authority:** ${authorityLine}`,
    ...formatLegalFreshnessLines({ currencyDate: currency }),
  ]
  return lines.join("\n")
}

export const UNVERIFIED_LEGAL_MESSAGE =
  "I couldn't verify this using official sources. This may require additional research or professional advice."
