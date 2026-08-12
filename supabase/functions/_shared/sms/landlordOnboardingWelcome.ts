/**
 * One-time landlord welcome SMS + email when onboarding completes.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  filterVendorEmailsFromOpsRecipients,
  normalizeOpsEmail,
  sendLandlordOpsEmail,
} from "../landlordOpsNotify.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"
import { findActiveLandlordMainNumber } from "./landlordSmsOnboarding.ts"
import { getSMSProvider } from "./providerFactory.ts"
import { uloAppUrl } from "../uloAppUrl.ts"

export type LandlordOnboardingWelcomeParams = {
  landlordId: string
  companyName?: string | null
  contactName?: string | null
}

export type LandlordOnboardingWelcomeResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  smsSent: string[]
  emailSent: string[]
  errors: string[]
}

function firstName(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return "there"
  return trimmed.split(/\s+/)[0] ?? trimmed
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function buildLandlordOnboardingWelcomeSms(input: {
  contactFirst: string
  companyName: string
  dashboardUrl: string
  smsIntakeDisplay: string | null
}): string {
  const company = input.companyName.trim() || "your portfolio"
  const lines = [
    `Hi ${input.contactFirst},`,
    "",
    "This is the Ulo team.",
    "",
    `Your setup for ${company} is complete. Open your dashboard anytime to manage maintenance, residents, and vendors.`,
  ]
  if (input.smsIntakeDisplay) {
    lines.push(
      "",
      "Residents can report maintenance by text at:",
      input.smsIntakeDisplay,
    )
  }
  lines.push("", "Open your dashboard:", input.dashboardUrl)
  return lines.join("\n")
}

export function buildLandlordOnboardingWelcomeEmail(input: {
  contactFirst: string
  companyName: string
  dashboardUrl: string
  smsIntakeDisplay: string | null
}): { subject: string; text: string; html: string } {
  const company = input.companyName.trim() || "your portfolio"
  const subject = "Your Ulo setup is complete"
  const intakeLine = input.smsIntakeDisplay
    ? `Residents can report maintenance by text at ${input.smsIntakeDisplay}.`
    : null
  const text = [
    `Hi ${input.contactFirst},`,
    "",
    "This is the Ulo team.",
    "",
    `Your setup for ${company} is complete. You can open your dashboard anytime to manage maintenance, residents, and vendors.`,
    intakeLine,
    "",
    "Open your dashboard:",
    input.dashboardUrl,
  ]
    .filter((line): line is string => line != null)
    .join("\n")

  const html = `<p>Hi ${escapeHtml(input.contactFirst)},</p>
<p>This is the Ulo team.</p>
<p>Your setup for <strong>${escapeHtml(company)}</strong> is complete. You can open your dashboard anytime to manage maintenance, residents, and vendors.</p>
${intakeLine ? `<p>${escapeHtml(intakeLine)}</p>` : ""}
<p><a href="${escapeHtml(input.dashboardUrl)}" style="display:inline-block;padding:10px 16px;background:#186179;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open your dashboard</a></p>
<p style="color:#6a7282;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:<br>${escapeHtml(input.dashboardUrl)}</p>`

  return { subject, text, html }
}

async function loadVendorPhones(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<Set<string>> {
  const blocked = new Set<string>()
  const { data, error } = await supabase
    .from("vendors")
    .select("phone")
    .eq("landlord_id", landlordId)
    .not("phone", "is", null)
    .limit(2000)
  if (error) return blocked
  for (const row of data ?? []) {
    const n = normalizePhoneFlexible(typeof row.phone === "string" ? row.phone : "")
    if (n) blocked.add(n)
  }
  return blocked
}

async function loadWelcomePhones(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string[]> {
  const candidates = new Set<string>()
  const { data: landlord } = await supabase
    .from("landlords")
    .select("phone")
    .eq("id", landlordId)
    .maybeSingle()
  if (typeof landlord?.phone === "string") {
    const n = normalizePhoneFlexible(landlord.phone)
    if (n) candidates.add(n)
  }

  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("draft_state")
    .eq("landlord_id", landlordId)
    .maybeSingle()
  const draft = (onboarding?.draft_state ?? {}) as Record<string, unknown>
  const account = (draft.accountSetup ?? {}) as Record<string, unknown>
  for (const key of ["phone", "backupContactPhone", "backup_contact_phone"]) {
    const n = normalizePhoneFlexible(
      typeof account[key] === "string" ? (account[key] as string) : "",
    )
    if (n) candidates.add(n)
  }

  const vendorPhones = await loadVendorPhones(supabase, landlordId)
  return [...candidates].filter((phone) => !vendorPhones.has(phone))
}

async function loadWelcomeEmails(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string[]> {
  const candidates = new Set<string>()
  const { data: landlord } = await supabase
    .from("landlords")
    .select("email")
    .eq("id", landlordId)
    .maybeSingle()
  if (typeof landlord?.email === "string") {
    const n = normalizeOpsEmail(landlord.email)
    if (n) candidates.add(n)
  }

  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("draft_state")
    .eq("landlord_id", landlordId)
    .maybeSingle()
  const draft = (onboarding?.draft_state ?? {}) as Record<string, unknown>
  const account = (draft.accountSetup ?? {}) as Record<string, unknown>
  const email = normalizeOpsEmail(
    typeof account.email === "string" ? account.email : "",
  )
  if (email) candidates.add(email)

  const { data: vendors } = await supabase
    .from("vendors")
    .select("email")
    .eq("landlord_id", landlordId)
    .not("email", "is", null)
    .limit(2000)
  const vendorEmails = (vendors ?? [])
    .map((row) =>
      normalizeOpsEmail(typeof row.email === "string" ? row.email : "")
    )
    .filter((e): e is string => Boolean(e))

  const { allowed } = filterVendorEmailsFromOpsRecipients(candidates, vendorEmails)
  return allowed
}

async function loadSmsIntakeDisplay(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("sms_numbers")
    .select("phone_number")
    .eq("landlord_id", landlordId)
    .eq("purpose", "landlord_main")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const phone = typeof data?.phone_number === "string" ? data.phone_number.trim() : ""
  if (phone) return phone

  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("ulo_phone_number")
    .eq("landlord_id", landlordId)
    .maybeSingle()
  const uloPhone =
    typeof onboarding?.ulo_phone_number === "string"
      ? onboarding.ulo_phone_number.trim()
      : ""
  return uloPhone || null
}

async function alreadyWelcomed(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("operations_graph_events")
    .select("id")
    .eq("landlord_id", landlordId)
    .eq("event_type", "landlord.onboarding_welcome_sent")
    .limit(1)
    .maybeSingle()
  if (error) {
    console.warn("[landlord-onboarding-welcome] idempotency lookup", error.message)
    return false
  }
  return Boolean(data?.id)
}

export async function sendLandlordOnboardingWelcome(
  supabase: SupabaseClient,
  params: LandlordOnboardingWelcomeParams,
): Promise<LandlordOnboardingWelcomeResult> {
  const landlordId = params.landlordId.trim()
  if (!landlordId) {
    return {
      ok: false,
      skipped: true,
      reason: "missing_landlord",
      smsSent: [],
      emailSent: [],
      errors: [],
    }
  }

  if (await alreadyWelcomed(supabase, landlordId)) {
    return {
      ok: true,
      skipped: true,
      reason: "already_sent",
      smsSent: [],
      emailSent: [],
      errors: [],
    }
  }

  const { data: landlordRow } = await supabase
    .from("landlords")
    .select("name, contact_name, phone, email")
    .eq("id", landlordId)
    .maybeSingle()

  const companyName =
    (params.companyName ?? "").trim() ||
    (typeof landlordRow?.name === "string" ? landlordRow.name.trim() : "") ||
    "your portfolio"
  const contactName =
    (params.contactName ?? "").trim() ||
    (typeof landlordRow?.contact_name === "string" ? landlordRow.contact_name.trim() : "")
  const contactFirst = firstName(contactName)
  const dashboardUrl = uloAppUrl.admin()
  const smsIntakeDisplay = await loadSmsIntakeDisplay(supabase, landlordId)

  const smsBody = buildLandlordOnboardingWelcomeSms({
    contactFirst,
    companyName,
    dashboardUrl,
    smsIntakeDisplay,
  })
  const emailCopy = buildLandlordOnboardingWelcomeEmail({
    contactFirst,
    companyName,
    dashboardUrl,
    smsIntakeDisplay,
  })

  const errors: string[] = []
  const smsSent: string[] = []
  const emailSent: string[] = []

  const phones = await loadWelcomePhones(supabase, landlordId)
  if (phones.length > 0) {
    const sender = await findActiveLandlordMainNumber(supabase, landlordId)
    const from = sender?.phone_number?.trim() || undefined
    if (!from) {
      errors.push("no_landlord_main_sms")
    } else {
      const provider = getSMSProvider()
      for (const to of phones) {
        const send = await provider.sendMessage({ to, body: smsBody, from })
        if (send.error) {
          errors.push(`sms:${to}:${send.error}`)
          continue
        }
        smsSent.push(to)
      }
    }
  }

  const welcomeEmails = await loadWelcomeEmails(supabase, landlordId)
  if (welcomeEmails.length > 0) {
    const mail = await sendLandlordOpsEmail(supabase, {
      landlordId,
      subject: emailCopy.subject,
      text: emailCopy.text,
      html: emailCopy.html,
      extraEmails: welcomeEmails,
      envEmails: [],
      logLabel: `onboarding-welcome:${landlordId}`,
    })
    emailSent.push(...mail.sent)
    for (const e of mail.errors) errors.push(`email:${e}`)
  }

  if (smsSent.length === 0 && emailSent.length === 0) {
    return {
      ok: false,
      skipped: false,
      reason: phones.length === 0 && welcomeEmails.length === 0
        ? "no_contact_info"
        : "delivery_failed",
      smsSent,
      emailSent,
      errors,
    }
  }

  try {
    await recordActivityLog(supabase, {
      landlordId,
      eventType: "landlord.onboarding_welcome_sent",
      source: "automation",
      actorType: "system",
      metadata: {
        message: "Welcome message sent after setup was completed.",
        sms_sent: smsSent,
        email_sent: emailSent,
        sms_intake_number: smsIntakeDisplay,
        company_name: companyName,
      },
    })
  } catch (err) {
    console.warn("[landlord-onboarding-welcome] activity log failed", err)
  }

  return {
    ok: errors.length === 0 || smsSent.length > 0 || emailSent.length > 0,
    smsSent,
    emailSent,
    errors,
  }
}
