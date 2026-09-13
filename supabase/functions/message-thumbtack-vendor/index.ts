import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"
import { resolveExternalVendorSearchContext } from "../_shared/external_vendor/search_location.ts"
import { extractZipFromLocation } from "../_shared/external_vendor/providers/thumbtack.ts"
import {
  listThumbtackThreadsForTicket,
  sendThumbtackVendorMessage,
} from "../_shared/external_vendor/thumbtackMessages.ts"

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

  const adminAuth = requireAdminReassignAuth(req, "[message-thumbtack-vendor]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  if (req.method === "GET") {
    const ticketId = new URL(req.url).searchParams.get("ticketId")?.trim() ?? ""
    if (!ticketId || !isUuidShape(ticketId)) {
      return jsonResponse({ error: "Missing or invalid ticketId" }, 400)
    }
    const threads = await listThumbtackThreadsForTicket(supabase, ticketId)
    return jsonResponse({ ticketId, threads })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let body: {
    ticketId?: string
    businessId?: string
    vendorName?: string
    searchId?: string
    categoryId?: string
    issueCategory?: string
    searchLocation?: string
    text?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
  const businessId = typeof body.businessId === "string" ? body.businessId.trim() : ""
  const vendorName = typeof body.vendorName === "string" ? body.vendorName.trim() : ""
  const text = typeof body.text === "string" ? body.text : ""
  if (!ticketId || !isUuidShape(ticketId)) {
    return jsonResponse({ error: "Missing or invalid ticketId" }, 400)
  }
  if (!businessId) {
    return jsonResponse({ error: "Missing businessId" }, 400)
  }

  const enriched = await supabase
    .from("maintenance_request_enriched")
    .select("id, landlord_id, issue_category, building, unit")
    .eq("id", ticketId)
    .maybeSingle()
  if (enriched.error) {
    console.warn("[message-thumbtack-vendor] enriched ticket load", enriched.error)
  }

  let ticket = enriched.data
  if (!ticket) {
    const loaded = await supabase
      .from("maintenance_requests")
      .select("id, landlord_id, issue_category, unit")
      .eq("id", ticketId)
      .maybeSingle()
    if (loaded.error) {
      console.error("[message-thumbtack-vendor] load ticket", loaded.error)
      return jsonResponse({ error: "Load ticket failed" }, 500)
    }
    ticket = loaded.data
  }
  if (!ticket) return jsonResponse({ error: "Ticket not found" }, 404)
  const landlordId = typeof ticket.landlord_id === "string" ? ticket.landlord_id : ""
  if (!landlordId) {
    return jsonResponse({ error: "Ticket is missing a landlord" }, 400)
  }

  let searchLocation = typeof body.searchLocation === "string" ? body.searchLocation : null
  if (!extractZipFromLocation(searchLocation ?? "")) {
    const resolved = await resolveExternalVendorSearchContext(supabase, {
      unit: typeof ticket.unit === "string" ? ticket.unit : "",
      building: "building" in ticket && typeof ticket.building === "string"
        ? ticket.building
        : null,
      landlordId,
    })
    searchLocation = resolved.searchLocation
  }

  const result = await sendThumbtackVendorMessage(supabase, {
    ticketId,
    landlordId,
    businessId,
    vendorName: vendorName || "Vendor",
    searchId: typeof body.searchId === "string" ? body.searchId : null,
    categoryId: typeof body.categoryId === "string" ? body.categoryId : null,
    issueCategory: typeof body.issueCategory === "string"
      ? body.issueCategory
      : typeof ticket.issue_category === "string"
      ? ticket.issue_category
      : null,
    searchLocation,
    text,
  })
  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.httpStatus && result.httpStatus >= 400
      ? 502
      : 400)
  }
  return jsonResponse({ ok: true, ticketId, thread: result.thread })
})
