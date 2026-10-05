import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { LIMITED_ALPHA_1_TWILIO_SMS_NUMBER } from "../../../shared/landlordCapabilities.ts"
import { normalizePhoneFlexible } from "../_shared/resident_notify.ts"
import { getSMSProvider } from "../_shared/sms/providerFactory.ts"
import { uloAppUrl } from "../_shared/uloAppUrl.ts"
import { buildLandlordVendorChoiceSms } from "../_shared/vendorLandlordChoice.ts"
import { buildVendorJobAssignmentSms } from "../_shared/vendor_outreach_copy.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const DEMO_PORTAL_EMAIL = "demo@ulohome.io"

type ExperienceId = "landlord" | "resident" | "vendor"

type DemoSessionPayload =
  | { email: string; hashed_token: string }
  | { email: string; access_token: string; refresh_token: string }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const email = raw.trim().toLowerCase()
  if (!email || !email.includes("@") || email.length > 320) return null
  return email
}

function normalizeExperience(raw: unknown): ExperienceId | null {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (value === "landlord" || value === "resident" || value === "vendor") {
    return value
  }
  return null
}

/** Staff / product emails may re-test each option while building the journey. */
function isUnlimitedTryDemoEmail(email: string): boolean {
  return email.endsWith("@ulohome.io")
}

function buildTryDemoResidentSampleSms(firstName: string): string {
  const greeting = firstName ? `Hi ${firstName}` : "Hi there"
  return [
    `${greeting} — this is a sample of how residents request repairs with Ulo.`,
    "",
    "Need a repair? Just text this number.",
    "",
    'For this demo, try texting back: "Bathroom sink is leaking"',
    "",
    "We'll ask a few quick questions, just like a real maintenance request.",
  ].join("\n")
}

function buildTryDemoVendorSampleSms(firstName: string): string {
  const vendorName = firstName.trim() || "there"
  return buildVendorJobAssignmentSms({
    vendorName,
    priority: "normal",
    unit: "2",
    description: "leaking bathroom sink",
    ticketId: "DEMO",
    issueHeadline: "leaking bathroom sink",
    location: "14 Maple Ave · Unit 2",
    entryOkIfAbsent: true,
    residentAvailabilityText: "Wed 9am–12pm",
    jobDetailUrl: uloAppUrl.admin(),
  })
}

function buildSampleSms(input: {
  experience: ExperienceId
  firstName: string
}): string | null {
  if (input.experience === "landlord") {
    return buildLandlordVendorChoiceSms({
      landlordFirstName: input.firstName || null,
      workOrderRef: "WO-DEMO",
      tradeLabel: "Plumbing",
      issueHeadline: "leaking bathroom sink",
      locationLabel: "14 Maple Ave",
      unit: "2",
      reason: "assign",
      adminUrl: uloAppUrl.admin(),
      options: [
        {
          id: "demo-metro-plumbing",
          name: "Metro Plumbing",
          role: "specialist",
          source: "roster",
          windowLabel: "Wed 9am–12pm",
          estimateNote: null,
        },
      ],
    })
  }
  if (input.experience === "resident") {
    return buildTryDemoResidentSampleSms(input.firstName)
  }
  if (input.experience === "vendor") {
    return buildTryDemoVendorSampleSms(input.firstName)
  }
  return null
}

async function mintDemoPortalSession(
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<DemoSessionPayload | null> {
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: DEMO_PORTAL_EMAIL,
  })

  if (linkErr || !linkData) {
    console.error("[send-try-demo-sms] generateLink", linkErr)
    return null
  }

  const props = linkData.properties as Record<string, unknown> | undefined
  const hashed_token =
    typeof props?.hashed_token === "string" ? props.hashed_token : null

  if (hashed_token) {
    return { email: DEMO_PORTAL_EMAIL, hashed_token }
  }

  const action_link = typeof props?.action_link === "string" ? props.action_link : null
  if (action_link) {
    try {
      const u = new URL(action_link)
      const hash = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash
      const hp = new URLSearchParams(hash)
      const access_token = hp.get("access_token")
      const refresh_token = hp.get("refresh_token")
      if (access_token && refresh_token) {
        return { email: DEMO_PORTAL_EMAIL, access_token, refresh_token }
      }
    } catch {
      /* ignore */
    }
  }

  console.error("[send-try-demo-sms] magic link missing exchangeable tokens")
  return null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Server misconfiguration" }, 500)
    }

    let body: {
      experience?: string
      phone?: string
      email?: string
      firstName?: string
      /** When true, skip SMS and only mint a Demo portal session. */
      sessionOnly?: boolean
      /**
       * Final Try Demo Next always passes this so a prior “already sent”
       * bookkeeping row (from a broken entry attempt) cannot skip the sample.
       * Still rate-limited by Twilio / carrier — not a spam loop.
       */
      forceResend?: boolean
    } = {}
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    const sessionOnly = body.sessionOnly === true
    const forceResend = body.forceResend === true
    const experience = normalizeExperience(body.experience)
    const email = normalizeEmail(body.email)
    const phone = normalizePhoneFlexible(String(body.phone ?? ""))
    const firstName =
      typeof body.firstName === "string" ? body.firstName.trim().slice(0, 80) : ""

    if (!sessionOnly && !experience) {
      return jsonResponse({ error: "Choose an experience option." }, 400)
    }
    if (!email) {
      return jsonResponse({ error: "Enter a valid work email." }, 400)
    }
    if (!sessionOnly && !phone) {
      return jsonResponse({ error: "Enter a valid phone number." }, 400)
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    // Demo admin requires a real session — mint before SMS so entry never depends on Twilio.
    const demoSession = await mintDemoPortalSession(supabase)
    if (!demoSession) {
      return jsonResponse({ error: "Could not open the demo account." }, 500)
    }

    if (sessionOnly) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "session_only",
        message: "Demo account ready.",
        demoSession,
      })
    }

    const smsBody = experience
      ? buildSampleSms({ experience, firstName })
      : null
    if (!smsBody || !experience || !phone) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "experience_not_ready",
        message: "That demo experience is not available yet.",
        demoSession,
      })
    }

    const unlimited = isUnlimitedTryDemoEmail(email)

    const { data: existing, error: existingError } = await supabase
      .from("try_demo_experience_sends")
      .select("id, updated_at")
      .eq("phone_e164", phone)
      .eq("experience", experience)
      .maybeSingle()

    if (existingError) {
      console.error("[send-try-demo-sms] lookup", existingError.message)
      // Still return demo session — SMS bookkeeping must not block entry.
      return jsonResponse({
        ok: true,
        sent: false,
        smsError: "Could not check prior demo texts.",
        demoSession,
      })
    }

    // Skip only for accidental re-clicks — not for the intentional final Next.
    if (existing && !unlimited && !forceResend) {
      return jsonResponse({
        ok: true,
        alreadySent: true,
        message: "You've already received this sample text.",
        demoSession,
      })
    }

    const from = LIMITED_ALPHA_1_TWILIO_SMS_NUMBER
    const provider = getSMSProvider()
    // Do not wait on carrier delivery receipts — that stalls the landing CTA.
    const send = await provider.sendMessage({
      to: phone,
      body: smsBody,
      from,
      waitForDelivery: false,
    })
    if (send.error) {
      console.error("[send-try-demo-sms] send failed", send.error)
      return jsonResponse({
        ok: true,
        sent: false,
        smsError: send.error,
        message: "Demo account ready. Sample text could not be sent.",
        demoSession,
      })
    }

    const now = new Date().toISOString()
    const { error: upsertError } = await supabase.from("try_demo_experience_sends").upsert(
      {
        phone_e164: phone,
        email,
        experience,
        updated_at: now,
        ...(existing ? {} : { created_at: now }),
      },
      { onConflict: "phone_e164,experience" },
    )
    if (upsertError) {
      console.warn("[send-try-demo-sms] upsert", upsertError.message)
    }

    return jsonResponse({
      ok: true,
      sent: true,
      resent: Boolean(existing && forceResend),
      providerMessageSid: send.providerMessageSid ?? null,
      message: "Sample text sent. Check your phone.",
      demoSession,
    })
  } catch (err) {
    console.error("[send-try-demo-sms]", err)
    return jsonResponse({ error: "Could not open the demo account." }, 500)
  }
})
