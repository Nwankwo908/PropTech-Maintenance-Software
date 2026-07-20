import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { adminReassignSecretAuthorized } from "../_shared/admin_reassign_auth.ts"
import {
  resolveLandlordId,
  resolveOutboundLandlordSmsLine,
} from "../_shared/sms/landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "../_shared/sms/inbound_db.ts"
import { sendInboundAutoReply } from "../_shared/sms/inboundReply.ts"
import { sendResendEmail } from "../_shared/delivery.ts"
import { logGraphEvent } from "../_shared/graph/logGraphEvent.ts"
import {
  createWorkflowRun,
  linkConversationToWorkflowRun,
  logPipelineStageEvent,
  updateWorkflowRun,
} from "../_shared/engine/workflowRuns.ts"
import { findLandlordVendorByContact } from "../_shared/vendor_verification/findVendor.ts"
import type { SmsProviderName } from "../_shared/sms/types.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function generateToken(): string {
  return `vv_${crypto.randomUUID().replace(/-/g, "")}${
    crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  }`
}

function resolveAppUrl(): string {
  const raw = Deno.env.get("APP_URL")?.trim() || "https://app.ulohome.io"
  return raw.replace(/\/$/, "")
}

function inviteSmsCopy(input: {
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

function inviteEmail(input: {
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
    "Completing a background check",
    "Providing a W-9",
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!Deno.env.get("ADMIN_REASSIGN_SECRET")?.trim()) {
    console.error("[send-vendor-invite] ADMIN_REASSIGN_SECRET not set")
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  if (!adminReassignSecretAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  let body: {
    landlordId?: string
    vendorId?: string | null
    businessName?: string
    contactName?: string
    vendorFirstName?: string
    email?: string
    phone?: string
    propertyName?: string
    channel?: string
    tradeCategories?: unknown
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
    return jsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      400,
    )
  }

  const businessName = typeof body.businessName === "string"
    ? body.businessName.trim()
    : ""
  const contactName = typeof body.contactName === "string"
    ? body.contactName.trim()
    : ""
  const vendorFirstName = typeof body.vendorFirstName === "string"
    ? body.vendorFirstName.trim()
    : (contactName.split(/\s+/)[0] ?? "")
  const email = typeof body.email === "string" ? body.email.trim() : ""
  const phone = typeof body.phone === "string" ? body.phone.trim() : ""
  const propertyName = typeof body.propertyName === "string"
    ? body.propertyName.trim()
    : ""
  const requestedVendorId =
    typeof body.vendorId === "string" && body.vendorId.trim()
      ? body.vendorId.trim()
      : null
  const tradeCategories = Array.isArray(body.tradeCategories)
    ? body.tradeCategories.filter((t): t is string => typeof t === "string")
    : []

  const channelRaw = (typeof body.channel === "string" ? body.channel : "both")
    .toLowerCase()
  const channel = ["sms", "email", "both"].includes(channelRaw)
    ? channelRaw
    : "both"

  if (!businessName && !contactName) {
    return jsonResponse(
      { error: "Provide a business name or contact name" },
      400,
    )
  }
  if (!email && !phone) {
    return jsonResponse({ error: "Provide an email or phone to send the invite" }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Link to an existing roster vendor when possible, but always mint a fresh
  // unique verification token/link for this invite.
  const vendorId = await findLandlordVendorByContact(supabase, landlordId, {
    vendorId: requestedVendorId,
    email: email || null,
    phone: phone || null,
  })

  const vendorLabel = businessName || contactName || "vendor"

  // Prefer the vendor's business name for the greeting; resolve the property
  // management company name so copy reads as a person, not a system.
  const vendorName = businessName || vendorFirstName || contactName || null
  let companyName: string | null = null
  {
    const { data: landlordRow } = await supabase
      .from("landlords")
      .select("name")
      .eq("id", landlordId)
      .maybeSingle()
    const name = typeof landlordRow?.name === "string" ? landlordRow.name.trim() : ""
    companyName = name || null
  }

  // Start a vendor_onboarding workflow run (trigger stage). Best-effort: if the
  // template is not seeded yet the run is null and the invite still sends.
  const run = await createWorkflowRun(supabase, {
    templateId: "vendor_onboarding",
    landlordId,
    triggerType: "dashboard",
    currentStep: "invited",
    metadata: {
      channel,
      business_name: businessName || null,
      contact_name: contactName || null,
      vendor_id: vendorId,
    },
  })
  const workflowRunId = run?.id ?? null

  const token = generateToken()
  const link = `${resolveAppUrl()}/v/${token}`

  const { data: inserted, error: insertErr } = await supabase
    .from("vendor_verifications")
    .insert({
      landlord_id: landlordId,
      vendor_id: vendorId,
      token,
      status: "invited",
      business_name: businessName || null,
      contact_name: contactName || null,
      vendor_first_name: vendorFirstName || null,
      email: email || null,
      phone: phone || null,
      property_name: propertyName || null,
      trade_categories: tradeCategories,
      invited_channel: channel,
      workflow_run_id: workflowRunId,
    })
    .select("id")
    .single()

  if (insertErr || !inserted?.id) {
    console.error("[send-vendor-invite] insert failed", insertErr)
    return jsonResponse({ error: "Could not create invite" }, 500)
  }

  const verificationId = inserted.id as string

  const delivery: {
    sms: "sent" | "skipped" | "failed" | null
    email: "sent" | "skipped" | "failed" | null
    smsError?: string
    emailError?: string
  } = { sms: null, email: null }

  let inviteConversationId: string | null = null
  let inviteMessageId: string | null = null

  // Email
  if ((channel === "email" || channel === "both") && email) {
    const { subject, text, html } = inviteEmail({
      vendorName,
      companyName,
      link,
    })
    const res = await sendResendEmail(email, subject, text, html)
    if ("error" in res) {
      delivery.email = "failed"
      delivery.emailError = res.error
      console.error("[send-vendor-invite] email failed", res.error)
    } else {
      delivery.email = "sent"
    }
  } else if (channel === "email" && !email) {
    delivery.email = "skipped"
  }

  // SMS (routed through the landlord's shared line + conversation thread)
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
      console.error("[send-vendor-invite] sms failed", err)
    }
  } else if (channel === "sms" && !phone) {
    delivery.sms = "skipped"
  }

  const anyDelivered = delivery.sms === "sent" || delivery.email === "sent"

  // Link the SMS thread to the run so the conversation box shows workflow context.
  if (workflowRunId && inviteConversationId) {
    await linkConversationToWorkflowRun(supabase, {
      conversationId: inviteConversationId,
      runId: workflowRunId,
      templateId: "vendor_onboarding",
    })
  }

  if (inviteConversationId) {
    // Best-effort: column added in 20260717180000. Ignore if not migrated yet.
    const { error: linkErr } = await supabase
      .from("vendor_verifications")
      .update({ invite_conversation_id: inviteConversationId })
      .eq("id", verificationId)
    if (linkErr) {
      console.warn(
        "[send-vendor-invite] invite_conversation_id not saved",
        linkErr.message,
      )
    }
  }

  const deliveredVia = [
    delivery.sms === "sent" ? "SMS" : null,
    delivery.email === "sent" ? "email" : null,
  ].filter(Boolean).join(" + ")

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "vendor.invited",
    source: "dashboard",
    actor_type: "landlord",
    vendor_id: vendorId,
    conversation_id: inviteConversationId,
    message_id: inviteMessageId,
    workflow_run_id: workflowRunId,
    workflow_template_id: workflowRunId ? "vendor_onboarding" : null,
    metadata: {
      message: `Verification invite sent to ${vendorLabel}${
        deliveredVia ? ` via ${deliveredVia}` : ""
      }.`,
      verification_id: verificationId,
      business_name: businessName || null,
      contact_name: contactName || null,
      channel,
      delivery,
      workflow_run_id: workflowRunId,
    },
  })

  // Advance the pipeline: route/act (invite delivered) → log.
  if (workflowRunId) {
    await logPipelineStageEvent(supabase, {
      runId: workflowRunId,
      stage: "act",
      step: "deliver_invite",
      actorType: "landlord",
      message: anyDelivered
        ? `Invite delivered to ${vendorLabel}${deliveredVia ? ` via ${deliveredVia}` : ""}.`
        : `Invite created for ${vendorLabel} (delivery pending).`,
      metadata: { channel, delivery, verification_id: verificationId },
    })
    await logPipelineStageEvent(supabase, {
      runId: workflowRunId,
      stage: "log",
      step: "append_graph_events",
      message: "Vendor invite logged to operations graph.",
      metadata: { verification_id: verificationId },
    })
    await updateWorkflowRun(supabase, workflowRunId, {
      currentStep: "invited",
      metadata: { verification_id: verificationId },
    })
  }

  return jsonResponse({
    ok: anyDelivered,
    verificationId,
    token,
    link,
    workflowRunId,
    delivery,
  })
})
