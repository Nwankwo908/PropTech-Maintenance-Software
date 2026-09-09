/// <reference lib="deno.ns" />
/**
 * Proxy Google Street View Static images for the Home data card.
 * Browser <img> calls fail when the Maps key is referrer-restricted; this runs server-side.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { fetchStreetViewStaticJpeg } from "../_shared/homeDataGraph/streetViewStatic.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function resolveGoogleMapsKey(): string {
  return (
    Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim() ||
    Deno.env.get("GOOGLE_STREET_VIEW_API_KEY")?.trim() ||
    ""
  )
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const adminAuth = requireAdminReassignAuth(req, "[home-data-street-view]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: { address?: string; lat?: number; lng?: number }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const address = typeof body.address === "string" ? body.address.trim() : ""
  const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null
  const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null
  if (!address && (lat == null || lng == null)) {
    return jsonResponse({ error: "Missing address" }, 400)
  }

  const apiKey = resolveGoogleMapsKey()
  if (!apiKey) {
    return jsonResponse({ error: "Street View isn’t connected." }, 503)
  }

  try {
    const result = await fetchStreetViewStaticJpeg({ apiKey, lat, lng, address })
    if (!result.ok) {
      return jsonResponse({ error: result.error }, 404)
    }
    return new Response(result.bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=86400",
      },
    })
  } catch (err) {
    console.error("[home-data-street-view]", err)
    return jsonResponse({ error: "Could not load Street View" }, 502)
  }
})
