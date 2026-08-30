/**
 * Admin Communication inbox — take over a live SMS thread and send freeform SMS.
 * Flag: sms_conversations.intake_state.admin_takeover (pauses inbound AI).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { normalizeSmsPhone } from "./inbound_db.ts"
import { getSMSProviderForSend } from "./providerFactory.ts"
import { recordActivityLog } from "../graph/recordActivityLog.ts"

export const ADMIN_TAKEOVER_KEY = "admin_takeover"

export type AdminTakeoverState = {
  active: boolean
  at?: string
  by?: string
}

export function readAdminTakeover(
  intakeState: Record<string, unknown> | null | undefined,
): AdminTakeoverState | null {
  const raw = intakeState?.[ADMIN_TAKEOVER_KEY]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  return {
    active: obj.active === true,
    at: typeof obj.at === "string" ? obj.at : undefined,
    by: typeof obj.by === "string" ? obj.by : undefined,
  }
}

export function isAdminTakeoverActive(
  intakeState: Record<string, unknown> | null | undefined,
): boolean {
  return readAdminTakeover(intakeState)?.active === true
}

type ConversationRow = {
  id: string
  landlord_id: string
  external_phone_number: string
  sms_number_id: string
  intake_state: Record<string, unknown> | null
  resident_id: string | null
  vendor_id: string | null
  maintenance_request_id: string | null
  conversation_type: string
  status: string
}

async function loadConversation(
  supabase: SupabaseClient,
  conversationId: string,
  landlordId: string,
): Promise<ConversationRow | { error: string; status: number }> {
  const { data, error } = await supabase
    .from("sms_conversations")
    .select(
      "id, landlord_id, external_phone_number, sms_number_id, intake_state, resident_id, vendor_id, maintenance_request_id, conversation_type, status",
    )
    .eq("id", conversationId)
    .eq("landlord_id", landlordId)
    .maybeSingle()

  if (error) {
    console.error("[admin-conversation] load failed", error.message)
    return { error: "Could not load conversation", status: 500 }
  }
  if (!data?.id) {
    return { error: "Conversation not found", status: 404 }
  }
  return data as ConversationRow
}

async function patchIntakeState(
  supabase: SupabaseClient,
  conversation: ConversationRow,
  nextIntake: Record<string, unknown>,
): Promise<{ error: string; status: number } | null> {
  const { error } = await supabase
    .from("sms_conversations")
    .update({
      intake_state: nextIntake,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.id)
    .eq("landlord_id", conversation.landlord_id)

  if (error) {
    console.error("[admin-conversation] intake_state update failed", error.message)
    return { error: "Could not update conversation control", status: 500 }
  }
  return null
}

export async function setAdminConversationTakeover(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    landlordId: string
    active: boolean
  },
): Promise<
  | { ok: true; conversationId: string; adminTakeoverActive: boolean }
  | { ok: false; error: string; status: number }
> {
  const conversation = await loadConversation(
    supabase,
    params.conversationId,
    params.landlordId,
  )
  if ("error" in conversation) {
    return { ok: false, error: conversation.error, status: conversation.status }
  }

  const closed = ["resolved", "completed", "closed"].includes(
    conversation.status.toLowerCase(),
  )
  if (params.active && closed) {
    return { ok: false, error: "This conversation is closed", status: 422 }
  }
  if (conversation.conversation_type === "ai_copilot") {
    return {
      ok: false,
      error: "AI co-pilot threads stay read-only",
      status: 422,
    }
  }

  const intake: Record<string, unknown> = {
    ...(conversation.intake_state && typeof conversation.intake_state === "object"
      ? conversation.intake_state
      : {}),
  }

  if (params.active) {
    intake[ADMIN_TAKEOVER_KEY] = {
      active: true,
      at: new Date().toISOString(),
      by: "dashboard",
    }
  } else {
    delete intake[ADMIN_TAKEOVER_KEY]
  }

  const patchErr = await patchIntakeState(supabase, conversation, intake)
  if (patchErr) return { ok: false, ...patchErr }

  await recordActivityLog(supabase, {
    landlordId: conversation.landlord_id,
    eventType: params.active
      ? "sms.admin_takeover_started"
      : "sms.admin_takeover_released",
    source: "dashboard",
    actorType: "landlord",
    residentId: conversation.resident_id,
    vendorId: conversation.vendor_id,
    maintenanceRequestId: conversation.maintenance_request_id,
    conversationId: conversation.id,
    metadata: {
      message: params.active
        ? "Property team took over this SMS conversation."
        : "Property team returned this SMS conversation to Ulo.",
    },
  })

  return {
    ok: true,
    conversationId: conversation.id,
    adminTakeoverActive: params.active,
  }
}

export async function sendAdminConversationSms(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    landlordId: string
    body: string
  },
): Promise<
  | {
      ok: true
      conversationId: string
      messageId: string
      adminTakeoverActive: boolean
    }
  | { ok: false; error: string; status: number }
> {
  const body = params.body.trim()
  if (!body) {
    return { ok: false, error: "Message cannot be empty", status: 400 }
  }

  const conversation = await loadConversation(
    supabase,
    params.conversationId,
    params.landlordId,
  )
  if ("error" in conversation) {
    return { ok: false, error: conversation.error, status: conversation.status }
  }

  if (conversation.conversation_type === "ai_copilot") {
    return {
      ok: false,
      error: "Cannot send SMS on AI co-pilot threads",
      status: 422,
    }
  }

  let intake: Record<string, unknown> = {
    ...(conversation.intake_state && typeof conversation.intake_state === "object"
      ? conversation.intake_state
      : {}),
  }

  // Sending from Communication implies the property team owns the thread.
  if (!isAdminTakeoverActive(intake)) {
    intake = {
      ...intake,
      [ADMIN_TAKEOVER_KEY]: {
        active: true,
        at: new Date().toISOString(),
        by: "dashboard",
      },
    }
    const patchErr = await patchIntakeState(supabase, conversation, intake)
    if (patchErr) return { ok: false, ...patchErr }

    await recordActivityLog(supabase, {
      landlordId: conversation.landlord_id,
      eventType: "sms.admin_takeover_started",
      source: "dashboard",
      actorType: "landlord",
      residentId: conversation.resident_id,
      vendorId: conversation.vendor_id,
      maintenanceRequestId: conversation.maintenance_request_id,
      conversationId: conversation.id,
      metadata: {
        message: "Property team took over this SMS conversation.",
      },
    })
  }

  const { data: smsNumber, error: numberErr } = await supabase
    .from("sms_numbers")
    .select("id, phone_number, provider")
    .eq("id", conversation.sms_number_id)
    .maybeSingle()

  if (numberErr || !smsNumber?.phone_number) {
    console.error(
      "[admin-conversation] sms_numbers lookup failed",
      numberErr?.message,
    )
    return { ok: false, error: "SMS line for this thread is missing", status: 422 }
  }

  const fromNumber = String(smsNumber.phone_number).trim()
  const toNumber = normalizeSmsPhone(conversation.external_phone_number)
  if (!toNumber) {
    return { ok: false, error: "Recipient phone is missing", status: 422 }
  }

  const smsBody = `[Property manager]
${body}`
  const provider = getSMSProviderForSend({
    landlordId: conversation.landlord_id,
    lineProvider: typeof smsNumber.provider === "string" ? smsNumber.provider : null,
  })

  let sendResult: Awaited<ReturnType<typeof provider.sendMessage>>
  try {
    sendResult = await provider.sendMessage({
      to: toNumber,
      body: smsBody,
      from: fromNumber,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[admin-conversation] send threw", message)
    return { ok: false, error: message || "SMS send failed", status: 502 }
  }

  if (sendResult.error) {
    return { ok: false, error: sendResult.error, status: 502 }
  }

  const providerMessageSid =
    sendResult.providerMessageSid ?? sendResult.messageId ?? crypto.randomUUID()

  const { data: saved, error: saveErr } = await supabase
    .from("sms_messages")
    .insert({
      conversation_id: conversation.id,
      landlord_id: conversation.landlord_id,
      direction: "outbound",
      from_number: normalizeSmsPhone(fromNumber),
      to_number: toNumber,
      body: smsBody,
      media_urls: [],
      provider: sendResult.provider,
      provider_message_sid: providerMessageSid,
      provider_status: sendResult.status ?? "sent",
      raw_payload: {
        source: "admin_conversation_sms",
        admin_takeover: true,
      },
    })
    .select("id")
    .single()

  if (saveErr || !saved?.id) {
    console.error("[admin-conversation] sms_messages insert failed", saveErr?.message)
    return {
      ok: false,
      error: "SMS sent but could not save the message",
      status: 500,
    }
  }

  await supabase
    .from("sms_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversation.id)

  await recordActivityLog(supabase, {
    landlordId: conversation.landlord_id,
    eventType: "sms.admin_message_sent",
    source: "dashboard",
    actorType: "landlord",
    residentId: conversation.resident_id,
    vendorId: conversation.vendor_id,
    maintenanceRequestId: conversation.maintenance_request_id,
    conversationId: conversation.id,
    messageId: saved.id as string,
    metadata: {
      message: "Property team sent an SMS from Communication.",
    },
  })

  return {
    ok: true,
    conversationId: conversation.id,
    messageId: saved.id as string,
    adminTakeoverActive: true,
  }
}

export async function loadAdminTakeoverActive(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", conversationId)
      .maybeSingle()
    const intake = (data as { intake_state?: Record<string, unknown> | null } | null)
      ?.intake_state
    return isAdminTakeoverActive(intake)
  } catch {
    return false
  }
}
