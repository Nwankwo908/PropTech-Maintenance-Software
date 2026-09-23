import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getSMSProvider } from "../_shared/sms/providerFactory.ts"
import { ensureTwilioMessagingWebhooks, resolveTwilioWebhookValidationUrl } from "../_shared/sms/TwilioProvider.ts"
import {
  InboundSmsError,
  processInboundSms,
  twilioEmptyTwiMLResponse,
} from "../_shared/sms/inbound_processor.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function webhookAckResponse(): Response {
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders })
  }

  const rawBody = await req.clone().text()
  const signature = req.headers.get("X-Twilio-Signature") ?? ""
  const url = resolveTwilioWebhookValidationUrl(req.url)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return errorResponse("Server misconfigured", 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  await ensureTwilioMessagingWebhooks().catch((err) => {
    console.warn("[sms-inbound] twilio webhook ensure", err)
  })

  try {
    const inbound = await getSMSProvider().normalizeInboundWebhook(req, {
      rawBody,
      signature,
      url,
    })

    const result = await processInboundSms(supabase, inbound)

    console.info("[sms-inbound] processed", {
      providerMessageSid: inbound.providerMessageSid,
      releasedPending: "releasedPending" in result && result.releasedPending === true,
      unmatchedSharedDid:
        "unmatchedSharedDid" in result && result.unmatchedSharedDid === true,
      workflowRoute: "workflowRoute" in result ? result.workflowRoute : undefined,
      identityType: "identityType" in result ? result.identityType : undefined,
      conversationId: result.conversationId,
      messageId: result.messageId,
      outboundMessageId:
        "outboundMessageId" in result ? result.outboundMessageId : undefined,
    })

    return webhookAckResponse()
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
