import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { authorizeProxiedMessageSender } from "../_shared/proxied_message_auth.ts"
import {
  loadProxiedTicketContext,
  sendProxiedMessage,
  type ProxiedRecipientType,
  type ProxiedSenderType,
} from "../_shared/sms/proxiedMessaging.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-reassign-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function parseSenderType(raw: string): ProxiedSenderType | null {
  if (
    raw === "vendor" ||
    raw === "resident" ||
    raw === "landlord" ||
    raw === "system"
  ) {
    return raw
  }
  return null
}

function parseRecipientType(raw: unknown): ProxiedRecipientType | undefined {
  if (raw === "vendor" || raw === "resident") return raw
  return undefined
}

function parseMediaUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let body: {
    maintenance_request_id?: string
    sender_type?: string
    sender_id?: string
    body?: string
    media_urls?: unknown
    recipient_type?: string
  }

  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const maintenanceRequestId =
    typeof body.maintenance_request_id === "string"
      ? body.maintenance_request_id.trim()
      : ""
  const senderTypeRaw =
    typeof body.sender_type === "string" ? body.sender_type.trim().toLowerCase() : ""
  const senderId =
    typeof body.sender_id === "string" ? body.sender_id.trim() : ""
  const messageBody = typeof body.body === "string" ? body.body : ""
  const mediaUrls = parseMediaUrls(body.media_urls)
  const recipientType = parseRecipientType(body.recipient_type)

  if (!maintenanceRequestId || !uuidRe.test(maintenanceRequestId)) {
    return jsonResponse({ error: "Missing or invalid maintenance_request_id" }, 400)
  }

  const senderType = parseSenderType(senderTypeRaw)
  if (!senderType) {
    return jsonResponse(
      { error: "sender_type must be vendor, resident, landlord, or system" },
      400,
    )
  }

  if (!senderId && senderType !== "system") {
    return jsonResponse({ error: "Missing sender_id" }, 400)
  }

  if (senderType === "system" && !senderId) {
    return jsonResponse({ error: "system sender requires sender_id (landlord uuid)" }, 400)
  }

  if (!messageBody.trim() && mediaUrls.length === 0) {
    return jsonResponse({ error: "body or media_urls is required" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const ctxResult = await loadProxiedTicketContext(supabase, maintenanceRequestId)
  if ("error" in ctxResult) {
    return jsonResponse({ error: ctxResult.error }, 404)
  }

  const { data: ticketRow } = await supabase
    .from("maintenance_requests")
    .select("resident_user_id")
    .eq("id", maintenanceRequestId)
    .maybeSingle()

  const auth = await authorizeProxiedMessageSender(req, supabase, {
    senderType,
    senderId,
    maintenanceRequestId,
    assignedVendorId: ctxResult.vendorId,
    ticketResidentUserId:
      typeof ticketRow?.resident_user_id === "string"
        ? ticketRow.resident_user_id
        : null,
    ticketResidentId: ctxResult.residentId,
    landlordId: ctxResult.landlordId,
  })

  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status)
  }

  const result = await sendProxiedMessage(supabase, {
    maintenanceRequestId,
    senderType,
    senderId,
    body: messageBody,
    mediaUrls,
    recipientType,
  })

  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status ?? 500)
  }

  return jsonResponse({
    ok: true,
    conversation_id: result.conversationId,
    message_id: result.messageId,
    provider_message_sid: result.providerMessageSid,
    from_number: result.fromNumber,
    event_type: result.eventType,
  })
})
