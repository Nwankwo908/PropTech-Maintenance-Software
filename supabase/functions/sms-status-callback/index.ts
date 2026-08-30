import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getSMSProviderFor } from "../_shared/sms/providerFactory.ts"
import { processInboundSms, InboundSmsError } from "../_shared/sms/inbound_processor.ts"
import { processSmsStatusUpdate } from "../_shared/sms/processSmsStatusUpdate.ts"
import {
  isTelnyxInboundEventType,
  isTelnyxStatusEventType,
  peekTelnyxEventType,
} from "../_shared/sms/TelnyxProvider.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature, telnyx-signature-ed25519, telnyx-timestamp",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function emptyOk(): Response {
  return new Response("", { status: 200, headers: corsHeaders })
}

function requestWithBody(req: Request, rawBody: string): Request {
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: rawBody,
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    console.error("[sms-status-callback] missing Supabase credentials")
    return new Response("Server misconfigured", { status: 500, headers: corsHeaders })
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const rawBody = await req.text()

  try {
    const telnyxEvent = peekTelnyxEventType(rawBody)
    if (isTelnyxInboundEventType(telnyxEvent)) {
      const inbound = await getSMSProviderFor("telnyx").normalizeInboundWebhook(req, {
        rawBody,
        signature: req.headers.get("telnyx-signature-ed25519") ?? "",
        url: req.url,
      })
      const result = await processInboundSms(supabase, inbound)
      console.info("[sms-status-callback] inbound message.received", {
        providerMessageSid: inbound.providerMessageSid,
        conversationId: result.conversationId,
        messageId: result.messageId,
      })
      return emptyOk()
    }
    if (telnyxEvent && !isTelnyxStatusEventType(telnyxEvent)) {
      console.info("[sms-status-callback] ignoring Telnyx event", { eventType: telnyxEvent })
      return emptyOk()
    }

    const statusProvider = isTelnyxStatusEventType(telnyxEvent)
      ? getSMSProviderFor("telnyx")
      : getSMSProviderFor("twilio")
    const statusUpdate = await statusProvider.normalizeStatusWebhook(
      requestWithBody(req, rawBody),
    )

    const result = await processSmsStatusUpdate(supabase, statusUpdate)

    console.info("[sms-status-callback] processed", {
      provider: statusUpdate.provider,
      providerMessageSid: statusUpdate.providerMessageSid,
      status: statusUpdate.status,
      messageId: result.messageId ?? null,
      graphEvent: result.graphEvent ?? null,
    })

    return emptyOk()
  } catch (err) {
    if (err instanceof InboundSmsError) {
      console.error("[sms-status-callback] inbound", err.message)
      if (err.status >= 500) {
        return new Response(err.message, { status: err.status, headers: corsHeaders })
      }
      return emptyOk()
    }
    const message = err instanceof Error ? err.message : String(err)
    if (
      /Invalid Twilio webhook signature/i.test(message) ||
      /Invalid Telnyx webhook signature/i.test(message) ||
      /Missing Telnyx webhook signature headers/i.test(message)
    ) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders })
    }

    console.error("[sms-status-callback] unexpected error", err)
    return new Response(message, { status: 500, headers: corsHeaders })
  }
})
