import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { sendResendEmail } from "../_shared/delivery.ts"
import {
  loadLandlordSupportContact,
  normalizeOpsEmail,
  primaryLandlordSupportEmail,
} from "../_shared/landlordOpsNotify.ts"
import { getSMSProviderForSend } from "../_shared/sms/providerFactory.ts"
import { findActiveLandlordMainNumber } from "../_shared/sms/landlordSmsOnboarding.ts"
import { resolveLandlordOpsPhones } from "../_shared/sms/tenantActivationAdminAlert.ts"

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

  const adminAuth = requireAdminReassignAuth(req, "[send-settings-test-notification]", corsHeaders)
  if (!adminAuth.ok) return adminAuth.response

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  const supabase = createClient(supabaseUrl, serviceKey)

  let body: { landlordId?: string; channel?: "email" | "sms"; toEmail?: string } = {}
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const landlordId = String(body.landlordId ?? "").trim()
  const channel = body.channel === "sms" ? "sms" : body.channel === "email" ? "email" : null
  if (!landlordId || !channel) {
    return jsonResponse({ error: "landlordId and channel are required" }, 400)
  }

  if (channel === "email") {
    const contact = await loadLandlordSupportContact(supabase, landlordId)
    const requested = normalizeOpsEmail(String(body.toEmail ?? ""))
    const to =
      primaryLandlordSupportEmail({
        accountSetupEmail: requested,
        organizationSupportEmail: contact.organizationSupportEmail,
        landlordEmail: contact.landlordEmail,
      }) ??
      requested ??
      ""
    if (!to) {
      return jsonResponse({ error: "No email on file for this account." }, 400)
    }
    const subject = "Ulo test notification"
    const text =
      "This is a test notification from Ulo. If you received this, email delivery is working for your account."
    const result = await sendResendEmail(to, subject, text, `<p>${text}</p>`)
    if ("error" in result) {
      return jsonResponse({ ok: false, error: result.error }, 502)
    }
    return jsonResponse({ ok: true, message: `Test email sent to ${to}.` })
  }

  const { phones } = await resolveLandlordOpsPhones(supabase, landlordId)
  const to = phones[0]
  if (!to) {
    return jsonResponse({ error: "No SMS phone on file for this account." }, 400)
  }
  const main = await findActiveLandlordMainNumber(supabase, landlordId)
  const provider = getSMSProviderForSend({
    landlordId,
    lineProvider: main?.provider,
  })
  const bodyText =
    "This is a test notification from Ulo. If you received this, SMS delivery is working for your account."
  const send = await provider.sendMessage({
    to,
    body: bodyText,
    from: main?.phone_number,
  })
  if (send.error) {
    return jsonResponse({ ok: false, error: send.error }, 502)
  }
  return jsonResponse({ ok: true, message: `Test SMS sent to ${to}.` })
})
