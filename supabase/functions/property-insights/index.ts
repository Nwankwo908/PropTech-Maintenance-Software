/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { loadPropertyInsights, type PropertyInsights } from "../_shared/propertyInsights/loadInsights.ts"

const corsHeaders = adminEdgeCorsHeaders

const cache = new Map<string, { at: number; insights: PropertyInsights }>()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

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

  const adminAuth = requireAdminReassignAuth(req, "[property-insights]", corsHeaders)
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

  const rentcastKey = Deno.env.get("RENTCAST_API_KEY")?.trim() ?? ""
  const zillowKey = Deno.env.get("ZILLOW_RAPIDAPI_KEY")?.trim() ?? ""
  const key = cacheKey(address)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return jsonResponse({
      ...cached.insights,
      configured: Boolean(rentcastKey || zillowKey),
      lookupError: null,
    })
  }

  try {
    const result = await loadPropertyInsights({
      address,
      rentcastKey: rentcastKey || null,
      zillowKey: zillowKey || null,
      zillowHost: Deno.env.get("ZILLOW_RAPIDAPI_HOST")?.trim() || null,
    })
    const i = result.insights
    if (
      result.configured &&
      (i.homeValue != null || i.yearBuilt != null || i.rentEstimate != null || i.photos.length > 0)
    ) {
      cache.set(key, { at: Date.now(), insights: i })
    }
    return jsonResponse({
      ...result.insights,
      configured: result.configured,
      lookupError: result.lookupError,
    })
  } catch (err) {
    console.error("[property-insights]", err)
    return jsonResponse({ error: "Could not load property data" }, 502)
  }
})
