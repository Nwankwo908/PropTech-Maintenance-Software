/**
 * Cron or manual POST: claims due `scheduled` broadcasts, delivers via shared pipeline,
 * sets terminal status to sent | partial | failed.
 */
import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  deliverBroadcastMessages,
  scheduledRunFinalStatus,
  type BroadcastAudience,
  type BroadcastChannel,
} from "../_shared/broadcast_delivery.ts"

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

function authorized(req: Request): boolean {
  const secret = Deno.env.get("RUN_SCHEDULED_BROADCASTS_SECRET")?.trim()
  if (!secret) return true
  const h = req.headers.get("Authorization")?.trim()
  if (!h?.toLowerCase().startsWith("bearer ")) return false
  return h.slice(7).trim() === secret
}

type BroadcastRow = {
  id: string
  subject: string
  message: string
  audience: string
  building: string | null
  units: unknown
  channels: unknown
  payload?: Record<string, unknown> | null
}

function parseUnits(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((u) => String(u ?? "").trim()).filter((u) => u.length > 0)
}

function parseChannels(raw: unknown): BroadcastChannel[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is BroadcastChannel => c === "email" || c === "sms")
}

function isAudience(v: string): v is BroadcastAudience {
  return v === "all" || v === "building" || v === "units"
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  if (!authorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const nowIso = new Date().toISOString()

  const { data: due, error: qErr } = await supabase
    .from("broadcast_notifications")
    .select("id, subject, message, audience, building, units, channels, payload")
    .eq("status", "scheduled")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(25)

  if (qErr) {
    console.error("[run-scheduled-broadcasts] query", qErr)
    return jsonResponse({ error: "Query failed", processed: 0, success: false }, 500)
  }

  let processed = 0

  for (const raw of due ?? []) {
    const row = raw as BroadcastRow
    const id = String(row.id ?? "")
    if (!id) continue

    const { data: claimed, error: claimErr } = await supabase
      .from("broadcast_notifications")
      .update({
        status: "processing",
        claimed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .select("id")
      .maybeSingle()

    if (claimErr) {
      console.error("[run-scheduled-broadcasts] claim", id, claimErr)
      continue
    }
    if (!claimed?.id) {
      continue
    }

    processed++

    const audience = row.audience
    if (!isAudience(audience)) {
      await supabase
        .from("broadcast_notifications")
        .update({ status: "failed", claimed_at: null })
        .eq("id", id)
      continue
    }

    const channels = parseChannels(row.channels)
    if (channels.length === 0) {
      await supabase
        .from("broadcast_notifications")
        .update({ status: "failed", claimed_at: null })
        .eq("id", id)
      continue
    }

    const units = parseUnits(row.units)
    const building = (row.building ?? "").trim()

    try {
      const result = await deliverBroadcastMessages(supabase, id, {
        subject: row.subject,
        message: row.message,
        payload: row.payload ?? undefined,
        audience,
        building,
        units,
        channels,
        resume: true,
      })

      const finalStatus = scheduledRunFinalStatus(result.immediateTerminalStatus)
      await supabase
        .from("broadcast_notifications")
        .update({ status: finalStatus, claimed_at: null })
        .eq("id", id)
    } catch (e) {
      console.error("[run-scheduled-broadcasts] deliver", id, e)
      await supabase
        .from("broadcast_notifications")
        .update({ status: "failed", claimed_at: null })
        .eq("id", id)
    }
  }

  return jsonResponse({ processed, success: true })
})
