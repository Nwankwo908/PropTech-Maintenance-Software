/**
 * Vendor verification submit side effects — roster, comms, activity log.
 * Called from the vendor_onboarding engine after the portal persists form state.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"
import { appendVendorVerificationSubmittedToInbox } from "../sms/vendorVerificationInbox.ts"
import { sendVendorVerificationFollowUpSms } from "../sms/vendorVerificationFollowUp.ts"
import {
  computeVerificationChecklist,
  type VerificationChecklist,
} from "./checklist.ts"
import { findLandlordVendorByContact } from "./findVendor.ts"

const VERIFICATION_SELECT =
  "id, landlord_id, vendor_id, token, status, business_name, contact_name, vendor_first_name, email, phone, property_name, license_state, license_number, license_type, license_status, license_expiration, coi_general_liability, coi_expiration, coi_additional_insured, coi_status, background_check_status, background_check_ref, w9_received, tax_entity_type, tin_type, tin_last4, tin_fingerprint, w9_variant, tax_1099_treatment, stripe_connect_ready, trade_categories, service_area, availability, progress, expires_at, workflow_run_id, invite_conversation_id"

export type VendorVerificationSubmitResult = {
  vendorId: string
  overall: "verified" | "needs_review"
  checklist: VerificationChecklist
  vendorLabel: string
  workflowRunId: string | null
  conversationId: string | null
  messageId: string | null
}

export class VendorVerificationSubmitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VendorVerificationSubmitError"
  }
}

function locationFieldsFromServiceArea(
  area: unknown,
): { city?: string; state?: string } {
  if (!area || typeof area !== "object") return {}
  const row = area as {
    cities?: unknown
    centerAddress?: unknown
  }
  const cities = Array.isArray(row.cities)
    ? row.cities.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0
    )
    : []
  const first = (
    cities[0] ??
    (typeof row.centerAddress === "string" ? row.centerAddress : "")
  ).trim()
  if (!first) return {}
  const parts = first.split(",").map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) {
    return { city: parts[0], state: parts[1] }
  }
  return { city: first }
}

/**
 * Upsert roster row, update verification status, mirror inbox, send follow-up SMS,
 * and log activity events. Returns facts for the engine to advance the run.
 */
export async function finalizeVendorVerificationSubmit(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    verificationId: string
  },
): Promise<VendorVerificationSubmitResult> {
  const { data: freshRaw, error: loadErr } = await supabase
    .from("vendor_verifications")
    .select(VERIFICATION_SELECT)
    .eq("id", params.verificationId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (loadErr || !freshRaw) {
    throw new VendorVerificationSubmitError("Verification record not found.")
  }

  const fresh = freshRaw as Record<string, unknown>
  const checklist = computeVerificationChecklist(fresh)
  const overall = checklist.overall
  const workflowRunId = typeof fresh.workflow_run_id === "string"
    ? fresh.workflow_run_id
    : null

  const primaryTrade = Array.isArray(fresh.trade_categories)
    ? (fresh.trade_categories as string[])[0] ?? null
    : null
  const email = typeof fresh.email === "string" ? fresh.email : null
  const phoneRaw = typeof fresh.phone === "string" ? fresh.phone : null
  const notificationChannel = phoneRaw && email
    ? "both"
    : phoneRaw
    ? "sms"
    : "email"

  let vendorId = await findLandlordVendorByContact(supabase, params.landlordId, {
    vendorId: typeof fresh.vendor_id === "string" ? fresh.vendor_id : null,
    email,
    phone: phoneRaw,
  })

  const vendorPhone = normalizePhoneFlexible(phoneRaw)
  const vendorLabel = (typeof fresh.business_name === "string" && fresh.business_name.trim())
    || (typeof fresh.contact_name === "string" && fresh.contact_name.trim())
    || "Vendor"

  const locationFromArea = locationFieldsFromServiceArea(fresh.service_area)
  const vendorPayload: Record<string, unknown> = {
    name: vendorLabel,
    email,
    phone: vendorPhone,
    category: primaryTrade,
    active: overall === "verified",
    notification_channel: notificationChannel,
    ...locationFromArea,
  }

  if (vendorId) {
    const { error: updErr } = await supabase
      .from("vendors")
      .update(vendorPayload)
      .eq("id", vendorId)
      .eq("landlord_id", params.landlordId)
    if (updErr) {
      console.error("[finalizeVendorVerificationSubmit] update vendor", updErr)
      throw new VendorVerificationSubmitError(
        `Could not update vendor profile${updErr.message ? `: ${updErr.message}` : ""}`,
      )
    }
  } else {
    const { data: ins, error: insErr } = await supabase
      .from("vendors")
      .insert({
        landlord_id: params.landlordId,
        ...vendorPayload,
        onboarded_from_external: true,
      })
      .select("id")
      .single()
    if (insErr || !ins?.id) {
      console.error("[finalizeVendorVerificationSubmit] create vendor", insErr)
      throw new VendorVerificationSubmitError(
        `Could not finalize vendor${insErr?.message ? `: ${insErr.message}` : ""}`,
      )
    }
    vendorId = ins.id as string
  }

  const nowIso = new Date().toISOString()
  const token = typeof fresh.token === "string" ? fresh.token : ""

  await supabase
    .from("vendor_verifications")
    .update({
      vendor_id: vendorId,
      status: overall,
      submitted_at: nowIso,
      verified_at: overall === "verified" ? nowIso : null,
    })
    .eq("id", params.verificationId)

  await supabase
    .from("vendor_documents")
    .update({ vendor_id: vendorId })
    .eq("verification_id", params.verificationId)

  let inviteConversationId = typeof fresh.invite_conversation_id === "string"
    ? fresh.invite_conversation_id
    : null
  if (!inviteConversationId) {
    const { data: linkRow } = await supabase
      .from("vendor_verifications")
      .select("invite_conversation_id")
      .eq("id", params.verificationId)
      .maybeSingle()
    inviteConversationId =
      (linkRow as { invite_conversation_id?: string | null } | null)
        ?.invite_conversation_id ?? null
  }

  const inbox = await appendVendorVerificationSubmittedToInbox(supabase, {
    landlordId: params.landlordId,
    inviteConversationId,
    workflowRunId,
    vendorId,
    phone: vendorPhone ?? phoneRaw,
    vendorLabel,
    overall,
    checklist,
    trades: Array.isArray(fresh.trade_categories)
      ? fresh.trade_categories as string[]
      : null,
    verificationId: params.verificationId,
  })

  await sendVendorVerificationFollowUpSms(supabase, {
    landlordId: params.landlordId,
    verificationId: params.verificationId,
    token,
    vendorLabel,
    overall,
    checklist,
    inviteConversationId: inbox.conversationId ?? inviteConversationId,
    workflowRunId,
    vendorId,
    phone: vendorPhone ?? phoneRaw,
  })

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "vendor.verification_submitted",
    source: "vendor_portal",
    actorType: "vendor",
    vendorId,
    conversationId: inbox.conversationId,
    messageId: inbox.messageId,
    workflowRunId,
    workflowTemplateId: workflowRunId ? "vendor_onboarding" : null,
    metadata: {
      message: `${vendorLabel} completed vendor verification.`,
      verification_id: params.verificationId,
      checklist_complete: checklist.completeCount,
      checklist_required: checklist.requiredCount,
      workflow_run_id: workflowRunId,
    },
  })

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: overall === "verified"
      ? "vendor.verified"
      : "vendor.verification_needs_review",
    source: "vendor_portal",
    actorType: "system",
    vendorId,
    conversationId: inbox.conversationId,
    messageId: inbox.messageId,
    workflowRunId,
    workflowTemplateId: workflowRunId ? "vendor_onboarding" : null,
    metadata: {
      message: overall === "verified"
        ? `${vendorLabel} is verified and ready for assignments.`
        : `${vendorLabel} needs review: ${checklist.missingReasons.join("; ")}`,
      verification_id: params.verificationId,
      missing_reasons: checklist.missingReasons,
      workflow_run_id: workflowRunId,
    },
  })

  return {
    vendorId,
    overall,
    checklist,
    vendorLabel,
    workflowRunId,
    conversationId: inbox.conversationId,
    messageId: inbox.messageId,
  }
}

/**
 * Admin clears a needs_review vendor — activate roster and complete the run.
 */
export async function finalizeVendorVerificationAdminApprove(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    verificationId: string
  },
): Promise<VendorVerificationSubmitResult> {
  const { data: freshRaw, error: loadErr } = await supabase
    .from("vendor_verifications")
    .select(VERIFICATION_SELECT)
    .eq("id", params.verificationId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (loadErr || !freshRaw) {
    throw new VendorVerificationSubmitError("Verification record not found.")
  }

  const fresh = freshRaw as Record<string, unknown>
  const vendorId = typeof fresh.vendor_id === "string" ? fresh.vendor_id : null
  if (!vendorId) {
    throw new VendorVerificationSubmitError("Vendor profile not linked to this verification.")
  }

  const vendorLabel = (typeof fresh.business_name === "string" && fresh.business_name.trim())
    || (typeof fresh.contact_name === "string" && fresh.contact_name.trim())
    || "Vendor"
  const workflowRunId = typeof fresh.workflow_run_id === "string"
    ? fresh.workflow_run_id
    : null
  const nowIso = new Date().toISOString()

  await supabase
    .from("vendors")
    .update({ active: true })
    .eq("id", vendorId)
    .eq("landlord_id", params.landlordId)

  await supabase
    .from("vendor_verifications")
    .update({
      status: "verified",
      verified_at: nowIso,
    })
    .eq("id", params.verificationId)

  const checklist = computeVerificationChecklist({
    ...fresh,
    status: "verified",
  })

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "vendor.verified",
    source: "dashboard",
    actorType: "landlord",
    vendorId,
    workflowRunId,
    workflowTemplateId: workflowRunId ? "vendor_onboarding" : null,
    metadata: {
      message: `${vendorLabel} was approved and added to the active roster.`,
      verification_id: params.verificationId,
      approved_by_admin: true,
      workflow_run_id: workflowRunId,
    },
  })

  return {
    vendorId,
    overall: "verified",
    checklist,
    vendorLabel,
    workflowRunId,
    conversationId: null,
    messageId: null,
  }
}
