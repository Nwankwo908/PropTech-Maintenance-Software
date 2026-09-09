import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { sendResendEmail } from "../_shared/delivery.ts"
import { recordActivityLog } from "../_shared/graph/recordActivityLog.ts"
import {
  loadLandlordSupportContact,
  normalizeOpsEmail,
  primaryLandlordSupportEmail,
} from "../_shared/landlordOpsNotify.ts"
import { getSMSProviderFor } from "../_shared/sms/providerFactory.ts"
import { resolveOutboundLandlordSmsLine } from "../_shared/sms/landlordSmsOnboarding.ts"
import {
  landlordUsesTwilioSms,
  LIMITED_ALPHA_1_TWILIO_SMS_NUMBER,
  pickSettingsTestSmsDestination,
} from "../../../shared/landlordCapabilities.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function resolveAccountPhoneForSettingsTest(
  supabase: ReturnType<typeof createClient>,
  landlordId: string,
  requested: string,
): Promise<string | null> {
  const { data: landlord } = await supabase
    .from("landlords")
    .select("phone")
    .eq("id", landlordId)
    .maybeSingle()
  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("draft_state, account_settings")
    .eq("landlord_id", landlordId)
    .maybeSingle()
  const draft = asRecord(onboarding?.draft_state)
  const account = asRecord(draft.accountSetup)
  const settings = asRecord(onboarding?.account_settings)
  const org = {
    ...asRecord(draft.organizationSettings),
    ...asRecord(settings.organization),
  }
  const { data: members, error: membersError } = await supabase
    .from("landlord_portal_members")
    .select("phone")
    .eq("landlord_id", landlordId)
    .limit(20)
  if (membersError) {
    console.warn("[send-settings-test-notification] portal members", membersError.message)
  }
  const memberPhones = (members ?? []).map((row) =>
    typeof row.phone === "string" ? row.phone : "",
  )
  const { data: residents } = await supabase
    .from("users")
    .select("phone")
    .eq("landlord_id", landlordId)
    .not("phone", "is", null)
    .limit(500)
  const residentPhones = (residents ?? []).map((row) =>
    typeof row.phone === "string" ? row.phone : "",
  )
  return pickSettingsTestSmsDestination(
    [
      requested,
      typeof landlord?.phone === "string" ? landlord.phone : "",
      typeof account.phone === "string" ? account.phone : "",
      typeof org.phone === "string" ? org.phone : "",
      typeof account.backupContactPhone === "string" ? account.backupContactPhone : "",
      typeof org.backupContactPhone === "string" ? org.backupContactPhone : "",
      ...memberPhones,
    ],
    { exclude: residentPhones },
  )
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Server misconfiguration" }, 500)
    }
    const supabase = createClient(supabaseUrl, serviceKey)

    let body: {
      landlordId?: string
      channel?: "email" | "sms"
      toEmail?: string
      toPhone?: string
    } = {}
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

    const to = await resolveAccountPhoneForSettingsTest(
      supabase,
      landlordId,
      String(body.toPhone ?? ""),
    )
    if (!to) {
      return jsonResponse({
        error:
          "Add the property team phone in Organization. The number on file is a resident number, not the account holder.",
      }, 400)
    }

    const line = await resolveOutboundLandlordSmsLine(supabase, landlordId)
    const from = landlordUsesTwilioSms(landlordId)
      ? LIMITED_ALPHA_1_TWILIO_SMS_NUMBER
      : line?.phone
    if (!from) {
      return jsonResponse({ error: "This account does not have an SMS number yet." }, 400)
    }

    const provider = getSMSProviderFor(
      landlordUsesTwilioSms(landlordId) ? "twilio" : (line?.provider ?? "telnyx"),
    )
    const bodyText =
      "This is a test notification from Ulo. If you received this, SMS delivery is working for your account."
    const send = await provider.sendMessage({
      to,
      body: bodyText,
      from,
      waitForDelivery: true,
    })
    if (send.error) {
      return jsonResponse({ ok: false, error: send.error }, 502)
    }

    try {
      await recordActivityLog(supabase, {
        landlordId,
        eventType: "settings.test_sms_sent",
        source: "dashboard",
        actorType: "landlord",
        metadata: { message: "Test SMS sent to the account phone." },
      })
    } catch (logErr) {
      console.warn("[send-settings-test-notification] activity log", logErr)
    }

    return jsonResponse({
      ok: true,
      message: `Test SMS sent to ${to} from ${from}.`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[send-settings-test-notification]", message)
    return jsonResponse({ ok: false, error: message || "Could not send the test text." }, 500)
  }
})
