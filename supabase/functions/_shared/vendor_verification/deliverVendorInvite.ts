/**
 * Vendor verification invite delivery — reused by the vendor_onboarding engine
 * and the send-vendor-invite edge trigger.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail } from "../delivery.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../sms/inbound_db.ts"
import { sendInboundAutoReply } from "../sms/inboundReply.ts"
import { resolveOutboundLandlordSmsLine } from "../sms/landlordSmsOnboarding.ts"
import type { SmsProviderName } from "../sms/types.ts"
import { uloAppUrl } from "../uloAppUrl.ts"
import { markVendorOnboardingInviteDelivered } from "../engine/vendorOnboardingProgress.ts"

export type VendorInviteDeliveryResult = {
  verificationId: string
  token: string
  link: string
  delivery: {
    sms: "sent" | "skipped" | "failed" | null
    email: "sent" | "skipped" | "failed" | null
    smsError?: string
    emailError?: string
  }
  anyDelivered: boolean
  deliveredVia: string
  inviteConversationId: string | null
  inviteMessageId: string | null
}

export type VendorInviteRequest = {
  landlordId: string
  workflowRunId: string | null
  vendorId: string | null
  businessName: string | null
  contactName: string | null
  vendorFirstName: string | null
  email: string | null
  phone: string | null
  propertyName: string | null
  channel: string
  tradeCategories: string[]
  vendorName: string | null
  companyName: string | null
}

export function generateVendorVerificationToken(): string {
  return `vv_${crypto.randomUUID().replace(/-/g, "")}${
    crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  }`
}

export function inviteSmsCopy(input: {
  vendorName: string | null
  companyName: string | null
  link: string
}): string {
  const greeting = input.vendorName ? `Hi ${input.vendorName},` : "Hi,"
  const team = input.companyName
    ? `This is the property management team at ${input.companyName}.`
    : "This is the property management team."
  return [
    greeting,
    "",
    team,
    "",
    "We'd like to invite you to join our preferred vendor network on Ulo. " +
    "Complete a quick verification (about 5 minutes) so we can begin sending you work orders.",
    "",
    input.link,
  ].join("\n")
}

export function inviteEmailCopy(input: {
  vendorName: string | null
  companyName: string | null
  link: string
}): { subject: string; text: string; html: string } {
  const vendor = input.vendorName || "there"
  const company = input.companyName || "Our property management team"
  const subject = "You're invited to join our vendor network"
  const steps = [
    "Verifying your professional license",
    "Uploading your insurance certificate",
    "Providing a W-9 (optional)",
    "Setting up your payout account",
    "Confirming the services you offer and the areas you serve",
  ]
  const text = [
    `Hi ${vendor},`,
    "",
    `${company} would like to add you to our preferred vendor network on Ulo.`,
    "",
    "Complete a quick verification to become eligible to receive work orders from our team.",
    "",
    "The process takes about 5 minutes and includes:",
    ...steps.map((step) => `• ${step}`),
    "",
    "Once everything is verified, you'll be eligible to receive work orders through Ulo.",
    "",
    `Start verification: ${input.link}`,
    "",
    "If the button doesn't work, copy and paste this link into your browser:",
    input.link,
    "",
    "Thank you,",
    company,
  ].join("\n")

  const stepsHtml = steps
    .map(
      (step) =>
        `<li style="margin:4px 0">${step}</li>`,
    )
    .join("")

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a;line-height:1.6;max-width:520px;margin:0 auto">
      <p>Hi ${vendor},</p>
      <p><strong>${company}</strong> would like to add you to our preferred vendor network on Ulo.</p>
      <p>Complete a quick verification to become eligible to receive work orders from our team.</p>
      <p style="margin-bottom:6px">The process takes about <strong>5 minutes</strong> and includes:</p>
      <ul style="margin:0 0 8px 20px;padding:0">${stepsHtml}</ul>
      <p>Once everything is verified, you'll be eligible to receive work orders through Ulo.</p>
      <p style="margin:24px 0">
        <a href="${input.link}" style="background:#186179;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block">Start Verification</a>
      </p>
      <p style="color:#6a7282;font-size:13px">If the button doesn't work, copy and paste this link into your browser:<br/>${input.link}</p>
      <p>Thank you,<br/>${company}</p>
    </div>
  `.trim()

  return { subject, text, html }
}

export function vendorInviteFailureUserMessage(delivery?: {
  sms?: string | null
  email?: string | null
  smsError?: string
  emailError?: string
} | null): string {
  const emailSent = delivery?.email === "sent"
  const smsError = (delivery?.smsError ?? "").trim()
  const emailError = (delivery?.emailError ?? "").trim().toLowerCase()

  if (smsError.startsWith("persist_failed")) {
    if (smsError.toLowerCase().includes("schema cache") || smsError.toLowerCase().includes("could not find")) {
      return "We couldn't start vendor onboarding because the database is still updating. Wait a few seconds and try again."
    }
    if (smsError.toLowerCase().includes("foreign key") || smsError.toLowerCase().includes("violates")) {
      return "We couldn't start vendor onboarding. Refresh the vendor profile and try again."
    }
    return "We couldn't start vendor onboarding. Please try again in a moment."
  }
  if (
    smsError === "no_active_landlord_sms_line" &&
    !emailSent
  ) {
    if (emailError.includes("resend")) {
      return "We couldn't send the verification invite. This account doesn't have an SMS line set up yet, and email delivery isn't configured."
    }
    if (delivery?.email === "failed") {
      return "We couldn't send the verification invite. This account doesn't have an SMS line set up yet, and the email could not be delivered."
    }
    return "We couldn't send the verification invite because this account doesn't have an SMS line set up yet."
  }
  if (smsError === "invalid_phone" && !emailSent) {
    return "We couldn't send the verification invite. Check that the vendor's phone number is valid and try again."
  }
  if (emailError.includes("resend") && delivery?.sms !== "sent") {
    return "We couldn't send the verification invite by email because email delivery isn't configured yet."
  }
  if (delivery?.sms === "failed" && !emailSent) {
    return "We couldn't send the verification invite by text. Check the vendor's phone number and try again."
  }
  if (delivery?.email === "failed" && delivery?.sms !== "sent") {
    return "We couldn't send the verification invite by email. Check the vendor's email address and try again."
  }
  return "We couldn't send the verification invite. Check the vendor's contact info and try again."
}

/** Live DBs may omit `invited` from vendor_verifications_status_check. */
const INVITE_STATUS_FALLBACKS = ["invited", "in_progress", "pending"] as const

function isVerificationStatusCheckError(error: {
  code?: string
  message?: string
} | null): boolean {
  if (!error) return false
  const message = (error.message ?? "").toLowerCase()
  return error.code === "23514" && message.includes("vendor_verifications_status_check")
}

async function insertVendorVerificationInvite(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<{ data: { id: string } | null; error: { code?: string; message?: string } | null }> {
  let lastError: { code?: string; message?: string } | null = null
  for (const status of INVITE_STATUS_FALLBACKS) {
    const { data, error } = await supabase
      .from("vendor_verifications")
      .insert({ ...payload, status })
      .select("id")
      .single()
    if (!error && data?.id) {
      return { data: { id: data.id as string }, error: null }
    }
    lastError = error
    console.error("[deliverVendorInvite] insert failed", { status, error })
    if (!isVerificationStatusCheckError(error)) {
      return { data: data?.id ? { id: data.id as string } : null, error }
    }
  }
  return { data: null, error: lastError }
}

/**
 * Create verification row, deliver SMS/email, link conversation, and advance the run.
 */
export async function deliverVendorInvite(
  supabase: SupabaseClient,
  params: VendorInviteRequest,
): Promise<VendorInviteDeliveryResult | null> {
  const {
    landlordId,
    workflowRunId,
    vendorId,
    businessName,
    contactName,
    vendorFirstName,
    email,
    phone,
    propertyName,
    channel,
    tradeCategories,
    vendorName,
    companyName,
  } = params

  const vendorLabel = businessName || contactName || "vendor"
  const token = generateVendorVerificationToken()
  const link = uloAppUrl.vendorVerification(token)
  const runId = workflowRunId?.trim() || null

  const insertPayload: Record<string, unknown> = {
    landlord_id: landlordId,
    vendor_id: vendorId,
    token,
    business_name: businessName || null,
    contact_name: contactName || null,
    vendor_first_name: vendorFirstName || null,
    email: email || null,
    phone: phone || null,
    property_name: propertyName || null,
    trade_categories: tradeCategories,
    invited_channel: channel,
  }
  if (runId) insertPayload.workflow_run_id = runId

  let { data: inserted, error: insertErr } = await insertVendorVerificationInvite(
    supabase,
    insertPayload,
  )

  if (insertErr) {
    console.error("[deliverVendorInvite] insert failed", insertErr)
    const retry = await insertVendorVerificationInvite(supabase, {
      landlord_id: landlordId,
      vendor_id: vendorId,
      token,
      business_name: businessName || null,
      email: email || null,
      phone: phone || null,
    })
    inserted = retry.data
    insertErr = retry.error
    if (insertErr) {
      console.error("[deliverVendorInvite] insert retry failed", insertErr)
    }
  }

  if (insertErr || !inserted?.id) {
    console.error("[deliverVendorInvite] insert failed", insertErr)
    return {
      verificationId: "",
      token,
      link,
      delivery: {
        sms: null,
        email: null,
        smsError: insertErr?.message ? `persist_failed:${insertErr.message}` : "persist_failed",
      },
      anyDelivered: false,
      deliveredVia: "",
      inviteConversationId: null,
      inviteMessageId: null,
    }
  }

  const verificationId = inserted.id as string

  const delivery: VendorInviteDeliveryResult["delivery"] = {
    sms: null,
    email: null,
  }

  let inviteConversationId: string | null = null
  let inviteMessageId: string | null = null

  if ((channel === "email" || channel === "both") && email) {
    const { subject, text, html } = inviteEmailCopy({
      vendorName,
      companyName,
      link,
    })
    const res = await sendResendEmail(email, subject, text, html)
    if ("error" in res) {
      delivery.email = "failed"
      delivery.emailError = res.error
      console.error("[deliverVendorInvite] email failed", res.error)
    } else {
      delivery.email = "sent"
    }
  } else if (channel === "email" && !email) {
    delivery.email = "skipped"
  }

  if ((channel === "sms" || channel === "both") && phone) {
    try {
      const line = await resolveOutboundLandlordSmsLine(supabase, landlordId)
      if (!line) {
        delivery.sms = "skipped"
        delivery.smsError = "no_active_landlord_sms_line"
      } else {
        const provider: SmsProviderName = line.provider === "telnyx"
          ? "telnyx"
          : "twilio"
        const identity = await upsertSmsIdentityForPhone(supabase, {
          landlordId,
          phone,
          identityType: "vendor",
          vendorId,
        })
        if (!identity) {
          delivery.sms = "failed"
          delivery.smsError = "invalid_phone"
        } else {
          const { conversationId } = await findOrCreateConversation(supabase, {
            landlordId,
            smsNumberId: line.id,
            externalPhone: phone,
            identity,
            conversationStatus: "open",
          })
          inviteConversationId = conversationId
          const sent = await sendInboundAutoReply(supabase, {
            conversationId,
            landlordId,
            fromNumber: line.phone,
            toNumber: phone,
            body: inviteSmsCopy({
              vendorName,
              companyName,
              link,
            }),
            provider,
            source: "vendor_invite",
          })
          delivery.sms = sent.ok ? "sent" : "failed"
          if (sent.messageId) inviteMessageId = sent.messageId
          if (!sent.ok) delivery.smsError = sent.error
        }
      }
    } catch (err) {
      delivery.sms = "failed"
      delivery.smsError = err instanceof Error ? err.message : String(err)
      console.error("[deliverVendorInvite] sms failed", err)
    }
  } else if (channel === "sms" && !phone) {
    delivery.sms = "skipped"
  }

  if (delivery.email == null && email && delivery.sms !== "sent") {
    const { subject, text, html } = inviteEmailCopy({
      vendorName,
      companyName,
      link,
    })
    const res = await sendResendEmail(email, subject, text, html)
    if ("error" in res) {
      delivery.email = "failed"
      delivery.emailError = res.error
      console.error("[deliverVendorInvite] email fallback failed", res.error)
    } else {
      delivery.email = "sent"
    }
  }

  const anyDelivered = delivery.sms === "sent" || delivery.email === "sent"
  const deliveredVia = [
    delivery.sms === "sent" ? "SMS" : null,
    delivery.email === "sent" ? "email" : null,
  ].filter(Boolean).join(" + ")

  if (!anyDelivered) {
    return {
      verificationId,
      token,
      link,
      delivery,
      anyDelivered,
      deliveredVia,
      inviteConversationId,
      inviteMessageId,
    }
  }

  if (inviteConversationId) {
    const { error: linkErr } = await supabase
      .from("vendor_verifications")
      .update({ invite_conversation_id: inviteConversationId })
      .eq("id", verificationId)
    if (linkErr) {
      console.warn(
        "[deliverVendorInvite] invite_conversation_id not saved",
        linkErr.message,
      )
    }
  }

  await markVendorOnboardingInviteDelivered(supabase, {
    runId,
    verificationId,
    vendorLabel,
    channel,
    delivery,
    anyDelivered,
    deliveredVia,
    conversationId: inviteConversationId,
  })

  await recordActivityLog(supabase, {
    landlordId,
    eventType: "vendor.invited",
    source: "dashboard",
    actorType: "landlord",
    vendorId,
    conversationId: inviteConversationId,
    messageId: inviteMessageId,
    workflowRunId,
    workflowTemplateId: "vendor_onboarding",
    metadata: {
      message: `Verification invite sent to ${vendorLabel}${
        deliveredVia ? ` via ${deliveredVia}` : ""
      }.`,
      verification_id: verificationId,
      business_name: businessName,
      contact_name: contactName,
      channel,
      delivery,
      workflow_run_id: workflowRunId,
    },
  })

  return {
    verificationId,
    token,
    link,
    delivery,
    anyDelivered,
    deliveredVia,
    inviteConversationId,
    inviteMessageId,
  }
}
