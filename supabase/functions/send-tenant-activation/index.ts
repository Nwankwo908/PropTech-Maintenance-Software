import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import { resolveLandlordId } from "../_shared/sms/landlordSmsOnboarding.ts"
import { sendTenantActivation } from "../_shared/sms/tenantActivation.ts"

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

  let body: {
    landlordId?: string
    residentIds?: unknown
    companyName?: string | null
    resend?: boolean
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

  const residentIds = Array.isArray(body.residentIds)
    ? body.residentIds.filter((id): id is string => typeof id === "string")
    : undefined

  const companyName =
    typeof body.companyName === "string" ? body.companyName.trim() || null : null

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const summary = await sendTenantActivation(supabase, {
      landlordId,
      residentIds,
      companyName,
      resend: body.resend === true,
    })
    return jsonResponse({ ok: true, ...summary })
  } catch (err) {
    console.error("[send-tenant-activation] error", err)
    const message = err instanceof Error ? err.message : String(err)
    return jsonResponse({ error: message }, 500)
  }
})
