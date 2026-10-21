/**
 * Integration-only: real SMS delivery on Limited Alpha 2 designated test phones.
 * Gated by ADMIN_REASSIGN_SECRET. Never targets phones outside the allowlist.
 *
 * Designated handsets (LA2 live ops SMS):
 *   +15715028158 — tenant (John Doe / portal tester)
 *   +19737358072 — landlord ops (used as vendor handset for this journey)
 *
 * Strict checks (default):
 *   - Outbound must reach Twilio terminal status `delivered` (via status callback / API)
 *   - Vendor YES must arrive as a real Twilio inbound (MessageSid SM…) — no inject unless
 *     injectVendorYes=true is explicitly set
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { requireAdminReassignAuth } from "../_shared/admin_edge_auth.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import { sendVendorJobAlert } from "../_shared/sms/vendorSmsRouting.ts"
import { buildVendorJobAssignmentSms } from "../_shared/vendor_outreach_copy.ts"
import { processInboundSms } from "../_shared/sms/inbound_processor.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "../_shared/sms/inbound_db.ts"
import { findActiveLandlordMainNumber } from "../_shared/sms/landlordSmsOnboarding.ts"
import { getSMSProviderForSend } from "../_shared/sms/providerFactory.ts"
import { readTwilioConfig } from "../_shared/sms/TwilioProvider.ts"
import { uloAppUrl } from "../_shared/uloAppUrl.ts"

const corsHeaders = adminEdgeCorsHeaders
const LA2 = "de300000-0000-4000-8000-000000000004"

const ALLOWED_PHONES = new Set([
  "+15715028158",
  "+19737358072",
])

const TERMINAL_OK = new Set(["delivered"])
const TERMINAL_FAIL = new Set(["failed", "undelivered", "canceled"])

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function allowPhone(raw: string): string | null {
  const n = normalizeSmsPhone(raw)
  if (!n || !ALLOWED_PHONES.has(n)) return null
  return n
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

function isTwilioHandsetSid(sid: unknown): boolean {
  return typeof sid === "string" && /^SM[0-9a-f]{32}$/i.test(sid.trim())
}

async function fetchTwilioMessageStatus(
  sid: string,
): Promise<{ status: string | null; error?: string }> {
  const cfg = readTwilioConfig()
  if ("error" in cfg) return { status: null, error: cfg.error }
  const auth = btoa(`${cfg.accountSid}:${cfg.authToken}`)
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages/${sid}.json`,
    { headers: { Authorization: `Basic ${auth}` } },
  )
  const raw = await res.text()
  if (!res.ok) {
    return { status: null, error: raw.slice(0, 300) || `HTTP ${res.status}` }
  }
  try {
    const j = JSON.parse(raw) as { status?: string }
    return { status: (j.status || "").toLowerCase() || null }
  } catch {
    return { status: null, error: "invalid Twilio JSON" }
  }
}

async function waitForDelivered(
  supabase: ReturnType<typeof createClient>,
  sid: string,
  waitMs: number,
): Promise<{ status: string; source: "db" | "twilio_api"; error?: string }> {
  const deadline = Date.now() + waitMs
  let last = "unknown"
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from("sms_messages")
      .select("provider_status")
      .eq("provider_message_sid", sid)
      .maybeSingle()
    const dbStatus = String(data?.provider_status || "").toLowerCase()
    if (dbStatus) last = dbStatus
    if (TERMINAL_OK.has(dbStatus) || TERMINAL_FAIL.has(dbStatus)) {
      return { status: dbStatus, source: "db" }
    }

    const api = await fetchTwilioMessageStatus(sid)
    if (api.status) {
      last = api.status
      if (TERMINAL_OK.has(api.status) || TERMINAL_FAIL.has(api.status)) {
        return { status: api.status, source: "twilio_api" }
      }
    }
    await sleep(2500)
  }
  return { status: last, source: "db", error: `not terminal within ${waitMs}ms` }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const auth = requireAdminReassignAuth(req, "[integration-sms-journey]", corsHeaders)
  if (!auth.ok) return auth.response

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Server misconfiguration" }, 500)
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  let body: {
    action?: string
    sids?: string[]
    tenantPhone?: string
    vendorPhone?: string
    /** Default false — only true when caller explicitly opts into inject fallback. */
    injectVendorYes?: boolean
    waitForInboundMs?: number
    waitForDeliveryMs?: number
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: "Expected JSON" }, 400)
  }

  // --- Delivery status check for known SIDs (no new sends) ---
  if (body.action === "check_delivery") {
    const sids = (body.sids || []).map((s) => String(s).trim()).filter(Boolean)
    if (!sids.length) return json({ error: "sids required" }, 400)
    const results = []
    for (const sid of sids) {
      const { data: row } = await supabase
        .from("sms_messages")
        .select("id,to_number,from_number,provider_status,direction,created_at")
        .eq("provider_message_sid", sid)
        .maybeSingle()
      const api = await fetchTwilioMessageStatus(sid)
      results.push({
        sid,
        dbStatus: row?.provider_status ?? null,
        twilioStatus: api.status,
        twilioError: api.error ?? null,
        to: row?.to_number ?? null,
        from: row?.from_number ?? null,
        delivered: TERMINAL_OK.has(String(api.status || row?.provider_status || "").toLowerCase()),
      })
    }
    return json({
      ok: results.every((r) => r.delivered),
      results,
    })
  }

  const tenantPhone = allowPhone(String(body.tenantPhone ?? "+15715028158"))
  const vendorPhone = allowPhone(String(body.vendorPhone ?? "+19737358072"))
  if (!tenantPhone || !vendorPhone) {
    return json({
      error: "Phones must be designated LA2 test handsets",
      allowed: [...ALLOWED_PHONES],
    }, 400)
  }
  if (tenantPhone === vendorPhone) {
    return json({ error: "tenantPhone and vendorPhone must differ" }, 400)
  }

  const waitMs = Math.min(
    Math.max(Number(body.waitForInboundMs ?? 120_000) || 120_000, 0),
    180_000,
  )
  const deliveryWaitMs = Math.min(
    Math.max(Number(body.waitForDeliveryMs ?? 60_000) || 60_000, 5_000),
    120_000,
  )
  const injectVendorYes = body.injectVendorYes === true
  const steps: Array<Record<string, unknown>> = []

  const line = await findActiveLandlordMainNumber(supabase, LA2)
  if (!line?.phone_number) {
    return json({ error: "No active landlord_main SMS line for LA2" }, 500)
  }
  const uloPhone = normalizeSmsPhone(line.phone_number) || line.phone_number
  steps.push({ step: "ulo_line", phone: uloPhone })

  let { data: resident } = await supabase
    .from("users")
    .select("id,full_name,phone,email,unit")
    .eq("landlord_id", LA2)
    .eq("phone", tenantPhone)
    .maybeSingle()

  if (!resident?.id) {
    const { data: created, error } = await supabase
      .from("users")
      .insert({
        landlord_id: LA2,
        role: "resident",
        full_name: "LA2 SMS Journey Tenant",
        name: "LA2 SMS Journey Tenant",
        email: "ulo.sms.journey.tenant@example.invalid",
        phone: tenantPhone,
        unit: "1",
        activation_status: "activated",
        is_active: true,
        status: "active",
      })
      .select("id,full_name,phone,email,unit")
      .single()
    if (error) return json({ error: `resident: ${error.message}`, steps }, 500)
    resident = created
  }
  steps.push({ step: "resident", id: resident.id, phone: tenantPhone })

  const { data: prop } = await supabase
    .from("properties")
    .select("id,name")
    .eq("landlord_id", LA2)
    .limit(1)
    .maybeSingle()
  const { data: unit } = await supabase
    .from("units")
    .select("id,unit_label,property_id")
    .eq("landlord_id", LA2)
    .limit(1)
    .maybeSingle()
  if (!prop?.id || !unit?.id) {
    return json({ error: "LA2 missing property/unit", steps }, 500)
  }

  let { data: vendor } = await supabase
    .from("vendors")
    .select("id,name,phone,category,active,onboarding_overridden_at")
    .eq("landlord_id", LA2)
    .eq("phone", vendorPhone)
    .maybeSingle()

  if (!vendor?.id) {
    const { data: created, error } = await supabase
      .from("vendors")
      .insert({
        landlord_id: LA2,
        name: "LA2 SMS Journey Vendor",
        phone: vendorPhone,
        email: "ulo.sms.journey.vendor@example.invalid",
        category: "plumbing",
        active: true,
        roster_status: null,
        onboarding_overridden_at: new Date().toISOString(),
        state: "NJ",
        preferred_emergency: true,
      })
      .select("id,name,phone,category,active,onboarding_overridden_at")
      .single()
    if (error) return json({ error: `vendor: ${error.message}`, steps }, 500)
    vendor = created
  } else {
    await supabase
      .from("vendors")
      .update({
        active: true,
        category: "plumbing",
        onboarding_overridden_at:
          vendor.onboarding_overridden_at || new Date().toISOString(),
      })
      .eq("id", vendor.id)
  }
  steps.push({ step: "vendor", id: vendor.id, phone: vendorPhone })

  const ticketId = crypto.randomUUID()
  const actionToken = crypto.randomUUID()
  const description =
    `[ulo-sms-journey] Kitchen sink leaking — SMS integration ${new Date().toISOString()}`

  const { error: ticketErr } = await supabase.from("maintenance_requests").insert({
    id: ticketId,
    landlord_id: LA2,
    property_id: prop.id,
    unit_id: unit.id,
    resident_id: resident.id,
    resident_name: resident.full_name || "LA2 SMS Journey Tenant",
    email: resident.email || "ulo.sms.journey.tenant@example.invalid",
    unit: unit.unit_label === "Home" ? "1" : unit.unit_label,
    description,
    priority: "Normal",
    urgency: "normal",
    issue_category: "plumbing",
    vendor_work_status: "unassigned",
    photo_paths: [],
    vendor_action_token: actionToken,
  })
  if (ticketErr) return json({ error: `ticket: ${ticketErr.message}`, steps }, 500)
  steps.push({ step: "ticket_created", ticketId })

  await supabase
    .from("maintenance_requests")
    .update({
      assigned_vendor_id: vendor.id,
      vendor_work_status: "pending_accept",
      assigned_at: new Date().toISOString(),
    })
    .eq("id", ticketId)

  const vendorSms = buildVendorJobAssignmentSms({
    vendorName: vendor.name || "Vendor",
    priority: "Normal",
    unit: unit.unit_label === "Home" ? "1" : unit.unit_label,
    description,
    ticketId,
    issueHeadline: "Kitchen sink leaking",
    location: prop.name,
    jobDetailUrl: uloAppUrl.workOrder(actionToken),
  })

  const vendorSend = await sendVendorJobAlert(supabase, {
    ticketId,
    vendorId: vendor.id,
    vendorPhone,
    body: vendorSms,
    landlordId: LA2,
  })
  if (!vendorSend.ok) {
    steps.push({ step: "vendor_outbound", status: "failed", error: vendorSend.error })
    return json({ ok: false, error: "vendor_outbound_failed", steps }, 502)
  }

  const vendorDelivery = await waitForDelivered(
    supabase,
    vendorSend.providerMessageSid,
    deliveryWaitMs,
  )
  const vendorDelivered = TERMINAL_OK.has(vendorDelivery.status)
  steps.push({
    step: "vendor_outbound",
    status: vendorDelivered ? "passed" : "failed",
    conversationId: vendorSend.conversationId,
    messageId: vendorSend.messageId,
    providerMessageSid: vendorSend.providerMessageSid,
    fromNumber: vendorSend.fromNumber,
    deliveryStatus: vendorDelivery.status,
    deliverySource: vendorDelivery.source,
    deliveryError: vendorDelivery.error ?? null,
  })

  // Tenant outbound (actual Twilio delivery)
  let tenantSid: string | null = null
  let tenantConvoId: string | null = null
  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: LA2,
    phone: tenantPhone,
    identityType: "resident",
    residentId: resident.id,
    unitId: unit.id,
  })
  if (!identity) {
    steps.push({ step: "tenant_outbound", status: "failed", error: "identity_upsert_failed" })
  } else {
    const found = await findOrCreateConversation(supabase, {
      landlordId: LA2,
      smsNumberId: line.id,
      externalPhone: tenantPhone,
      identity,
      maintenanceRequestId: ticketId,
      conversationStatus: "open",
    })
    tenantConvoId = found.conversationId
    const provider = getSMSProviderForSend()
    const tenantBody =
      "Ulo test: we opened a plumbing repair for your home and notified a vendor. Reply YES if you got this message. (integration)"
    const tenantSend = await provider.sendMessage({
      to: tenantPhone,
      from: uloPhone,
      body: tenantBody,
    })
    if (tenantSend.error) {
      steps.push({ step: "tenant_outbound", status: "failed", error: tenantSend.error })
    } else {
      tenantSid = tenantSend.providerMessageSid || tenantSend.messageId || null
      const { data: msgRow } = await supabase
        .from("sms_messages")
        .insert({
          conversation_id: tenantConvoId,
          landlord_id: LA2,
          direction: "outbound",
          from_number: uloPhone,
          to_number: tenantPhone,
          body: tenantBody,
          media_urls: [],
          provider: "twilio",
          provider_message_sid: tenantSid,
          provider_status: tenantSend.status || "queued",
          raw_payload: { source: "integration_sms_journey", ticket_id: ticketId },
        })
        .select("id")
        .maybeSingle()

      const tenantDelivery = tenantSid
        ? await waitForDelivered(supabase, tenantSid, deliveryWaitMs)
        : { status: "missing_sid", source: "db" as const, error: "no sid" }
      const tenantDelivered = TERMINAL_OK.has(tenantDelivery.status)
      steps.push({
        step: "tenant_outbound",
        status: tenantDelivered ? "passed" : "failed",
        conversationId: tenantConvoId,
        messageId: msgRow?.id ?? null,
        providerMessageSid: tenantSid,
        deliveryStatus: tenantDelivery.status,
        deliverySource: tenantDelivery.source,
        deliveryError: tenantDelivery.error ?? null,
      })
    }
  }

  const vendorConvoId = vendorSend.conversationId
  const waitStarted = Date.now()
  let handsetReply: {
    id: string
    body: string
    providerMessageSid: string | null
  } | null = null
  while (Date.now() - waitStarted < waitMs) {
    const { data: inbound } = await supabase
      .from("sms_messages")
      .select("id,body,created_at,provider_message_sid,raw_payload")
      .eq("conversation_id", vendorConvoId)
      .eq("direction", "inbound")
      .gte("created_at", new Date(waitStarted - 2000).toISOString())
      .order("created_at", { ascending: false })
      .limit(12)
    const hit = (inbound || []).find((m) => {
      const bodyText = String(m.body || "")
      if (!/^\s*(yes|y|accept)\b/i.test(bodyText)) return false
      // Real handset only: Twilio SM… sid, and not our inject marker
      const sid = m.provider_message_sid
      const raw = m.raw_payload as Record<string, unknown> | null
      if (raw?.integration === true) return false
      return isTwilioHandsetSid(sid)
    })
    if (hit) {
      handsetReply = {
        id: String(hit.id),
        body: String(hit.body),
        providerMessageSid: hit.provider_message_sid
          ? String(hit.provider_message_sid)
          : null,
      }
      break
    }
    await sleep(2500)
  }

  let replySource: "handset" | "edge_injected" | "none" = "none"
  if (handsetReply) {
    replySource = "handset"
    steps.push({
      step: "vendor_reply",
      status: "passed",
      source: "handset",
      messageId: handsetReply.id,
      body: handsetReply.body,
      providerMessageSid: handsetReply.providerMessageSid,
    })
  } else if (injectVendorYes) {
    const sid = `integration-${crypto.randomUUID()}`
    try {
      await processInboundSms(supabase, {
        provider: "twilio",
        providerMessageSid: sid,
        messageId: sid,
        from: vendorPhone,
        to: uloPhone,
        body: "YES",
        mediaUrls: [],
        rawPayload: { integration: true, ticketId },
      })
      replySource = "edge_injected"
      steps.push({
        step: "vendor_reply",
        status: "passed",
        source: "edge_injected",
        note: "Explicit injectVendorYes=true; not a handset proof",
      })
    } catch (e) {
      steps.push({
        step: "vendor_reply",
        status: "failed",
        source: "edge_injected",
        error: e instanceof Error ? e.message : String(e),
      })
    }
  } else {
    steps.push({
      step: "vendor_reply",
      status: "blocked",
      source: "none",
      note:
        `No Twilio handset YES (SM…) within ${waitMs}ms from ${vendorPhone}. ` +
        `Reply YES to ${uloPhone} from that phone.`,
      tenantConversationId: tenantConvoId,
    })
  }

  const { data: ticketAfter } = await supabase
    .from("maintenance_requests")
    .select("id,vendor_work_status,assigned_vendor_id")
    .eq("id", ticketId)
    .maybeSingle()

  steps.push({
    step: "ticket_after_reply",
    vendor_work_status: ticketAfter?.vendor_work_status ?? null,
    assigned_vendor_id: ticketAfter?.assigned_vendor_id ?? null,
  })

  const outboundOk = steps.some((s) =>
    s.step === "vendor_outbound" && s.status === "passed"
  )
  const tenantOk = steps.some((s) =>
    s.step === "tenant_outbound" && s.status === "passed"
  )
  const replyOk = steps.some((s) =>
    s.step === "vendor_reply" && s.status === "passed" && s.source === "handset"
  )
  // Full ok only with handset reply (inject alone does not pass overall when inject used)
  const injectOnly = replySource === "edge_injected"
  const ok = outboundOk && tenantOk && (replyOk || (injectOnly && injectVendorYes))

  return json({
    ok: injectOnly ? false : ok, // inject path never claims full handset verification
    okWithInjectFallback: outboundOk && tenantOk && (replyOk || injectOnly),
    landlordId: LA2,
    ticketId,
    tenantPhone,
    vendorPhone,
    uloPhone,
    replySource,
    handsetVerified: replySource === "handset",
    deliveryVerified: outboundOk && tenantOk,
    steps,
  })
})
