/**
 * One-time landlord welcome SMS + email when onboarding completes.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../delivery.ts"
import { normalizeOpsEmail } from "../landlordOpsNotify.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"
import { resolveOutboundLandlordSmsLine } from "./landlordSmsOnboarding.ts"
import { getSMSProviderForSend } from "./providerFactory.ts"
import { uloAppUrl } from "../uloAppUrl.ts"
import { resolveSmsIntakeNumber } from "../../../../shared/landlordCapabilities.ts"
import { landlordPortfolioLabel } from "../../../../shared/landlordPortfolioLabel.ts"
import { planLandlordWelcomeDelivery } from "../../../../shared/onboarding/landlordWelcomeDelivery.ts"

export type LandlordOnboardingWelcomeParams = {
  landlordId: string
  companyName?: string | null
  contactName?: string | null
  email?: string | null
  /** Send email even if a prior welcome event already recorded email_sent. */
  forceEmail?: boolean
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
  const company = input.companyName.trim() || "your properties"
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
  const company = input.companyName.trim() || "your properties"
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

/** Landlord identity emails are never dropped, even if a vendor row reuses the address. */
export function collectLandlordWelcomeEmails(input: {
  landlordEmail?: string | null
  accountEmail?: string | null
  requestedEmail?: string | null
}): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of [input.requestedEmail, input.accountEmail, input.landlordEmail]) {
    const email = normalizeOpsEmail(raw ?? "")
    if (!email || seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

function stringListFromMeta(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

async function loadSmsIntakeDisplay(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string> {
  const { data } = await supabase
    .from("sms_numbers")
    .select("phone_number, provider")
    .eq("landlord_id", landlordId)
    .eq("purpose", "landlord_main")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const phone = typeof data?.phone_number === "string" ? data.phone_number.trim() : ""
  const provider = typeof data?.provider === "string" ? data.provider : ""

  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("ulo_phone_number")
    .eq("landlord_id", landlordId)
    .maybeSingle()
  const uloPhone =
    typeof onboarding?.ulo_phone_number === "string"
      ? onboarding.ulo_phone_number.trim()
      : ""

  return resolveSmsIntakeNumber({
    landlordId,
    phone: phone || uloPhone,
    provider,
  })
}

async function loadWelcomeEmails(
  supabase: SupabaseClient,
  landlordId: string,
  requestedEmail?: string | null,
): Promise<string[]> {
  const { data: landlord } = await supabase
    .from("landlords")
    .select("email")
    .eq("id", landlordId)
    .maybeSingle()

  const { data: onboarding } = await supabase
    .from("landlord_onboarding")
    .select("draft_state")
    .eq("landlord_id", landlordId)
    .maybeSingle()
  const draft = (onboarding?.draft_state ?? {}) as Record<string, unknown>
  const account = (draft.accountSetup ?? {}) as Record<string, unknown>

  return collectLandlordWelcomeEmails({
    requestedEmail,
    landlordEmail: typeof landlord?.email === "string" ? landlord.email : null,
    accountEmail: typeof account.email === "string" ? account.email : null,
  })
}

type PriorWelcome = {
  exists: boolean
  smsSent: string[]
  emailSent: string[]
  smsSkipped: string[]
  emailSkipped: string[]
}

async function loadPriorWelcome(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<PriorWelcome> {
  const { data, error } = await supabase
    .from("operations_graph_events")
    .select("id, metadata")
    .eq("landlord_id", landlordId)
    .in("event_type", [
      "landlord.onboarding_welcome_sent",
      "landlord.onboarding_welcome_email_sent",
      "landlord.onboarding_welcome_skipped",
    ])
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    console.warn("[landlord-onboarding-welcome] idempotency lookup", error.message)
    return { exists: false, smsSent: [], emailSent: [], smsSkipped: [], emailSkipped: [] }
  }

  const smsSent = new Set<string>()
  const emailSent = new Set<string>()
  const smsSkipped = new Set<string>()
  const emailSkipped = new Set<string>()
  for (const row of data ?? []) {
    const metadata = (row as { metadata?: Record<string, unknown> }).metadata ?? {}
    for (const item of stringListFromMeta(metadata.sms_sent)) smsSent.add(item)
    for (const item of stringListFromMeta(metadata.email_sent)) emailSent.add(item)
    for (const item of stringListFromMeta(metadata.sms_skipped)) smsSkipped.add(item)
    for (const item of stringListFromMeta(metadata.email_skipped)) emailSkipped.add(item)
  }
  return {
    exists: (data ?? []).length > 0,
    smsSent: [...smsSent],
    emailSent: [...emailSent],
    smsSkipped: [...smsSkipped],
    emailSkipped: [...emailSkipped],
  }
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

  const prior = await loadPriorWelcome(supabase, landlordId)
  const welcomePhones = await loadWelcomePhones(supabase, landlordId)
  const welcomeEmails = await loadWelcomeEmails(supabase, landlordId, params.email)
  const plan = planLandlordWelcomeDelivery({
    phones: welcomePhones,
    emails: welcomeEmails,
    priorSmsSent: prior.smsSent,
    priorEmailSent: prior.emailSent,
    priorSmsSkipped: prior.smsSkipped,
    priorEmailSkipped: prior.emailSkipped,
    forceEmail: params.forceEmail,
  })
  const nothingNew =
    plan.smsToSend.length === 0 &&
    plan.emailToSend.length === 0 &&
    plan.smsSkipped.length === 0 &&
    plan.emailSkipped.length === 0
  if (nothingNew && (prior.smsSent.length > 0 || prior.emailSent.length > 0)) {
    return {
      ok: true,
      skipped: true,
      reason: "already_sent",
      smsSent: prior.smsSent,
      emailSent: prior.emailSent,
      errors: [],
    }
  }
  if (
    nothingNew &&
    (prior.smsSkipped.length > 0 || prior.emailSkipped.length > 0)
  ) {
    return {
      ok: true,
      skipped: true,
      reason: "undeliverable_contact",
      smsSent: [],
      emailSent: [],
      errors: [],
    }
  }
  if (nothingNew) {
    return {
      ok: false,
      skipped: true,
      reason: "no_contact_info",
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

  const contactName =
    (params.contactName ?? "").trim() ||
    (typeof landlordRow?.contact_name === "string" ? landlordRow.contact_name.trim() : "")
  const companyName =
    landlordPortfolioLabel({
      companyName:
        (params.companyName ?? "").trim() ||
        (typeof landlordRow?.name === "string" ? landlordRow.name.trim() : ""),
      contactName,
    }) || "your properties"
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

  const phones = plan.smsToSend
  if (phones.length > 0) {
    // Same Alpha-aware shared Twilio DID path as tenant welcome / vendor invite.
    const line = await resolveOutboundLandlordSmsLine(supabase, landlordId)
    const from = line?.phone?.trim() || undefined
    if (!from) {
      errors.push("no_landlord_main_sms")
    } else {
      const provider = getSMSProviderForSend({
        landlordId,
        lineProvider: line!.provider,
      })
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

  if (plan.emailToSend.length > 0) {
    for (const to of plan.emailToSend) {
      const mail = await sendResendEmail(
        to,
        emailCopy.subject,
        emailCopy.text,
        emailCopy.html,
      )
      if ("error" in mail) {
        errors.push(`email:${to}:${mail.error}`)
        continue
      }
      emailSent.push(to)
    }
  }

  if (smsSent.length === 0 && emailSent.length === 0) {
    const undeliverable =
      errors.length === 0 &&
      (plan.smsSkipped.length > 0 || plan.emailSkipped.length > 0)
    if (undeliverable) {
      try {
        await recordActivityLog(supabase, {
          landlordId,
          eventType: "landlord.onboarding_welcome_skipped",
          source: "automation",
          actorType: "system",
          metadata: {
            message:
              "Setup welcome was not sent because the contact details cannot receive messages.",
            sms_skipped: plan.smsSkipped,
            email_skipped: plan.emailSkipped,
          },
        })
      } catch (err) {
        console.warn("[landlord-onboarding-welcome] skip log failed", err)
      }
    }
    return {
      ok: undeliverable,
      skipped: undeliverable,
      reason: undeliverable ? "undeliverable_contact" : "delivery_failed",
      smsSent,
      emailSent,
      errors,
    }
  }

  const emailOnly = smsSent.length === 0
  try {
    await recordActivityLog(supabase, {
      landlordId,
      eventType: emailOnly
        ? "landlord.onboarding_welcome_email_sent"
        : "landlord.onboarding_welcome_sent",
      source: "automation",
      actorType: "system",
      metadata: {
        message: emailOnly
          ? "Welcome email sent after setup was completed."
          : "Welcome message sent after setup was completed.",
        sms_sent: smsSent,
        email_sent: emailSent,
        sms_skipped: plan.smsSkipped,
        email_skipped: plan.emailSkipped,
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
