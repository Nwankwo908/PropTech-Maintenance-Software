import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getSMSProvider } from "../_shared/sms/providerFactory.ts"
import { resolveTwilioWebhookValidationUrl } from "../_shared/sms/TwilioProvider.ts"
import {
  InboundSmsError,
  processInboundSms,
  twilioEmptyTwiMLResponse,
  twilioMessageResponse,
} from "../_shared/sms/inbound_processor.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function errorResponse(message: string, status: number): Response {
  console.error("[sms-inbound]", message)
  if (status >= 500) {
    return new Response(message, { status, headers: corsHeaders })
  }
  return twilioEmptyTwiMLResponse()
}

Deno.serve(async (req) => {
  // 1. Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders })
  }

  // 2. Clone the request body before doing anything else
  const rawBody = await req.clone().text()

  // 3. Extract headers needed for validation
  const signature = req.headers.get("X-Twilio-Signature") ?? ""
  // Must match Twilio Console webhook URL exactly (not internal edge-runtime URL).
  const url = resolveTwilioWebhookValidationUrl(req.url)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return errorResponse("Server misconfigured", 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const provider = getSMSProvider()
    const inbound = await provider.normalizeInboundWebhook(req, {
      rawBody,
      signature,
      url,
    })

    const result = await processInboundSms(supabase, inbound)

    if (result.releasedPending) {
      console.info("[sms-inbound] released_pending reply", {
        providerMessageSid: inbound.providerMessageSid,
        to: inbound.to,
      })
      return twilioMessageResponse(result.autoReply)
    }

    console.info("[sms-inbound] processed", {
      providerMessageSid: inbound.providerMessageSid,
      workflowRoute: result.workflowRoute,
      identityType: result.identityType,
      conversationId: result.conversationId,
      messageId: result.messageId,
    })

    return twilioEmptyTwiMLResponse()
  } catch (err) {
    if (err instanceof InboundSmsError) {
      return errorResponse(err.message, err.status)
    }

    const message = err instanceof Error ? err.message : String(err)
    if (/Invalid Twilio webhook signature/i.test(message)) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders })
    }

    console.error("[sms-inbound] unexpected error", err)
    return errorResponse(message, 500)
  }
})
