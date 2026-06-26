import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getSMSProvider, resolveProviderName } from "../_shared/sms/providerFactory.ts"
import { resolveTwilioWebhookValidationUrl } from "../_shared/sms/TwilioProvider.ts"
import {
  InboundSmsError,
  processInboundSms,
  twilioEmptyTwiMLResponse,
} from "../_shared/sms/inbound_processor.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature, telnyx-signature-ed25519, telnyx-timestamp",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function webhookAckResponse(): Response {
  if (resolveProviderName() === "telnyx") {
    return new Response("", { status: 200, headers: corsHeaders })
  }
  return twilioEmptyTwiMLResponse()
}

function errorResponse(message: string, status: number): Response {
  console.error("[sms-inbound]", message)
  if (status >= 500) {
    return new Response(message, { status, headers: corsHeaders })
  }
  if (status === 401) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders })
  }
  return webhookAckResponse()
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

    console.info("[sms-inbound] processed", {
      providerMessageSid: inbound.providerMessageSid,
      releasedPending: "releasedPending" in result && result.releasedPending === true,
      workflowRoute: "workflowRoute" in result ? result.workflowRoute : undefined,
      identityType: "identityType" in result ? result.identityType : undefined,
      conversationId: result.conversationId,
      messageId: result.messageId,
      outboundMessageId: result.outboundMessageId,
    })

    // Replies are sent via getSMSProvider().sendMessage(); return provider-specific ack.
    return webhookAckResponse()
  } catch (err) {
    if (err instanceof InboundSmsError) {
      return errorResponse(err.message, err.status)
    }

    const message = err instanceof Error ? err.message : String(err)
    if (
      /Invalid Twilio webhook signature/i.test(message) ||
      /Invalid Telnyx webhook signature/i.test(message) ||
      /Missing Telnyx webhook signature headers/i.test(message)
    ) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders })
    }

    console.error("[sms-inbound] unexpected error", err)
    return errorResponse(message, 500)
  }
})
