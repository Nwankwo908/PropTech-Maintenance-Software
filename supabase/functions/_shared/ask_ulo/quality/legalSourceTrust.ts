/**
 * Legal source trust tiers for Ask Ulo.
 *
 * Priority (answers must cite higher tiers; mirrors are discovery-only):
 * 1. primary_official — statutes, regs, courts, city/county/building codes on official hosts
 * 2. agency_guidance — HUD / EPA / Census / housing-authority handbooks & FAQs
 * 3. discovery_mirror — aggregators (CourtListener, Municode mirrors, etc.) —
 *    use to find leads faster; always confirm on the official government/court source
 *    before presenting as legal guidance (see officialSourceVerify.ts)
 * 4. untrusted — blogs, opinion, commercial legal summaries
 */

export type LegalSourceTier =
  | "primary_official"
  | "agency_guidance"
  | "discovery_mirror"
  | "untrusted"

export type LegalSourceTrust = {
  tier: LegalSourceTier
  /** Higher = more trustworthy for answering. */
  rank: number
  host: string | null
  reason: string
}

const TIER_RANK: Record<LegalSourceTier, number> = {
  primary_official: 100,
  agency_guidance: 70,
  discovery_mirror: 30,
  untrusted: 0,
}

/** Aggregators / mirrors that collect law but are not the official publisher. */
const DISCOVERY_MIRROR_HOSTS = [
  "courtlistener.com",
  "justia.com",
  "findlaw.com",
  "leagle.com",
  "casetext.com",
  "casemine.com",
  "vlex.com",
  "law.cornell.edu", // LII — useful mirror of USC/CFR, not Congress.gov
  "municode.com",
  "library.municode.com",
  "americanlegal.com",
  "amlegal.com",
  "codepublishing.com",
  "qcode.us",
  "ecode360.com",
  "generalcode.com",
  "sterlingcodifiers.com",
  "nolo.com",
  "avvo.com",
  "rocketlawyer.com",
  "legalzoom.com",
]

const UNTRUSTED_HOST_HINTS = [
  "medium.com",
  "substack.com",
  "wordpress.com",
  "blogspot.",
  "reddit.com",
  "quora.com",
  "facebook.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "wikipedia.org",
  "wikihow.com",
]

/** Federal / state agency hosts that publish guidance (tier 2 when not clearly primary law). */
const AGENCY_HOST_HINTS = [
  "hud.gov",
  "huduser.gov",
  "epa.gov",
  "census.gov",
  "cdc.gov",
  "dol.gov",
  "justice.gov",
  "ftc.gov",
  "consumerfinance.gov",
  "fema.gov",
  "energy.gov",
  "irs.gov",
  "ssa.gov",
  "oregon.gov",
  "wa.gov",
  "ca.gov",
]

const PRIMARY_LAW_HINT =
  /\b(ors|ors\.|o\.r\.s|usc|u\.s\.c|cfr|c\.f\.r|statute|statutes|code\s+title|city\s+code|municipal\s+code|ordinance|regulation|regulations|court|opinion|holding|ipmc|building\s+code|housing\s+code|landlord[- ]tenant\s+act)\b/i

const AGENCY_GUIDANCE_HINT =
  /\b(faq|handbook|guidance|guide|bulletin|fact\s*sheet|brochure|overview|how\s+to|best\s+practices|agency\s+guidance)\b/i

function hostnameOf(url: string | null | undefined): string | null {
  if (!url?.trim()) return null
  try {
    return new URL(url.trim()).hostname.toLowerCase()
  } catch {
    return null
  }
}

function hostMatches(host: string, needles: string[]): boolean {
  return needles.some((n) => host === n || host.endsWith(`.${n}`) || host.includes(n))
}

function isDotGov(host: string): boolean {
  return host.endsWith(".gov") || host.endsWith(".gov.uk") || host.endsWith(".mil")
}

function looksLikePrimaryLaw(title?: string | null, citation?: string | null, domain?: string | null): boolean {
  const blob = `${title ?? ""} ${citation ?? ""} ${domain ?? ""}`
  if (PRIMARY_LAW_HINT.test(blob)) return true
  if (/\b(building_code|landlord_tenant|fair_housing)\b/i.test(domain ?? "")) {
    // Domain alone is weak; only treat as primary when we also have a citation-like string.
    return Boolean(citation?.trim())
  }
  return false
}

/**
 * Classify a legal citation / RAG hit into a trust tier.
 */
export function classifyLegalSourceTrust(input: {
  url?: string | null
  title?: string | null
  citation?: string | null
  domain?: string | null
}): LegalSourceTrust {
  const host = hostnameOf(input.url ?? null)
  const title = input.title ?? null
  const citation = input.citation ?? null
  const domain = input.domain ?? null
  const primaryHint = looksLikePrimaryLaw(title, citation, domain)
  const guidanceHint = AGENCY_GUIDANCE_HINT.test(`${title ?? ""} ${citation ?? ""}`)

  if (!host) {
    // Statute citation string without URL — treat as primary only when citation looks official.
    if (citation && PRIMARY_LAW_HINT.test(citation)) {
      return {
        tier: "primary_official",
        rank: TIER_RANK.primary_official - 5,
        host: null,
        reason: "statute_citation_without_url",
      }
    }
    return {
      tier: "untrusted",
      rank: TIER_RANK.untrusted,
      host: null,
      reason: "missing_url",
    }
  }

  if (hostMatches(host, UNTRUSTED_HOST_HINTS)) {
    return { tier: "untrusted", rank: TIER_RANK.untrusted, host, reason: "untrusted_host" }
  }

  if (hostMatches(host, DISCOVERY_MIRROR_HOSTS)) {
    return {
      tier: "discovery_mirror",
      rank: TIER_RANK.discovery_mirror,
      host,
      reason: "aggregator_or_mirror",
    }
  }

  // Private code publishers (ICC) — useful reference, not government authority alone.
  if (host.includes("iccsafe.org")) {
    return {
      tier: "discovery_mirror",
      rank: TIER_RANK.discovery_mirror,
      host,
      reason: "private_code_publisher",
    }
  }

  if (isDotGov(host) || host.includes("legislature") || host.includes("leg.state")) {
    // Agency FAQ/handbook pages on .gov → tier 2; statute/code/court → tier 1.
    if (guidanceHint && !primaryHint) {
      return {
        tier: "agency_guidance",
        rank: TIER_RANK.agency_guidance,
        host,
        reason: "gov_agency_guidance",
      }
    }
    if (hostMatches(host, AGENCY_HOST_HINTS) && guidanceHint) {
      return {
        tier: "agency_guidance",
        rank: TIER_RANK.agency_guidance,
        host,
        reason: "named_agency_guidance",
      }
    }
    if (primaryHint || host.includes("legislature") || host.includes("courts.") || host.includes("congress.gov")) {
      return {
        tier: "primary_official",
        rank: TIER_RANK.primary_official,
        host,
        reason: "gov_primary_law",
      }
    }
    // Default .gov / city portals (portland.gov code pages, etc.) → primary when hosting codes.
    if (host.includes("portland.gov") || /\/code\b/i.test(input.url ?? "")) {
      return {
        tier: "primary_official",
        rank: TIER_RANK.primary_official,
        host,
        reason: "gov_municipal_or_code",
      }
    }
    // Other .gov → agency guidance (still answerable).
    return {
      tier: "agency_guidance",
      rank: TIER_RANK.agency_guidance,
      host,
      reason: "gov_general",
    }
  }

  return {
    tier: "untrusted",
    rank: TIER_RANK.untrusted,
    host,
    reason: "non_government_host",
  }
}

/** Backward-compatible: primary + agency count as “official enough” for URL checks. */
export function isOfficialLegalSourceUrl(url: string | null | undefined): boolean {
  const t = classifyLegalSourceTrust({ url })
  return t.tier === "primary_official" || t.tier === "agency_guidance"
}

export function isAnswerableLegalTier(tier: LegalSourceTier): boolean {
  return tier === "primary_official" || tier === "agency_guidance"
}

export function sortByLegalSourceTrust<T extends {
  sourceUrl?: string | null
  sourceTitle?: string | null
  sourceCitation?: string | null
  domain?: string | null
  similarity?: number | null
  url?: string | null
  title?: string | null
  citation?: string | null
}>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ta = classifyLegalSourceTrust({
      url: a.sourceUrl ?? a.url,
      title: a.sourceTitle ?? a.title,
      citation: a.sourceCitation ?? a.citation,
      domain: a.domain,
    })
    const tb = classifyLegalSourceTrust({
      url: b.sourceUrl ?? b.url,
      title: b.sourceTitle ?? b.title,
      citation: b.sourceCitation ?? b.citation,
      domain: b.domain,
    })
    if (tb.rank !== ta.rank) return tb.rank - ta.rank
    const sa = a.similarity ?? 0
    const sb = b.similarity ?? 0
    return sb - sa
  })
}

export function summarizeLegalSourceTiers(
  citations: Array<{ url?: string; title?: string; citation?: string; domain?: string }>,
): {
  primaryOfficial: number
  agencyGuidance: number
  discoveryMirror: number
  untrusted: number
  answerableCount: number
} {
  let primaryOfficial = 0
  let agencyGuidance = 0
  let discoveryMirror = 0
  let untrusted = 0
  for (const c of citations) {
    const t = classifyLegalSourceTrust(c).tier
    if (t === "primary_official") primaryOfficial += 1
    else if (t === "agency_guidance") agencyGuidance += 1
    else if (t === "discovery_mirror") discoveryMirror += 1
    else untrusted += 1
  }
  return {
    primaryOfficial,
    agencyGuidance,
    discoveryMirror,
    untrusted,
    answerableCount: primaryOfficial + agencyGuidance,
  }
}
