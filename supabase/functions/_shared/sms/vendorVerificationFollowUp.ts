/**
 * Vendor verification SMS follow-ups after form submit:
 * 1) Acknowledge receipt (under review)
 * 2) Status: verified, or incomplete with outstanding items + form link
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import type { VerificationChecklist } from "../vendor_verification/checklist.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import { resolveOutboundLandlordSmsLine } from "./landlordSmsOnboarding.ts"
import { resolveVendorVerificationConversationId } from "./vendorVerificationInbox.ts"
import type { SmsProviderName } from "./types.ts"

function resolveAppUrl(): string {
  const raw = Deno.env.get("APP_URL")?.trim() || "https://app.ulohome.io"
  return raw.replace(/\/$/, "")
}

function firstNameOrVendor(vendorLabel: string): string {
  const trimmed = vendorLabel.trim()
  return trimmed || "there"
}

function teamLine(companyName: string | null | undefined): string {
  const company = companyName?.trim()
  return company
    ? `This is the property management team at ${company}.`
    : "This is the property management team."
}

/** Plain-language labels for incomplete required checklist items. */
export function outstandingVerificationLabels(
  checklist: VerificationChecklist,
): string[] {
  return checklist.items
    .filter((item) => item.required && item.status !== "complete")
    .map((item) => item.label)
}

/** Always sent when a vendor submits the verification form. */
export function buildVendorVerificationReceivedSms(input: {
  vendorLabel: string
  companyName?: string | null
}): string {
  return [
    `Hi ${firstNameOrVendor(input.vendorLabel)},`,
    "",
    teamLine(input.companyName),
    "",
    "We received your verification form and it's under review. We'll text you here with an update shortly.",
  ].join("\n")
}

/** Sent when the form is complete and the vendor is verified. */
export function buildVendorVerificationApprovedSms(input: {
  vendorLabel: string
  companyName?: string | null
}): string {
  return [
    `Hi ${firstNameOrVendor(input.vendorLabel)},`,
    "",
    teamLine(input.companyName),
    "",
    "Good news — your verification is complete. You're eligible to receive work orders from our team through Ulo.",
  ].join("\n")
}

/**
 * Sent when required items are still missing — lists outstanding items and
 * asks the vendor to upload/finish via the same verification link.
 */
export function buildVendorVerificationIncompleteSms(input: {
  vendorLabel: string
  companyName?: string | null
  outstandingLabels: string[]
  formLink: string
}): string {
  const items = input.outstandingLabels.length > 0
    ? input.outstandingLabels.map((label) => `• ${label}`).join("\n")
    : "• A few verification details"

  return [
    `Hi ${firstNameOrVendor(input.vendorLabel)},`,
    "",
    teamLine(input.companyName),
    "",
    "Thanks for submitting your verification form. A few items still need attention before we can begin sending you work orders:",
    "",
    items,
    "",
    "Please open your form to finish (about 5 minutes):",
    input.formLink,
  ].join("\n")
}

async function loadCompanyName(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("landlords")
    .select("name")
    .eq("id", landlordId)
    .maybeSingle()
  const name = typeof data?.name === "string" ? data.name.trim() : ""
  return name || null
}

async function ensureConversation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    inviteConversationId?: string | null
    workflowRunId?: string | null
    vendorId?: string | null
    phone?: string | null
  },
): Promise<{
  conversationId: string | null
  fromNumber: string | null
  toNumber: string | null
  provider: SmsProviderName | null
}> {
  const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
  if (!line?.phone) {
    return {
      conversationId: null,
      fromNumber: null,
      toNumber: null,
      provider: null,
    }
  }

  const provider: SmsProviderName = line.provider === "telnyx" ? "telnyx" : "twilio"
  const toNumber = normalizeSmsPhone(params.phone ?? "")
  let conversationId = await resolveVendorVerificationConversationId(supabase, params)

  if (!conversationId && toNumber) {
    const identity = await upsertSmsIdentityForPhone(supabase, {
      landlordId: params.landlordId,
      phone: toNumber,
      identityType: "vendor",
      vendorId: params.vendorId ?? null,
    })
    if (identity) {
      const created = await findOrCreateConversation(supabase, {
        landlordId: params.landlordId,
        smsNumberId: line.id,
        externalPhone: toNumber,
        identity,
        conversationStatus: "open",
      })
      conversationId = created.conversationId
    }
  }

  if (!conversationId) {
    return {
      conversationId: null,
      fromNumber: normalizeSmsPhone(line.phone),
      toNumber: toNumber || null,
      provider,
    }
  }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("external_phone_number")
    .eq("id", conversationId)
    .maybeSingle()

  const external = normalizeSmsPhone(
    (conv?.external_phone_number as string | undefined) ?? "",
  )

  return {
    conversationId,
    fromNumber: normalizeSmsPhone(line.phone),
    toNumber: toNumber || external || null,
    provider,
  }
}

export type VendorVerificationFollowUpResult = {
  conversationId: string | null
  receivedMessageId: string | null
  statusMessageId: string | null
  overall: "verified" | "needs_review"
}

/**
 * After form submit: SMS acknowledgement, then status (approved or incomplete
 * with outstanding items + form link). Best-effort; never throws.
 */
export async function sendVendorVerificationFollowUpSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    verificationId: string
    token: string
    vendorLabel: string
    overall: "verified" | "needs_review"
    checklist: VerificationChecklist
    inviteConversationId?: string | null
    workflowRunId?: string | null
    vendorId?: string | null
    phone?: string | null
    companyName?: string | null
  },
): Promise<VendorVerificationFollowUpResult> {
  const empty: VendorVerificationFollowUpResult = {
    conversationId: null,
    receivedMessageId: null,
    statusMessageId: null,
    overall: params.overall,
  }

  try {
    const companyName = params.companyName ??
      (await loadCompanyName(supabase, params.landlordId))

    const channel = await ensureConversation(supabase, params)
    if (
      !channel.conversationId ||
      !channel.fromNumber ||
      !channel.toNumber ||
      !channel.provider
    ) {
      console.warn("[vendorVerificationFollowUp] no SMS channel", {
        verificationId: params.verificationId,
      })
      return empty
    }

    const receivedBody = buildVendorVerificationReceivedSms({
      vendorLabel: params.vendorLabel,
      companyName,
    })
    const received = await sendInboundAutoReply(supabase, {
      conversationId: channel.conversationId,
      landlordId: params.landlordId,
      fromNumber: channel.fromNumber,
      toNumber: channel.toNumber,
      body: receivedBody,
      provider: channel.provider,
      source: "vendor_verification_received",
    })

    if (received.messageId) {
      await logGraphEvent(supabase, {
        landlord_id: params.landlordId,
        event_type: "vendor.verification_ack_sent",
        source: "edge_function",
        actor_type: "system",
        vendor_id: params.vendorId ?? null,
        conversation_id: channel.conversationId,
        message_id: received.messageId,
        workflow_run_id: params.workflowRunId ?? null,
        workflow_template_id: params.workflowRunId ? "vendor_onboarding" : null,
        metadata: {
          message: `Verification form acknowledgement sent to ${params.vendorLabel}.`,
          verification_id: params.verificationId,
        },
      })
    }

    const formLink = `${resolveAppUrl()}/v/${params.token}`
    const outstanding = outstandingVerificationLabels(params.checklist)
    const statusBody = params.overall === "verified"
      ? buildVendorVerificationApprovedSms({
        vendorLabel: params.vendorLabel,
        companyName,
      })
      : buildVendorVerificationIncompleteSms({
        vendorLabel: params.vendorLabel,
        companyName,
        outstandingLabels: outstanding,
        formLink,
      })

    const status = await sendInboundAutoReply(supabase, {
      conversationId: channel.conversationId,
      landlordId: params.landlordId,
      fromNumber: channel.fromNumber,
      toNumber: channel.toNumber,
      body: statusBody,
      provider: channel.provider,
      source: params.overall === "verified"
        ? "vendor_verification_approved"
        : "vendor_verification_incomplete",
    })

    if (status.messageId) {
      await logGraphEvent(supabase, {
        landlord_id: params.landlordId,
        event_type: params.overall === "verified"
          ? "vendor.verification_status_sent"
          : "vendor.verification_incomplete_followup_sent",
        source: "edge_function",
        actor_type: "system",
        vendor_id: params.vendorId ?? null,
        conversation_id: channel.conversationId,
        message_id: status.messageId,
        workflow_run_id: params.workflowRunId ?? null,
        workflow_template_id: params.workflowRunId ? "vendor_onboarding" : null,
        metadata: {
          message: params.overall === "verified"
            ? `Verification approved SMS sent to ${params.vendorLabel}.`
            : `Incomplete verification follow-up sent to ${params.vendorLabel}.`,
          verification_id: params.verificationId,
          outstanding,
          overall: params.overall,
        },
      })
    }

    await supabase
      .from("sms_conversations")
      .update({
        updated_at: new Date().toISOString(),
        status: "open",
        vendor_id: params.vendorId ?? null,
      })
      .eq("id", channel.conversationId)
      .eq("landlord_id", params.landlordId)

    return {
      conversationId: channel.conversationId,
      receivedMessageId: received.messageId ?? null,
      statusMessageId: status.messageId ?? null,
      overall: params.overall,
    }
  } catch (err) {
    console.error("[vendorVerificationFollowUp] failed", err)
    return empty
  }
}
