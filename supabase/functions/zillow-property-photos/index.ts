import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { loadZillowPropertyPhotos, zillowRapidApiHosts } from "../_shared/zillow/propertyPhotos.ts"

const corsHeaders = adminEdgeCorsHeaders

const cache = new Map<string, { at: number; photos: string[]; zpid: string | null }>()
const CACHE_TTL_MS = 30 * 60 * 1000
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000
let rateLimitedUntil = 0

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function cacheKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ")
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const adminAuth = requireAdminReassignAuth(req, "[zillow-property-photos]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: { address?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const address = typeof body.address === "string" ? body.address.trim() : ""
  if (!address) {
    return jsonResponse({ error: "Missing address" }, 400)
  }

  const apiKey = Deno.env.get("ZILLOW_RAPIDAPI_KEY")?.trim() ?? ""
  const host = zillowRapidApiHosts(Deno.env.get("ZILLOW_RAPIDAPI_HOST"))[0]

  const key = cacheKey(address)
  const cached = cache.get(key)
  if (cached && cached.photos.length > 0 && Date.now() - cached.at < CACHE_TTL_MS) {
    return jsonResponse({
      photos: cached.photos,
      zpid: cached.zpid,
      configured: Boolean(apiKey),
      rateLimited: false,
    })
  }

  if (Date.now() < rateLimitedUntil) {
    return jsonResponse({
      photos: [],
      zpid: null,
      configured: Boolean(apiKey),
      rateLimited: true,
    })
  }

  try {
    const result = await loadZillowPropertyPhotos({
      address,
      apiKey: apiKey || null,
      host,
    })
    if (result.rateLimited) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS
    }
    if (result.photos.length > 0) {
      cache.set(key, { at: Date.now(), photos: result.photos, zpid: result.zpid })
    }
    return jsonResponse({
      photos: result.photos,
      zpid: result.zpid,
      configured: Boolean(apiKey),
      rateLimited: result.rateLimited,
    })
  } catch (err) {
    console.error("[zillow-property-photos]", err)
    return jsonResponse({ error: "Could not load Zillow photos" }, 502)
  }
})
