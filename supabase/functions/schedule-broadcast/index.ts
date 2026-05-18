import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"

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

function isMissingColumnError(message: string, column: string): boolean {
  return message.includes(`'${column}'`) && message.includes("column")
}

type Channel = "email" | "sms"
type Audience = "all" | "building" | "units"

type ScheduleBody = {
  action?: string
  subject?: string
  message?: string
  audience?: Audience
  building?: string
  units?: string[]
  channels?: Channel[]
  automation?: Record<string, unknown>
  payload?: Record<string, unknown>
  scheduled_for?: string
  schedule?: {
    scheduledAtIso?: string
    date?: string
    time?: string
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

  let body: ScheduleBody
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
  const channels = Array.isArray(body.channels)
    ? body.channels.filter((c): c is Channel => c === "email" || c === "sms")
    : []
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

  const scheduledAtIsoTopLevel =
    typeof body.scheduled_for === "string" ? body.scheduled_for.trim() : ""
  const scheduledAtIsoLegacy =
    typeof body.schedule?.scheduledAtIso === "string"
      ? body.schedule.scheduledAtIso.trim()
      : ""
  const scheduledAtIso = scheduledAtIsoTopLevel || scheduledAtIsoLegacy

  if (action !== "schedule") {
    return jsonResponse({ error: "Invalid action. Expected schedule." }, 400)
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
  if (!scheduledAtIso) {
    return jsonResponse(
      { error: "Missing scheduled_for (or schedule.scheduledAtIso)" },
      400,
    )
  }

  const scheduledFor = new Date(scheduledAtIso)
  if (Number.isNaN(scheduledFor.getTime())) {
    return jsonResponse({ error: "Invalid schedule.scheduledAtIso" }, 400)
  }
  if (scheduledFor.getTime() <= Date.now() - 60_000) {
    return jsonResponse(
      { error: "Scheduled time must be at least one minute in the future" },
      400,
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const baseInsert = {
    subject,
    message,
    audience,
    building: audience === "building" ? building : null,
    units: audience === "units" ? units : [],
    channels,
    status: "scheduled",
  }

  let row: { id: string } | null = null
  let insertErr: { message?: string } | null = null
  let usedPayloadInsert = true
  {
    const attempt = await supabase
      .from("broadcast_notifications")
      .insert({
        ...baseInsert,
        scheduled_for: scheduledFor.toISOString(),
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
      const fallbackInsert = await supabase
        .from("broadcast_notifications")
        .insert(baseInsert)
        .select("id")
        .single()
      row = fallbackInsert.data as { id: string } | null
      insertErr = fallbackInsert.error
      usedPayloadInsert = false
    }
  }

  if (insertErr || !row?.id) {
    console.error("[schedule-broadcast] insert failed", insertErr)
    return jsonResponse(
      { error: insertErr?.message ?? "Could not save scheduled broadcast" },
      500,
    )
  }

  return jsonResponse({
    ok: true,
    broadcast_id: row.id,
    scheduled_for: scheduledFor.toISOString(),
    status: "scheduled",
    payload_received: payloadReceived,
    payload_keys: payloadKeys,
    payload_inserted: usedPayloadInsert,
  })
})
