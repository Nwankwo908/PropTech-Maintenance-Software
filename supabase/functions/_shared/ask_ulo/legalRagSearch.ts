/// <reference lib="deno.ns" />
/**
 * Legal RAG: hybrid retrieval — semantic (pgvector) + keyword (FTS / token), fused with RRF.
 * Prefer official sources; mirrors are discovery-only.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "./opsGraphLookup.ts"
import {
  type DocumentPassport,
  type DocumentType,
  passportFromChunkRow,
  passesHousingProgramFilter,
} from "./documentPassport.ts"
import { isAnswerableLegalTier, classifyLegalSourceTrust, sortByLegalSourceTrust } from "./legalSourceTrust.ts"
import { legalPlaceRank } from "./sourceHierarchy.ts"

export type LegalPublicationStatus =
  | "published_code"
  | "adopted_not_yet_codified"
  | "agency_guidance"

export type LegalRagHit = {
  id: string
  sourceTitle: string
  sourceCitation: string | null
  sourceUrl: string | null
  chunkText: string
  domain: string
  similarity: number | null
  publicationStatus: LegalPublicationStatus
  normativeType: "requirement" | "guidance" | null
  effectiveOn: string | null
  jurisdictionLevel: string | null
  stateCode: string | null
  citySlug: string | null
  countySlug: string | null
  /** Digital ID card for this chunk (type, publisher, geo, program, extras). */
  passport: DocumentPassport
  /** How this hit entered the fused list (for audits). */
  retrievalChannels?: Array<"vector" | "keyword">
}

export type LegalRagSearchResult = {
  hits: LegalRagHit[]
  bullets: string[]
  citations: AskUloCitation[]
  mode: "hybrid" | "vector" | "keyword" | "empty"
  /** Chunks marked adopted but not yet in the published online code (Municode lag). */
  pendingOrdinanceCount: number
}

const OPS_ONLY_RE =
  /\b(what needs (my )?attention|open (maintenance|tickets|workflows)|past[- ]due|balances?|summarize open|lease[- ]renewal message|draft a )\b/i

const LEGAL_HINT_RE =
  /\b(law|legal|statute|ors|deposit|notice|late fee|fair housing|hud|fha|habitab|evict|landlord[- ]tenant|code|compliance|oregon|portland|rent cap|entry)\b/i

/** Curated landlord-tenant phrase bridges for keyword/FTS (plain English → statutory language). */
const LEGAL_QUERY_SYNONYMS: Array<{ match: RegExp; add: string[] }> = [
  {
    match: /\b(security\s+)?deposit(s)?\b/i,
    add: ["deposit disposition", "return of funds", "security deposits", "ORS 90.300"],
  },
  {
    match: /\b(return|refund).{0,24}deposit|\bdeposit.{0,24}(return|refund|timeline|deadline|days)\b/i,
    add: ["deposit disposition", "within 30 days", "return of tenant's security deposit"],
  },
  {
    match: /\blate\s+fee(s)?\b/i,
    add: ["late charge", "rent late fee", "ORS 90.260"],
  },
  {
    match: /\b(entry|enter|access).{0,20}(unit|premises|apartment)|landlord\s+entry\b/i,
    add: ["right of entry", "reasonable notice", "ORS 90.322"],
  },
  {
    match: /\bevict|\bunlawful\s+detainer|\bnotice\s+to\s+(quit|vacate)\b/i,
    add: ["termination of tenancy", "notice of termination", "forcible entry"],
  },
  {
    match: /\bhabitab|\brepair\b.*\btenant|\bwarrant(y)?\s+of\s+habitability\b/i,
    add: ["habitability", "landlord duty to maintain", "ORS 90.320"],
  },
  {
    match: /\bfair\s+housing|\bdiscriminat/i,
    add: ["Fair Housing Act", "HUD", "protected class"],
  },
]

/** Reciprocal rank fusion constant (standard IR default). */
export const RRF_K = 60

/** Skip legal tool when the question is clearly portfolio-ops-only. Prefer intent routing in runAskUlo. */
export function shouldRunLegalRag(question: string): boolean {
  const q = question.trim()
  if (!q) return false
  if (LEGAL_HINT_RE.test(q)) return true
  if (OPS_ONLY_RE.test(q) && !LEGAL_HINT_RE.test(q)) return false
  return false
}

/** Expand a landlord question with statutory / synonym phrases for keyword retrieval. */
export function expandLegalQueryForKeyword(question: string): string {
  const q = question.trim()
  if (!q) return q
  const extras: string[] = []
  for (const rule of LEGAL_QUERY_SYNONYMS) {
    if (rule.match.test(q)) {
      for (const phrase of rule.add) {
        if (!extras.includes(phrase)) extras.push(phrase)
      }
    }
  }
  if (extras.length === 0) return q
  return `${q} ${extras.join(" ")}`
}

/**
 * Fuse ranked lists with Reciprocal Rank Fusion.
 * Hits appearing in both channels score higher than either alone.
 */
export function fuseLegalHitsRrf(
  vectorHits: LegalRagHit[],
  keywordHits: LegalRagHit[],
  matchCount: number,
  k: number = RRF_K,
): LegalRagHit[] {
  const scores = new Map<string, number>()
  const byId = new Map<string, LegalRagHit>()
  const channels = new Map<string, Set<"vector" | "keyword">>()

  const absorb = (hits: LegalRagHit[], channel: "vector" | "keyword") => {
    hits.forEach((hit, index) => {
      const id = hit.id
      if (!id) return
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1))
      const existing = byId.get(id)
      if (!existing) {
        byId.set(id, { ...hit })
      } else if (
        (hit.similarity ?? -1) > (existing.similarity ?? -1) &&
        hit.similarity != null
      ) {
        byId.set(id, { ...existing, ...hit, similarity: hit.similarity })
      }
      const ch = channels.get(id) ?? new Set()
      ch.add(channel)
      channels.set(id, ch)
    })
  }

  absorb(vectorHits, "vector")
  absorb(keywordHits, "keyword")

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, matchCount)
    .map(([id]) => {
      const hit = byId.get(id)!
      return {
        ...hit,
        retrievalChannels: [...(channels.get(id) ?? [])],
      }
    })
}

async function embedQuery(apiKey: string, text: string): Promise<number[] | null> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  })
  const data = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>
    error?: { message?: string }
  }
  if (!res.ok) {
    console.error("[ask_ulo/legalRagSearch] embed error", res.status, data.error?.message)
    return null
  }
  const emb = data.data?.[0]?.embedding
  return Array.isArray(emb) && emb.length === 1536 ? emb : null
}

function parsePublicationStatus(raw: unknown): LegalPublicationStatus {
  if (raw === "adopted_not_yet_codified" || raw === "agency_guidance") return raw
  return "published_code"
}

function toHit(row: Record<string, unknown>, similarity: number | null): LegalRagHit {
  const normative =
    row.normative_type === "requirement" || row.normative_type === "guidance"
      ? row.normative_type
      : null
  return {
    id: String(row.id),
    sourceTitle: String(row.source_title ?? "Legal source"),
    sourceCitation: typeof row.source_citation === "string" ? row.source_citation : null,
    sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
    chunkText: String(row.chunk_text ?? ""),
    domain: String(row.domain ?? ""),
    similarity,
    publicationStatus: parsePublicationStatus(row.publication_status),
    normativeType: normative,
    effectiveOn: typeof row.effective_on === "string" ? row.effective_on : null,
    jurisdictionLevel:
      typeof row.jurisdiction_level === "string" ? row.jurisdiction_level : null,
    stateCode: typeof row.state_code === "string" ? row.state_code : null,
    citySlug: typeof row.city_slug === "string" ? row.city_slug : null,
    countySlug: typeof row.county_slug === "string" ? row.county_slug : null,
    passport: passportFromChunkRow(row),
  }
}

type JurisdictionFilters = {
  stateCode?: string | null
  citySlug?: string | null
  countySlug?: string | null
  countryCode?: string | null
  housingProgram?: string | null
  documentTypes?: DocumentType[] | null
}

function hitsToPackets(
  hits: LegalRagHit[],
): Pick<LegalRagSearchResult, "bullets" | "citations" | "pendingOrdinanceCount"> {
  const ranked = sortByLegalSourceTrust(hits).filter((h) => {
    const tier = classifyLegalSourceTrust({
      url: h.sourceUrl,
      title: h.sourceTitle,
      citation: h.sourceCitation,
      domain: h.domain,
    }).tier
    return tier !== "untrusted"
  })
  ranked.sort((a, b) => {
    const trustA = classifyLegalSourceTrust({
      url: a.sourceUrl,
      title: a.sourceTitle,
      citation: a.sourceCitation,
      domain: a.domain,
    }).rank
    const trustB = classifyLegalSourceTrust({
      url: b.sourceUrl,
      title: b.sourceTitle,
      citation: b.sourceCitation,
      domain: b.domain,
    }).rank
    if (trustB !== trustA) return trustB - trustA
    const place = legalPlaceRank(a) - legalPlaceRank(b)
    if (place !== 0) return place
    const pub = (h: LegalRagHit) =>
      h.publicationStatus === "adopted_not_yet_codified"
        ? 0
        : h.publicationStatus === "published_code"
          ? 1
          : 2
    return pub(a) - pub(b)
  })
  const preferred = ranked.filter((h) =>
    isAnswerableLegalTier(
      classifyLegalSourceTrust({
        url: h.sourceUrl,
        title: h.sourceTitle,
        citation: h.sourceCitation,
        domain: h.domain,
      }).tier,
    ),
  )
  const forAnswer = preferred
  const discoveryOnly = ranked.filter(
    (h) =>
      classifyLegalSourceTrust({
        url: h.sourceUrl,
        title: h.sourceTitle,
        citation: h.sourceCitation,
        domain: h.domain,
      }).tier === "discovery_mirror",
  )
  const pendingOrdinanceCount = forAnswer.filter(
    (h) => h.publicationStatus === "adopted_not_yet_codified",
  ).length

  const bullets = forAnswer.map((h) => {
    const trust = classifyLegalSourceTrust({
      url: h.sourceUrl,
      title: h.sourceTitle,
      citation: h.sourceCitation,
      domain: h.domain,
    })
    const excerpt = h.chunkText.length > 280 ? `${h.chunkText.slice(0, 277)}…` : h.chunkText
    const sourceLabel = h.sourceCitation || h.sourceTitle
    const kindNote =
      trust.tier === "agency_guidance"
        ? " (government guidance — helpful, not always a hard statute)"
        : ""
    const pendingNote =
      h.publicationStatus === "adopted_not_yet_codified"
        ? " Note: a recent update may not appear on every government website yet."
        : ""
    return `From ${sourceLabel}${kindNote}: ${excerpt}${pendingNote}`
  })
  const citations: AskUloCitation[] = [
    ...forAnswer.map((h) => ({
      tool: "legal_rag" as const,
      title: h.sourceTitle,
      citation: h.sourceCitation ?? undefined,
      url: h.sourceUrl ?? undefined,
      excerpt: h.chunkText.slice(0, 180),
      effectiveOn: h.effectiveOn ?? undefined,
      lastUpdatedOn: h.passport?.lastUpdatedOn ?? undefined,
    })),
    ...discoveryOnly.slice(0, 4).map((h) => ({
      tool: "legal_rag" as const,
      title: `${h.sourceTitle} (discovery only — confirm on official site)`,
      citation: h.sourceCitation ?? undefined,
      url: h.sourceUrl ?? undefined,
      excerpt: h.chunkText.slice(0, 120),
      effectiveOn: h.effectiveOn ?? undefined,
      lastUpdatedOn: h.passport?.lastUpdatedOn ?? undefined,
    })),
  ]
  return { bullets, citations, pendingOrdinanceCount }
}

/** Client-side token keyword when FTS RPC is unavailable. */
async function keywordTokenFallback(
  supabase: SupabaseClient,
  input: {
    question: string
    stateCode?: string | null
    citySlug?: string | null
    countySlug?: string | null
    housingProgram?: string | null
    matchCount: number
  },
): Promise<LegalRagHit[]> {
  const expanded = expandLegalQueryForKeyword(input.question)
  const tokens = expanded
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((t) => t.length >= 3)
    .slice(0, 14)

  let query = supabase
    .from("legal_rag_chunks")
    .select(
      "id, source_title, source_citation, source_url, chunk_text, domain, jurisdiction_level, country_code, state_code, city_slug, county_slug, publication_status, normative_type, effective_on, last_updated_on, document_type, publisher_name, publisher_kind, authority_tier, housing_program, court_system, case_number, holding_summary, manufacturer, equipment_model, equipment_type, manual_version, replaces_chunk_id, metadata",
    )
    .limit(60)

  const stateCode = input.stateCode?.trim().toUpperCase() || null
  if (stateCode) {
    query = query.or(`jurisdiction_level.eq.federal,state_code.eq.${stateCode}`)
  }

  const { data, error } = await query
  if (error) {
    console.error("[ask_ulo/legalRagSearch] keyword", error.message)
    return []
  }

  const citySlug = input.citySlug?.trim().toLowerCase() || null
  const countySlug = input.countySlug?.trim().toLowerCase() || null
  const scored = (data ?? [])
    .filter((row) =>
      passesHousingProgramFilter(
        typeof row.housing_program === "string" ? row.housing_program : null,
        input.housingProgram,
      ),
    )
    .map((row) => {
      const text =
        `${row.source_title ?? ""} ${row.source_citation ?? ""} ${row.chunk_text ?? ""}`.toLowerCase()
      let score = 0
      for (const t of tokens) {
        if (text.includes(t)) score += t.includes(".") || /\d/.test(t) ? 2 : 1
      }
      if (citySlug && String(row.city_slug ?? "").toLowerCase() === citySlug) score += 2
      if (countySlug && String(row.county_slug ?? "").toLowerCase() === countySlug) {
        score += 1.5
      }
      if (stateCode && String(row.state_code ?? "").toUpperCase() === stateCode) score += 1
      if (row.jurisdiction_level === "federal") score += 0.25
      if (row.publication_status === "adopted_not_yet_codified") score += 0.4
      return { row, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.matchCount)

  return scored.map((x) => toHit(x.row as Record<string, unknown>, null))
}

async function keywordSearch(
  supabase: SupabaseClient,
  input: {
    question: string
    matchCount: number
  } & JurisdictionFilters,
): Promise<LegalRagHit[]> {
  const expanded = expandLegalQueryForKeyword(input.question)
  const { data, error } = await supabase.rpc("match_legal_rag_chunks_fts", {
    query_text: expanded,
    match_count: Math.max(input.matchCount * 2, 8),
    filter_state_code: input.stateCode?.trim().toUpperCase() || null,
    filter_city_slug: input.citySlug?.trim().toLowerCase() || null,
    domain_filter: null,
    filter_county_slug: input.countySlug?.trim().toLowerCase() || null,
    filter_country_code: input.countryCode?.trim().toUpperCase() || "US",
    filter_housing_program: input.housingProgram?.trim().toLowerCase() || null,
    filter_document_types:
      input.documentTypes && input.documentTypes.length > 0
        ? input.documentTypes
        : null,
    filter_answerable_only: true,
  })
  if (error) {
    // Migration not applied yet — fall back to in-process tokens.
    console.error("[ask_ulo/legalRagSearch] fts rpc", error.message)
    return keywordTokenFallback(supabase, {
      question: input.question,
      stateCode: input.stateCode,
      citySlug: input.citySlug,
      countySlug: input.countySlug,
      housingProgram: input.housingProgram,
      matchCount: input.matchCount,
    })
  }
  if (!Array.isArray(data) || data.length === 0) {
    return keywordTokenFallback(supabase, {
      question: input.question,
      stateCode: input.stateCode,
      citySlug: input.citySlug,
      countySlug: input.countySlug,
      housingProgram: input.housingProgram,
      matchCount: input.matchCount,
    })
  }
  return data.map((row) =>
    toHit(
      row as Record<string, unknown>,
      typeof (row as { rank?: number }).rank === "number"
        ? (row as { rank: number }).rank
        : null,
    ),
  )
}

async function vectorSearch(
  supabase: SupabaseClient,
  embedding: number[],
  input: { matchCount: number } & JurisdictionFilters,
): Promise<LegalRagHit[]> {
  const { data, error } = await supabase.rpc("match_legal_rag_chunks", {
    query_embedding: embedding,
    match_count: Math.max(input.matchCount * 2, 8),
    filter_state_code: input.stateCode?.trim().toUpperCase() || null,
    filter_city_slug: input.citySlug?.trim().toLowerCase() || null,
    domain_filter: null,
    filter_county_slug: input.countySlug?.trim().toLowerCase() || null,
    filter_country_code: input.countryCode?.trim().toUpperCase() || "US",
    filter_housing_program: input.housingProgram?.trim().toLowerCase() || null,
    filter_document_types:
      input.documentTypes && input.documentTypes.length > 0
        ? input.documentTypes
        : null,
    filter_answerable_only: true,
  })
  if (error) {
    console.error("[ask_ulo/legalRagSearch] vector rpc", error.message)
    return []
  }
  if (!Array.isArray(data) || data.length === 0) return []
  return data.map((row) =>
    toHit(
      row as Record<string, unknown>,
      typeof row.similarity === "number" ? row.similarity : null,
    ),
  )
}

export async function legalRagSearch(
  supabase: SupabaseClient,
  input: {
    question: string
    stateCode?: string | null
    citySlug?: string | null
    countySlug?: string | null
    countryCode?: string | null
    /** Section 8 / HCV etc. — narrows passport before search. */
    housingProgram?: string | null
    /** Optional document-type allow-list (passport document_type). */
    documentTypes?: DocumentType[] | null
    matchCount?: number
  },
): Promise<LegalRagSearchResult> {
  const matchCount = input.matchCount ?? 6
  const filters: JurisdictionFilters = {
    stateCode: input.stateCode,
    citySlug: input.citySlug,
    countySlug: input.countySlug,
    countryCode: input.countryCode,
    housingProgram: input.housingProgram,
    documentTypes: input.documentTypes,
  }
  const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim()

  const keywordPromise = keywordSearch(supabase, {
    question: input.question,
    matchCount,
    ...filters,
  })

  let vectorHits: LegalRagHit[] = []
  if (apiKey) {
    try {
      const embedding = await embedQuery(apiKey, input.question)
      if (embedding) {
        vectorHits = await vectorSearch(supabase, embedding, { matchCount, ...filters })
      }
    } catch (err) {
      console.error("[ask_ulo/legalRagSearch] vector path threw", err)
    }
  }

  const keywordHits = await keywordPromise

  if (vectorHits.length === 0 && keywordHits.length === 0) {
    return {
      hits: [],
      bullets: [],
      citations: [],
      mode: "empty",
      pendingOrdinanceCount: 0,
    }
  }

  if (vectorHits.length > 0 && keywordHits.length > 0) {
    const hits = fuseLegalHitsRrf(vectorHits, keywordHits, matchCount)
    return { hits, mode: "hybrid", ...hitsToPackets(hits) }
  }

  if (vectorHits.length > 0) {
    const hits = vectorHits.slice(0, matchCount).map((h) => ({
      ...h,
      retrievalChannels: ["vector" as const],
    }))
    return { hits, mode: "vector", ...hitsToPackets(hits) }
  }

  const hits = keywordHits.slice(0, matchCount).map((h) => ({
    ...h,
    retrievalChannels: ["keyword" as const],
  }))
  return { hits, mode: "keyword", ...hitsToPackets(hits) }
}
