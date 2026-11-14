import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizePlatformAccount } from "../_shared/adminAccountAuthorization.ts"
import { provisionLandlordMainNumber } from "../_shared/sms/smsNumberPool.ts"

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
    phoneNumber?: string
    providerNumberSid?: string
    areaCode?: string
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

  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }
  const denied = await authorizePlatformAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  for (const value of [body.phoneNumber, body.providerNumberSid, body.areaCode]) {
    if (value != null && typeof value !== "string") return jsonResponse({ error: "Invalid provider parameters" }, 400)
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const result = await provisionLandlordMainNumber(supabase, {
      landlordId,
      phoneNumber: body.phoneNumber,
      providerNumberSid: body.providerNumberSid,
      areaCode: body.areaCode,
    })

    return jsonResponse({ ok: true, ...result })
  } catch (err) {
    console.error("[provision-sms-number]", err)
    return jsonResponse({ error: "SMS provisioning unavailable" }, 503)
  }
})
