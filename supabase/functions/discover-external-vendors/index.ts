import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { discoverExternalVendorsForTicket } from "../_shared/external_vendor/discover.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"

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

  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit) &&
      body.limit >= 1 && body.limit <= 10
      ? Math.floor(body.limit)
      : 8

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
    notice: result.mode === "mock" && result.providersUsed.includes("mock")
      ? "Using demo external vendor data (set THUMBTACK_CLIENT_ID and THUMBTACK_CLIENT_SECRET for live Thumbtack search)."
      : undefined,
  })
})
