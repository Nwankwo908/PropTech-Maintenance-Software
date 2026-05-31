import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../_shared/delivery.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const email = raw.trim().toLowerCase()
  if (!email || !email.includes("@") || email.length > 320) return null
  return email
}

function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const code = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10)
  if (code.length < 4) return null
  return code
}

function normalizeAppOrigin(raw?: string): string | null {
  if (!raw?.trim()) return null
  try {
    const url = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`)
    return url.origin
  } catch {
    return null
  }
}

function resolveReferralBase(origin?: string): string | null {
  const fromOrigin = normalizeAppOrigin(origin)
  const fromEnv = normalizeAppOrigin(Deno.env.get("APP_URL") ?? undefined)

  // Prefer the browser origin when signing up on a deployed site (not localhost).
  if (fromOrigin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(fromOrigin)) {
    return fromOrigin
  }

  return fromEnv ?? fromOrigin
}

function buildReferralLink(referralCode: string, origin?: string): string {
  const base = resolveReferralBase(origin)
  if (!base) return `/?ref=${referralCode}`
  return `${base}/?ref=${referralCode}`
}

async function resolveReferrerId(
  admin: ReturnType<typeof createClient>,
  ref: string,
  signupEmail: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("waitlist_signups")
    .select("id, email")
    .eq("referral_code", ref)
    .maybeSingle()

  if (error || !data?.id) {
    if (error) console.error("[join-waitlist] referrer lookup error", error)
    return null
  }

  if (data.email === signupEmail) return null
  return data.id
}

async function fetchSignupReferralLink(
  admin: ReturnType<typeof createClient>,
  email: string,
  origin?: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("waitlist_signups")
    .select("referral_code")
    .eq("email", email)
    .maybeSingle()

  if (error || !data?.referral_code) {
    console.error("[join-waitlist] referral lookup error", error)
    return null
  }

  return buildReferralLink(data.referral_code, origin)
}

function buildWaitlistConfirmationEmail(
  email: string,
  alreadyExists: boolean,
): { subject: string; text: string; html: string } {
  const safeEmail = escapeHtml(email)
  const subject = alreadyExists
    ? "You're already on the Ulo Home waitlist"
    : "You're on the Ulo Home waitlist"

  const intro = alreadyExists
    ? "You're already signed up for early access to Ulo Home."
    : "Thanks for signing up for early access to Ulo Home."

  const text = `${intro}

We've confirmed your request for ${email}. We'll reach out when early access opens.

— The Ulo Home team`

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f0fdf4;font-family:Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0fdf4;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:32px;">
            <tr>
              <td>
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0e5c45;">Ulo Home</p>
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#1f2937;">${escapeHtml(subject)}</h1>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#4b5563;">${escapeHtml(intro)}</p>
                <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#4b5563;">We've confirmed your request for <strong>${safeEmail}</strong>. We'll reach out when early access opens.</p>
                <p style="margin:0;font-size:14px;line-height:1.6;color:#6b7280;">— The Ulo Home team</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    const body = await req.json()
    const email = normalizeEmail(body?.email)
    const sourceRaw = body?.source
    const source =
      sourceRaw === "google" || sourceRaw === "email" ? sourceRaw : "email"
    const origin =
      typeof body?.origin === "string" ? body.origin.trim() : undefined
    const ref = normalizeReferralCode(body?.ref)

    if (!email) {
      return jsonResponse({ error: "Enter a valid email address." }, 400)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Server misconfiguration." }, 500)
    }

    const admin = createClient(supabaseUrl, serviceKey)
    let alreadyExists = false
    const referredBy = ref ? await resolveReferrerId(admin, ref, email) : null

    const { error: insertError } = await admin.from("waitlist_signups").insert({
      email,
      source,
      referred_by: referredBy,
    })

    if (insertError) {
      if (insertError.code === "23505") {
        alreadyExists = true
      } else {
        console.error("[join-waitlist] insert error", insertError)
        return jsonResponse({ error: insertError.message }, 500)
      }
    }

    const { subject, text, html } = buildWaitlistConfirmationEmail(
      email,
      alreadyExists,
    )
    const emailResult = await sendResendEmail(email, subject, text, html)

    if ("error" in emailResult) {
      console.error("[join-waitlist] email error", emailResult.error)
      return jsonResponse(
        {
          error:
            /resend not configured/i.test(emailResult.error)
              ? "Confirmation email is not configured yet. Your signup was saved — we'll follow up manually."
              : "Could not send confirmation email. Please try again in a few minutes.",
          saved: true,
          alreadyExists,
        },
        /resend not configured/i.test(emailResult.error) ? 503 : 502,
      )
    }

    const referralLink = await fetchSignupReferralLink(admin, email, origin)
    const { data: signupRow } = await admin
      .from("waitlist_signups")
      .select("referral_code")
      .eq("email", email)
      .maybeSingle()

    return jsonResponse({
      ok: true,
      alreadyExists,
      emailSent: true,
      referralLink,
      referralCode: signupRow?.referral_code ?? null,
    })
  } catch (err) {
    console.error("[join-waitlist] unexpected error", err)
    return jsonResponse({ error: "Unexpected server error." }, 500)
  }
})
