import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import {
  ensureLandlordMainSmsNumber,
} from "../_shared/sms/landlordSmsOnboarding.ts"
import { logGraphEvent } from "../_shared/graph/logGraphEvent.ts"

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


  let body: { landlordId?: string }
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
  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }


  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const result = await ensureLandlordMainSmsNumber(supabase, landlordId)

    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "landlord.sms_onboarded",
      source: "dashboard",
      actor_type: "landlord",
      metadata: {
        sms_number_id: result.number.id,
        phone_number: result.number.phone_number,
        provider: result.number.provider,
        provider_number_sid: result.number.provider_number_sid,
        source: result.source,
        created: result.created,
      },
    })

    return jsonResponse({
      ok: true,
      landlordId,
      created: result.created,
      source: result.source,
      // The shared platform row can belong to another portfolio. Expose only
      // the public line data the dashboard needs, not provider/owner internals.
      smsNumber: { phone_number: result.number.phone_number, provider: result.number.provider },
    })
  } catch (err) {
    console.error("[landlord-sms-onboarding] error", err)
    return jsonResponse({ error: "SMS onboarding unavailable" }, 503)
  }
})
