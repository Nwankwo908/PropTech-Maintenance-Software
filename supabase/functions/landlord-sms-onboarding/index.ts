import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import {
  ensureLandlordMainSmsNumber,
  resolveLandlordId,
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

  if (!adminReassignSecretAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: { landlordId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  let landlordId: string
  try {
    landlordId = resolveLandlordId(body.landlordId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 400)
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
      smsNumber: result.number,
    })
  } catch (err) {
    console.error("[landlord-sms-onboarding] error", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 500)
  }
})
