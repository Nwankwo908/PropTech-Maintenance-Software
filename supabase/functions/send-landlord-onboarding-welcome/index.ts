import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"
import { sendLandlordOnboardingWelcome } from "../_shared/sms/landlordOnboardingWelcome.ts"

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
    companyName?: string | null
    contactName?: string | null
    email?: string | null
    forceEmail?: boolean
  }
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Expected JSON object" }, 400)
    body = parsed as typeof body
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const landlordId = typeof body.landlordId === "string" ? body.landlordId.trim() : ""
  if (!isUuidShape(landlordId)) return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  const companyName =
    typeof body.companyName === "string" ? body.companyName.trim() || null : null
  const contactName =
    typeof body.contactName === "string" ? body.contactName.trim() || null : null

  const email =
    typeof body.email === "string" ? body.email.trim() || null : null
  const forceEmail = body.forceEmail === true

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const summary = await sendLandlordOnboardingWelcome(supabase, {
      landlordId,
      companyName,
      contactName,
      email,
      forceEmail,
    })
    return jsonResponse(summary)
  } catch (err) {
    console.error("[send-landlord-onboarding-welcome] error", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 500)
  }
})
