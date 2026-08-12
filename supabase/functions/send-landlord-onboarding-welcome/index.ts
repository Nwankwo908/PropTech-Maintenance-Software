import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { resolveLandlordId } from "../_shared/sms/landlordSmsOnboarding.ts"
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

  const adminAuth = requireAdminReassignAuth(req, "[send-landlord-onboarding-welcome]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  let body: {
    landlordId?: string
    companyName?: string | null
    contactName?: string | null
  }
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

  const companyName =
    typeof body.companyName === "string" ? body.companyName.trim() || null : null
  const contactName =
    typeof body.contactName === "string" ? body.contactName.trim() || null : null

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const summary = await sendLandlordOnboardingWelcome(supabase, {
      landlordId,
      companyName,
      contactName,
    })
    return jsonResponse(summary)
  } catch (err) {
    console.error("[send-landlord-onboarding-welcome] error", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 500)
  }
})
