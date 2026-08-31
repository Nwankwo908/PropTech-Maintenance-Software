import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { discoverExternalVendorsForTicket } from "../_shared/external_vendor/discover.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"
import {
  clampExternalVendorSearchLimit,
  EXTERNAL_VENDOR_SEARCH_LIMIT,
} from "../../../shared/externalVendor/searchLimit.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }
  const adminAuth = requireAdminReassignAuth(req, "[discover-external-vendors]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response


  let body: { ticketId?: string; limit?: number; useMock?: boolean }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
  if (!ticketId || !isUuidShape(ticketId)) {
    return jsonResponse({ error: "Missing or invalid ticketId" }, 400)
  }

  const limit = clampExternalVendorSearchLimit(
    typeof body.limit === "number" ? body.limit : EXTERNAL_VENDOR_SEARCH_LIMIT,
  )

  const forceMock = body.useMock === true

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const result = await discoverExternalVendorsForTicket(supabase, ticketId, {
    limit,
    forceMock,
  })

  if ("error" in result) {
    const status = result.error === "Ticket not found" ? 404 : 500
    return jsonResponse({ error: result.error }, status)
  }

  return jsonResponse({
    ticketId: result.ticketId,
    suggestions: result.suggestions,
    providersUsed: result.providersUsed,
    mode: result.mode,
    configured: result.configured,
    searchLocation: result.searchLocation,
    locationLabel: result.locationLabel,
    areaLabel: result.areaLabel,
    issueCategory: result.issueCategory,
    notice: thumbtackDiscoverNotice(result),
    providerError: result.providerError ?? undefined,
    jobContext: result.jobContext,
  })
})

function thumbtackDiscoverNotice(result: {
  mode: string
  providersUsed: string[]
  suggestions: unknown[]
  configured: boolean
  areaLabel: string | null
  searchLocation: string
  providerError?: string | null
}): string | undefined {
  if (result.mode === "mock" && result.providersUsed.includes("mock")) {
    return "Using demo external vendor data (set THUMBTACK_CLIENT_ID and THUMBTACK_CLIENT_SECRET for live Thumbtack search)."
  }
  if (result.suggestions.length > 0 || !result.configured) return undefined
  const err = result.providerError ?? ""
  const area = result.areaLabel || result.searchLocation
  if (err === "oauth_token_failed" || err.startsWith("oauth_http_")) {
    return "Thumbtack did not accept our login. Confirm the partner client ID and secret match production (or set staging API/token URLs if these are staging keys)."
  }
  if (err.startsWith("search_http_403") || err.startsWith("search_filtered_http_403")) {
    return "Thumbtack blocked this search (forbidden). The partner account may need the assigned cma- utm source, or Edge traffic may be blocked."
  }
  if (err.startsWith("search_http_") || err.startsWith("search_filtered_http_")) {
    return `Thumbtack search failed (${err.replace(/_/g, " ")}). Check the partner utm source and API environment.`
  }
  return `No Thumbtack pros found for this trade near ${area}.`
}
