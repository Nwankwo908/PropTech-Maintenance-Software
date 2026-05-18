import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import { discoverExternalVendorsMerged } from "../_shared/discover_external_vendors.ts"

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

  let body: { ticketId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
  if (!ticketId || !uuidRe.test(ticketId)) {
    return jsonResponse({ error: "Missing or invalid ticketId" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }

  const googleKey = Deno.env.get("GOOGLE_PLACES_API_KEY")?.trim() || null
  const yelpKey = Deno.env.get("YELP_API_KEY")?.trim() || null
  if (!googleKey && !yelpKey) {
    return jsonResponse({
      ticketId,
      suggestions: [],
      configured: false,
      notice:
        "Set Edge secrets GOOGLE_PLACES_API_KEY and/or YELP_API_KEY to load outside-network vendors.",
    })
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select("id, issue_category, unit")
    .eq("id", ticketId)
    .maybeSingle()

  if (error) {
    console.error("[discover-external-vendors] load ticket", error)
    return jsonResponse({ error: "Load ticket failed" }, 500)
  }
  if (!ticket) {
    return jsonResponse({ error: "Ticket not found" }, 404)
  }

  const issueCategory = ticket.issue_category == null
    ? null
    : String(ticket.issue_category)
  const unit = ticket.unit == null ? "" : String(ticket.unit).trim()
  const envLoc = Deno.env.get("EXTERNAL_VENDOR_SEARCH_LOCATION")?.trim() || ""
  const searchLocation = unit || envLoc || "United States"

  const suggestions = await discoverExternalVendorsMerged({
    issueCategory,
    searchLocation,
    googleApiKey: googleKey,
    yelpApiKey: yelpKey,
  })

  return jsonResponse({
    ticketId,
    suggestions,
    configured: true,
  })
})
