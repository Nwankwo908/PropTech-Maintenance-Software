/**
 * SMS when a landlord activates a vendor via Override onboarding.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { loadLandlordDisplayName } from "../landlordDisplayName.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import { resolveOutboundLandlordSmsLine } from "./landlordSmsOnboarding.ts"
import type { SmsProviderName } from "./types.ts"
import { buildVendorOnboardingOverrideActivatedSms } from "./vendorOnboardingOverrideSmsCopy.ts"

export { buildVendorOnboardingOverrideActivatedSms } from "./vendorOnboardingOverrideSmsCopy.ts"

export type OverrideActivationSmsResult = {
  sms: "sent" | "skipped" | "failed"
  conversationId: string | null
  messageId: string | null
}

/**
 * Best-effort SMS after override. Never throws.
 */
export async function sendVendorOnboardingOverrideActivatedSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
  },
): Promise<OverrideActivationSmsResult> {
  const skipped: OverrideActivationSmsResult = {
    sms: "skipped",
    conversationId: null,
    messageId: null,
  }

  try {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("id, name, contact_name, phone")
      .eq("id", params.vendorId)
      .eq("landlord_id", params.landlordId)
      .maybeSingle()

    const phone = normalizeSmsPhone(
      typeof vendor?.phone === "string" ? vendor.phone : "",
    )
    if (!phone) return skipped

    const line = await resolveOutboundLandlordSmsLine(supabase, params.landlordId)
    if (!line?.phone) return skipped

    const provider: SmsProviderName = line.provider === "telnyx" ? "telnyx" : "twilio"
    const identity = await upsertSmsIdentityForPhone(supabase, {
      landlordId: params.landlordId,
      phone,
      identityType: "vendor",
      vendorId: params.vendorId,
    })
    if (!identity) return { sms: "failed", conversationId: null, messageId: null }

    const created = await findOrCreateConversation(supabase, {
      landlordId: params.landlordId,
      smsNumberId: line.id,
      externalPhone: phone,
      identity,
      conversationStatus: "open",
    })
    const conversationId = created.conversationId
    if (!conversationId) {
      return { sms: "failed", conversationId: null, messageId: null }
    }

    const vendorLabel =
      (typeof vendor?.contact_name === "string" && vendor.contact_name.trim()) ||
      (typeof vendor?.name === "string" && vendor.name.trim()) ||
      "there"
    const companyName = await loadLandlordDisplayName(supabase, params.landlordId)
    const body = buildVendorOnboardingOverrideActivatedSms({
      vendorLabel,
      companyName,
    })

    const sent = await sendInboundAutoReply(supabase, {
      conversationId,
      landlordId: params.landlordId,
      fromNumber: normalizeSmsPhone(line.phone),
      toNumber: phone,
      body,
      provider,
      source: "vendor_onboarding_override_activated",
    })

    if (!sent.messageId) {
      return { sms: "failed", conversationId, messageId: null }
    }

    try {
      await recordActivityLog(supabase, {
        landlordId: params.landlordId,
        eventType: "vendor.onboarding_override_sms_sent",
        source: "sms",
        actorType: "system",
        vendorId: params.vendorId,
        conversationId,
        messageId: sent.messageId,
        metadata: {
          message: `Activation text sent to ${vendorLabel}.`,
        },
      })
    } catch (err) {
      console.warn("[vendorOnboardingOverrideSms] activity log", err)
    }

    return { sms: "sent", conversationId, messageId: sent.messageId }
  } catch (err) {
    console.error("[vendorOnboardingOverrideSms]", err)
    return { sms: "failed", conversationId: null, messageId: null }
  }
}
