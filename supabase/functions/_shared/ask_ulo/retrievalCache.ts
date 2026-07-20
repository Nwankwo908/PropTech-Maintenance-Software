/**
 * Scoped retrieval reuse for Ask Ulo.
 *
 * Cache key = intent + jurisdiction + normalized question + source freshness.
 * When official feeds for that place are unchanged, skip embedding + RAG + structured re-fetch.
 * Does not cache final LLM answers (property/safety context still varies per turn).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { LegalRagSearchResult } from "./legalRagSearch.ts"
import type { StructuredLookupResult } from "./structuredLookup.ts"

export type RetrievalCachePayload = {
  legal: LegalRagSearchResult | null
  structured: StructuredLookupResult | null
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "my",
  "our",
  "please",
  "can",
  "could",
  "would",
  "should",
  "i",
  "we",
  "me",
  "at",
  "in",
  "on",
  "for",
  "to",
  "of",
  "is",
  "are",
  "do",
  "does",
  "what",
  "how",
  "about",
])

/** Collapse question text so near-duplicates share a cache entry. */
export function normalizeRetrievalQuestion(question: string): string {
  const raw = question
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  const tokens = raw.split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t))
  return tokens.join(" ")
}

/** Coarse topic bucket — keeps rent-increase queries from colliding with deposit queries after stopword strip. */
export function retrievalTopicBucket(question: string): string {
  const q = question.toLowerCase()
  if (/\brent\s*(increase|raise|hike|control|cap|stabiliz)/i.test(q) || /\bincrease\s+(?:the\s+)?rent\b/i.test(q)) {
    return "rent_increase"
  }
  if (/\bdeposit\b/i.test(q)) return "deposit"
  if (/\blate\s+fee\b/i.test(q)) return "late_fee"
  if (/\bentry|enter\s+(?:the\s+)?(?:unit|premises)\b/i.test(q)) return "entry"
  if (/\bevict|unlawful\s+detainer\b/i.test(q)) return "eviction"
  if (/\bfair\s*housing|discriminat|protected\s+class\b/i.test(q)) return "fair_housing"
  if (/\blead|asbestos|mold|radon\b/i.test(q)) return "environmental"
  if (/\bscreen(?:ing)?|background\s*check|credit\s*check\b/i.test(q)) return "screening"
  if (/\baccommodat|esa\b|service\s*animal\b/i.test(q)) return "accommodation"
  return "general_legal"
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function buildRetrievalCacheKey(input: {
  intent: string
  stateCode: string | null
  citySlug: string | null
  countySlug: string | null
  housingProgram: string | null
  question: string
  sourceFreshnessToken: string
}): Promise<{ cacheKey: string; questionNorm: string; topicBucket: string }> {
  const questionNorm = normalizeRetrievalQuestion(input.question)
  const topicBucket = retrievalTopicBucket(input.question)
  const material = [
    input.intent,
    topicBucket,
    (input.stateCode ?? "").toUpperCase(),
    (input.citySlug ?? "").toLowerCase(),
    (input.countySlug ?? "").toLowerCase(),
    (input.housingProgram ?? "").toLowerCase(),
    questionNorm,
    input.sourceFreshnessToken,
  ].join("|")
  const cacheKey = await sha256Hex(material)
  return { cacheKey, questionNorm, topicBucket }
}

/**
 * Freshness token for feeds that apply to this place (federal + matching state/city).
 * When a feed fingerprint changes, the token changes → cache miss → re-retrieve.
 */
export async function resolveSourceFreshnessToken(
  supabase: SupabaseClient,
  input: { stateCode: string | null; citySlug?: string | null },
): Promise<string> {
  const state = input.stateCode?.trim().toUpperCase() || null
  let query = supabase
    .from("ask_ulo_source_feeds")
    .select(
      "id, state_code, city_slug, content_fingerprint, last_checked_at, last_change_detected_at, feed_kind",
    )
    .eq("enabled", true)

  if (state) {
    query = query.or(`state_code.is.null,state_code.eq.${state}`)
  }

  const { data, error } = await query.limit(80)
  if (error) {
    console.error("[ask_ulo/retrievalCache] freshness", error.message)
    return `err:${Date.now()}`
  }

  const rows = (data ?? []).filter((r) => {
    const city = typeof r.city_slug === "string" ? r.city_slug.toLowerCase() : null
    const wantCity = input.citySlug?.trim().toLowerCase() || null
    if (wantCity && city && city !== wantCity) return false
    return true
  })

  if (rows.length === 0) return "no-feeds"

  const parts = rows
    .map((r) => {
      const id = String(r.id)
      const fp =
        (typeof r.content_fingerprint === "string" && r.content_fingerprint) ||
        (typeof r.last_change_detected_at === "string" && r.last_change_detected_at) ||
        (typeof r.last_checked_at === "string" && r.last_checked_at) ||
        "unset"
      return `${id}:${fp}`
    })
    .sort()

  return await sha256Hex(parts.join("|"))
}

export async function getRetrievalCache(
  supabase: SupabaseClient,
  cacheKey: string,
): Promise<RetrievalCachePayload | null> {
  const { data, error } = await supabase
    .from("ask_ulo_retrieval_cache")
    .select("id, payload, expires_at, hit_count")
    .eq("cache_key", cacheKey)
    .maybeSingle()

  if (error) {
    console.error("[ask_ulo/retrievalCache] get", error.message)
    return null
  }
  if (!data?.payload || typeof data.payload !== "object") return null
  if (typeof data.expires_at === "string" && new Date(data.expires_at).getTime() < Date.now()) {
    return null
  }

  const prevHits = typeof data.hit_count === "number" ? data.hit_count : 0
  void supabase
    .from("ask_ulo_retrieval_cache")
    .update({
      hit_count: prevHits + 1,
      last_hit_at: new Date().toISOString(),
    })
    .eq("id", data.id)

  const raw = data.payload as Record<string, unknown>
  return {
    legal: (raw.legal as LegalRagSearchResult | null) ?? null,
    structured: (raw.structured as StructuredLookupResult | null) ?? null,
  }
}

export async function putRetrievalCache(
  supabase: SupabaseClient,
  input: {
    cacheKey: string
    intent: string
    stateCode: string | null
    citySlug: string | null
    countySlug: string | null
    housingProgram: string | null
    questionNorm: string
    sourceFreshnessToken: string
    payload: RetrievalCachePayload
    ttlDays?: number
  },
): Promise<void> {
  const hasLegal = Boolean(input.payload.legal?.bullets?.length)
  const hasStructured = Boolean(input.payload.structured?.relevant)
  if (!hasLegal && !hasStructured) return

  const ttlDays = input.ttlDays ?? 14
  const expires = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from("ask_ulo_retrieval_cache").upsert(
    {
      cache_key: input.cacheKey,
      intent: input.intent,
      state_code: input.stateCode,
      city_slug: input.citySlug,
      county_slug: input.countySlug,
      housing_program: input.housingProgram,
      question_norm: input.questionNorm,
      source_freshness_token: input.sourceFreshnessToken,
      payload: input.payload,
      expires_at: expires,
      last_hit_at: new Date().toISOString(),
    },
    { onConflict: "cache_key" },
  )
  if (error) {
    console.error("[ask_ulo/retrievalCache] put", error.message)
  }
}

/** Prepare cache key + freshness, then try a hit. */
export async function prepareRetrievalCache(
  supabase: SupabaseClient,
  input: {
    intent: string
    stateCode: string | null
    citySlug: string | null
    countySlug: string | null
    housingProgram: string | null
    question: string
  },
): Promise<{
  hit: boolean
  payload: RetrievalCachePayload | null
  cacheKey: string
  sourceFreshnessToken: string
  questionNorm: string
  topicBucket: string
}> {
  const sourceFreshnessToken = await resolveSourceFreshnessToken(supabase, {
    stateCode: input.stateCode,
    citySlug: input.citySlug,
  })
  const { cacheKey, questionNorm, topicBucket } = await buildRetrievalCacheKey({
    ...input,
    sourceFreshnessToken,
  })
  const payload = await getRetrievalCache(supabase, cacheKey)
  return {
    hit: payload != null,
    payload,
    cacheKey,
    sourceFreshnessToken,
    questionNorm,
    topicBucket,
  }
}
