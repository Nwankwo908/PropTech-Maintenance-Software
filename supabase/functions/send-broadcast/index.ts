import { serve } from "https://deno.land/std/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { deliverBroadcastMessages } from "../_shared/broadcast_delivery.ts"
import { logGraphEvent } from "../_shared/graph/logGraphEvent.ts"
import { resolveLandlordId } from "../_shared/sms/landlordSmsOnboarding.ts"

const VERSION = "v2-" + Date.now()
console.log("🔥 VERSION:", VERSION)

console.log("🔥 FORCE NEW DEPLOY 🔥", Date.now())

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

type Channel = "email" | "sms"
type Audience = "all" | "building" | "units"

type SendBroadcastBody = {
  action?: string
  subject?: string
  message?: string
  audience?: Audience
  building?: string
  units?: string[]
  channels?: Channel[]
  channel_email?: boolean
  channel_sms?: boolean
  automation?: Record<string, unknown>
  payload?: Record<string, unknown>
}

function isMissingColumnError(message: string, column: string): boolean {
  return message.includes(`'${column}'`) && message.includes("column")
}

function broadcastFailureLogError(channel: Channel, errMsg: string): string {
  const m = errMsg.trim()
  if (channel === "sms" && /twilio not configured|missing twilio/i.test(m)) {
    return "Twilio not configured"
  }
  if (channel === "email" && /resend not configured|missing resend/i.test(m)) {
    return "Resend not configured"
  }
  return m.slice(0, 2000)
}

async function insertBroadcastFailureLogs(
  supabase: SupabaseClient,
  broadcastId: string,
  channels: Channel[],
  errMsg: string,
): Promise<void> {
  for (const ch of channels) {
    const { error } = await supabase.from("broadcast_notification_log").insert({
      broadcast_id: broadcastId,
      recipient_type: "resident",
      recipient_id: null,
      channel: ch,
      success: false,
      error: broadcastFailureLogError(ch, errMsg),
    })
    if (error) {
      console.error("[send-broadcast] broadcast_notification_log failure insert failed", error)
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }

  let body: SendBroadcastBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const action = typeof body.action === "string" ? body.action.trim() : ""
  const subject = typeof body.subject === "string" ? body.subject.trim() : ""
  const message = typeof body.message === "string" ? body.message.trim() : ""
  const audience =
    body.audience === "all" || body.audience === "building" || body.audience === "units"
      ? body.audience
      : null
  const building = typeof body.building === "string" ? body.building.trim() : ""
  const units = Array.isArray(body.units)
    ? body.units
      .map((u) => String(u ?? "").trim())
      .filter((u) => u.length > 0)
    : []
  const useEmail =
    body.channel_email === true ||
    (Array.isArray(body.channels) && body.channels.includes("email"))

  const useSms =
    body.channel_sms === true ||
    (Array.isArray(body.channels) && body.channels.includes("sms"))

  const channels: Channel[] = [
    ...(useEmail ? ["email" as const] : []),
    ...(useSms ? ["sms" as const] : []),
  ]
  const automation =
    body.automation && typeof body.automation === "object" && !Array.isArray(body.automation)
      ? (body.automation as Record<string, unknown>)
      : {}
  const payloadFromBody =
    body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : automation
  const payloadReceived =
    body.payload != null &&
    typeof body.payload === "object" &&
    !Array.isArray(body.payload)
  const payloadKeys = payloadReceived
    ? Object.keys(body.payload as Record<string, unknown>)
    : []

  if (action !== "send_now") {
    return jsonResponse({ error: "Invalid action. Expected send_now." }, 400)
  }
  if (!subject) return jsonResponse({ error: "Missing subject" }, 400)
  if (!message) return jsonResponse({ error: "Missing message" }, 400)
  if (!audience) return jsonResponse({ error: "Missing audience" }, 400)
  if (audience === "building" && !building) {
    return jsonResponse({ error: "Missing building for building audience" }, 400)
  }
  if (audience === "units" && units.length === 0) {
    return jsonResponse({ error: "Missing units for units audience" }, 400)
  }
  if (channels.length === 0) {
    return jsonResponse({ error: "At least one channel is required" }, 400)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const baseInsert = {
    subject,
    message,
    audience,
    building: audience === "building" ? building : null,
    units: audience === "units" ? units : [],
    channels,
    status: "processing",
  }

  let row: { id: string } | null = null
  let insertErr: { message?: string } | null = null
  let usedPayloadInsert = true

  {
    const attempt = await supabase
      .from("broadcast_notifications")
      .insert({
        ...baseInsert,
        scheduled_for: null,
        claimed_at: null,
        payload: payloadFromBody,
      })
      .select("id")
      .single()
    row = attempt.data as { id: string } | null
    insertErr = attempt.error
  }

  if (insertErr || !row?.id) {
    const raw = insertErr?.message ?? ""
    if (
      isMissingColumnError(raw, "payload") ||
      isMissingColumnError(raw, "scheduled_for") ||
      isMissingColumnError(raw, "claimed_at")
    ) {
      const fallback = await supabase
        .from("broadcast_notifications")
        .insert(baseInsert)
        .select("id")
        .single()
      row = fallback.data as { id: string } | null
      insertErr = fallback.error
      usedPayloadInsert = false
    }
  }

  if (insertErr || !row?.id) {
    console.error("[send-broadcast] insert broadcast failed", insertErr)
    return jsonResponse(
      { error: insertErr?.message ?? "Could not create broadcast record" },
      500,
    )
  }

  const broadcastId = row.id as string

  try {
    const result = await deliverBroadcastMessages(supabase, broadcastId, {
      audience,
      building,
      units,
      subject,
      message,
      payload: payloadFromBody,
      channels,
    })

    const updateRes = await supabase
      .from("broadcast_notifications")
      .update({ status: result.immediateTerminalStatus, claimed_at: null })
      .eq("id", broadcastId)
    if (updateRes.error && isMissingColumnError(updateRes.error.message ?? "", "claimed_at")) {
      await supabase
        .from("broadcast_notifications")
        .update({ status: result.immediateTerminalStatus })
        .eq("id", broadcastId)
    }

    try {
      await logGraphEvent(supabase, {
        landlord_id: resolveLandlordId(),
        event_type: "broadcast.sent",
        source: "dashboard",
        actor_type: "landlord",
        metadata: {
          broadcast_id: broadcastId,
          action,
          audience,
          building,
          units,
          channels,
          status: result.immediateTerminalStatus,
          recipients_count: result.recipients_count,
          attempts_ok: result.attemptsOk,
          attempts_failed: result.attemptsFail,
        },
      })
    } catch (e) {
      console.error("[send-broadcast] graph event", e)
    }

    return jsonResponse({
      ok: true,
      status: result.immediateTerminalStatus,
      broadcast_id: broadcastId,
      action,
      audience,
      channels,
      recipients_count: result.recipients_count,
      attempts: { success: result.attemptsOk, failed: result.attemptsFail },
      payload_received: payloadReceived,
      payload_keys: payloadKeys,
      payload_inserted: usedPayloadInsert,
      created_at: new Date().toISOString(),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await insertBroadcastFailureLogs(supabase, broadcastId, channels, msg)
    const failUpdate = await supabase
      .from("broadcast_notifications")
      .update({ status: "failed", claimed_at: null })
      .eq("id", broadcastId)
    if (failUpdate.error && isMissingColumnError(failUpdate.error.message ?? "", "claimed_at")) {
      await supabase
        .from("broadcast_notifications")
        .update({ status: "failed" })
        .eq("id", broadcastId)
    }
    return jsonResponse(
      {
        error: msg,
        payload_received: payloadReceived,
        payload_keys: payloadKeys,
        payload_inserted: usedPayloadInsert,
      },
      500,
    )
  }
})
