import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { authorizeAdminAccount } from "../_shared/adminAccountAuthorization.ts"
import { adminEdgeCorsHeaders } from "../_shared/admin_edge_cors.ts"
import {
  sendAdminConversationSms,
  setAdminConversationTakeover,
} from "../_shared/sms/adminConversationControl.ts"

const corsHeaders = adminEdgeCorsHeaders

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }


  let body: {
    action?: string
    conversation_id?: string
    landlord_id?: string
    body?: string
  }
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return jsonResponse({ error: "Expected JSON object" }, 400)
    body = parsed as typeof body
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : ""
  const conversationId =
    typeof body.conversation_id === "string" ? body.conversation_id.trim() : ""
  const landlordId =
    typeof body.landlord_id === "string" ? body.landlord_id.trim() : ""
  const messageBody = typeof body.body === "string" ? body.body : ""

  if (!conversationId || !uuidRe.test(conversationId)) {
    return jsonResponse({ error: "Missing or invalid conversation_id" }, 400)
  }
  if (!landlordId || !uuidRe.test(landlordId)) {
    return jsonResponse({ error: "Missing or invalid landlord_id" }, 400)
  }
  if (action !== "takeover" && action !== "release" && action !== "send") {
    return jsonResponse(
      { error: "action must be takeover, release, or send" },
      400,
    )
  }

  const denied = await authorizeAdminAccount(req, landlordId, corsHeaders)
  if (denied) return denied

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server misconfiguration" }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  const { data: conversation, error } = await supabase.from("sms_conversations").select("id").eq("id", conversationId).eq("landlord_id", landlordId).maybeSingle()
  if (error) return jsonResponse({ error: "Conversation lookup unavailable" }, 503)
  if (!conversation) return jsonResponse({ error: "Conversation not found" }, 404)

  if (action === "takeover" || action === "release") {
    const result = await setAdminConversationTakeover(supabase, {
      conversationId,
      landlordId,
      active: action === "takeover",
    })
    if (!result.ok) {
      return jsonResponse({ error: result.error }, result.status)
    }
    return jsonResponse({
      ok: true,
      conversation_id: result.conversationId,
      admin_takeover_active: result.adminTakeoverActive,
    })
  }

  const result = await sendAdminConversationSms(supabase, {
    conversationId,
    landlordId,
    body: messageBody,
  })
  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status)
  }
  return jsonResponse({
    ok: true,
    conversation_id: result.conversationId,
    message_id: result.messageId,
    admin_takeover_active: result.adminTakeoverActive,
  })
})
