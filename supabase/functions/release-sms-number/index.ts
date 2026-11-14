import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { releaseLandlordMainNumber } from "../_shared/sms/smsNumberPool.ts"

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

  let body: {
    landlordId?: string
    smsNumberId?: string
    finalAutoReply?: string
    completeRelease?: boolean
  }
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ error: "Expected JSON object" }, 400)
    }
    body = parsed as typeof body
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  if (!uuid.test(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }
  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied
  if (body.smsNumberId != null && body.smsNumberId !== "" &&
    (typeof body.smsNumberId !== "string" || !uuid.test(body.smsNumberId.trim()))) {
    return jsonResponse({ error: "Invalid smsNumberId" }, 400)
  }
  if ((body.finalAutoReply != null && typeof body.finalAutoReply !== "string") ||
    (body.completeRelease != null && typeof body.completeRelease !== "boolean")) {
    return jsonResponse({ error: "Invalid release options" }, 400)
  }
  const smsNumberId = body.smsNumberId?.trim() || undefined

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    if (smsNumberId) {
      const { data: number, error } = await supabase
        .from("sms_numbers").select("id, landlord_id, purpose")
        .eq("id", smsNumberId).eq("landlord_id", landlordId)
        .eq("purpose", "landlord_main").maybeSingle()
      if (error) return jsonResponse({ error: "SMS number lookup unavailable" }, 503)
      if (!number) return jsonResponse({ error: "SMS number not found" }, 404)
    }
    const result = await releaseLandlordMainNumber(supabase, {
      landlordId,
      smsNumberId,
      finalAutoReply: body.finalAutoReply,
      completeRelease: body.completeRelease === true,
    })

    return jsonResponse({ ok: true, ...result })
  } catch (error) {
    console.error("[release-sms-number] release failed", error)
    return jsonResponse({ error: "SMS number release unavailable" }, 503)
  }
})
