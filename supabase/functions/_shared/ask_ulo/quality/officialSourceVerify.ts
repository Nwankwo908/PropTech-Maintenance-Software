/**
 * Official-source verification for Ask Ulo legal answers.
 *
 * Discovery tools (CourtListener, Municode, Justia, etc.) help find material quickly.
 * Before Ulo presents something as the law, it must rest on an official government /
 * court / legislature / city–county clerk source — not the mirror alone.
 */

import {
  classifyLegalSourceTrust,
  type LegalSourceTier,
} from "./legalSourceTrust.ts"

export type OfficialVerifyTarget = {
  /** Human label, e.g. "Oregon Legislature — ORS chapter 90" */
  label: string
  /** Preferred official URL to confirm against */
  url: string
  /** Citation string that triggered the mapping, when known */
  citation: string | null
  /** Why this is the verify target */
  reason:
    | "ors_statute"
    | "usc_federal"
    | "portland_city_code"
    | "oregon_courts"
    | "congress"
    | "hud_primary"
    | "generic_gov"
}

export type CiteLike = {
  url?: string | null
  title?: string | null
  citation?: string | null
  domain?: string | null
}

/** Build oregonlegislature.gov chapter URL from a 1–3 digit chapter number. */
export function oregonOrsChapterUrl(chapter: number): string {
  const padded = String(chapter).padStart(3, "0")
  return `https://www.oregonlegislature.gov/bills_laws/ors/ors${padded}.html`
}

/**
 * From citation / title / mirror URL text, propose where a human (or Ulo) should
 * confirm the rule on an official host.
 */
export function resolveOfficialVerifyTarget(input: CiteLike): OfficialVerifyTarget | null {
  const blob = `${input.citation ?? ""} ${input.title ?? ""} ${input.url ?? ""}`

  // Oregon Revised Statutes — ORS 90.322 or ORS chapter 90
  const orsSection = blob.match(/\bORS\s+(\d{1,3})\.(\d{1,4})\b/i)
  if (orsSection) {
    const chapter = Number(orsSection[1])
    return {
      label: `Oregon Legislature — ORS ${orsSection[1]}.${orsSection[2]}`,
      url: oregonOrsChapterUrl(chapter),
      citation: `ORS ${orsSection[1]}.${orsSection[2]}`,
      reason: "ors_statute",
    }
  }
  const orsChapter = blob.match(/\bORS\s+(?:ch(?:apter)?\.?\s*)?(\d{1,3})\b/i)
  if (orsChapter) {
    const chapter = Number(orsChapter[1])
    return {
      label: `Oregon Legislature — ORS chapter ${chapter}`,
      url: oregonOrsChapterUrl(chapter),
      citation: `ORS chapter ${chapter}`,
      reason: "ors_statute",
    }
  }

  // Portland City Code / Title 29 / 30
  const portlandTitle = blob.match(/\b(?:Portland\s+)?Title\s+(\d{1,3})\b/i)
  if (portlandTitle || /\bportland\s+(?:city\s+)?code\b/i.test(blob) || /\bPCC\s+\d/i.test(blob)) {
    const titleNum = portlandTitle?.[1] ?? null
    return {
      label: titleNum
        ? `City of Portland — Title ${titleNum}`
        : "City of Portland Code",
      url: titleNum
        ? `https://www.portland.gov/code/title-${titleNum}`
        : "https://www.portland.gov/code",
      citation: titleNum ? `Portland Title ${titleNum}` : "Portland City Code",
      reason: "portland_city_code",
    }
  }

  // United States Code
  const usc = blob.match(/\b(\d+)\s*U\.?\s*S\.?\s*C\.?\s*[§\s]*(\d[\d\w\-.]*)/i)
  if (usc) {
    return {
      label: `U.S. Code — ${usc[1]} U.S.C. § ${usc[2]}`,
      url: `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title${usc[1]}-section${usc[2]}&num=0&edition=prelim`,
      citation: `${usc[1]} U.S.C. § ${usc[2]}`,
      reason: "usc_federal",
    }
  }

  // Oregon courts
  if (/\boregon\s+(?:supreme\s+)?court\b/i.test(blob) || /\bcourts\.oregon\.gov\b/i.test(blob)) {
    return {
      label: "Oregon Judicial Department",
      url: "https://www.courts.oregon.gov/",
      citation: input.citation?.trim() || null,
      reason: "oregon_courts",
    }
  }

  // Already on a primary official host — that URL is the verify target
  const trust = classifyLegalSourceTrust(input)
  if (trust.tier === "primary_official" && input.url?.trim()) {
    return {
      label: input.title?.trim() || input.citation?.trim() || trust.host || "Official government source",
      url: input.url.trim(),
      citation: input.citation?.trim() || null,
      reason: "generic_gov",
    }
  }

  return null
}

export function collectOfficialVerifyTargets(
  citations: CiteLike[],
  limit = 5,
): OfficialVerifyTarget[] {
  const out: OfficialVerifyTarget[] = []
  const seen = new Set<string>()
  for (const c of citations) {
    const t = resolveOfficialVerifyTarget(c)
    if (!t) continue
    const key = t.url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= limit) break
  }
  return out
}

/**
 * True when this cite is only a discovery mirror / aggregator and must not be
 * treated as the final legal authority by itself.
 */
export function isDiscoveryOnlySource(input: CiteLike): boolean {
  return classifyLegalSourceTrust(input).tier === "discovery_mirror"
}

export function isAnswerAuthorityTier(tier: LegalSourceTier): boolean {
  return tier === "primary_official" || tier === "agency_guidance"
}

/**
 * Split retrieved cites into answer authorities vs discovery-only mirrors.
 * Synthesis and legal answer bullets should use authorities only.
 */
export function partitionLegalCitations<T extends CiteLike>(
  citations: T[],
): { authorities: T[]; discoveryOnly: T[]; verifyTargets: OfficialVerifyTarget[] } {
  const authorities: T[] = []
  const discoveryOnly: T[] = []
  for (const c of citations) {
    const tier = classifyLegalSourceTrust(c).tier
    if (isAnswerAuthorityTier(tier)) authorities.push(c)
    else if (tier === "discovery_mirror") discoveryOnly.push(c)
  }
  const verifyTargets = collectOfficialVerifyTargets([
    ...authorities,
    ...discoveryOnly,
  ])
  return { authorities, discoveryOnly, verifyTargets }
}

/** Plain-language note for refuse / clarify when mirrors were found. */
export function formatOfficialVerifyHint(targets: OfficialVerifyTarget[]): string {
  if (targets.length === 0) {
    return (
      "Before treating any aggregator (CourtListener, Municode, Justia, etc.) as the rule, " +
      "confirm the text on the official legislature, court, or city/county clerk site."
    )
  }
  const lines = targets.map((t) => `- ${t.label}: ${t.url}`)
  return (
    "I can use tools like CourtListener or Municode to find leads faster, but I only treat " +
    "official government or court sources as the final authority. Confirm here:\n" +
    lines.join("\n")
  )
}
