import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import { discoverExternalVendorsForTicket } from "../_shared/external_vendor/discover.ts"

const corsHeaders = adminEdgeCorsHeaders

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

  if (!Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()) {
    console.error("[discover-external-vendors] ADMIN_REASSIGN_SECRET not set")
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  if (!adminReassignSecretAuthorized(req)) {
    console.warn(
      "[discover-external-vendors] 401 Unauthorized: x-admin-reassign-secret mismatch",
    )
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: { ticketId?: string; limit?: number; useMock?: boolean }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
  if (!ticketId || !uuidRe.test(ticketId)) {
    return jsonResponse({ error: "Missing or invalid ticketId" }, 400)
  }

  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit) &&
      body.limit >= 1 && body.limit <= 10
      ? Math.floor(body.limit)
      : 8

  const forceMock =
    body.useMock === true ||
    (Deno.env.get("EXTERNAL_VENDOR_USE_MOCK") ?? "").trim().toLowerCase() === "true"

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
    notice: result.mode === "mock"
      ? "Using mock external vendor provider (set GOOGLE_PLACES_API_KEY / YELP_API_KEY for live search)."
      : undefined,
  })
})
