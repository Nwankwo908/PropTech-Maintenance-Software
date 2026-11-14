import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { normalizePhoneFlexible } from "../_shared/resident_notify.ts"
import { sendLateRentAccountSms } from "../_shared/late_rent_account_outreach.ts"
import { isUuidShape } from "../_shared/uuid_shape.ts"

const corsHeaders = adminEdgeCorsHeaders

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function readAction(value: unknown): "offer_payment_plan" | "waive_late_fee" | null {
  const s = readString(value)
  if (s === "offer_payment_plan" || s === "waive_late_fee") return s
  return null
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }


  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Expected JSON object" }, 400)
    body = parsed as Record<string, unknown>
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const workflowRunId = readString(body.workflowRunId)
  const residentId = readString(body.residentId)
  const residentPhone = readString(body.residentPhone)
  const message = readString(body.message)
  const action = readAction(body.action)
  const landlordId = readString(body.landlordId)

  if (!workflowRunId || !isUuidShape(workflowRunId)) {
    return jsonResponse({ error: "Missing or invalid workflowRunId" }, 400)
  }
  if (!residentId || !isUuidShape(residentId)) {
    return jsonResponse({ error: "Missing or invalid residentId" }, 400)
  }
  if (!residentPhone) {
    return jsonResponse({ error: "Missing residentPhone" }, 400)
  }
  if (!message) {
    return jsonResponse({ error: "Missing message" }, 400)
  }
  if (!action) {
    return jsonResponse({ error: "Missing or invalid action" }, 400)
  }
  if (!landlordId || !isUuidShape(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlordId" }, 400)
  }

  const installmentsRaw = body.installments
  const installments =
    typeof installmentsRaw === "number" && Number.isFinite(installmentsRaw)
      ? Math.floor(installmentsRaw)
      : null

  const lateFeeCentsRaw = body.lateFeeCents
  const lateFeeCents =
    typeof lateFeeCentsRaw === "number" && Number.isFinite(lateFeeCentsRaw)
      ? Math.floor(lateFeeCentsRaw)
      : null

  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const { data: run, error: runError } = await supabase.from("workflow_runs").select("id, resident_id").eq("id", workflowRunId).eq("landlord_id", landlordId).eq("template_id", "rent_collection").maybeSingle()
    if (runError) return jsonResponse({ error: "Workflow lookup unavailable" }, 503)
    if (!run || run.resident_id !== residentId) return jsonResponse({ error: "Workflow and resident not found" }, 404)
    const { data: resident, error: residentError } = await supabase.from("users").select("id, phone").eq("id", residentId).eq("landlord_id", landlordId).maybeSingle()
    if (residentError) return jsonResponse({ error: "Resident lookup unavailable" }, 503)
    if (!resident) return jsonResponse({ error: "Resident not found" }, 404)
    const canonicalPhone = normalizePhoneFlexible(typeof resident.phone === "string" ? resident.phone : "")
    if (!canonicalPhone || canonicalPhone !== normalizePhoneFlexible(residentPhone)) return jsonResponse({ error: "Resident contact changed. Refresh the resident record before sending." }, 400)
    const result = await sendLateRentAccountSms(supabase, {
      landlordId,
      workflowRunId,
      residentId,
      residentPhone: canonicalPhone,
      message,
      action,
      installments,
      lateFeeCents,
    })

    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.error }, 400)
    }

    return jsonResponse({
      ok: true,
      conversation_id: result.conversationId,
      message_id: result.messageId,
      balance_due_after_waiver: result.balanceDueAfterWaiver ?? null,
      late_fee_waived: result.lateFeeWaived ?? null,
    })
  } catch (err) {
    console.error("[send-late-rent-account-message]", err)
    return jsonResponse({ ok: false, error: "Message service unavailable" }, 503)
  }
})
