/**
 * Adapters for legacy notification code ({ sid } | { error }) and thin send helpers.
 * All outbound SMS should flow through getSMSProvider() — never Twilio directly.
 */

import { getSMSProvider } from "./providerFactory.ts"
import type { SendMessageInput, SendMessageResult } from "./types.ts"

export type LegacySmsSendResult = { sid: string } | { error: string }

/** Maps provider send result to legacy shape used by notification logs. */
export function toLegacySmsSendResult(
  result: SendMessageResult,
): LegacySmsSendResult {
  if (result.error) {
    return { error: result.error }
  }
  const sid = result.providerMessageSid ?? result.messageId
  if (!sid) {
    return { error: "SMS send returned no provider message sid" }
  }
  return { sid }
}

/**
 * Drop-in replacement for the former sendTwilioSms(to, body) helper.
 * Uses providerFactory.getSMSProvider() under the hood.
 */
export async function sendOutboundSms(
  to: string,
  body: string,
  options?: Pick<SendMessageInput, "from" | "mediaUrls">,
): Promise<LegacySmsSendResult> {
  const result = await getSMSProvider().sendMessage({
    to,
    body,
    from: options?.from,
    mediaUrls: options?.mediaUrls,
  })
  return toLegacySmsSendResult(result)
}

/** Full provider result when callers need status or providerMessageSid explicitly. */
export async function sendOutboundSmsDetailed(
  input: SendMessageInput,
): Promise<SendMessageResult> {
  return getSMSProvider().sendMessage(input)
}
